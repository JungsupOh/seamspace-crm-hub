// 럭키세븐 이벤트 — 그룹 신청 / 결제 묶음 / 라이선스 발급 공용 헬퍼
// /event/lucky-seven 폼 + 결제 페이지 + 어드민 다이얼로그에서 공통 사용

import { apiCreateCoupon, apiSendCoupon } from '@/lib/coupons';
import { airtable } from '@/lib/airtable';
import { saveDealQuote, type DealQuote } from '@/lib/storage';
import { saveDealUsers, type DealUserInput } from '@/lib/deal-users';
import type { DealFields } from '@/types/airtable';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

export const LS_UNIT_PRICE = 100000;          // 멤버 1인당 결제 금액
export const LS_NORMAL_UNIT_PRICE = 240000;   // 정상가 (7개월권 = 6+1 분해 240,000원)
export const LS_DURATION_MONTHS = 7;
export const LS_USER_COUNT = 40;              // 학급플랜 = 40명
export const LS_SERVICE_EXPIRE_AT = '2026-12-31';

// ─────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────

export interface LSLeaderInput {
  schoolName: string;
  schoolCode: string | null;
  schoolKind: string | null;
  position: string;
  name: string;
  phone: string;
  email: string;
  source: string;
  sourceEtc: string | null;
  marketingConsent: boolean;
}

export interface LSMemberInput {
  name: string;
  phone: string;
  email: string;
  schoolName: string;   // 자유입력
}

export interface LSPaymentGroupInput {
  payerName: string;
  payerPhone: string;
  payerEmail: string;
  buyerOrgName: string | null;
  buyerBusinessNo: string | null;
  buyerOrgAddr: string | null;
  buyerOrgCeo: string | null;
  buyerContact: string | null;
  schoolIdUrl: string | null;
  taxInvoiceRequired: boolean;
  memberIndices: number[];  // Step 2의 멤버 인덱스 (0-based, 0번이 대표자)
}

