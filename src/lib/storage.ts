// Supabase Storage — deal-files 버킷
// Supabase Dashboard > Storage > New bucket: "deal-files" (Public) 생성 필요

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BUCKET = 'deal-files';

const DB_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// ── Supabase Storage 업로드 ────────────────────────
export async function uploadDealFile(dealId: string, file: File): Promise<{ name: string; url: string }> {
  const ts     = Date.now();
  const dotIdx = file.name.lastIndexOf('.');
  const rawExt  = dotIdx >= 0 ? file.name.slice(dotIdx + 1) : '';
  const rawBase = dotIdx >= 0 ? file.name.slice(0, dotIdx) : file.name;
  const ext  = rawExt.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
  const safe = rawBase
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'file';
  const path = `deals/${dealId}/${ts}-${safe}.${ext}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `업로드 실패: ${res.status}`);
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return { name: file.name, url };
}

// ── Supabase DB — deal_files 테이블 ───────────────
export interface DealFileRecord {
  id: string;
  deal_id: string;
  slot_key: string;
  label: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
}

const DB_URL = `${SUPABASE_URL}/rest/v1/deal_files`;

export async function saveDealFileRecord(
  record: Omit<DealFileRecord, 'id' | 'uploaded_at'>
): Promise<DealFileRecord> {
  const res = await fetch(DB_URL, {
    method: 'POST',
    headers: { ...DB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `파일 메타데이터 저장 실패: ${res.status}`);
  }
  const [row] = await res.json();
  return row;
}

export async function getDealFiles(dealId: string): Promise<DealFileRecord[]> {
  const res = await fetch(
    `${DB_URL}?deal_id=eq.${encodeURIComponent(dealId)}&order=uploaded_at.asc`,
    { headers: DB_HEADERS }
  );
  if (!res.ok) throw new Error(`파일 목록 조회 실패: ${res.status}`);
  return res.json();
}

export async function deleteDealFileRecord(id: string): Promise<void> {
  const res = await fetch(`${DB_URL}?id=eq.${id}`, {
    method: 'DELETE',
    headers: DB_HEADERS,
  });
  if (!res.ok) throw new Error(`파일 삭제 실패: ${res.status}`);
}

// ── Supabase DB — deal_licenses 테이블 ───────────
// 이용권 발급 수량만큼 각 코드를 '대기' 상태로 등록
// 실제 사용 여부는 추후 서비스 DB 연동으로 조회

export type LicenseStatus = '대기' | '사용중' | '만료' | '이탈';

export interface DealLicenseRecord {
  id: string;
  deal_id: string;
  coupon_code: string;
  contact_name: string;
  contact_phone: string;
  org_name: string;
  duration: string;
  user_count: string;
  status: LicenseStatus;
  service_expire_at: string | null; // 운영DB 동기화 후 저장
  member_count?: number | null;     // 실제 사용 인원 (운영DB 동기화)
  group_name?: string | null;       // mDiary 그룹명 (운영DB 동기화)
  edu_office_name?: string | null;  // 교육청명 (운영DB 동기화)
  admin_name?: string | null;       // 그룹 관리자 이름 (운영DB 동기화)
  admin_phone?: string | null;      // 그룹 관리자 전화번호 (운영DB 동기화)
  admin_last_login?: string | null; // 그룹 관리자 최근 로그인 (운영DB 동기화)
  created_at: string;
}

const LICENSE_URL = `${SUPABASE_URL}/rest/v1/deal_licenses`;

export async function saveDealLicenses(
  records: Omit<DealLicenseRecord, 'id' | 'created_at'>[]
): Promise<DealLicenseRecord[]> {
  if (records.length === 0) return [];
  const res = await fetch(LICENSE_URL, {
    method: 'POST',
    headers: { ...DB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(records),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `이용권 등록 실패: ${res.status}`);
  }
  return res.json();
}

export async function getDealLicenses(dealId: string): Promise<DealLicenseRecord[]> {
  const res = await fetch(
    `${LICENSE_URL}?deal_id=eq.${encodeURIComponent(dealId)}&order=created_at.asc`,
    { headers: DB_HEADERS }
  );
  if (!res.ok) throw new Error(`이용권 목록 조회 실패: ${res.status}`);
  return res.json();
}

export async function getAllLicenses(): Promise<DealLicenseRecord[]> {
  const [dealRes, mdiaryRes] = await Promise.all([
    fetch(`${LICENSE_URL}?order=created_at.desc&limit=2000`, { headers: DB_HEADERS }),
    fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons?order=created_at.desc&limit=3000`, { headers: DB_HEADERS }),
  ]);

  const dealLicenses: DealLicenseRecord[] = dealRes.ok ? await dealRes.json() : [];

  interface MdiaryCouponRow {
    id: number; coupon_code: string; created_at: string;
    duration: number; user_limit: number; is_used: boolean;
    descript: string; extracted_name: string | null; link_confirmed: boolean | null;
    service_expire_at: string | null; member_count: number | null;
    group_name: string | null; edu_office_name: string | null;
    admin_name: string | null; admin_phone: string | null;
    admin_last_login: string | null;
  }
  const mDiaryCoupons: MdiaryCouponRow[] = mdiaryRes.ok ? await mdiaryRes.json() : [];

  // mDiary 쿠폰을 DealLicenseRecord 형식으로 변환
  const mdiaryAsLicenses: DealLicenseRecord[] = mDiaryCoupons.map(c => ({
    id:               `mdiary_${c.id}`,
    deal_id:          'mdiary',
    coupon_code:      c.coupon_code,
    contact_name:     c.extracted_name ?? '',   // 사람이름만 (descript 폴백 제거)
    contact_phone:    '',
    org_name:         c.descript ?? '',          // 원본 설명 (학교+이름 혼합 가능)
    duration:         String(c.duration),
    user_count:       String(c.user_limit),
    status:           c.is_used ? '사용중' : '대기',
    service_expire_at: c.service_expire_at ?? null,
    member_count:     c.member_count ?? null,
    group_name:       c.group_name ?? null,
    edu_office_name:  c.edu_office_name ?? null,
    admin_name:       c.admin_name ?? null,
    admin_phone:      c.admin_phone ?? null,
    admin_last_login: c.admin_last_login ?? null,
    created_at:       c.created_at,
  }));

  // deal_licenses coupon_code 목록 (중복 제거용)
  const dealCodes = new Set(dealLicenses.map(l => l.coupon_code));
  const uniqueMdiary = mdiaryAsLicenses.filter(l =>
    !dealCodes.has(l.coupon_code) && (mDiaryCoupons.find(c => `mdiary_${c.id}` === l.id)?.link_confirmed !== false)
  );

  return [...dealLicenses, ...uniqueMdiary].sort(
    (a, b) => b.created_at.localeCompare(a.created_at)
  );
}

