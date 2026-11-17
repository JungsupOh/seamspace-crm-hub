// 도매 정산 현황 (LEAD-S7-8)
//
// **셈을 새로 만들지 않는다.** 구매 합계·미수액·경과일·단계는 전부
// `partnerLedger` 가 이미 한다. 여기서 하는 일은 그 결과를 **계약별·파트너별로
// 모으고**, 알림 이력을 붙이는 것뿐이다.
//
// (S7-2b 의 미수금 요약과 같은 함수를 쓴다 — 두 화면이 다른 숫자를 말하면
//  어느 쪽이 맞는지 아무도 모르게 된다.)

import {
  isLivePurchase, receivableDays, receivableStage, totalsByCurrency,
  type CurrencyTotal, type PurchaseLine, type ReceivableStage,
} from '@/lib/partnerLedger';

export interface AlertHistoryRow {
  id: string;
  purchase_id: string;
  partner_id: string;
  stage: string;
  sent_to: string;
  days_elapsed: number | null;
  outstanding: number | null;
  currency: string | null;
  sent_at: string;
  delivered: boolean;
  voided_at: string | null;
}

export interface ContractLike {
  id: string;
  partner_id: string;
  settlement_method?: string | null;
  status?: string | null;
  voided_at?: string | null;
}

export interface SettlementRow {
  contractId: string;
  partnerId: string;
  partnerName: string;
  /** 통화별 — **절대 섞지 않는다** */
  money: CurrencyTotal[];
  oldestDays: number | null;
  worstStage: ReceivableStage;
  /** 아직 못 받은 줄 수 */
  openLines: number;
  purchaseLines: number;
  /** 이 계약에 대해 보낸 알림(무효 제외) */
  alerts: AlertHistoryRow[];
  lastAlertAt: string | null;
}

/** 도매형이고 살아 있는 계약만. 커미션형은 우리가 받을 돈이 아니다. */
export function isWholesaleLive(c: ContractLike): boolean {
  return c.settlement_method === 'wholesale' && !c.voided_at;
}

/**
 * 계약 하나의 정산 현황. `partnerLedger` 를 **그대로** 쓴다.
 */
export function settlementOf(
  contract: ContractLike,
  purchases: readonly PurchaseLine[],
  alerts: readonly AlertHistoryRow[],
  partnerName: string,
  today: string,
): SettlementRow {
  const live = purchases.filter(isLivePurchase);
  const purchaseIds = new Set(live.map(p => (p as { id?: string }).id));

  let oldest: number | null = null;
  let worst: ReceivableStage = 'none';
  let open = 0;

  for (const p of live) {
    const d = receivableDays(p, today);
    if (d !== null) {
      open += 1;
      if (oldest === null || d > oldest) oldest = d;
    }
    const s = receivableStage(p, today);
    if (s === 'd60' || (s === 'd30' && worst === 'none')) worst = s;
  }

  const mine = alerts
    .filter(a => !a.voided_at && purchaseIds.has(a.purchase_id))
    .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));

  return {
    contractId: contract.id,
    partnerId: contract.partner_id,
    partnerName,
    money: totalsByCurrency(live),
    oldestDays: oldest,
    worstStage: worst,
    openLines: open,
    purchaseLines: live.length,
    alerts: mine,
    lastAlertAt: mine[0]?.sent_at ?? null,
  };
}

/** 단계에 따른 색. 화면 셋이 같은 색을 쓰게 한 곳에 둔다. */
export function stageTone(s: ReceivableStage): 'none' | 'warn' | 'bad' {
  return s === 'd60' ? 'bad' : s === 'd30' ? 'warn' : 'none';
}

/** 걱정되는 것부터 — 60일 → 30일 → 경과일 순. */
export function sortBySeverity(rows: readonly SettlementRow[]): SettlementRow[] {
  const rank = (s: ReceivableStage) => (s === 'd60' ? 0 : s === 'd30' ? 1 : 2);
  return [...rows].sort((a, b) =>
    rank(a.worstStage) - rank(b.worstStage)
    || (b.oldestDays ?? -1) - (a.oldestDays ?? -1)
    || a.partnerName.localeCompare(b.partnerName));
}

export interface SettlementTotals {
  contracts: number;
  d30: number;
  d60: number;
  /** 통화별 미수 합계 — **섞지 않는다** */
  outstanding: { currency: string; amount: number }[];
  alerted: number;
  neverAlerted: number;
}

export function settlementTotals(rows: readonly SettlementRow[]): SettlementTotals {
  const byCur = new Map<string, number>();
  let d30 = 0, d60 = 0, alerted = 0, never = 0;

  for (const r of rows) {
    if (r.worstStage === 'd60') d60 += 1;
    else if (r.worstStage === 'd30') d30 += 1;
    for (const m of r.money) {
      if (m.outstanding === null) continue;
      byCur.set(m.currency, (byCur.get(m.currency) ?? 0) + m.outstanding);
    }
    if (r.worstStage !== 'none') {
      if (r.alerts.length > 0) alerted += 1; else never += 1;
    }
  }

  return {
    contracts: rows.length,
    d30, d60,
    outstanding: [...byCur.entries()].sort()
      .map(([currency, amount]) => ({ currency, amount })),
    alerted, neverAlerted: never,
  };
}

/** 알림 이력 한 줄을 사람이 읽을 말로. */
export function alertLabel(a: AlertHistoryRow): string {
  const who = a.sent_to === 'partner' ? '파트너 담당자' : '우리';
  const stage = a.stage === 'd60' ? '60일' : '30일';
  const when = a.sent_at.slice(0, 10);
  return `${when} · ${stage} · ${who}${a.delivered ? '' : ' (실패)'}`;
}

/**
 * **알림이 가야 하는데 안 간 건**을 찾는다 — 이게 이 화면의 쓸모다.
 * (파트너 메일이 꺼져 있으면 60일 건은 늘 여기 뜬다. 그게 맞다 —
 *  꺼 둔 것을 잊지 않게 보여 준다.)
 */
export function needsAttention(rows: readonly SettlementRow[]): SettlementRow[] {
  return rows.filter(r => r.worstStage !== 'none' && r.alerts.length === 0);
}