export interface LSGroupRow {
  id: string;
  campaign_id: string;
  group_code: string;
  leader_lead_id: string | null;
  leader_phone_normalized: string;
  member_count: number;
  total_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LSPaymentGroupRow {
  id: string;
  group_id: string;
  quote_number: string;
  payer_name: string;
  payer_phone: string;
  payer_phone_normalized: string;
  payer_email: string;
  buyer_org_name: string | null;
  buyer_business_no: string | null;
  buyer_org_addr: string | null;
  buyer_org_ceo: string | null;
  buyer_contact: string | null;
  school_id_url: string | null;
  amount: number;
  tax_invoice_required: boolean;
  status: string;
  quote_pdf_url: string | null;
  toss_order_id: string | null;
  toss_payment_key: string | null;
  paid_at: string | null;
  email_sent_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LSLeadRow {
  id: string;
  campaign_id: string;
  ls_group_id: string | null;
  ls_payment_group_id: string | null;
  ls_role: string | null;
  ls_member_index: number | null;
  school_name: string | null;
  position: string | null;
  name: string;
  phone: string;
  phone_normalized: string | null;
  email: string | null;
  converted_contact_id: string | null;
}

// ─────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 그룹 코드 생성 (JS) — {YYYY}-LS-{6 alphanum} 형식.
// 견적서 번호는 group_code + '-Q{i}' 로 결합되므로 결제 페이지/링크에서도 동일 prefix 사용.
// 충돌 방지를 위해 호출 측에서 INSERT 실패 시 재시도하도록 설계.
export function generateGroupCode(): string {
  const yyyy = String(new Date().getFullYear());
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 헷갈리는 0/O/I/L/1 제외
  let rand = '';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) rand += alphabet[buf[i] % alphabet.length];
  return `${yyyy}-LS-${rand}`;
}

// 고유번호증 파일 업로드 (Supabase Storage — lucky_seven_school_id_files 버킷)
export async function uploadSchoolIdFile(file: File): Promise<string> {
  const ts = Date.now();
  const dotIdx = file.name.lastIndexOf('.');
  const rawExt = dotIdx >= 0 ? file.name.slice(dotIdx + 1) : 'pdf';
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'pdf';
  const path = `${ts}-${crypto.randomUUID()}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/lucky_seven_school_id_files/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || `파일 업로드 실패 (${r.status})`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/lucky_seven_school_id_files/${path}`;
}

// 묶음 검증: 모든 멤버가 정확히 한 묶음에 속하고, 묶음 합 = member_count
export function validatePaymentGroups(memberCount: number, groups: LSPaymentGroupInput[]): string | null {
  if (groups.length === 0) return '결제 묶음이 1개 이상 필요합니다.';
  const seen = new Set<number>();
  for (const g of groups) {
    if (g.memberIndices.length === 0) return '비어 있는 결제 묶음이 있습니다.';
    for (const idx of g.memberIndices) {
      if (seen.has(idx)) return '한 멤버가 여러 묶음에 중복 배정되었습니다.';
      seen.add(idx);
    }
    if (!g.payerName.trim()) return '결제자 이름이 필요합니다.';
    if (!g.payerPhone.trim()) return '결제자 휴대폰이 필요합니다.';
    if (!g.payerEmail.trim() || !isValidEmail(g.payerEmail)) return '결제자 이메일이 유효하지 않습니다.';
  }
  if (seen.size !== memberCount) return `모든 멤버가 묶음에 배정되어야 합니다 (현재 ${seen.size}/${memberCount}).`;
  return null;
}

// ─────────────────────────────────────────────────
// 캠페인 조회
// ─────────────────────────────────────────────────

export async function fetchLuckySevenCampaign(slug: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?slug=eq.${encodeURIComponent(slug)}&select=*`, { headers: HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] ?? null;
}

// ─────────────────────────────────────────────────
// contacts upsert (멤버 1명)
// 신규면 contact_type='리드' 생성, 기존이면 빈 필드만 보강 (contact_type은 절대 덮어쓰지 않음)
// ─────────────────────────────────────────────────

export async function upsertLeadContact(member: { name: string; phone: string; email: string; orgName: string }): Promise<string> {
  const phoneNorm = normalizePhone(member.phone);

  const findRes = await fetch(
    `${SUPABASE_URL}/rest/v1/contacts?phone_normalized=eq.${encodeURIComponent(phoneNorm)}&select=id,name,email,org_name,contact_type`,
    { headers: HEADERS },
  );
  const found = findRes.ok ? await findRes.json() : [];

  if (Array.isArray(found) && found.length > 0) {
    const existing = found[0];
    const patch: Record<string, unknown> = {};
    if (!existing.name && member.name) patch.name = member.name;
    if (!existing.email && member.email) patch.email = member.email;
    if (!existing.org_name && member.orgName) patch.org_name = member.orgName;
    if (Object.keys(patch).length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
    }
    return existing.id as string;
  }

  // 신규 insert
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: member.name,
      phone: member.phone,
      phone_normalized: phoneNorm,
      email: member.email,
      org_name: member.orgName,
      contact_type: '리드',
      lead_source: '럭키세븐 5월',
    }),
  });
  if (!insertRes.ok) throw new Error('contacts insert 실패');
  const created = await insertRes.json();
  return (Array.isArray(created) ? created[0]?.id : created.id) as string;
}

// ─────────────────────────────────────────────────
// 그룹 신청 제출 (DB만 — 견적서 PDF/이메일은 별도 호출)
// ─────────────────────────────────────────────────

export interface LSSubmitResult {
  group: LSGroupRow;
  paymentGroups: LSPaymentGroupRow[];
  leads: LSLeadRow[];   // ls_member_index 순으로 정렬됨
}

export async function submitLuckySevenGroup(input: {
  campaignId: string;
  leader: LSLeaderInput;
  members: LSMemberInput[];   // 0번이 대표자, 0번에는 leader.name/phone/email/schoolName 동일하게 들어감
}, paymentGroups: LSPaymentGroupInput[]): Promise<LSSubmitResult> {
  const memberCount = input.members.length;
  if (memberCount < 7 || memberCount > 10) throw new Error('멤버 수는 7~10명이어야 합니다.');

  const validationError = validatePaymentGroups(memberCount, paymentGroups);
  if (validationError) throw new Error(validationError);

  // 1) 그룹 코드 생성 (JS) + 그룹 행 생성 (충돌 시 재시도)
  const leaderPhoneNorm = normalizePhone(input.leader.phone);
  let group: LSGroupRow | null = null;
  let groupCode = '';
  for (let attempt = 0; attempt < 5 && !group; attempt++) {
    groupCode = generateGroupCode();
    const groupInsRes = await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_groups`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify({
        campaign_id: input.campaignId,
        group_code: groupCode,
        leader_phone_normalized: leaderPhoneNorm,
        member_count: memberCount,
        total_amount: memberCount * LS_UNIT_PRICE,
        status: '신청',
      }),
    });
    if (groupInsRes.ok) {
      group = (await groupInsRes.json())[0];
      break;
    }
    // 23505 unique violation은 재시도, 그 외는 에러
    const err = await groupInsRes.json().catch(() => ({}));
    if (err.code !== '23505') {
      throw new Error(err.message || `그룹 생성 실패 (${groupInsRes.status})`);
    }
  }
  if (!group) throw new Error('그룹 코드 생성 재시도 실패');

  // 3) 멤버별 contacts upsert + campaign_leads insert
  const leadIds: string[] = [];
  for (let i = 0; i < input.members.length; i++) {
    const m = input.members[i];
    const phoneNorm = normalizePhone(m.phone);
    const isLeader = i === 0;

    // contacts upsert
    const contactId = await upsertLeadContact({
      name: m.name,
      phone: m.phone,
      email: m.email,
      orgName: m.schoolName,
    });

    const leadInsRes = await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify({
        campaign_id: input.campaignId,
        school_name: m.schoolName,
        school_code: isLeader ? input.leader.schoolCode : null,
        school_kind: isLeader ? input.leader.schoolKind : null,
        position: isLeader ? input.leader.position : null,
        name: m.name,
        phone: m.phone,
        phone_normalized: phoneNorm,
        email: m.email,
        source: isLeader ? input.leader.source : '럭키세븐 멤버',
        source_etc: isLeader && input.leader.source === '기타' ? input.leader.sourceEtc : null,
        marketing_consent: isLeader ? input.leader.marketingConsent : false,
        status: '신규',
        is_existing_customer: false,
        converted_contact_id: contactId,
        ls_group_id: group.id,
        ls_role: isLeader ? 'leader' : 'member',
        ls_member_index: i + 1,
      }),
    });
    if (!leadInsRes.ok) throw new Error('멤버 등록 실패');
    const leadRow = (await leadInsRes.json())[0];
    leadIds.push(leadRow.id);
  }

  // 4) 그룹의 leader_lead_id 업데이트
  await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_groups?id=eq.${group.id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ leader_lead_id: leadIds[0] }),
  });
  group.leader_lead_id = leadIds[0];

  // 5) 결제 묶음 insert + 멤버 매핑
  const paymentGroupRows: LSPaymentGroupRow[] = [];
  for (let pgIdx = 0; pgIdx < paymentGroups.length; pgIdx++) {
    const pg = paymentGroups[pgIdx];
    const quoteNumber = `${groupCode}-Q${pgIdx + 1}`;
    const payerPhoneNorm = normalizePhone(pg.payerPhone);

    const pgRes = await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify({
        group_id: group.id,
        quote_number: quoteNumber,
        payer_name: pg.payerName,
        payer_phone: pg.payerPhone,
        payer_phone_normalized: payerPhoneNorm,
        payer_email: pg.payerEmail,
        buyer_org_name: pg.buyerOrgName,
        buyer_business_no: pg.buyerBusinessNo,
        buyer_org_addr: pg.buyerOrgAddr,
        buyer_org_ceo: pg.buyerOrgCeo,
        buyer_contact: pg.buyerContact,
        school_id_url: pg.schoolIdUrl,
        amount: pg.memberIndices.length * LS_UNIT_PRICE,
        tax_invoice_required: pg.taxInvoiceRequired,
        status: '대기',
      }),
    });
    if (!pgRes.ok) throw new Error('결제 묶음 생성 실패');
    const pgRow: LSPaymentGroupRow = (await pgRes.json())[0];
    paymentGroupRows.push(pgRow);

    // 묶음에 속한 멤버들의 campaign_leads.ls_payment_group_id 업데이트
    for (const memberIdx of pg.memberIndices) {
      const leadId = leadIds[memberIdx];
      if (!leadId) continue;
      await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${leadId}`, {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ ls_payment_group_id: pgRow.id }),
      });
    }
  }

  // leads 행을 다시 가져와서 매핑 결과 반환
  const leadsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?ls_group_id=eq.${group.id}&order=ls_member_index.asc&select=*`,
    { headers: HEADERS },
  );
  const leads: LSLeadRow[] = leadsRes.ok ? await leadsRes.json() : [];

  return { group, paymentGroups: paymentGroupRows, leads };
}

