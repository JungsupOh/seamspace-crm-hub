// order-submit-quote 의 순수 로직 — 입력 검증 / 견적번호 / 딜 분류 / 행 만들기.
//
// 원본은 src/pages/OrderTest.tsx 의 saveWebQuote(:631-800 대)다. 순서와 값을 그대로 옮겼다.
//   ① 견적번호 채번   ② 같은 전화의 딜 조회 → 재구매/머지 판정   ③ 딜 PATCH 또는 INSERT
//   ④ 머지면 기존 견적 is_selected=false   ⑤ deal_quotes INSERT
//
// ⚠️ 가격은 브라우저가 계산해 보낸다(원본과 같다). 서버가 가격표를 다시 계산하지는 않는다 —
//    pricing.ts 를 Deno 로 옮겨야 해서 이번 범위를 넘는다. 대신 **내부 정합성**을 본다
//    (공급가+세액=합계, 값의 범위·형식). 완전한 서버 재계산은 후속 과제로 남겼다.
//    견적은 결제 금액의 근거가 아니다 — 결제 승인은 confirm-payment 가 따로 검증한다.

export const CLOSED_STAGES = [
  '입금완료', '이용권 발송완료', '딜취소', '계약파기', 'Closed_Won', 'Contract',
];

const MAX_TEXT = 200;
const MAX_MONEY = 1_000_000_000;      // 10억 — 이보다 큰 견적은 웹 주문에 없다
const MAX_QTY = 100_000;

export interface SubmitInput {
  productCode: string;        // '01' 이면 이용권 상품(기간·단가 필드를 채운다)
  productName: string;
  planLabel: string;
  orgName: string;
  contactName: string;
  phone: string;
  email: string;
  students: number | null;    // 총인원(학생수). 없으면 null
  qty: number;                // 이용권 수
  months: number;
  unitPrice: number;
  supply: number;
  tax: number;
  total: number;
  items: unknown[];           // 견적 라인(브라우저가 buildQuoteItems 로 만든 것)
  notesStudents: string;      // 메모에 쓰는 "학생수" 원문(빈 문자열 가능)
  leadSource: string;         // contacts 활동이력의 유입경로(빈 문자열이면 기본값)
}

export type Verdict =
  | { ok: true; value: SubmitInput }
  | { ok: false; status: 400; error: string };

const str = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));

export function validateInput(raw: unknown): Verdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const ALLOWED = ['productCode','productName','planLabel','orgName','contactName','phone','email',
                   'students','qty','months','unitPrice','supply','tax','total','items','notesStudents',
                   // HARD-B2c: contacts 등록을 같은 요청 안에서 하므로 유입경로가 함께 온다.
                   // 활동이력 본문은 서버가 만든다(buildQuoteActivityNote) — 받지 않는다.
                   'leadSource'];
  const unknown = Object.keys(b).filter(k => !ALLOWED.includes(k));
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const productCode = str(b.productCode, 10);
  const orgName = str(b.orgName);
  const contactName = str(b.contactName, 50);
  const phone = str(b.phone, 30);
  if (!productCode || !orgName || !contactName || !phone) {
    return { ok: false, status: 400, error: '필수 정보가 비어 있습니다.' };
  }
  const email = str(b.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: '이메일을 정확히 입력해 주세요.' };
  }

  const qty = num(b.qty), months = num(b.months);
  const unitPrice = num(b.unitPrice), supply = num(b.supply), tax = num(b.tax), total = num(b.total);
  for (const [k, v] of [['qty', qty], ['months', months]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > MAX_QTY) {
      return { ok: false, status: 400, error: `${k} 값이 올바르지 않습니다.` };
    }
  }
  for (const [k, v] of [['unitPrice', unitPrice], ['supply', supply], ['tax', tax], ['total', total]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > MAX_MONEY) {
      return { ok: false, status: 400, error: `${k} 값이 올바르지 않습니다.` };
    }
  }
  // 내부 정합성 — 공급가 + 세액 = 합계 (반올림 1원 오차 허용)
  if (productCode === '01' && Math.abs((supply + tax) - total) > 1) {
    return { ok: false, status: 400, error: '금액이 올바르지 않습니다.' };
  }

  const students = b.students === null || b.students === undefined ? null : num(b.students);
  if (students !== null && (!Number.isFinite(students) || students < 0 || students > MAX_QTY)) {
    return { ok: false, status: 400, error: 'students 값이 올바르지 않습니다.' };
  }
  const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];

  return {
    ok: true,
    value: {
      productCode, productName: str(b.productName, 100), planLabel: str(b.planLabel, 100),
      orgName, contactName, phone, email,
      students, qty, months, unitPrice, supply, tax, total, items,
      notesStudents: str(b.notesStudents, 20),
      leadSource: str(b.leadSource, 50),
    },
  };
}

