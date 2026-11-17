// 계약·구매 입력 폼의 **순수 부분** (LEAD-S7-2b)
//
// 화면에서 계산하지 않는다 — 잔량·미수금은 `partnerContract.ts`·`partnerLedger.ts` 가 세고,
// 여기서는 **사람이 적은 글자를 DB 가 받을 모양으로 바꾸는 일**과 **보내기 전 검사**만 한다.
//
// 이 파일이 지키는 약속
//   ① DB 의 CHECK 와 **같은 규칙**을 먼저 본다. 서버에서 막히는 것을 화면에서도 막아야
//      "저장 실패" 대신 "무엇이 비었는지"를 보여 줄 수 있다.
//   ② 빈 칸은 `null` 로 보낸다. **빈 문자열이나 0 으로 바꾸지 않는다** —
//      `Number('') === 0` 이라 "단가 미입력"이 "무상(0원)"이 된다.
//   ③ 인원·개월은 **두 칸으로 받아 곱해서** 저장한다(사람은 "40명 12개월"로 생각한다).
//   ④ 원장은 고치지 않는다. 금액을 잘못 적었으면 **무효 후 재등록**이다.

import {
  SETTLEMENT_METHODS, seatMonths, toSettlementMethod,
  type Contract, type ContractStatus, type SettlementMethod,
} from './partnerContract';
import { BILLING_STATUSES, type BillingStatus } from './partnerLedger';

// ───────────────────────── 계약 폼 ─────────────────────────

export interface ContractForm {
  settlement_method: SettlementMethod | '';
  starts_on: string;
  ends_on: string;
  renews_on: string;
  /** 계약 수량은 "인원 × 개월" 두 칸으로 받는다 */
  seats: string;
  months: string;
  unit_price_per_seat_year: string;
  currency: string;
  commission_rate: string;
  is_grant: boolean;
  status: ContractStatus;
  contract_file_id: string;
  notes: string;
}

export function emptyContractForm(today: string, currency = 'USD'): ContractForm {
  return {
    settlement_method: '', starts_on: today, ends_on: '', renews_on: '',
    seats: '', months: '', unit_price_per_seat_year: '', currency,
    commission_rate: '', is_grant: false, status: 'draft',
    contract_file_id: '', notes: '',
  };
}

