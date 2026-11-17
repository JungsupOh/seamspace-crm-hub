// 도매 선구매 원장 — 구매 합계 · 청구 · 입금 · 미수금 (LEAD-S7-2a · CRM-016)
//
// `partnerContract.ts` 를 **재사용한다** — 잔량과 인원·개월 계산을 두 벌로 만들면
// "화면과 서버가 다른 숫자"가 생긴다. 여기서는 **돈** 쪽만 더한다.
//
// 이 파일이 지키는 약속
//   ① **통화를 섞어 더하지 않는다.** 환산하지 않는다(환율 기준일이 아직 ❓ — S6 1-4).
//      합계는 통화별로만 낸다.
//   ② **`billing_status` 는 이름표일 뿐이고 사실은 금액이다.** 미수액은
//      `amount − paid_amount` 로 센다. 이름표와 금액이 어긋나면 **감추지 않고 알린다**.
//   ③ 셀 수 없는 것을 0 으로 바꾸지 않는다. 청구 금액이 비어 있으면 "모름"이고
//      0 원 청구가 아니다.
//   ④ 미수 경과일은 **청구일(invoiced_on) 기준**이다 — James 확정 Q3 "청구 후 30일·60일".
//   ⑤ 초과 입금을 음수로 숨기지 않고 따로 보여 준다.

import {
  balanceOf, purchasedSeatMonths,
  type Balance, type Contract, type IssuedRow, type PurchaseRow,
} from './partnerContract';

// ───────────────────────── 원장 한 줄 ─────────────────────────

