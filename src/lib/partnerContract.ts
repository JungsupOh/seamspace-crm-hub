// 파트너 계약 · 잔량 · 리드 보호 — 순수 로직 한 곳 (LEAD-S7-1 · CRM-016/020)
//
// **서버(엣지 함수)와 화면이 같이 쓴다.** 두 곳에서 따로 세면 "화면엔 잔량이 있는데
// 발급은 거부"가 생기고, 그 차이를 사람이 재현할 수 없다.
//
// 이 파일이 지키는 약속
//   ① 잔량 = 구매 합계 − 발급 합계. **저장하지 않고 센다**(설계 1-3).
//   ② **무효화한 이용권도 발급으로 센다** — James 확정: 무효화해도 수량 복구 없음.
//      (취소된 *구매 원장*은 뺀다. 둘은 다른 것이다.)
//   ③ 리드 보호는 90일, **접촉 기록을 남기면 그날부터 다시 90일**(James 확정 Q4).
//      보호 여부도 저장하지 않고 센다 — 90일을 60일로 바꾸는 결정이
//      데이터 보정을 요구하면 안 된다.
//   ④ 정산 방식은 만든 뒤 바꾸지 않는다. 막는 자리가 여기 하나다.
//
// 돈이 걸린 숫자라, 모르는 값을 0 으로 바꾸지 않는다. 모르면 `null` 을 돌려준다.

// ───────────────────────── 정산 방식 ─────────────────────────

