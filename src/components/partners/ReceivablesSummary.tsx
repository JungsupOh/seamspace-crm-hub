// 파트너 목록 위의 "미수금 한눈에" (LEAD-S7-2b)
//
// 계산은 `partnerLedger` 가 한다 — 여기서 다시 세지 않는다.
// **통화를 섞어 더하지 않는다**(환율 기준일이 아직 미확정). 통화별로 나란히 보여 준다.
//
// 알림은 이 단계가 아니다(S7-8). 여기서는 **보여 주기만** 한다.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Wallet } from 'lucide-react';

import { isLiveContract } from '@/lib/partnerContract';
import {
  RECEIVABLE_D30, RECEIVABLE_D60, isLivePurchase, receivableDays, receivableStage,
  totalsByCurrency,
} from '@/lib/partnerLedger';
import { money } from '@/lib/partnerContractForm';
import { getAllContracts, getPurchasesForContracts } from '@/lib/partnerContractsApi';
import { todayKst } from '@/lib/leadFollowup';

interface Props {
  /** 파트너 이름을 보여 주기 위한 지도(개인정보를 새로 늘리지 않는다 — 회사 이름만) */
  partnerNames?: Map<string, string>;
  /** 그 파트너를 열어 준다 */
  onOpenPartner?: (partnerId: string) => void;
}

export default function ReceivablesSummary({ partnerNames, onOpenPartner }: Props) {
  const today = todayKst();

  const { data: contracts } = useQuery({
    queryKey: ['receivables', 'contracts'],
    queryFn: getAllContracts,
  });

  const contractIds = useMemo(
    () => (contracts ?? []).filter(isLiveContract).map(c => c.id), [contracts]);

  const { data: purchases } = useQuery({
    queryKey: ['receivables', 'purchases', contractIds.length],
    queryFn: () => getPurchasesForContracts(contractIds),
    enabled: contractIds.length > 0,
  });

  const view = useMemo(() => {
    const live = (purchases ?? []).filter(isLivePurchase);
    const byContract = new Map<string, string>();   // contract_id → partner_id
    for (const c of contracts ?? []) byContract.set(c.id, c.partner_id);

    let d30 = 0, d60 = 0;
    const owing = new Map<string, { partnerId: string; days: number }>();  // contract_id

    for (const p of live) {
      const stage = receivableStage(p, today);
      if (stage === 'none') continue;
      if (stage === 'd60') d60 += 1; else d30 += 1;

      const cid = String(p.contract_id ?? '');
      const days = receivableDays(p, today) ?? 0;
      const prev = owing.get(cid);
      if (!prev || days > prev.days) {
        owing.set(cid, { partnerId: byContract.get(cid) ?? '', days });
      }
    }

    // 미수액이 있는 계약(경과일이 30일 미만인 것도 포함)
    const withOutstanding = new Set<string>();
    for (const p of live) {
      const t = totalsByCurrency([p]);
      if (t.some(x => x.outstanding > 0)) withOutstanding.add(String(p.contract_id ?? ''));
    }

    return {
      totals: totalsByCurrency(live),
      contractsOwing: withOutstanding.size,
      d30, d60,
      worst: [...owing.entries()]
        .map(([cid, v]) => ({ contractId: cid, ...v }))
        .sort((a, b) => b.days - a.days)
        .slice(0, 5),
    };
  }, [contracts, purchases, today]);

  // 계약이 아예 없으면 보여 줄 것이 없다(기존 파트너만 있는 상태).
  if ((contracts ?? []).length === 0) return null;

  const hasOwing = view.totals.some(t => t.outstanding > 0);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">미수금</h3>
        {!hasOwing && <span className="text-xs text-muted-foreground">받을 돈이 없습니다</span>}
      </div>

      {hasOwing && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>미수 있는 계약 <strong>{view.contractsOwing}</strong>건</span>
            {view.d30 > 0 && (
              <span className="text-amber-700">
                {RECEIVABLE_D30}일 이상 <strong>{view.d30}</strong>건
              </span>
            )}
            {view.d60 > 0 && (
              <span className="text-destructive">
                {RECEIVABLE_D60}일 이상 <strong>{view.d60}</strong>건
              </span>
            )}
          </div>

          {/* 통화별로만 — 환산하지 않는다 */}
          <div className="flex flex-wrap gap-2">
            {view.totals.filter(t => t.outstanding > 0).map(t => (
              <div key={t.currency} className="rounded border px-2 py-1 text-xs">
                <strong>{money(t.outstanding, t.currency)}</strong>
                <span className="text-muted-foreground ml-1.5">
                  청구 {money(t.billed, t.currency)} · 입금 {money(t.paid, t.currency)}
                </span>
                {t.unknownAmounts > 0 && (
                  <span className="text-amber-700 ml-1.5">
                    금액 모르는 줄 {t.unknownAmounts}건
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            통화가 다른 금액은 더하지 않습니다(환율 기준일이 아직 정해지지 않았습니다).
          </p>

          {view.worst.length > 0 && (
            <div className="space-y-1">
              {view.worst.map(w => (
                <button key={w.contractId} type="button"
                  onClick={() => w.partnerId && onOpenPartner?.(w.partnerId)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted text-left">
                  <AlertTriangle className={`h-3 w-3 shrink-0 ${
                    w.days >= RECEIVABLE_D60 ? 'text-destructive' : 'text-amber-600'}`} />
                  <span className="truncate">
                    {partnerNames?.get(w.partnerId) ?? '(파트너 미확인)'}
                  </span>
                  <Badge variant="outline" className="h-4 px-1 text-[10px] ml-auto shrink-0">
                    {w.days}일 경과
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