/** 견적번호 채번 — 원본과 같은 규칙: `{연도}-{상품코드}-{4자리}` */
export function nextQuoteNumber(prefix: string, lastQuoteNumber: string | null): string {
  let seq = 1;
  if (lastQuoteNumber) {
    const lastSeq = parseInt(lastQuoteNumber.split('-')[2] ?? '0', 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export interface DealRow { id: string; deal_stage: string; created_date: string; quote_number?: string }

export interface DealDecision {
  dealType: 'New' | 'Renewal';
  mergeDealId: string | null;
}

/** 재구매·머지 판정 — 원본(:666-690)과 같은 규칙. */
export function decideDeal(all: DealRow[], today: string): DealDecision {
  const list = Array.isArray(all) ? all : [];
  const thirtyDaysAgo = new Date(new Date(today).getTime() - 30 * 24 * 3600 * 1000)
    .toISOString().slice(0, 10);
  const dealType: 'New' | 'Renewal' =
    list.some(d => CLOSED_STAGES.includes(d.deal_stage)) ? 'Renewal' : 'New';
  const open = list.find(d => !CLOSED_STAGES.includes(d.deal_stage) && d.created_date >= thirtyDaysAgo);
  return { dealType, mergeDealId: open ? open.id : null };
}

const lic = (i: SubmitInput, v: number) => (i.productCode === '01' ? v : null);

/** 딜 갱신 본문(머지일 때) — 원본과 같은 필드. */
export function buildDealPatch(i: SubmitInput, today: string, qNum: string): Record<string, unknown> {
  return {
    quote_date: today,
    quote_qty: i.students,
    license_code_count: i.qty,
    quote_plan: i.planLabel,
    quote_number: qNum,
    license_duration: lic(i, i.months),
    unit_price: lic(i, i.unitPrice),
    supply_price: lic(i, i.supply),
    tax_amount: lic(i, i.tax),
    final_contract_value: lic(i, i.total),
  };
}

/** 신규 딜 본문 — 원본과 같은 필드. */
export function buildDealInsert(i: SubmitInput, today: string, qNum: string, dealType: string): Record<string, unknown> {
  return {
    deal_name: `심스페이스-${i.productName} - ${i.orgName}`,
    deal_stage: '견적',
    deal_type: dealType,
    contact_name: i.contactName,
    contact_phone: i.phone,
    contact_email: i.email || null,
    org_name: i.orgName,
    quote_date: today,
    quote_qty: i.students,
    license_code_count: i.qty,
    quote_plan: i.planLabel,
    quote_number: qNum,
    license_duration: lic(i, i.months),
    unit_price: lic(i, i.unitPrice),
    supply_price: lic(i, i.supply),
    tax_amount: lic(i, i.tax),
    final_contract_value: lic(i, i.total),
    lead_source: 'Web',
    order_date: today,
    created_date: today,
    notes: `[웹주문] ${i.contactName} (${i.phone})${i.notesStudents ? ` 학생 ${i.notesStudents}명` : ''}`,
  };
}

/** 견적 행 — 원본과 같은 필드. */
export function buildQuoteInsert(
  i: SubmitInput, today: string, qNum: string, dealId: string, phoneNorm: string,
): Record<string, unknown> {
  const u = (v: number) => (i.productCode === '01' ? v : undefined);
  return {
    deal_id: dealId,
    quote_number: qNum,
    plan: i.planLabel,
    qty: i.students,
    license_qty: i.qty,
    items: i.items,
    duration: u(i.months),
    unit_price: u(i.unitPrice),
    supply_price: u(i.supply),
    tax_amount: u(i.tax),
    final_value: u(i.total),
    contact_phone: phoneNorm,
    quote_date: today,
    is_selected: true,
    notes: `[웹주문] 상품: 심스페이스-${i.productName} / 기관: ${i.orgName} / 담당자: ${i.contactName} / 연락처: ${i.phone} / 이메일: ${i.email}${i.notesStudents ? ` / 학생수: ${i.notesStudents}명` : ''}`,
    source: 'web',
    buyer_phone: i.phone,
    buyer_phone_normalized: phoneNorm,
    buyer_name: i.contactName,
    buyer_email: i.email || null,
    org_name: i.orgName,
    order_status: '견적',
    student_count: i.students,
  };
}

export const normalizePhoneDigits = (p: string) => p.replace(/\D/g, '');

// ─────────────────────────────────────────────────────────────────────────────
// contacts 등록 — HARD-B2c 에서 브라우저(lib/public/leadContact.ts)에서 옮겨 왔다.
//
// 왜 옮기나: 공개 /order 가 contacts 를 **공개 키로 직접 읽고 썼다**. contacts 는
// 1,500명 넘는 사람의 이름·전화·이메일·소속·내부 메모가 들어 있는 표다. 그 정책을
// 닫으려면 이 호출이 사라져야 한다(hard_b2b_result.md §D-2).
//
// 동작은 원본과 **글자 단위로 같다** — 전화번호로 찾고, 빈 칸만 채우고, 활동이력은
// 같은 줄이 이미 있으면 덧붙이지 않는다. 바뀐 것은 "누가 DB를 읽느냐"뿐이다.
//
// ⚠️ 전화번호 정규화는 원본이 lib/phone.ts 의 normalizePhone(국가 코드 인식)을 썼다.
//    여기서는 국내('kr')만 쓰므로 그 규칙만 옮긴다 — 원본 호출부(OrderTest.tsx)가
//    country:'kr' 로 고정이었다. 다른 국가가 필요해지면 그때 옮긴다.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadMember {
  name: string;
  phone: string;
  email: string;
  orgName: string;
}

export interface LeadOptions {
  leadSource?: string;
  activityNote?: string;
}

export type LeadVerdict =
  | { ok: true; member: LeadMember; options: LeadOptions }
  | { ok: false; status: 400; error: string };

/** lib/phone.ts 의 'kr' 규칙 — 숫자만 남긴다. */
export function normalizeKrPhone(p: unknown): string {
  return typeof p === 'string' ? p.replace(/\D/g, '') : '';
}

export function validateLead(raw: unknown): LeadVerdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const ALLOWED = ['action', 'name', 'phone', 'email', 'orgName', 'leadSource', 'activityNote'];
  const unknown = Object.keys(b).filter(k => !ALLOWED.includes(k));
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const name = str(b.name, 50);
  const phone = str(b.phone, 30);
  const orgName = str(b.orgName);
  if (!phone || normalizeKrPhone(phone).length < 9) {
    return { ok: false, status: 400, error: '연락처를 정확히 입력해 주세요.' };
  }
  const email = str(b.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: '이메일을 정확히 입력해 주세요.' };
  }
  return {
    ok: true,
    member: { name, phone, email, orgName },
    options: {
      leadSource: str(b.leadSource, 50) || undefined,
      // 활동이력은 화면이 만든 한 줄이다. 길이만 자른다.
      activityNote: str(b.activityNote, 500) || undefined,
    },
  };
}

