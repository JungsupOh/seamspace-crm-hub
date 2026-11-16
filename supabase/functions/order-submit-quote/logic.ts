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
                   'students','qty','months','unitPrice','supply','tax','total','items','notesStudents'];
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