// ── Supabase DB — deal_quotes 테이블 ─────────────
export interface DealQuote {
  id: string;
  deal_id: string;
  quote_number?: string;
  quote_date?: string;
  plan?: string;
  qty?: number;
  duration?: number;
  unit_price?: number;
  supply_price?: number;
  tax_amount?: number;
  final_value?: number;
  notes?: string;
  is_selected: boolean;
  created_at: string;
}

const QUOTES_URL = `${SUPABASE_URL}/rest/v1/deal_quotes`;

export async function getDealQuotes(dealId: string): Promise<DealQuote[]> {
  const res = await fetch(
    `${QUOTES_URL}?deal_id=eq.${encodeURIComponent(dealId)}&order=created_at.asc`,
    { headers: DB_HEADERS }
  );
  if (!res.ok) throw new Error(`견적 목록 조회 실패: ${res.status}`);
  return res.json();
}

export async function saveDealQuote(
  record: Omit<DealQuote, 'id' | 'created_at'>
): Promise<DealQuote> {
  const res = await fetch(QUOTES_URL, {
    method: 'POST',
    headers: { ...DB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `견적 저장 실패: ${res.status}`);
  }
  const [row] = await res.json();
  return row;
}

export async function updateDealQuote(
  id: string,
  updates: Partial<Omit<DealQuote, 'id' | 'created_at'>>
): Promise<void> {
  const res = await fetch(`${QUOTES_URL}?id=eq.${id}`, {
    method: 'PATCH',
    headers: DB_HEADERS,
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`견적 업데이트 실패: ${res.status}`);
}

export async function deleteDealQuote(id: string): Promise<void> {
  const res = await fetch(`${QUOTES_URL}?id=eq.${id}`, {
    method: 'DELETE',
    headers: DB_HEADERS,
  });
  if (!res.ok) throw new Error(`견적 삭제 실패: ${res.status}`);
}

export async function selectDealQuote(dealId: string, quoteId: string): Promise<void> {
  // 기존 선택 해제
  await fetch(`${QUOTES_URL}?deal_id=eq.${encodeURIComponent(dealId)}`, {
    method: 'PATCH',
    headers: DB_HEADERS,
    body: JSON.stringify({ is_selected: false }),
  });
  // 선택
  await fetch(`${QUOTES_URL}?id=eq.${quoteId}`, {
    method: 'PATCH',
    headers: DB_HEADERS,
    body: JSON.stringify({ is_selected: true }),
  });
}

export async function updateLicenseStatus(id: string, status: LicenseStatus): Promise<void> {
  const res = await fetch(`${LICENSE_URL}?id=eq.${id}`, {
    method: 'PATCH',
    headers: DB_HEADERS,
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`이용권 상태 업데이트 실패: ${res.status}`);
}

export async function updateLicenseDeal(id: string, dealId: string): Promise<void> {
  const res = await fetch(`${LICENSE_URL}?id=eq.${id}`, {
    method: 'PATCH',
    headers: DB_HEADERS,
    body: JSON.stringify({ deal_id: dealId }),
  });
  if (!res.ok) throw new Error(`딜 연결 실패: ${res.status}`);
}

export async function attachCouponToDeal(
  couponCode: string,
  dealId: string,
  info: { contact_name?: string; contact_phone?: string; org_name?: string; duration?: string; user_count?: string }
): Promise<DealLicenseRecord> {
  const MDIARY_URL = `${SUPABASE_URL}/rest/v1/mdiary_coupons`;

  // Check if already in deal_licenses
  const existRes = await fetch(
    `${LICENSE_URL}?coupon_code=eq.${encodeURIComponent(couponCode)}&limit=1`,
    { headers: DB_HEADERS }
  );
  const existing: DealLicenseRecord[] = existRes.ok ? await existRes.json() : [];

  if (existing.length > 0) {
    const patchRes = await fetch(`${LICENSE_URL}?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: { ...DB_HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify({ deal_id: dealId }),
    });
    if (!patchRes.ok) throw new Error(`이용권 연결 실패: ${patchRes.status}`);
    const updated = await patchRes.json();
    return updated[0];
  }

  // Look up coupon details from mdiary_coupons
  const couponRes = await fetch(
    `${MDIARY_URL}?coupon_code=eq.${encodeURIComponent(couponCode)}&limit=1`,
    { headers: DB_HEADERS }
  );
  const coupons: Array<{
    duration: number; user_limit: number; is_used: boolean;
    descript: string | null; service_expire_at: string | null;
  }> = couponRes.ok ? await couponRes.json() : [];

  const c = coupons[0];
  if (!c) throw new Error(`쿠폰 코드를 찾을 수 없습니다: ${couponCode}`);

  const record: Omit<DealLicenseRecord, 'id' | 'created_at'> = {
    deal_id:          dealId,
    coupon_code:      couponCode,
    contact_name:     info.contact_name  ?? '',
    contact_phone:    info.contact_phone ?? '',
    org_name:         info.org_name      ?? (c.descript ?? ''),
    duration:         info.duration      ?? String(c.duration),
    user_count:       info.user_count    ?? String(c.user_limit),
    status:           c.is_used ? '사용중' : '대기',
    service_expire_at: c.service_expire_at ?? null,
  };

  const saved = await saveDealLicenses([record]);
  return saved[0];
}

// ── 레거시 호환 (기존 Notes 파싱 — 마이그레이션 기간용) ──
export interface StoredFile {
  name: string;
  url: string;
  uploadedAt: string;
}

export function parseFileLinks(notes: string): StoredFile[] {
  const regex = /\[📎 ([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const files: StoredFile[] = [];
  let m;
  while ((m = regex.exec(notes)) !== null) {
    files.push({ name: m[1], url: m[2], uploadedAt: '' });
  }
  return files;
}
