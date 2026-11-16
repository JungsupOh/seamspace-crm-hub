// 해외 리드 엑셀 가져오기 — LEAD-6 (CRM-014)
//
// 기존 `campaign-lead-import.ts`(국내 부스 스캔, **핸드폰 기준**)와 **섞지 않는다.**
// 섞으면 휴대폰 없는 해외 리드가 전부 제외되거나(지금 noPhone 규칙), 빈 휴대폰끼리
// 중복으로 잡힌다. 그래서 이 파일은 **이메일을 열쇠로** 따로 돈다.
//
// ⚠️ 헤더가 두 가지다.
//   ① 브리프 E항의 영문 헤더(행사 앱 내보내기): Name / Organization / Position /
//      Email / Phone / Country / Visited at / Notes
//   ② **James 의 실제 첫 사용 파일은 한글 헤더다** — 등급 / 이름 / 소속 / 이메일 /
//      국가 / 출처 / 현장 메모·근거 / 발송 가능 / 주의·메모.
//      (명령서는 영문 헤더를 가정했지만 파일을 읽어 보니 한글이었다. 둘 다 받는다.)
//
// 이 파일은 **순수 함수**다(fetch 없음). 파일 읽기만 XLSX 를 쓴다.

import * as XLSX from 'xlsx';
import { hasUncertainty, normalizeCountry, regionOf, stripAnnotation, type Region } from './leadRegion';
import { normalizeLeadEmail, normalizeLeadPhone } from './leadMarket';

/** 열 이름 후보 — 앞에 있는 것이 우선. 대소문자·공백은 무시한다. */
const FIELD_ALIASES: Record<string, readonly string[]> = {
  name:        ['이름', '성명', 'name', 'full name', 'contact name', 'first name'],
  org:         ['소속', '기관', '학교', '회사', 'organization', 'organisation', 'company', 'school', 'institution'],
  position:    ['직위', '직책', '담당', 'position', 'title', 'job title', 'role'],
  email:       ['이메일', '메일', 'e-mail', 'email', 'email address'],
  phone:       ['전화', '연락처', '휴대폰', '핸드폰', 'phone', 'mobile', 'tel', 'telephone', 'contact number'],
  country:     ['국가', '나라', 'country', 'country/region', 'nation'],
  visitedAt:   ['방문시간', '방문일', '일시', 'visited at', 'visited', 'date', 'scan time', 'timestamp'],
  notes:       ['현장 메모/근거', '현장 메모·근거', '메모', '비고', 'notes', 'note', 'remarks', 'comment'],
  grade:       ['등급', '세그먼트', 'grade', 'segment', 'tier'],
  sendable:    ['발송 가능', '발송가능', '발송여부', 'sendable', 'send', 'email status'],
  caution:     ['주의·메모', '주의 메모', '주의', 'caution', 'warning'],
  source:      ['출처', 'source', 'lead source', 'origin'],
  consent:     ['수신 동의', '마케팅 수신 동의', 'consent', 'marketing consent', 'opt-in'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** 파일의 실제 헤더를 우리 칸에 맞춘다. 맞춘 결과는 문서(매핑표)에 쓴다. */
export function mapHeaders(headers: readonly string[]): Record<string, string | null> {
  const found: Record<string, string | null> = {};
  const normed = headers.map(h => ({ raw: h, n: norm(String(h)) }));
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    found[field] = null;
    for (const a of aliases) {
      const hit = normed.find(h => h.n === norm(a));
      if (hit) { found[field] = hit.raw; break; }
    }
    // 정확히 못 맞췄으면 포함 관계로 한 번 더 (예: 'Email Address (work)')
    if (!found[field]) {
      for (const a of aliases) {
        const hit = normed.find(h => h.n.includes(norm(a)));
        if (hit) { found[field] = hit.raw; break; }
      }
    }
  }
  return found;
}

/** 등급 → 세그먼트 A~E. `B-교육`·`C2` 같은 변형을 첫 글자로 줄인다. */
export function toSegment(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^([A-E])/);
  return m ? m[1] : null;
}

/** 등급이 '제외'인가 — 그 행은 가져오지 않는다. */
export function isExcludedGrade(v: unknown): boolean {
  return typeof v === 'string' && /제외|exclude/i.test(v);
}

export type EmailStatus = 'unverified' | 'valid' | 'invalid' | 'bounced' | 'hold';

/**
 * '발송 가능' 칸 → 이메일 상태.
 *
 * ⚠️ **안전한 쪽으로 기운다.** `OK`·`선택` 만 보낼 수 있다고 보고,
 *    나머지(보류·확인·제외·빈값·모르는 값)는 전부 `hold`(발송 보류)로 표시한다.
 *    반대로 기울면 보류해야 할 사람에게 메일이 나간다 — 되돌릴 수 없다.
 */
export function toEmailStatus(v: unknown): EmailStatus {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (s === 'OK' || s === '선택' || s === 'SEND' || s === 'Y' || s === 'YES') return 'unverified';
  return 'hold';
}