/** 빈 칸은 null. **`''` 를 0 으로 바꾸지 않는다**(단가 미입력 ≠ 무상). */
function numOrNull(v: string): number | null {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(v: string): string | null {
  const s = v.trim();
  return s === '' ? null : s;
}

/**
 * 계약 수량(인원·개월). 두 칸 중 하나라도 비면 **null**(= 수량 미정).
 * 0 이나 소수는 받지 않는다 — 최소 단위는 1명 × 1개월이다.
 */
export function contractSeatMonths(form: Pick<ContractForm, 'seats' | 'months'>): number | null {
  // 한 칸이 비어 있으면 `Number('')` 은 0 이고, `seatMonths` 는 0 을 거부한다.
  // 그래서 "둘 다 비어 있는가"를 여기서 다시 보지 않는다 — 불변식을 테스트로 지킨다.
  // (빈 칸을 “적지 않았다”고 사람에게 알리는 일은 `validateContractForm` 이 한다.)
  return seatMonths(Number(form.seats.trim()), Number(form.months.trim()));
}

export interface ContractPayload {
  partner_id: string;
  settlement_method: SettlementMethod;
  starts_on: string;
  ends_on: string | null;
  renews_on: string | null;
  contracted_seat_months: number | null;
  unit_price_per_seat_year: number | null;
  currency: string | null;
  commission_rate: number | null;
  is_grant: boolean;
  status: ContractStatus;
  contract_file_id: string | null;
  notes: string | null;
}

/**
 * 폼 → DB 로 보낼 모양.
 *
 * **방식과 무관한 칸은 보내지 않고 null 로 비운다.** 커미션 계약에 단가가 남아 있으면
 * 나중에 "이 계약은 도매였나" 하고 헷갈린다.
 */
export function toContractPayload(form: ContractForm, partnerId: string): ContractPayload | null {
  const method = toSettlementMethod(form.settlement_method);
  if (!method) return null;
  const wholesale = method === 'wholesale';
  return {
    partner_id: partnerId,
    settlement_method: method,
    starts_on: form.starts_on,
    ends_on: textOrNull(form.ends_on),
    renews_on: textOrNull(form.renews_on),
    contracted_seat_months: contractSeatMonths(form),
    unit_price_per_seat_year: wholesale
      ? (form.is_grant ? 0 : numOrNull(form.unit_price_per_seat_year))
      : null,
    currency: wholesale ? textOrNull(form.currency) : null,
    commission_rate: wholesale ? null : numOrNull(form.commission_rate),
    is_grant: wholesale ? form.is_grant : false,
    status: form.status,
    contract_file_id: textOrNull(form.contract_file_id),
    notes: textOrNull(form.notes),
  };
}

/** 폼 채우기(수정 화면) — 저장된 계약을 두 칸(인원·개월)으로 되돌릴 수는 없다. */
/**
 * 폼 채우기(수정 화면).
 *
 * `Contract` 에 없는 칸(renews_on·is_grant·contract_file_id·notes)도 읽어야 하므로
 * 넘어오는 객체를 넣게 받고, 칸마다 모양을 다시 확인한다.
 */
export interface ContractLike extends Contract {
  renews_on?: string | null;
  is_grant?: boolean | null;
  contract_file_id?: string | null;
  notes?: string | null;
}

export function contractToForm(c: ContractLike, today: string): ContractForm {
  const sm = typeof c.contracted_seat_months === 'number' ? c.contracted_seat_months : null;
  return {
    settlement_method: toSettlementMethod(c.settlement_method) ?? '',
    starts_on: String(c.starts_on ?? today).slice(0, 10),
    ends_on: c.ends_on ? String(c.ends_on).slice(0, 10) : '',
    renews_on: c.renews_on ? String(c.renews_on).slice(0, 10) : '',
    // 저장된 것은 곱한 값뿐이라 **인원 칸에 전부 넣고 개월을 1 로** 둔다.
    // (어떻게 쪼갰는지는 저장하지 않는다 — 40명 12개월과 480명 1개월은 같은 수량이다.)
    seats: sm === null ? '' : String(sm),
    months: sm === null ? '' : '1',
    unit_price_per_seat_year:
      c.unit_price_per_seat_year === null || c.unit_price_per_seat_year === undefined
        ? '' : String(c.unit_price_per_seat_year),
    currency: String(c.currency ?? ''),
    commission_rate:
      c.commission_rate === null || c.commission_rate === undefined
        ? '' : String(c.commission_rate),
    is_grant: c.is_grant === true,
    status: (c.status as ContractStatus) ?? 'draft',
    contract_file_id: String(c.contract_file_id ?? ''),
    notes: String(c.notes ?? ''),
  };
}

export interface FormProblem { field: string; message: string }

/**
 * 보내기 전 검사. **DB 의 CHECK 와 같은 규칙**이라 여기서 막히면 서버에서도 막힌다.
 *
 * `draft` 는 비어 있어도 된다(마법사 중간 저장). `active` 로 올릴 때만 방식별 필수값을 따진다.
 */
export function validateContractForm(form: ContractForm): FormProblem[] {
  const out: FormProblem[] = [];
  const method = toSettlementMethod(form.settlement_method);

  if (!method) out.push({ field: 'settlement_method', message: '정산 방식을 고르세요.' });
  if (!form.starts_on.trim()) out.push({ field: 'starts_on', message: '계약 시작일이 필요합니다.' });
  if (form.ends_on.trim() && form.starts_on.trim() && form.ends_on < form.starts_on) {
    out.push({ field: 'ends_on', message: '종료일이 시작일보다 앞섭니다.' });
  }

  // 수량: 한 칸만 채우면 셀 수 없다
  const s = form.seats.trim(), m = form.months.trim();
  if ((s === '') !== (m === '')) {
    out.push({ field: 'seats', message: '인원과 개월 수를 함께 적으세요(또는 둘 다 비우세요).' });
  } else if (s !== '' && contractSeatMonths(form) === null) {
    out.push({ field: 'seats', message: '인원과 개월 수는 1 이상 정수여야 합니다(반 달은 없습니다).' });
  }

  const price = numOrNull(form.unit_price_per_seat_year);
  const rate = numOrNull(form.commission_rate);
  if (form.unit_price_per_seat_year.trim() !== '' && (price === null || price < 0)) {
    out.push({ field: 'unit_price_per_seat_year', message: '단가는 0 이상 숫자여야 합니다.' });
  }
  if (form.commission_rate.trim() !== '' && (rate === null || rate < 0 || rate > 100)) {
    out.push({ field: 'commission_rate', message: '수수료율은 0~100 사이여야 합니다.' });
  }

  if (form.is_grant && method !== 'wholesale') {
    out.push({ field: 'is_grant', message: '무상 배정은 도매형에서만 쓸 수 있습니다.' });
  }

  // active 로 올릴 때만 방식별 필수값
  if (form.status === 'active' && method) {
    if (method === 'wholesale') {
      if (!form.is_grant && price === null) {
        out.push({ field: 'unit_price_per_seat_year', message: '도매형을 유효 상태로 올리려면 단가가 필요합니다(무상이면 "무상 배정"을 켜세요).' });
      }
      if (!textOrNull(form.currency)) {
        out.push({ field: 'currency', message: '도매형을 유효 상태로 올리려면 통화가 필요합니다.' });
      }
    } else if (rate === null) {
      out.push({ field: 'commission_rate', message: '커미션형을 유효 상태로 올리려면 수수료율이 필요합니다.' });
    }
  }
  return out;
}

/** 방식에 따라 **보여 줄 칸**만 고른다. 쓰지 않을 칸을 보여 주면 잘못 적게 된다. */
export function visibleFields(method: SettlementMethod | ''): {
  price: boolean; currency: boolean; rate: boolean; quantity: boolean; grant: boolean;
} {
  const wholesale = method === 'wholesale';
  return {
    price: wholesale, currency: wholesale, grant: wholesale,
    rate: method === 'commission',
    quantity: method !== '',
  };
}

/** 수정 화면에서 정산 방식 칸을 잠그는가 — **만든 뒤에는 늘 잠근다**(새 계약을 만든다). */
export function isMethodLocked(isEdit: boolean): boolean {
  return isEdit;
}

export const METHOD_LOCK_HINT =
  '정산 방식은 만든 뒤 바꿀 수 없습니다. 이 계약에 달린 구매·발급·정산의 뜻이 통째로 달라지기 때문입니다. 바꾸려면 새 계약을 만드세요.';

// ───────────────────────── 구매 폼 ─────────────────────────

export interface PurchaseForm {
  purchased_on: string;
  seats: string;
  months: string;
  unit_price_per_seat_year: string;
  currency: string;
  amount: string;
  invoice_no: string;
  billing_status: BillingStatus;
  invoiced_on: string;
  paid_on: string;
  paid_amount: string;
  memo: string;
}

export function emptyPurchaseForm(today: string, contract?: Contract): PurchaseForm {
  return {
    purchased_on: today, seats: '', months: '',
    unit_price_per_seat_year:
      contract?.unit_price_per_seat_year === null || contract?.unit_price_per_seat_year === undefined
        ? '' : String(contract.unit_price_per_seat_year),
    currency: String(contract?.currency ?? 'USD'),
    amount: '', invoice_no: '', billing_status: 'unbilled',
    invoiced_on: '', paid_on: '', paid_amount: '', memo: '',
  };
}

export interface PurchasePayload {
  contract_id: string;
  purchased_on: string;
  seat_months: number;
  unit_price_per_seat_year: number | null;
  currency: string | null;
  amount: number | null;
  invoice_no: string | null;
  billing_status: BillingStatus;
  invoiced_on: string | null;
  paid_on: string | null;
  paid_amount: number | null;
  memo: string | null;
}

export function toPurchasePayload(form: PurchaseForm, contractId: string): PurchasePayload | null {
  const sm = seatMonths(Number(form.seats.trim()), Number(form.months.trim()));
  if (sm === null) return null;
  return {
    contract_id: contractId,
    purchased_on: form.purchased_on,
    seat_months: sm,
    unit_price_per_seat_year: numOrNull(form.unit_price_per_seat_year),
    currency: textOrNull(form.currency),
    amount: numOrNull(form.amount),
    invoice_no: textOrNull(form.invoice_no),
    billing_status: form.billing_status,
    invoiced_on: textOrNull(form.invoiced_on),
    paid_on: textOrNull(form.paid_on),
    paid_amount: numOrNull(form.paid_amount),
    memo: textOrNull(form.memo),
  };
}

export function validatePurchaseForm(form: PurchaseForm): FormProblem[] {
  const out: FormProblem[] = [];
  if (!form.purchased_on.trim()) out.push({ field: 'purchased_on', message: '구매일이 필요합니다.' });

  if (!form.seats.trim() || !form.months.trim()) {
    out.push({ field: 'seats', message: '인원과 개월 수를 적으세요.' });
  } else if (seatMonths(Number(form.seats), Number(form.months)) === null) {
    out.push({ field: 'seats', message: '인원과 개월 수는 1 이상 정수여야 합니다(반 달은 없습니다).' });
  }

  for (const [field, label] of [
    ['unit_price_per_seat_year', '단가'], ['amount', '금액'], ['paid_amount', '입금액'],
  ] as const) {
    const raw = form[field].trim();
    if (raw === '') continue;
    const n = numOrNull(raw);
    if (n === null || n < 0) out.push({ field, message: `${label}은 0 이상 숫자여야 합니다.` });
  }

  // DB CHECK 와 같은 규칙: 입금일이 있으면 입금액이 있어야 한다
  if (form.paid_on.trim() && form.paid_amount.trim() === '') {
    out.push({ field: 'paid_amount', message: '입금일을 적으면 입금액도 적어야 합니다.' });
  }
  // 반대로 입금액만 있으면 언제 들어왔는지 모른다 — 경과일을 셀 수 없다
  if (form.paid_amount.trim() && !form.paid_on.trim()) {
    out.push({ field: 'paid_on', message: '입금액을 적으면 입금일도 적어야 합니다.' });
  }
  if (!(BILLING_STATUSES as readonly string[]).includes(form.billing_status)) {
    out.push({ field: 'billing_status', message: '청구 상태를 고르세요.' });
  }
  return out;
}

/**
 * 구매 원장에서 **고칠 수 있는 칸**. 금액·수량·날짜는 고치지 않는다 —
 * 원장이라 "무효 후 재등록"이 맞다. 메모와 청구서 번호는 사실을 바꾸지 않으므로 허용한다.
 */
export const EDITABLE_PURCHASE_FIELDS = ['memo', 'invoice_no'] as const;

export const PURCHASE_EDIT_HINT =
  '금액·수량·날짜를 잘못 적었으면 고치지 말고 **무효 처리한 뒤 다시 등록**하세요. 원장은 고친 흔적이 남지 않으면 나중에 설명할 수 없습니다. 메모와 청구서 번호는 바로 고칠 수 있습니다.';

/** 청구·입금 처리만 따로 보내는 모양(원장 한 줄의 상태 변화). */
export interface BillingPatch {
  billing_status?: BillingStatus;
  invoice_no?: string | null;
  invoiced_on?: string | null;
  paid_on?: string | null;
  paid_amount?: number | null;
}

export function toBillingPatch(form: Pick<PurchaseForm,
  'billing_status' | 'invoice_no' | 'invoiced_on' | 'paid_on' | 'paid_amount'>): BillingPatch {
  return {
    billing_status: form.billing_status,
    invoice_no: textOrNull(form.invoice_no),
    invoiced_on: textOrNull(form.invoiced_on),
    paid_on: textOrNull(form.paid_on),
    paid_amount: numOrNull(form.paid_amount),
  };
}

// ───────────────────────── 보여 주기 ─────────────────────────

/** 금액은 **통화를 같이** 보여 준다(요구 6). 통화를 모르면 숫자만. */
export function money(amount: unknown, currency?: unknown): string {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return '—';
  const cur = typeof currency === 'string' && currency.trim() !== '' ? currency.trim().toUpperCase() : '';
  const s = n.toLocaleString('ko-KR');
  return cur ? `${s} ${cur}` : s;
}

/** 인원·개월을 사람 말로. */
export function seatMonthsLabel(v: unknown): string {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('ko-KR')} 인원·개월`;
}

export const QUANTITY_HINT = '100명이 1년이면 1,200 인원·개월입니다. 파트너는 산 수량을 인원과 개월로 쪼개 씁니다.';

/** 무효 처리에는 사유가 필요하다(DB CHECK 와 같은 규칙). */
export function validateVoidReason(reason: string): FormProblem[] {
  return reason.trim() === ''
    ? [{ field: 'void_reason', message: '무효로 바꾸는 이유를 적으세요. 나중에 설명할 수 없습니다.' }]
    : [];
}

export { SETTLEMENT_METHODS, BILLING_STATUSES };