// ─────────────────────────────────────────────────
// 그룹 status 갱신 (일부결제/결제완료)
// ─────────────────────────────────────────────────

export async function refreshGroupStatus(groupId: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?group_id=eq.${groupId}&select=status`,
    { headers: HEADERS },
  );
  if (!res.ok) return '신청';
  const rows: { status: string }[] = await res.json();
  const total = rows.length;
  const paid = rows.filter(r => r.status === '결제완료').length;
  let nextStatus = '견적발송';
  if (paid === 0) nextStatus = '견적발송';
  else if (paid < total) nextStatus = '일부결제';
  else nextStatus = '결제완료';

  await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_groups?id=eq.${groupId}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: nextStatus }),
  });
  return nextStatus;
}

// ─────────────────────────────────────────────────
// 견적서 번호로 결제묶음 조회 (결제 페이지용 — anon)
// ─────────────────────────────────────────────────

export async function fetchPaymentGroupByQuoteNumber(quoteNumber: string): Promise<{
  paymentGroup: LSPaymentGroupRow;
  group: LSGroupRow;
  members: LSLeadRow[];
} | null> {
  const pgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=*`,
    { headers: HEADERS },
  );
  if (!pgRes.ok) return null;
  const pgs = await pgRes.json();
  if (!Array.isArray(pgs) || pgs.length === 0) return null;
  const paymentGroup: LSPaymentGroupRow = pgs[0];

  const [groupRes, leadsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_groups?id=eq.${paymentGroup.group_id}&select=*`, { headers: HEADERS }),
    fetch(
      `${SUPABASE_URL}/rest/v1/campaign_leads?ls_payment_group_id=eq.${paymentGroup.id}&order=ls_member_index.asc&select=*`,
      { headers: HEADERS },
    ),
  ]);
  const group = (groupRes.ok ? (await groupRes.json())[0] : null) as LSGroupRow;
  const members = (leadsRes.ok ? await leadsRes.json() : []) as LSLeadRow[];
  if (!group) return null;
  return { paymentGroup, group, members };
}

// ─────────────────────────────────────────────────
// 본인확인 조회 (그룹코드 + 대표자 휴대폰)
// ─────────────────────────────────────────────────

export async function fetchGroupByLeaderAuth(groupCode: string, leaderPhone: string): Promise<{
  group: LSGroupRow;
  paymentGroups: LSPaymentGroupRow[];
  leads: LSLeadRow[];
} | null> {
  const phoneNorm = normalizePhone(leaderPhone);
  const groupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/lucky_seven_groups?group_code=eq.${encodeURIComponent(groupCode)}&leader_phone_normalized=eq.${encodeURIComponent(phoneNorm)}&select=*`,
    { headers: HEADERS },
  );
  if (!groupRes.ok) return null;
  const groups = await groupRes.json();
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const group: LSGroupRow = groups[0];

  const [pgRes, leadsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?group_id=eq.${group.id}&order=quote_number.asc&select=*`, { headers: HEADERS }),
    fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?ls_group_id=eq.${group.id}&order=ls_member_index.asc&select=*`, { headers: HEADERS }),
  ]);
  return {
    group,
    paymentGroups: pgRes.ok ? await pgRes.json() : [],
    leads: leadsRes.ok ? await leadsRes.json() : [],
  };
}