export interface ContactRow {
  id: string;
  name?: unknown;
  email?: unknown;
  org_name?: unknown;
  notes?: unknown;
}

/**
 * 기존 contact 에 덧쓸 내용 — 원본(leadContact.ts:75-87)과 같은 규칙.
 *
 * ⚠️ **비어 있는 칸만** 채운다. 이미 값이 있으면 덮어쓰지 않는다 — 영업팀이 손으로
 *    고친 이름·소속을 웹 주문이 되돌리면 안 된다.
 * ⚠️ 활동이력은 **같은 줄이 이미 있으면 덧붙이지 않는다**(오늘 같은 폼을 두 번 내도
 *    한 줄만 남는다). 원본의 중복 방지 규칙 그대로다.
 */
export function buildContactPatch(
  existing: ContactRow, member: LeadMember, options: LeadOptions,
): { patch: Record<string, unknown>; activityAppended: boolean } {
  const patch: Record<string, unknown> = {};
  if (!existing.name && member.name) patch.name = member.name;
  if (!existing.email && member.email) patch.email = member.email;
  if (!existing.org_name && member.orgName) patch.org_name = member.orgName;

  let activityAppended = false;
  const note = (options.activityNote ?? '').trim();
  if (note) {
    const prevNotes = (existing.notes ?? '').toString();
    if (!prevNotes.includes(note)) {
      patch.notes = [note, prevNotes].filter(Boolean).join('\n');
      activityAppended = true;
    }
  }
  return { patch, activityAppended };
}