/** 이메일 신뢰도 1~5. 손글씨·추측 표시가 있으면 낮춘다. */
export function emailQuality(email: string | null, uncertainHints: readonly unknown[]): number {
  if (!email) return 1;
  let q = 4;
  if (uncertainHints.some(h => hasUncertainty(h))) q -= 2;
  // 흔한 무료 메일은 기관 담당자 확인이 더 필요하다(발송을 막지는 않는다)
  if (/@(gmail|hotmail|yahoo|outlook|naver|qq|163)\./i.test(email)) q -= 1;
  return Math.max(1, Math.min(5, q));
}

export interface IntlLeadRow {
  name: string;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
  school_name: string | null;
  position: string | null;
  country: string | null;          // 정규화된 코드 또는 원본
  region: Region;                  // 파생값(저장하지 않는다 — 미리보기 표시용)
  event_name: string | null;
  segment: string | null;
  source_type: string;
  email_status: EmailStatus;
  email_quality: number;
  notes: string | null;
  visited_at: string | null;
  /** 원본 보존 — 우리 칸에 자리가 없는 열과 주석이 붙은 원본 값 */
  custom_fields: Record<string, string>;
  /** 파일에서의 행 번호(1부터, 헤더 제외) — 사람이 엑셀에서 찾아갈 수 있게 */
  rowNo: number;
}

export interface ExcludedRow {
  rowNo: number;
  reason: 'noEmail' | 'badEmail' | 'dupInFile' | 'excludedGrade';
  /** 사람이 찾아갈 수 있게 **소속만** 적는다. 이름·이메일은 적지 않는다(개인정보). */
  org: string;
}

export interface IntlImportResult {
  rows: IntlLeadRow[];
  total: number;
  excluded: ExcludedRow[];
  /** 파일 헤더 → 우리 칸 매핑(문서·화면에 그대로 보여 준다) */
  headerMap: Record<string, string | null>;
  /** 우리 칸에 맞추지 못한 헤더 */
  unmapped: string[];
  /** 발송 보류로 표시된 건수 */
  holdCount: number;
  /** 이메일 신뢰도가 낮은(≤2) 건수 */
  lowQualityCount: number;
}

export interface IntlImportOptions {
  /** 행사명 — 파일에 없으므로 화면에서 받는다 */
  eventName?: string;
  /** 행사 시간대(분). 싱가포르 UTC+8 = 480, 미국 동부 -300, 런던 0. 기본은 한국(540). */
  tzOffsetMinutes?: number;
  /** 출처 유형 기본값 */
  sourceType?: string;
}

const txt = (v: unknown) => String(v ?? '').trim();