export const SETTLEMENT_METHODS = ['commission', 'wholesale'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const SETTLEMENT_LABEL: Record<SettlementMethod, string> = {
  commission: '커미션형',
  wholesale: '도매 선구매형',
};

/** 같은 열에 담지 않으려고 용어를 가른다 — 커미션은 **줄 돈**, 도매는 **받을 돈**이다. */
export const SETTLEMENT_MONEY_LABEL: Record<SettlementMethod, string> = {
  commission: '지급(수수료)',
  wholesale: '수금(선구매 대금)',
};

export const SETTLEMENT_HINT: Record<SettlementMethod, string> = {
  commission: '고객이 우리에게 결제하고, 우리가 파트너에게 수수료를 줍니다. 계약 수량은 초과 경고의 기준입니다.',
  wholesale: '파트너가 수량을 미리 사고, 발급할 때마다 보유 수량에서 빠집니다. 0이 되면 발급이 막힙니다.',
};

export function toSettlementMethod(v: unknown): SettlementMethod | null {
  return typeof v === 'string' && (SETTLEMENT_METHODS as readonly string[]).includes(v)
    ? (v as SettlementMethod)
    : null;
}

export const CONTRACT_STATUSES = ['draft', 'active', 'ended', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: '작성 중', active: '유효', ended: '종료', cancelled: '취소',
};

export interface Contract {
  id: string;
  partner_id?: string | null;
  settlement_method?: unknown;
  starts_on?: string | null;
  ends_on?: string | null;
  contracted_seat_months?: number | null;
  unit_price_per_seat_year?: number | null;
  currency?: string | null;
  commission_rate?: number | null;
  is_grant?: boolean | null;
  status?: unknown;
  voided_at?: string | null;
}

/** 살아 있는 계약인가 — 무효 표시된 것은 어떤 집계에도 넣지 않는다. */
export function isLiveContract(c: Contract): boolean {
  return !c.voided_at && c.status !== 'cancelled';
}

// ───────────────────────── 인원·개월 ─────────────────────────

/**
 * 인원 × 개월. 단위는 **인원·개월**이다(James 확정 — 100명 연간 = 1,200).
 *
 * 발급 최소 단위는 1명 × 1개월이라 **정수만** 받는다. 반 달은 없다(James 위임 확정 ①).
 * 셀 수 없으면 `null` — 0 으로 바꾸면 "공짜로 발급"이 되어 잔량이 줄지 않는다.
 */
export function seatMonths(userCount: unknown, months: unknown): number | null {
  const u = Number(userCount);
  const m = Number(months);
  if (!Number.isInteger(u) || !Number.isInteger(m)) return null;
  if (u <= 0 || m <= 0) return null;
  return u * m;
}

// ───────────────────────── 잔량 ─────────────────────────

export interface PurchaseRow {
  /**
   * 이 회차로 산 인원·개월.
   * DB 는 `bigint` 라 PostgREST 가 **문자열로 돌려줄 수도** 있다 — 둘 다 받는다
   * (`_shared/seat-balance.ts` 와 같은 모양).
   */
  seat_months?: number | string | null;
  /** 잘못 적은 구매 회차는 지우지 않고 취소 표시한다 → 합계에서 뺀다 */
  voided_at?: string | null;
}

export interface IssuedRow {
  /** 발급 시점에 박아 둔 인원·개월. 없으면 user_count × duration 으로 센다 */
  seat_months?: number | string | null;
  user_count?: number | string | null;
  duration?: number | string | null;
  /** ⚠️ 무효화는 **수량을 되돌리지 않는다**(James 확정). 그래서 여기서 쓰지 않는다 */
  revoked_at?: string | null;
  /** LEAD-S7-3. `failed` 만 뺀다 — 아래 `countsTowardIssued` 참고 */
  status?: unknown;
  created_at?: string | null;
  contract_id?: string | null;
}

/**
 * 수량을 세는 데 포함하는 발급 상태 (LEAD-S7-3).
 *
 * **`failed` 만 뺀다.**
 *   · `revoked`(무효화)도 센다 — 무효화해도 수량은 돌려주지 않는다(James 확정).
 *   · `reserved`(진행 중)도 센다 — 안 세면 그 틈에 두 번 나간다.
 *   · `failed` 는 쿠폰이 안 만들어져 아무 일도 없었던 줄이다.
 *
 * ⚠️ 이 규칙은 SQL(`partner_reserve_license_seats`)과
 *    `supabase/functions/_shared/seat-balance.ts` 에도 같은 모양으로 있다.
 *    셋이 어긋나면 "화면엔 잔량이 있는데 발급은 거부"가 된다 — 대조 시험이 지킨다.
 */
export function countsTowardIssued(status: unknown): boolean {
  const s = typeof status === 'string' && status.trim() !== '' ? status.trim() : 'issued';
  return s !== 'failed';
}

/** 예약으로 오래 남은 줄은 사람이 치워야 한다(그만큼 잔량이 줄어 있다). */
export const STALE_RESERVATION_MINUTES = 15;

export function isStaleReservation(
  row: { status?: unknown; created_at?: string | null }, nowMs: number,
): boolean {
  if (row.status !== 'reserved') return false;
  const t = row.created_at ? Date.parse(row.created_at) : NaN;
  if (Number.isNaN(t)) return false;
  return nowMs - t > STALE_RESERVATION_MINUTES * 60_000;
}

/** 구매 합계. 취소된 회차는 뺀다. */
export function purchasedSeatMonths(rows: readonly PurchaseRow[]): number {
  return rows.reduce((sum, r) => {
    if (r.voided_at) return sum;
    const n = Number(r.seat_months);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
}

/**
 * 한 건의 발급이 쓴 인원·개월.
 *
 * `seat_months` 가 박혀 있으면 그것을 쓴다 — 규격(플랜·기간)의 뜻이 나중에 바뀌어도
 * **발급 당시의 수량**이 흔들리면 안 된다(설계 1-2). 없으면 그때만 곱한다(옛 기록).
 */
export function issuedSeatMonthsOf(row: IssuedRow): number | null {
  const fixed = Number(row.seat_months);
  if (Number.isFinite(fixed) && fixed > 0) return fixed;
  return seatMonths(row.user_count, row.duration);
}

/**
 * 발급 합계. **무효화한 것도 센다**(James 확정: 무효화해도 보유 수량 복구 없음).
 *
 * 셀 수 없는 줄(수량을 알 수 없는 옛 기록)은 **0 으로 치지 않고** 따로 돌려준다.
 * 0 으로 치면 잔량이 실제보다 많아 보여 초과 발급이 난다.
 */
export function issuedSeatMonths(rows: readonly IssuedRow[]): {
  total: number;
  unknown: number;
} {
  let total = 0;
  let unknown = 0;
  for (const r of rows) {
    // LEAD-S7-3: 쿠폰이 안 만들어졌던 줄(`failed`)은 발급이 아니다.
    if (!countsTowardIssued(r.status)) continue;
    const n = issuedSeatMonthsOf(r);
    if (n === null) unknown += 1;
    else total += n;
  }
  return { total, unknown };
}

export interface Balance {
  purchased: number;
  issued: number;
  /** 구매 − 발급. 음수일 수 있다(과거에 초과 발급된 경우) */
  balance: number;
  /** 수량을 셀 수 없는 발급 기록 수. 0 이 아니면 잔량을 **믿으면 안 된다** */
  unknownIssues: number;
}

export function balanceOf(
  purchases: readonly PurchaseRow[],
  issues: readonly IssuedRow[],
): Balance {
  const purchased = purchasedSeatMonths(purchases);
  const { total: issued, unknown } = issuedSeatMonths(issues);
  return { purchased, issued, balance: purchased - issued, unknownIssues: unknown };
}

// ───────────────────────── 발급 가능 판정 ─────────────────────────

export type IssueBlockReason =
  | 'no_contract' | 'contract_not_active' | 'contract_expired'
  | 'bad_request' | 'insufficient' | 'unknown_history';

export interface IssueCheck {
  ok: boolean;
  reason?: IssueBlockReason;
  message?: string;
  /** 요청한 인원·개월 */
  requested?: number;
  /** 발급하면 남는 양 */
  remaining?: number;
}

export const BUY_MORE_HINT =
  '보유 수량이 모자랍니다. "추가 구매 요청"을 보내 주시면 저희가 확인하고 연락드립니다.';

/**
 * 도매형 발급을 할 수 있는가 (James 확정 Q2·Q6).
 *
 * · 잔량이 유일한 한도다 — **계정별 한도는 두지 않는다**(Q6).
 * · 모자라면 막고 추가 구매를 안내한다. 자동 청구서는 발행하지 않는다(Q2).
 * · 커미션형은 이 판정을 쓰지 않는다 — 막지 않고 `overageOf()` 로 경고만 한다.
 *
 * ⚠️ 이 함수는 **판정만** 한다. 실제 발급은 서버가 계약 행을 잠그고(`for update`)
 *    다시 세어 쓴다 — 두 사람이 동시에 발급하면 둘 다 "잔량 있음"을 보기 때문이다.
 */
export function canIssue(
  contract: Contract | null | undefined,
  bal: Balance,
  request: { userCount?: unknown; months?: unknown },
  today?: string,
): IssueCheck {
  if (!contract || !isLiveContract(contract)) {
    return { ok: false, reason: 'no_contract', message: '연결된 계약이 없습니다.' };
  }
  if (contract.status !== 'active') {
    return {
      ok: false, reason: 'contract_not_active',
      message: `계약이 ${CONTRACT_STATUS_LABEL[(contract.status as ContractStatus)] ?? '유효하지 않은'} 상태입니다.`,
    };
  }
  if (today && contract.ends_on && contract.ends_on < today) {
    return { ok: false, reason: 'contract_expired', message: '계약 기간이 끝났습니다.' };
  }

  const requested = seatMonths(request.userCount, request.months);
  if (requested === null) {
    return { ok: false, reason: 'bad_request', message: '인원과 개월 수는 1 이상 정수여야 합니다.' };
  }

  // 수량을 셀 수 없는 옛 발급이 섞여 있으면 잔량을 믿을 수 없다 → 사람이 보게 막는다.
  if (bal.unknownIssues > 0) {
    return {
      ok: false, reason: 'unknown_history', requested,
      message: `수량을 알 수 없는 발급 기록이 ${bal.unknownIssues}건 있어 잔량을 셀 수 없습니다. 먼저 확인해 주세요.`,
    };
  }

  const remaining = bal.balance - requested;
  if (remaining < 0) {
    return {
      ok: false, reason: 'insufficient', requested, remaining,
      message: `보유 수량이 ${bal.balance} 인원·개월인데 ${requested} 인원·개월을 발급하려 합니다. ${BUY_MORE_HINT}`,
    };
  }
  return { ok: true, requested, remaining };
}

// ───────────────────────── 초과 판정 (커미션형) ─────────────────────────

export interface Overage {
  contracted: number | null;
  issued: number;
  /** 계약 수량을 넘은 양. 계약 수량이 없으면 null(판단하지 않는다) */
  over: number | null;
  warn: boolean;
}

/**
 * 커미션형의 초과 **경고**. 막지 않는다 — 초과 판매를 놓치지 않으면서
 * James 가 알 수 있게 하는 것이 목적이다(브리프 D항 "경고하고 승인 후 허용").
 *
 * 계약 수량이 비어 있으면 **경고하지 않는다**. 모르는 것을 0 으로 치면
 * 모든 발급이 초과로 보인다.
 */
export function overageOf(contract: Contract | null | undefined, issued: number): Overage {
  const raw = contract?.contracted_seat_months;
  const contracted = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  if (contracted === null) return { contracted: null, issued, over: null, warn: false };
  const over = issued - contracted;
  return { contracted, issued, over, warn: over > 0 };
}

// ───────────────────────── 정산 방식 변경 금지 ─────────────────────────

/**
 * 정산 방식을 바꿀 수 있는가.
 *
 * **바꿀 수 없는 것이 기본이다.** 바꾸면 그 계약에 달린 구매·발급·정산의 뜻이
 * 통째로 달라진다(커미션의 "정산액"은 줄 돈, 도매의 그것은 받을 돈이다).
 * 아직 아무것도 달리지 않은 `draft` 일 때만 허용한다 — 바꿔야 하면 **새 계약**을 만든다.
 */
export function canChangeSettlementMethod(
  contract: Contract,
  counts: { purchases: number; issues: number; deals: number },
): { ok: boolean; message?: string } {
  if (contract.status !== 'draft') {
    return { ok: false, message: '작성 중인 계약만 정산 방식을 바꿀 수 있습니다. 바꾸려면 새 계약을 만드세요.' };
  }
  const attached = counts.purchases + counts.issues + counts.deals;
  if (attached > 0) {
    return { ok: false, message: `이 계약에 구매·발급·판매 ${attached}건이 달려 있어 정산 방식을 바꿀 수 없습니다.` };
  }
  return { ok: true };
}

// ───────────────────────── 리드 보호 기간 ─────────────────────────

/** James 확정 Q4. 기간을 바꿔도 **데이터 보정이 필요 없다** — 저장하지 않고 세기 때문이다. */
export const PROTECTION_DAYS = 90;

export const PROTECTION_BASIS =
  `파트너가 등록한 리드는 ${PROTECTION_DAYS}일 동안 그 파트너 것입니다. ` +
  '접촉 기록을 남기면 그날부터 다시 ' + PROTECTION_DAYS + '일로 늘어납니다. ' +
  '기간이 지나면 보호만 풀리고 등록·이력은 그대로 남습니다.';

export interface ClaimableLead {
  partner_id?: string | null;
  /** 파트너가 등록한 날 */
  partner_claimed_at?: string | null;
  /** 마지막 접촉 — 있으면 이 날부터 다시 센다 */
  last_contact_at?: string | null;
}

const DAY = 86400000;

/** `YYYY-MM-DD` 또는 ISO 문자열에서 날짜만. 못 읽으면 null(추측하지 않는다). */
function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const s = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);
}

/**
 * 보호가 끝나는 날. 접촉이 있으면 **접촉일**부터, 없으면 **등록일**부터 센다.
 *
 * 등록일이 없으면 보호도 없다(언제부터인지 모르는 보호는 주장할 수 없다).
 * 접촉일이 등록일보다 앞서면(데이터 오류) 등록일을 쓴다 — 보호가 짧아지는 쪽이 안전하다.
 */
export function protectionEndsOn(lead: ClaimableLead): string | null {
  const claimed = dayOf(lead.partner_claimed_at);
  if (!claimed) return null;
  const contacted = dayOf(lead.last_contact_at);
  const from = contacted && contacted > claimed ? contacted : claimed;
  return addDays(from, PROTECTION_DAYS);
}

export function isProtected(lead: ClaimableLead, today: string): boolean {
  const ends = protectionEndsOn(lead);
  return ends !== null && today < ends;
}

/** 남은 날 수. 보호가 없거나 이미 끝났으면 null. */
export function protectionDaysLeft(lead: ClaimableLead, today: string): number | null {
  const ends = protectionEndsOn(lead);
  const t = dayOf(today);
  if (!ends || !t || t >= ends) return null;
  return Math.round((Date.parse(ends) - Date.parse(t)) / DAY);
}

export type ClaimVerdict = 'free' | 'mine' | 'other_partner' | 'ours';

export interface ClaimCheck {
  verdict: ClaimVerdict;
  /** 등록을 막는가 — **항상 false**. 막지 않고 알린다(설계 3-3) */
  blocked: false;
  /** 우리에게 알려야 하는가 */
  notifyUs: boolean;
  message?: string;
  daysLeft?: number | null;
}

/**
 * 파트너가 어떤 리드를 등록하려 할 때의 판정 (설계 3-3).
 *
 * **등록을 막지 않는다.** 막으면 그 파트너는 왜 막혔는지 모르고,
 * 상대가 누군지 알려 줄 수도 없다(다른 파트너 정보다). 대신 우리에게 알려
 * James 가 조정한다.
 *
 * 우리(내부)가 이미 잡고 있는 리드면 **우리가 우선**이다 — 같은 기관에 둘이
 * 따로 들어가면 고객이 혼란스럽다.
 */
export function checkClaim(
  existing: ClaimableLead | null | undefined,
  byPartnerId: string,
  today: string,
): ClaimCheck {
  if (!existing) return { verdict: 'free', blocked: false, notifyUs: false };

  const owner = existing.partner_id ?? null;

  // 우리 리드(파트너 소유가 아님)와 겹친다 → 우리가 우선.
  if (!owner) {
    return {
      verdict: 'ours', blocked: false, notifyUs: true,
      message: '이미 저희 쪽에서 접촉 중인 곳입니다. 중복 연락이 되지 않도록 담당자가 연락드리겠습니다.',
    };
  }

  if (owner === byPartnerId) {
    return {
      verdict: 'mine', blocked: false, notifyUs: false,
      message: '이미 등록하신 곳입니다.',
      daysLeft: protectionDaysLeft(existing, today),
    };
  }

  if (isProtected(existing, today)) {
    return {
      verdict: 'other_partner', blocked: false, notifyUs: true,
      // ⚠️ 어느 파트너인지 **알려 주지 않는다** — 다른 파트너의 정보다.
      message: '이미 다른 파트너가 진행 중인 곳입니다. 저희가 확인하고 연락드리겠습니다.',
      daysLeft: protectionDaysLeft(existing, today),
    };
  }

  // 보호가 끝났다 → 가져갈 수 있다. 등록·이력은 지우지 않는다.
  return { verdict: 'free', blocked: false, notifyUs: false };
}