// ─────────────────────────────────────────────────
// 럭키세븐 그룹 → 딜 1건 자동 생성 (그룹 신청 시 영업 추적용)
// + 결제묶음별 deal_quotes 등록
// + 모든 멤버 deal_users로 등록 (대표자=primary)
// + 멱등성: 같은 group_code의 딜이 이미 있으면 skip
// ─────────────────────────────────────────────────

// 같은 group_code로 이미 만들어진 딜이 있는지 확인 (Quote_Number 매칭)
export async function findDealIdForGroupCode(groupCode: string): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/deals?quote_number=eq.${encodeURIComponent(groupCode)}&select=id&limit=1`;
  const r = await fetch(url, { headers: HEADERS }).catch(() => null);
  if (!r?.ok) return null;
  const rows: { id: string }[] = await r.json();
  return rows[0]?.id ?? null;
}

export async function createDealFromLuckySevenGroup(params: {
  group: LSGroupRow;
  leader: LSLeaderInput;
  members: LSLeadRow[];
  paymentGroups: LSPaymentGroupRow[];
}): Promise<{ dealId: string; created: boolean }> {
  const { group, leader, members, paymentGroups } = params;

  // 멱등성: 이미 등록된 딜이 있으면 skip (return 기존 deal id)
  const existing = await findDealIdForGroupCode(group.group_code);
  if (existing) return { dealId: existing, created: false };

  const today = new Date().toISOString().slice(0, 10);
  const totalAmount = group.member_count * LS_UNIT_PRICE;
  const supplyPrice = Math.round(totalAmount / 1.1);
  const taxAmount = totalAmount - supplyPrice;

  const pgSummary = paymentGroups
    .map((pg) => `${pg.quote_number} (${pg.payer_name}, ${pg.amount.toLocaleString('ko-KR')}원)`)
    .join('\n');

  // 1) 03_Deals INSERT
  const dealData: DealFields = {
    Deal_Name: `[럭키세븐] ${group.group_code} ${leader.name} (${leader.schoolName})`,
    Deal_Stage: '견적',
    Deal_Type: 'New',
    Contact_Name: leader.name,
    Contact_Phone: leader.phone,
    Contact_Email: leader.email,
    Org_Name: leader.schoolName,
    Education_Office: leader.schoolKind ?? undefined,
    Quote_Date: today,
    Quote_Qty: group.member_count,
    Quote_Plan: '럭키세븐이벤트플랜',
    Quote_Number: group.group_code,
    License_Duration: LS_DURATION_MONTHS,
    Unit_Price: LS_UNIT_PRICE,
    Supply_Price: supplyPrice,
    Tax_Amount: taxAmount,
    Final_Contract_Value: totalAmount,
    Lead_Source: '럭키세븐 5월',
    Created_Date: today,
    Notes: `럭키세븐 그룹 ${group.group_code} (멤버 ${group.member_count}명, 1인 100,000원 × 7개월)\n결제 묶음 ${paymentGroups.length}건:\n${pgSummary}`,
  };
  const created = await airtable.createRecord<DealFields>('03_Deals', dealData);
  const dealId = created.id;

  // 2) 결제묶음별 deal_quotes INSERT
  for (let i = 0; i < paymentGroups.length; i++) {
    const pg = paymentGroups[i];
    const pgMembers = members.filter((m) => m.ls_payment_group_id === pg.id);
    const qty = pgMembers.length;
    const final_value = qty * LS_UNIT_PRICE;
    const supply = Math.round(final_value / 1.1);
    const tax = final_value - supply;

    const quoteRow: Omit<DealQuote, 'id' | 'created_at'> = {
      deal_id: dealId,
      quote_number: pg.quote_number,
      quote_date: today,
      plan: '럭키세븐이벤트플랜',
      qty,
      license_qty: qty,
      duration: LS_DURATION_MONTHS,
      unit_price: LS_UNIT_PRICE,
      supply_price: supply,
      tax_amount: tax,
      final_value,
      items: [{ plan: '럭키세븐이벤트플랜', duration: LS_DURATION_MONTHS, qty, unit_price: LS_UNIT_PRICE, amount: final_value, s2b_number: '' }],
      discount_amount: 0,
      contact_phone: pg.payer_phone,
      contact_email: pg.payer_email,
      notes: `결제자: ${pg.payer_name} / 묶음 ${i + 1}/${paymentGroups.length}`,
      is_selected: i === 0,    // 첫 묶음을 활성 견적으로
    };
    await saveDealQuote(quoteRow).catch((e) => console.warn(`deal_quote 저장 실패 (${pg.quote_number})`, e));
  }

  // 3) 모든 멤버를 deal_users로 등록 (대표자=primary)
  const userInputs: DealUserInput[] = members.map((m) => ({
    user_name: m.name,
    user_phone: m.phone,
    user_email: m.email ?? undefined,
    student_count: LS_USER_COUNT,
    month_count: LS_DURATION_MONTHS,
    plan_name: '럭키세븐이벤트플랜',
    is_primary: m.ls_role === 'leader',
  }));
  await saveDealUsers(dealId, userInputs).catch((e) => console.warn('deal_users 저장 실패', e));

  return { dealId, created: true };
}

// ─────────────────────────────────────────────────
// 라이선스 일괄 발급 (그룹의 멤버 N명 모두에게 campaign_licenses + 알림톡)
// ─────────────────────────────────────────────────

export async function issueLuckySevenLicenses(group: LSGroupRow, members: LSLeadRow[]): Promise<void> {
  for (const m of members) {
    // 1) 쿠폰 생성
    const couponCode = await apiCreateCoupon(
      `[럭키세븐] ${group.group_code} ${m.name}`,
      String(LS_DURATION_MONTHS),
      String(LS_USER_COUNT),
    );

    // 2) campaign_licenses 행 생성
    await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaign_id: group.campaign_id,
        lead_id: m.id,
        coupon_code: couponCode,
        contact_name: m.name,
        contact_phone: m.phone,
        org_name: m.school_name,
        duration: String(LS_DURATION_MONTHS),
        user_count: String(LS_USER_COUNT),
        status: '대기',
        service_expire_at: LS_SERVICE_EXPIRE_AT,
      }),
    });

    // 3) 쿠폰 알림톡 발송 (기존 인프라)
    await apiSendCoupon({
      first_name: m.name,
      phone: m.phone,
      coupon_code: couponCode,
      user_limit: String(LS_USER_COUNT),
      duration: String(LS_DURATION_MONTHS),
      send_type: 'buyer',
    });
  }

  // 그룹 status='발급완료'
  await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_groups?id=eq.${group.id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: '발급완료' }),
  });
}
