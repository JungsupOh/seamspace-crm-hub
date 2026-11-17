// 도매 정산 현황 (LEAD-S7-8)
//
// S7-2b 의 미수금 요약은 **계약 한 건**을 본다. 이 화면은 **전부**를 걱정되는
// 순서로 늘어놓고, 각 건에 **알림이 갔는지**를 붙인다. 그게 이 화면의 쓸모다 —
// "60일이 지났는데 아무에게도 안 갔다"를 한눈에 보는 것.
//
// 셈은 `partnerSettlement.ts` 가 하고, 그건 `partnerLedger` 를 그대로 쓴다.
// **이 파일에 산술이 없다.**

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, BellOff, Wallet } from 'lucide-react';

import { authedFetch } from '@/lib/authedFetch';
import {
  alertLabel, isWholesaleLive, needsAttention, settlementOf, settlementTotals,
  sortBySeverity, stageTone, type AlertHistoryRow, type ContractLike,
  type SettlementRow,
} from '@/lib/partnerSettlement';
import { STAGE_LABEL, type PurchaseLine } from '@/lib/partnerLedger';
import { todayKst } from '@/lib/leadFollowup';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const H = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

interface Props {
  /** 파트너 id → 이름. `ReceivablesSummary` 와 **같은 모양**으로 받는다 */
  partnerNames: Map<string, string>;
}

async function load(): Promise<{
  contracts: ContractLike[]; purchases: (PurchaseLine & { id: string; contract_id: string })[];
  alerts: AlertHistoryRow[];
}> {
  const [c, p, a] = await Promise.all([
    authedFetch(`${SUPABASE_URL}/rest/v1/partner_contracts`
      + `?select=id,partner_id,settlement_method,status,voided_at`, { headers: H }),
    authedFetch(`${SUPABASE_URL}/rest/v1/partner_purchases`
      + `?select=id,contract_id,purchased_on,invoiced_on,paid_on,amount,currency,`
      + `billing_status,seat_months,unit_price_per_seat_year,voided_at`, { headers: H }),
    authedFetch(`${SUPABASE_URL}/rest/v1/partner_receivable_alerts`
      + `?select=id,purchase_id,partner_id,stage,sent_to,days_elapsed,outstanding,`
      + `currency,sent_at,delivered,voided_at&order=sent_at.desc`, { headers: H }),
  ]);
  if (!c.ok || !p.ok) throw new Error('정산 현황 조회 실패');
  return {
    contracts: await c.json(),
    purchases: await p.json(),
    // 알림 표가 아직 없으면(마이그레이션 전) 이력만 비워 둔다 — 화면은 뜬다
    alerts: a.ok ? await a.json() : [],
  };
}

export default function SettlementStatus({ partnerNames }: Props) {
  const today = todayKst();
  const { data, isLoading, error } = useQuery({
    queryKey: ['partner-settlement'], queryFn: load,
  });

  const rows = useMemo<SettlementRow[]>(() => {
    if (!data) return [];
    const byContract = new Map<string, (PurchaseLine & { id: string })[]>();
    for (const p of data.purchases) {
      const k = p.contract_id;
      byContract.set(k, [...(byContract.get(k) ?? []), p]);
    }
    return sortBySeverity(
      data.contracts.filter(isWholesaleLive).map(c =>
        settlementOf(c, byContract.get(c.id) ?? [], data.alerts,
          partnerNames.get(c.partner_id) || '(이름 없음)', today)));
  }, [data, partnerNames, today]);

  const sum = useMemo(() => settlementTotals(rows), [rows]);
  const attention = useMemo(() => needsAttention(rows), [rows]);

  if (isLoading) return null;
  if (error) {
    return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  }
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" />도매 정산 현황
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 합계 — **통화를 섞지 않는다** */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">계약 <strong className="text-foreground">{sum.contracts}</strong></span>
          {sum.outstanding.map(o => (
            <span key={o.currency} className="text-muted-foreground">
              미수 <strong className="text-foreground">
                {o.currency} {o.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </strong>
            </span>
          ))}
          {sum.d30 > 0 && <Badge variant="outline" className="border-amber-400 text-amber-700">30일 {sum.d30}</Badge>}
          {sum.d60 > 0 && <Badge variant="outline" className="border-destructive text-destructive">60일 {sum.d60}</Badge>}
        </div>

        {attention.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-1.5">
            <BellOff className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              <strong>{attention.length}건</strong>은 경과했는데 <strong>알림이 한 번도 가지 않았습니다.</strong>
              {' '}파트너 담당자 메일이 꺼져 있으면 60일 건도 여기 남습니다.
            </span>
          </div>
        )}

        <div className="space-y-2">
          {rows.map(r => <Row key={r.contractId} r={r} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ r }: { r: SettlementRow }) {
  const tone = stageTone(r.worstStage);
  return (
    <div className={`rounded-lg border p-2.5 ${
      tone === 'bad' ? 'border-destructive/40 bg-destructive/5'
      : tone === 'warn' ? 'border-amber-300 bg-amber-50/50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{r.partnerName}</p>
          <p className="text-xs text-muted-foreground">
            구매 {r.purchaseLines}줄 · 미수 {r.openLines}줄
            {r.oldestDays !== null && ` · 최장 ${r.oldestDays}일`}
          </p>
        </div>
        <div className="text-right text-xs shrink-0">
          {r.money.map(m => (
            <p key={m.currency}>
              {m.currency} {m.outstanding === null
                ? '—'
                : m.outstanding.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
          ))}
        </div>
      </div>

      {r.worstStage !== 'none' && (
        <p className={`text-xs mt-1 ${tone === 'bad' ? 'text-destructive' : 'text-amber-700'}`}>
          <AlertTriangle className="h-3 w-3 inline mr-1" />{STAGE_LABEL[r.worstStage]}
        </p>
      )}

      {r.alerts.length > 0 ? (
        <p className="text-[11px] text-muted-foreground mt-1">
          최근 알림: {alertLabel(r.alerts[0])}
          {r.alerts.length > 1 && ` 외 ${r.alerts.length - 1}건`}
        </p>
      ) : r.worstStage !== 'none' && (
        <p className="text-[11px] text-amber-700 mt-1">알림이 간 적 없습니다</p>
      )}
    </div>
  );
}