/** 엑셀의 날짜/시각을 **행사 시간대**로 해석해 ISO 로. */
export function excelDateToISO(v: unknown, tzOffsetMinutes = 540): string | null {
  if (v == null || v === '') return null;
  const offMs = tzOffsetMinutes * 60 * 1000;
  const fromWallClock = (y: number, mo: number, d: number, h: number, mi: number, sec: number) =>
    new Date(Date.UTC(y, mo - 1, d, h, mi, sec) - offMs).toISOString();

  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return fromWallClock(d.y, d.m, d.d, d.H ?? 0, d.M ?? 0, Math.floor(d.S ?? 0));
  }
  const raw = String(v).trim();
  if (!raw) return null;
  // ⚠️ 오전/오후 표시가 **시각 앞뒤 어디든** 올 수 있다.
  //    한국어는 "오후 2:30", 영어는 "2:30 PM" 이다. 한쪽만 읽으면 오후가 오전으로
  //    해석돼 **방문 시각이 12시간 밀린다**(날짜까지 어긋날 수 있다).
  const m = raw.match(
    /(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[\sT]+(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(오전|오후|AM|PM)?)?/i,
  );
  if (m) {
    const [, y, mo, d, ampmBefore, hh, mi, ss, ampmAfter] = m;
    let hour = hh ? Number(hh) : 0;
    const ap = (ampmBefore || ampmAfter || '').toUpperCase();
    if ((ap === '오후' || ap === 'PM') && hour < 12) hour += 12;
    if ((ap === '오전' || ap === 'AM') && hour === 12) hour = 0;
    return fromWallClock(Number(y), Number(mo), Number(d), hour, Number(mi ?? 0), Number(ss ?? 0));
  }
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 시트 데이터(이미 읽은 객체 배열)를 가져오기 결과로.
 * 파일 읽기와 분리한 이유: 이쪽만 순수 함수라 테스트할 수 있다.
 */
export function parseIntlRows(
  raw: readonly Record<string, unknown>[],
  headers: readonly string[],
  options: IntlImportOptions = {},
): IntlImportResult {
  const map = mapHeaders(headers);
  const used = new Set(Object.values(map).filter(Boolean) as string[]);
  const unmapped = headers.filter(h => !used.has(h));
  const tz = options.tzOffsetMinutes ?? 540;

  const rows: IntlLeadRow[] = [];
  const excluded: ExcludedRow[] = [];
  const seen = new Set<string>();

  const get = (r: Record<string, unknown>, field: string) =>
    map[field] ? txt(r[map[field]!]) : '';

  raw.forEach((r, i) => {
    const rowNo = i + 1;
    const org = get(r, 'org');

    if (isExcludedGrade(get(r, 'grade'))) {
      excluded.push({ rowNo, reason: 'excludedGrade', org });
      return;
    }

    const emailRaw = get(r, 'email');
    const email = normalizeLeadEmail(emailRaw);
    if (!email) { excluded.push({ rowNo, reason: 'noEmail', org }); return; }
    if (!EMAIL_RE.test(email)) { excluded.push({ rowNo, reason: 'badEmail', org }); return; }
    if (seen.has(email)) { excluded.push({ rowNo, reason: 'dupInFile', org }); return; }
    seen.add(email);

    const countryRaw = get(r, 'country');
    const phoneRaw = get(r, 'phone');
    const phoneNorm = normalizeLeadPhone(phoneRaw);
    const notes = [get(r, 'notes'), get(r, 'caution')].filter(Boolean).join(' / ') || null;

    // 우리 칸에 자리가 없는 열과 **주석이 붙은 원본**은 그대로 남긴다.
    const custom: Record<string, string> = {};
    for (const h of unmapped) { const v = txt(r[h]); if (v) custom[h] = v; }
    if (countryRaw && stripAnnotation(countryRaw) !== countryRaw) custom['국가_원본'] = countryRaw;
    const gradeRaw = get(r, 'grade');
    if (gradeRaw && toSegment(gradeRaw) !== gradeRaw) custom['등급_원본'] = gradeRaw;
    const src = get(r, 'source');
    if (src) custom['출처_원본'] = src;

    rows.push({
      name: get(r, 'name') || '(이름없음)',
      email: emailRaw || null,
      email_normalized: email,
      phone: phoneRaw || null,
      phone_normalized: phoneNorm || null,
      school_name: org || null,
      position: get(r, 'position') || null,
      country: normalizeCountry(countryRaw),
      region: regionOf({ country: countryRaw, phone: phoneRaw }),
      event_name: options.eventName?.trim() || null,
      segment: toSegment(gradeRaw),
      source_type: options.sourceType ?? 'exhibition',
      email_status: toEmailStatus(get(r, 'sendable')),
      email_quality: emailQuality(email, [countryRaw, gradeRaw, notes, get(r, 'caution')]),
      notes,
      visited_at: excelDateToISO(map.visitedAt ? r[map.visitedAt] : '', tz),
      custom_fields: custom,
      rowNo,
    });
  });

  return {
    rows,
    total: raw.length,
    excluded,
    headerMap: map,
    unmapped,
    holdCount: rows.filter(r => r.email_status === 'hold').length,
    lowQualityCount: rows.filter(r => r.email_quality <= 2).length,
  };
}

/** 이미 등록된 리드와 겹치는지 — **이메일 기준**(국내 휴대폰 기준과 섞지 않는다). */
export function markExistingDuplicates(
  rows: readonly IntlLeadRow[],
  existingEmailNormalized: readonly (string | null | undefined)[],
): { fresh: IntlLeadRow[]; dupInDb: IntlLeadRow[] } {
  const have = new Set(
    existingEmailNormalized.map(e => normalizeLeadEmail(e)).filter(Boolean) as string[],
  );
  const fresh: IntlLeadRow[] = [];
  const dupInDb: IntlLeadRow[] = [];
  for (const r of rows) {
    if (r.email_normalized && have.has(r.email_normalized)) dupInDb.push(r);
    else fresh.push(r);
  }
  return { fresh, dupInDb };
}

/** 행사별 시간대 — 브리프 E항 "행사별 시간대 지정". */
export const EVENT_TIMEZONES: ReadonlyArray<{ label: string; minutes: number }> = [
  { label: '한국 (UTC+9)', minutes: 540 },
  { label: '싱가포르·홍콩 (UTC+8)', minutes: 480 },
  { label: '인도 (UTC+5:30)', minutes: 330 },
  { label: '두바이 (UTC+4)', minutes: 240 },
  { label: '런던 (UTC+0)', minutes: 0 },
  { label: '미국 동부 (UTC-5)', minutes: -300 },
  { label: '미국 서부 (UTC-8)', minutes: -480 },
];

/** 파일을 읽어 파싱까지. 시트 이름을 고를 수 있다(James 파일은 '전체 명단'). */
export function parseIntlLeadExcel(
  file: File, options: IntlImportOptions & { sheetName?: string } = {},
): Promise<IntlImportResult & { sheetNames: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array', cellDates: false });
        const sheet = (options.sheetName && wb.Sheets[options.sheetName])
          ? options.sheetName : wb.SheetNames[0];
        const ws = wb.Sheets[sheet];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        const headerRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
        const headers = (headerRows[0] ?? []).map(h => String(h)).filter(Boolean);
        resolve({ ...parseIntlRows(raw, headers, options), sheetNames: wb.SheetNames });
      } catch {
        reject(new Error('엑셀 파싱 실패 — 이메일 열이 있는지 확인하세요'));
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsArrayBuffer(file);
  });
}