export const BILLING_STATUSES = ['unbilled', 'billed', 'partial', 'paid'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const BILLING_LABEL: Record<BillingStatus, string> = {
  unbilled: '청구 전', billed: '청구함', partial: '일부 입금', paid: '입금 완료',
};

/** 구매 회차 한 줄. `PurchaseRow`(수량)에 돈 쪽을 더한 것. */
export interface PurchaseLine extends PurchaseRow {
  id?: string;
  /**
   * 무효 사유. 표에는 `voided_at` 과 **짝으로** 있어야 한다(CHECK).
   * 처음에 이 칸을 형에서 못 썼다 — 화면이 "왜 무효한지"를 보여 주려면 필요하다.
   */
  void_reason?: string | null;
  contract_id?: string | null;
  purchased_on?: string | null;
  unit_price_per_seat_year?: number | null;
  currency?: string | null;
  amount?: number | null;
  invoice_no?: string | null;
  billing_status?: unknown;
  invoiced_on?: string | null;
  paid_on?: string | null;
  paid_amount?: number | null;
}

export function toBillingStatus(v: unknown): BillingStatus | null {
  return typeof v === 'string' && (BILLING_STATUSES as readonly string[]).includes(v)
    ? (v as BillingStatus)
    : null;
}

/** 살아 있는 회차인가 — 무효 표시한 줄은 어떤 합계에도 넣지 않는다. */
export function isLivePurchase(p: PurchaseLine): boolean {
  return !p.voided_at;
}

/**
 * 돈을 읽는다. **모를면 null** — 0 이 아니다.
 *
 * ⚠️ `Number(null)` 은 **0** 이다. 그것을 거르지 않으면 초안에 주었던
 *    "금여 미포잡 미포잡"이 **0 원 진짜**로 보여 미수금이 사라진다.
 *    (LEAD-UI2 에서 `qualityLabel(null)` 이 "낮은 (0)" 으로 보이던 것과 같은 종류의
 *     상처다. 돈에서는 더 나발다 — 영수증을 끔짜는 일이 된다.)
 *    `''`·`true`·배열도 사람이 적은 금에갑이 아니므로 거리는 쪽이 맞다.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 계산상의 청구 금액 — `seat_months / 12 × 연간 인원당 단가`.
 *
 * **강제하지 않는다.** 할인·절삭·협의가 있어 실제 `amount` 와 다를 수 있다.
 * 화면이 "계산값과 다릅니다"를 보여 주는 데만 쓴다. 셀 수 없으면 null.
 */
export function expectedAmount(p: PurchaseLine): number | null {
  const sm = num(p.seat_months);
  const price = num(p.unit_price_per_seat_year);
  if (sm === null || price === null || sm <= 0) return null;
  return Math.round((sm / 12) * price * 100) / 100;
}

/** 실제 금액이 계산값과 다른가(차이가 1원/센트를 넘으면). 모르면 null. */
export function amountDiffers(p: PurchaseLine): boolean | null {
  const expected = expectedAmount(p);
  const actual = num(p.amount);
  if (expected === null || actual === null) return null;
  return Math.abs(expected - actual) > 1;
}

// ───────────────────────── 금액에서 읽는 상태 ─────────────────────────

export interface MoneyOf {
  /** 청구 금액. 비어 있으면 null — **0 원 청구가 아니다** */
  billed: number | null;
  /** 들어온 금액 */
  paid: number;
  /** 청구 − 입금. 음수면 초과 입금. 청구 금액을 모르면 null */
  outstanding: number | null;
  /** 초과로 들어온 금액(0 이상) */
  overpaid: number;
  /** 금액에서 읽은 상태 — `billing_status` 이름표가 아니라 **사실** */
  derived: BillingStatus;
}

/**
 * 한 줄의 돈 상태를 **금액에서** 읽는다.
 *
 * `billing_status` 를 믿지 않는다 — 이름표는 사람이 바꾸는 것이고, 돈은 숫자다.
 * 청구를 안 했으면(`invoiced_on`·`invoice_no`·상태 어느 것으로도 청구 흔적이 없으면)
 * 미수금이 아니다 — 아직 우리가 달라고 하지 않았다.
 */
export function moneyOf(p: PurchaseLine): MoneyOf {
  const billed = num(p.amount);
  const paid = num(p.paid_amount) ?? 0;
  const invoiced = isInvoiced(p);

  const outstanding = billed === null ? null : billed - paid;
  const overpaid = billed === null ? 0 : Math.max(0, paid - billed);

  let derived: BillingStatus;
  if (!invoiced) derived = 'unbilled';
  else if (billed !== null && paid >= billed && billed > 0) derived = 'paid';
  else if (billed !== null && billed === 0 && paid === 0) derived = 'paid';   // 무상 배정
  else if (paid > 0) derived = 'partial';
  else derived = 'billed';

  return { billed, paid, outstanding, overpaid, derived };
}

/**
 * 청구했는가. 청구일이 가장 믿을 만하고, 없으면 청구서 번호나 상태로 본다.
 * (상태만 'billed' 인데 청구일이 없는 줄이 있을 수 있다 — 그건 경과일을 셀 수 없다.)
 */
export function isInvoiced(p: PurchaseLine): boolean {
  if (p.invoiced_on) return true;
  if (typeof p.invoice_no === 'string' && p.invoice_no.trim() !== '') return true;
  const s = toBillingStatus(p.billing_status);
  return s === 'billed' || s === 'partial' || s === 'paid';
}

/** 적어 둔 이름표가 금액과 어긋나는가. 어긋나면 화면이 보여 준다(감추지 않는다). */
export function statusDisagrees(p: PurchaseLine): boolean {
  const label = toBillingStatus(p.billing_status);
  if (label === null) return true;              // 모르는 값이면 어긋난 것으로 본다
  return label !== moneyOf(p).derived;
}

// ───────────────────────── 미수 경과일 ─────────────────────────

/**
 * James 확정 Q3: **청구 후 30일 · 60일 2단계.**
 * 30일에 우리에게, 60일에 우리 + 파트너 담당자. (실제 알림은 S7-8, 여기서는 판정만.)
 */
export const RECEIVABLE_D30 = 30;
export const RECEIVABLE_D60 = 60;

export const RECEIVABLE_BASIS =
  `미수 경과일은 **청구일**부터 셉니다(James 확정: "청구 후 ${RECEIVABLE_D30}일·${RECEIVABLE_D60}일"). ` +
  '입금 기한 칸을 따로 두지 않았습니다 — 기한은 계약마다 다르고, 적지 않으면 셀 수 없게 됩니다. ' +
  '청구 전(unbilled)은 미수금이 아니고, 청구일이 비어 있으면 경과일을 세지 않습니다(추측하지 않습니다).';

export type ReceivableStage = 'none' | 'd30' | 'd60';

const DAY = 86400000;

function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const s = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

/**
 * 청구일부터 오늘까지 며칠. 셀 수 없으면 null.
 *
 * 다 받은 줄과 무효 줄은 미수금이 아니므로 null 이다.
 * **청구일이 비어 있으면 세지 않는다** — "아마 그 무렵" 으로 알림을 보내면 안 된다.
 */
export function receivableDays(p: PurchaseLine, today: string): number | null {
  if (!isLivePurchase(p)) return null;
  const m = moneyOf(p);
  // 청구 전은 여기서 따로 거를 필요가 없다 — 청구일이 없으면 아래 날짜 계산에서
  // null 이 되고, **청구일이 있으면 unbilled 일 수 없다**(isInvoiced).
  // 그 부분은 중복 가드가 아니라 **불변식 테스트**로 지킨다.
  if (m.derived === 'paid') return null;
  if (m.outstanding === null || m.outstanding <= 0) return null;

  const from = dayOf(p.invoiced_on);
  const t = dayOf(today);
  if (!from || !t) return null;
  const d = Math.round((Date.parse(t) - Date.parse(from)) / DAY);
  return d >= 0 ? d : null;   // 미래 청구일(입력 오류)은 세지 않는다
}

export function receivableStage(p: PurchaseLine, today: string): ReceivableStage {
  const d = receivableDays(p, today);
  if (d === null) return 'none';
  if (d >= RECEIVABLE_D60) return 'd60';
  if (d >= RECEIVABLE_D30) return 'd30';
  return 'none';
}

export const STAGE_LABEL: Record<ReceivableStage, string> = {
  none: '—',
  d30: `${RECEIVABLE_D30}일 경과 (우리에게 알림)`,
  d60: `${RECEIVABLE_D60}일 경과 (우리 + 파트너 담당자)`,
};

// ───────────────────────── 통화별 합계 ─────────────────────────

/** 통화 이름이 없으면 `(미지정)` 으로 **따로** 모은다 — 다른 통화와 섞지 않는다. */
export const NO_CURRENCY = '(미지정)';

export function currencyOf(p: PurchaseLine): string {
  const c = p.currency;
  return typeof c === 'string' && c.trim() !== '' ? c.trim().toUpperCase() : NO_CURRENCY;
}

export interface CurrencyTotal {
  currency: string;
  /** 청구한 금액 합계 */
  billed: number;
  paid: number;
  outstanding: number;
  overpaid: number;
  /** 청구 금액을 알 수 없는 줄 수. 0 이 아니면 합계를 **믿으면 안 된다** */
  unknownAmounts: number;
  lines: number;
}

/**
 * 통화별 합계. **환산하지 않는다**(설계 5-3 "통화가 섞여 합계가 틀린다").
 *
 * 청구 금액이 비어 있는 줄은 **0 으로 치지 않고** `unknownAmounts` 로 센다 —
 * 0 으로 치면 미수금이 실제보다 적어 보인다.
 */
export function totalsByCurrency(lines: readonly PurchaseLine[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const p of lines) {
    if (!isLivePurchase(p)) continue;
    const cur = currencyOf(p);
    const t = map.get(cur) ?? {
      currency: cur, billed: 0, paid: 0, outstanding: 0, overpaid: 0,
      unknownAmounts: 0, lines: 0,
    };
    const m = moneyOf(p);
    t.lines += 1;
    t.paid += m.paid;
    if (m.billed === null) t.unknownAmounts += 1;
    else {
      t.billed += m.billed;
      // 미수액은 **청구한 줄에서만** 센다. 청구 전은 아직 받을 돈이 아니다.
      if (m.derived !== 'unbilled' && m.outstanding !== null && m.outstanding > 0) {
        t.outstanding += m.outstanding;
      }
    }
    t.overpaid += m.overpaid;
    map.set(cur, t);
  }
  // 미수액이 큰 통화부터
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding || a.currency.localeCompare(b.currency));
}

