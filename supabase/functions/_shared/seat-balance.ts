// 발급 잔량 규칙 — **SQL 과 프런트가 같은 답을 내야 한다** (LEAD-S7-3)
//
// 이 파일은 엣지 함수(Deno)가 쓰는 거울이다. 진짜 판정은 SQL 함수
// `partner_reserve_license_seats` 가 **계약 행을 잠근 채로** 하고, 여기서는
// 응답 문구를 만들고 요청을 다듬는 데 쓴다.
//
// 같은 규칙이 세 군데에 있다:
//   ① SQL  : supabase/migrations/20261201000100_lead_s7_3_reserve_rpc.sql  ← **권위**
//   ② Deno : 이 파일
//   ③ 화면 : src/lib/partnerContract.ts
// 셋이 어긋나면 "화면엔 잔량이 있는데 발급은 거부"가 된다.
// `src/test/lead-s7-3-*.test.ts` 가 ②와 ③을 같은 사례로 대조하고,
// ①은 그 규칙이 SQL 글자에 그대로 있는지 확인한다.

/** 수량을 세는 데 포함하는 발급 상태. **`failed` 만 뺀다.** */
export function countsTowardIssued(status: unknown): boolean {
  const s = typeof status === 'string' && status.trim() !== '' ? status.trim() : 'issued';
  // revoked(무효화)도 센다 — 무효화해도 수량은 돌려주지 않는다(James 확정).
  // reserved(진행 중)도 센다 — 안 세면 그 틈에 두 번 나간다.
  // failed 는 쿠폰이 안 만들어져 아무 일도 없었던 줄이다.
  return s !== 'failed';
}

export interface LicenseLike {
  seat_months?: number | string | null;
  user_count?: number | string | null;
  duration?: number | string | null;
  status?: unknown;
}

/** 정수로만 읽는다. `''`·null·소수·음수는 **셀 수 없음**(null)이다. */
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 한 발급이 쓴 인원·개월. `seat_months` 가 박혀 있으면 그것을 쓴다 —
 * 규격의 뜻이 나중에 바뀌어도 **발급 당시의 수량**이 흔들리면 안 된다.
 * 셀 수 없으면 `null` — **0 으로 치지 않는다**(0 이면 잔량이 많아 보여 초과 발급이 난다).
 */
export function licenseSeatMonths(row: LicenseLike): number | null {
  const fixed = intOrNull(row.seat_months);
  if (fixed !== null) return fixed;
  const u = intOrNull(row.user_count);
  const d = intOrNull(row.duration);
  return u !== null && d !== null ? u * d : null;
}

export interface PurchaseLike {
  seat_months?: number | string | null;
  voided_at?: string | null;
}

/** 구매 합계. **무효 표시한 회차는 뺀다.** */
export function purchasedSeatMonths(rows: readonly PurchaseLike[]): number {
  let sum = 0;
  for (const r of rows) {
    if (r.voided_at) continue;
    const n = intOrNull(r.seat_months);
    if (n !== null) sum += n;
  }
  return sum;
}

export interface IssuedTotals { total: number; unknown: number }

export function issuedSeatMonths(rows: readonly LicenseLike[]): IssuedTotals {
  let total = 0, unknown = 0;
  for (const r of rows) {
    if (!countsTowardIssued(r.status)) continue;
    const n = licenseSeatMonths(r);
    if (n === null) unknown += 1;
    else total += n;
  }
  return { total, unknown };
}

export interface BalanceView {
  purchased: number;
  issued: number;
  balance: number;
  unknownIssues: number;
}

export function balanceOf(
  purchases: readonly PurchaseLike[], licenses: readonly LicenseLike[],
): BalanceView {
  const purchased = purchasedSeatMonths(purchases);
  const { total: issued, unknown } = issuedSeatMonths(licenses);
  return { purchased, issued, balance: purchased - issued, unknownIssues: unknown };
}

// ───────────────────────── 요청 다듬기 ─────────────────────────

export interface IssueRequest { userCount: unknown; duration: unknown }

/** 요청 수량. 반 달은 없다(James 위임 확정 ①). 셀 수 없으면 null. */
export function requestedSeatMonths(req: IssueRequest): number | null {
  const u = intOrNull(req.userCount);
  const d = intOrNull(req.duration);
  return u !== null && d !== null ? u * d : null;
}

// ───────────────────────── 응답 문구 ─────────────────────────

