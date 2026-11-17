// 미수금 셈 — 서버 쪽 거울 (LEAD-S7-8)
//
// ⚠️ `src/lib/partnerLedger.ts` 와 **같은 규칙**이어야 한다. 다르면 관리자 화면과
//    알림이 다른 숫자를 말하고, 그건 파트너와 다투는 자리가 된다.
//    (Deno 는 `src/` 를 import 하지 못해 거울을 둔다 — S7-3 의 `seat-balance.ts`
//     와 같은 사정이다. 시험이 두 구현을 같은 입력으로 맞대어 본다.)

export const D30 = 30;
export const D60 = 60;
const DAY = 86400000;

export interface PurchaseRow {
  id: string;
  contract_id?: unknown;
  invoiced_on?: unknown;
  invoice_no?: unknown;
  paid_on?: unknown;
  paid_amount?: unknown;
  amount?: unknown;
  currency?: unknown;
  billing_status?: unknown;
  seat_months?: unknown;
  unit_price_per_seat_year?: unknown;
  voided_at?: unknown;
}

export interface ContractRow {
  id: string;
  partner_id?: unknown;
  settlement_method?: unknown;
  status?: unknown;
  voided_at?: unknown;
}

export interface PartnerRow {
  id: string;
  name?: unknown;
  contact_email?: unknown;
  locale?: unknown;
}

export const NO_CURRENCY = '(미지정)';

function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const s = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

/** `Number(null) === 0` 을 피한다 — 빈 금액은 **0원이 아니라 모름**이다. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isLive(p: PurchaseRow): boolean {
  return !p.voided_at;
}

/**
 * 청구했는가. `partnerLedger.isInvoiced` 와 같다.
 */
export function isInvoiced(p: PurchaseRow): boolean {
  if (p.invoiced_on) return true;
  if (typeof p.invoice_no === 'string' && p.invoice_no.trim() !== '') return true;
  const s = p.billing_status;
  return s === 'billed' || s === 'partial' || s === 'paid';
}

export type Derived = 'unbilled' | 'billed' | 'partial' | 'paid';

/**
 * 돈에서 읽은 상태. **`billing_status` 이름표를 믿지 않는다** —
 * 이름표는 사람이 바꾸는 것이고 돈은 숫자다(`partnerLedger.moneyOf` 와 같은 규칙).
 *
 * ⚠️ 처음에 `paid_on`·`billing_status` 로 판단했다가 시험이 잡았다.
 *    `partnerLedger` 는 **`paid_amount`** 를 본다. 다른 칸을 보면 관리자 화면과
 *    알림이 다른 말을 한다.
 */
export function derivedOf(p: PurchaseRow): Derived {
  const billed = num(p.amount);
  const paid = num(p.paid_amount) ?? 0;
  if (!isInvoiced(p)) return 'unbilled';
  if (billed !== null && paid >= billed && billed > 0) return 'paid';
  if (billed !== null && billed === 0 && paid === 0) return 'paid';   // 무상 배정
  if (paid > 0) return 'partial';
  return 'billed';
}

export function isPaid(p: PurchaseRow): boolean {
  return derivedOf(p) === 'paid';
}

/** 적어 둔 이름표가 금액과 어긋나는가. `partnerLedger.statusDisagrees` 와 같다. */
export function labelDisagrees(p: PurchaseRow): boolean {
  const label = p.billing_status;
  if (label !== 'unbilled' && label !== 'billed'
      && label !== 'partial' && label !== 'paid') return true;
  return label !== derivedOf(p);
}

/** 아직 받지 못한 돈(청구 − 입금). 셀 수 없으면 null. */
export function outstandingOf(p: PurchaseRow): number | null {
  if (!isLive(p) || isPaid(p)) return null;
  const billed = num(p.amount);
  // 금액이 비어 있으면 수량×단가로 **추정하지 않는다** — 추정으로 독촉하지 않는다.
  if (billed === null) return null;
  const rest = billed - (num(p.paid_amount) ?? 0);
  return rest > 0 ? rest : null;
}

export function currencyOf(p: PurchaseRow): string {
  return typeof p.currency === 'string' && p.currency.trim()
    ? p.currency.trim() : NO_CURRENCY;
}

/**
 * 청구일부터 오늘까지 며칠. 청구일이 없으면 **세지 않는다**.
 *
 * ⚠️ `partnerLedger.receivableDays` 와 같아야 한다 — 받을 돈이 **얼마인지
 *    모르면 경과일도 세지 않는다**(금액이 빈 줄로 독촉하지 않는다).
 *    처음에 이 조건을 빠뜨려 거울이 48일을 말하고 화면은 "셀 수 없음"을
 *    말했다. 시험이 잡았다.
 */
export function daysElapsed(p: PurchaseRow, today: string): number | null {
  if (!isLive(p) || isPaid(p)) return null;
  const rest = outstandingOf(p);
  if (rest === null || rest <= 0) return null;
  const from = dayOf(p.invoiced_on);
  const t = dayOf(today);
  if (!from || !t) return null;
  const d = Math.round((Date.parse(t) - Date.parse(from)) / DAY);
  return d >= 0 ? d : null;
}

export interface Candidate {
  /** 이름표가 금액과 어긋나는 줄 — **파트너에게는 보내지 않는다**(아래 설명) */
  labelDisagrees: boolean;
  purchaseId: string;
  contractId: string | null;
  partnerId: string;
  partnerName: string;
  contactEmail: string | null;
  locale: string;
  daysElapsed: number;
  outstanding: number;
  currency: string;
}

/**
 * 알림 후보를 추린다. **도매형 계약만** — 커미션형은 우리가 받을 돈이 아니다.
 * 셀 수 없는 줄은 조용히 빠진다(추측으로 독촉하지 않는다).
 */
export function candidatesFrom(args: {
  purchases: readonly PurchaseRow[];
  contracts: readonly ContractRow[];
  partners: readonly PartnerRow[];
  today: string;
}): Candidate[] {
  const byContract = new Map<string, ContractRow>();
  for (const c of args.contracts) byContract.set(c.id, c);
  const byPartner = new Map<string, PartnerRow>();
  for (const p of args.partners) byPartner.set(p.id, p);

  const out: Candidate[] = [];
  for (const p of args.purchases) {
    const cid = typeof p.contract_id === 'string' ? p.contract_id : null;
    const c = cid ? byContract.get(cid) : undefined;
    if (!c || c.voided_at) continue;
    if (c.settlement_method !== 'wholesale') continue;

    const d = daysElapsed(p, args.today);
    const amt = outstandingOf(p);
    if (d === null || amt === null) continue;
    if (d < D30) continue;

    const pid = typeof c.partner_id === 'string' ? c.partner_id : null;
    if (!pid) continue;
    const partner = byPartner.get(pid);

    out.push({
      purchaseId: p.id,
      contractId: cid,
      partnerId: pid,
      partnerName: typeof partner?.name === 'string' ? partner.name : '',
      contactEmail: typeof partner?.contact_email === 'string' && partner.contact_email
        ? partner.contact_email : null,
      locale: typeof partner?.locale === 'string' ? partner.locale : 'en',
      daysElapsed: d,
      outstanding: amt,
      currency: currencyOf(p),
      labelDisagrees: labelDisagrees(p),
    });
  }
  return out;
}