// ───────────────────────── 계약 한 줄 요약 ─────────────────────────

export interface ContractSummary {
  contractId: string;
  /** 구매 합계(인원·개월, 무효 제외) */
  purchased: number;
  /** 발급 합계(인원·개월, **무효화한 이용권도 센다**) */
  issued: number;
  /** 잔량 = 구매 − 발급 */
  balance: number;
  /** 수량을 셀 수 없는 발급 기록 수. 0 이 아니면 잔량을 믿으면 안 된다 */
  unknownIssues: number;
  /** 통화별 돈 합계 */
  money: CurrencyTotal[];
  /** 가장 오래된 미수 경과일. 미수금이 없으면 null */
  oldestReceivableDays: number | null;
  /** 그중 가장 심한 단계 */
  worstStage: ReceivableStage;
  /** 이름표가 금액과 어긋나는 줄 수 */
  disagreeingLines: number;
  purchaseLines: number;
}

/**
 * S7-2b 화면이 **그대로 쓰는** 한 줄 요약. 화면에서 다시 세지 않는다.
 *
 * 잔량은 `partnerContract.balanceOf` 를 그대로 쓴다(계산을 두 벌로 만들지 않는다).
 */
export function contractSummary(
  contract: Pick<Contract, 'id'>,
  purchases: readonly PurchaseLine[],
  issues: readonly IssuedRow[],
  today: string,
): ContractSummary {
  const live = purchases.filter(isLivePurchase);
  const bal: Balance = balanceOf(live, issues);

  let oldest: number | null = null;
  let worst: ReceivableStage = 'none';
  let disagreeing = 0;

  for (const p of live) {
    const d = receivableDays(p, today);
    if (d !== null && (oldest === null || d > oldest)) oldest = d;
    const s = receivableStage(p, today);
    if (s === 'd60' || (s === 'd30' && worst === 'none')) worst = s;
    if (statusDisagrees(p)) disagreeing += 1;
  }

  return {
    contractId: contract.id,
    purchased: bal.purchased,
    issued: bal.issued,
    balance: bal.balance,
    unknownIssues: bal.unknownIssues,
    money: totalsByCurrency(live),
    oldestReceivableDays: oldest,
    worstStage: worst,
    disagreeingLines: disagreeing,
    purchaseLines: live.length,
  };
}

/** 구매 합계만 따로 필요할 때 — `partnerContract` 의 것을 그대로 내보낸다. */
export { purchasedSeatMonths };