/** 신규 contact 본문 — 원본(leadContact.ts:99-118)과 같은 필드. */
export function buildContactInsert(
  member: LeadMember, options: LeadOptions, phoneNorm: string,
): Record<string, unknown> {
  const note = (options.activityNote ?? '').trim();
  return {
    name: member.name,
    phone: member.phone,
    phone_normalized: phoneNorm,
    email: member.email,
    org_name: member.orgName,
    contact_type: '리드',
    // 원본의 기본값이 '럭키세븐 5월' 이었다. /order 는 항상 leadSource 를 넘기므로
    // 그 기본값이 쓰인 적은 없지만, 값을 바꾸면 집계가 달라지므로 그대로 둔다.
    lead_source: options.leadSource ?? '럭키세븐 5월',
    ...(note ? { notes: note } : {}),
  };
}

/**
 * 접수 활동이력 한 줄 — 원본 OrderTest.tsx:739 와 **글자 단위로 같다**.
 *
 * 이 줄은 브라우저가 만들 수 없다. 견적번호·머지 여부·재구매 여부가 서버 응답으로만
 * 정해지기 때문이다(원본은 응답을 받은 뒤 두 번째 요청에서 만들었다).
 *
 * ⚠️ 금액은 `ko-KR` 로 고정한다. 브라우저의 toLocaleString() 은 접속 환경의 로캘을
 *    따르지만 한국 사용자 전용 화면이라 실제로는 늘 ko-KR 이었다. 서버에서 기본
 *    로캘에 맡기면 "1234000" 처럼 쉼표가 빠질 수 있어 명시한다.
 */
export function buildQuoteActivityNote(a: {
  today: string; quoteNumber: string; planLabel: string;
  months: number; qty: number; total: number;
  merged: boolean; dealType: string;
}): string {
  const suffix = a.merged ? ' (기존 딜에 추가)' : (a.dealType === 'Renewal' ? ' (재구매)' : '');
  return `[${a.today}] 웹 견적서 발급 — ${a.quoteNumber} / ${a.planLabel} ${a.months}개월 × ${a.qty} / ${a.total.toLocaleString('ko-KR')}원${suffix}`;
}