export type IssueBlockCode =
  | 'BAD_REQUEST' | 'NO_CONTRACT' | 'CONTRACT_NOT_ACTIVE' | 'CONTRACT_EXPIRED'
  | 'NOT_WHOLESALE' | 'UNKNOWN_HISTORY' | 'INSUFFICIENT_BALANCE' | 'CONTRACT_REQUIRED';

export type Locale = 'en' | 'ko';

/** `partners.locale` 로 고른다. 모르면 영어(해외 파트너 기본). */
export function pickLocale(v: unknown): Locale {
  return typeof v === 'string' && v.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export interface BlockContext {
  balance?: number;
  requested?: number;
  unknownIssues?: number;
  contractCount?: number;
}

/**
 * 막힌 이유를 파트너가 읽을 말로. **개인정보를 넣지 않는다.**
 *
 * 잔량이 0 이면 "추가 구매 요청"을 안내한다(James 확정 Q2 — 자동 청구서는 없다).
 */
export function blockMessage(code: IssueBlockCode, ctx: BlockContext, locale: Locale): string {
  const b = ctx.balance ?? 0;
  const r = ctx.requested ?? 0;
  if (locale === 'ko') {
    switch (code) {
      case 'BAD_REQUEST': return '인원과 개월 수는 1 이상이어야 합니다.';
      case 'CONTRACT_REQUIRED':
        return `유효한 도매 계약이 ${ctx.contractCount ?? 2}건 있습니다. 어느 계약에서 발급할지 고르세요.`;
      case 'NO_CONTRACT': return '계약을 찾을 수 없습니다.';
      case 'CONTRACT_NOT_ACTIVE': return '유효한 계약이 아닙니다. 담당자에게 문의해 주세요.';
      case 'CONTRACT_EXPIRED': return '계약 기간이 끝났습니다. 담당자에게 문의해 주세요.';
      case 'NOT_WHOLESALE': return '도매형 계약이 아닙니다.';
      case 'UNKNOWN_HISTORY':
        return `수량을 알 수 없는 발급 기록이 ${ctx.unknownIssues ?? 0}건 있어 잔량을 셀 수 없습니다. 담당자가 확인한 뒤 발급할 수 있습니다.`;
      case 'INSUFFICIENT_BALANCE':
        return `보유 수량이 ${b.toLocaleString('ko-KR')} 인원·개월인데 ${r.toLocaleString('ko-KR')} 인원·개월을 발급하려 합니다. 추가 구매를 요청해 주세요.`;
    }
  }
  switch (code) {
    case 'BAD_REQUEST': return 'User count and months must be 1 or more.';
    case 'CONTRACT_REQUIRED':
      return `You have ${ctx.contractCount ?? 2} active wholesale contracts. Please choose which one to issue from.`;
    case 'NO_CONTRACT': return 'Contract not found.';
    case 'CONTRACT_NOT_ACTIVE': return 'This contract is not active. Please contact us.';
    case 'CONTRACT_EXPIRED': return 'This contract has ended. Please contact us.';
    case 'NOT_WHOLESALE': return 'This is not a wholesale contract.';
    case 'UNKNOWN_HISTORY':
      return `${ctx.unknownIssues ?? 0} issuance record(s) have an unknown quantity, so the remaining balance cannot be calculated. We will check and get back to you.`;
    case 'INSUFFICIENT_BALANCE':
      return `Your remaining balance is ${b.toLocaleString('en-US')} seat-months, but this request needs ${r.toLocaleString('en-US')}. Please request an additional purchase.`;
  }
}

/** 커미션형 계약 수량 초과 — **막지 않고 알린다**(브리프 D항). */
export function overageWarning(
  contractedSeatMonths: unknown, issued: number, requested: number,
): { over: number } | null {
  const c = intOrNull(contractedSeatMonths);
  if (c === null) return null;            // 계약 수량이 없으면 판단하지 않는다
  const after = issued + requested;
  return after > c ? { over: after - c } : null;
}

/** 예약 상태로 오래 남은 줄 — 사람이 치워야 하는 것(관리자 화면이 보여 준다). */
export const STALE_RESERVATION_MINUTES = 15;

export function isStaleReservation(
  row: { status?: unknown; created_at?: string | null }, nowMs: number,
): boolean {
  if (row.status !== 'reserved') return false;
  const t = row.created_at ? Date.parse(row.created_at) : NaN;
  if (Number.isNaN(t)) return false;
  return nowMs - t > STALE_RESERVATION_MINUTES * 60_000;
}
