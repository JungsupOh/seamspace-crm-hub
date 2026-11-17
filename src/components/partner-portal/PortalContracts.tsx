// 파트너 포털의 "내 계약" 구역 (LEAD-S7-4)
//
// **도매형 계약이 있는 파트너에게만** 보인다. 커미션형·계약 없음은 지금 화면 그대로다.
// 계산은 `partnerContract.ts`·`partnerLedger.ts` 를 그대로 쓴다 —
// 서버(예약 RPC)·관리자 화면과 **같은 숫자**여야 한다. 여기서 다시 세지 않는다.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Package, Send } from 'lucide-react';

import { balanceOf, isLiveContract, toSettlementMethod } from '@/lib/partnerContract';
import {
  isLivePurchase, moneyOf, totalsByCurrency, type PurchaseLine,
} from '@/lib/partnerLedger';
import { makeT, type Msg, type PartnerLocale } from '@/lib/partner-i18n';
import { PORTAL_MSG } from '@/lib/partnerPortalMsg';
import {
  getMyContracts, getMyPurchases, getMyRequests, sendPartnerRequest,
  type PortalContract, type PortalPurchase, type PortalRequest,
} from '@/lib/partnerPortalContracts';

/** 수량을 사람 말로. 셀 수 없으면 '—'(0 으로 보이지 않게). */
export function qty(v: unknown, unit: string): string {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString()} ${unit}`;
}

export function moneyText(amount: unknown, currency: unknown): string {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return '—';
  const cur = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : '';
  return cur ? `${n.toLocaleString()} ${cur}` : n.toLocaleString();
}

export interface PortalContractView {
  contract: PortalContract;
  purchased: number;
  issued: number;
  balance: number;
  unknownIssues: number;
  purchases: PortalPurchase[];
  openRequest: PortalRequest | null;
}

/** 발급 원장에서 이 계약의 줄만 — `contract_id` 가 NULL 인 것은 **어느 잔량에도 넣지 않는다.** */
export interface LicenseLike {
  contract_id?: string | null;
  seat_months?: number | string | null;
  user_count?: number | string | null;
  duration?: number | string | null;
  status?: unknown;
}

/** 화면이 그릴 것을 한 번에 만든다(순수 — 테스트가 이것만 보면 된다). */
export function buildViews(
  contracts: readonly PortalContract[],
  purchases: readonly PortalPurchase[],
  licenses: readonly LicenseLike[],
  requests: readonly PortalRequest[],
): PortalContractView[] {
  return contracts
    .filter(c => isLiveContract(c) && toSettlementMethod(c.settlement_method) === 'wholesale')
    .map(c => {
      const mine = purchases.filter(p => p.contract_id === c.id);
      const issuedRows = licenses.filter(l => l.contract_id === c.id);
      const bal = balanceOf(mine.filter(isLivePurchase) as PurchaseLine[], issuedRows);
      return {
        contract: c,
        purchased: bal.purchased,
        issued: bal.issued,
        balance: bal.balance,
        unknownIssues: bal.unknownIssues,
        purchases: mine,
        openRequest: requests.find(
          r => r.kind === 'purchase' && r.contract_id === c.id && r.status === 'open') ?? null,
      };
    });
}

interface Props {
  partnerId: string;
  locale: PartnerLocale;
  /** 포털이 이미 읽어 둔 발급 목록 — 다시 부르지 않는다 */
  licenses: readonly LicenseLike[];
  /** 요청을 보낼 수 있는가(게스트는 보기만) */
  canRequest: boolean;
}

export default function PortalContracts({ partnerId, locale, licenses, canRequest }: Props) {
  const t = makeT(locale);
  const qc = useQueryClient();

  const { data: contracts } = useQuery({
    queryKey: ['portal_contracts', partnerId],
    queryFn: () => getMyContracts(partnerId),
  });
  const ids = useMemo(() => (contracts ?? []).map(c => c.id), [contracts]);

  const { data: purchases } = useQuery({
    queryKey: ['portal_purchases', ids.join(',')],
    queryFn: () => getMyPurchases(ids),
    enabled: ids.length > 0,
  });
  const { data: requests } = useQuery({
    queryKey: ['portal_requests', partnerId],
    queryFn: () => getMyRequests(partnerId),
  });

  const views = useMemo(
    () => buildViews(contracts ?? [], purchases ?? [], licenses, requests ?? []),
    [contracts, purchases, licenses, requests]);

  const [asking, setAsking] = useState<PortalContractView | null>(null);

  // 도매 계약이 없으면 **아무것도 보여 주지 않는다** — 기존 화면 그대로다.
  if (views.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-1.5">
        <Package className="h-4 w-4" />{t(PORTAL_MSG.sectionTitle)}
      </h2>

      {views.map(v => (
        <ContractCard key={v.contract.id} view={v} t={t}
          canRequest={canRequest} onAsk={() => setAsking(v)} />
      ))}

      {asking && (
        <PurchaseRequestDialog
          view={asking} t={t}
          onClose={() => setAsking(null)}
          onSent={() => {
            qc.invalidateQueries({ queryKey: ['portal_requests', partnerId] });
            setAsking(null);
          }}
        />
      )}
    </section>
  );
}

function ContractCard({ view, t, canRequest, onAsk }: {
  view: PortalContractView; t: (m: Msg) => string;
  canRequest: boolean; onAsk: () => void;
}) {
  const c = view.contract;
  const unknown = view.unknownIssues > 0;
  const money = totalsByCurrency(view.purchases.filter(isLivePurchase) as PurchaseLine[]);

  return (
    <div className="rounded border p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">{t(PORTAL_MSG.period)}</span>
        <strong>{c.starts_on} ~ {c.ends_on ?? '—'}</strong>
        {c.is_grant && <Badge variant="outline" className="h-5 px-1.5 text-[11px]">Grant</Badge>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label={t(PORTAL_MSG.contracted)}
          value={qty(c.contracted_seat_months, t(PORTAL_MSG.seatMonths))} />
        <Stat label={t(PORTAL_MSG.purchased)}
          value={qty(view.purchased, t(PORTAL_MSG.seatMonths))} />
        <Stat label={t(PORTAL_MSG.issued)}
          value={unknown ? '—' : qty(view.issued, t(PORTAL_MSG.seatMonths))} />
        <Stat label={t(PORTAL_MSG.balance)}
          value={unknown ? '—' : qty(view.balance, t(PORTAL_MSG.seatMonths))}
          tone={unknown ? 'muted' : view.balance < 0 ? 'bad' : view.balance === 0 ? 'warn' : 'ok'} />
      </div>

      <div className="text-xs text-muted-foreground">
        {t(PORTAL_MSG.unitPrice)} {moneyText(c.unit_price_per_seat_year, c.currency)}
      </div>

      {/* 숫자를 지어내지 않는다 — 셀 수 없으면 셀 수 없다고 말한다 */}
      {unknown && (
        <p className="text-xs text-amber-700 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{t(PORTAL_MSG.balanceUnknown)}</span>
        </p>
      )}
      {!unknown && view.balance === 0 && (
        <p className="text-xs text-amber-700">{t(PORTAL_MSG.balanceZero)}</p>
      )}
      {!unknown && view.balance < 0 && (
        <p className="text-xs text-destructive">{t(PORTAL_MSG.balanceNegative)}</p>
      )}

      {/* 구매 내역 */}
      {view.purchases.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {t(PORTAL_MSG.purchases)} ({view.purchases.length})
          </summary>
          <div className="mt-2 space-y-1">
            {view.purchases.map(p => <PurchaseRow key={p.id} row={p} t={t} />)}
            <p className="text-muted-foreground pt-1">{t(PORTAL_MSG.unpaidOk)}</p>
            {money.map(m => (
              <p key={m.currency} className="text-muted-foreground">
                {m.currency}: {moneyText(m.billed, m.currency)}
                {m.outstanding > 0 && ` · ${moneyText(m.outstanding, m.currency)} ↺`}
              </p>
            ))}
          </div>
        </details>
      )}

      {/* 추가 구매 요청 */}
      {view.openRequest
        ? <p className="text-xs text-muted-foreground">{t(PORTAL_MSG.requestOpen)}</p>
        : canRequest && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onAsk}>
            <Send className="h-3 w-3 mr-1" />{t(PORTAL_MSG.requestPurchase)}
          </Button>
        )}
    </div>
  );
}

function Stat({ label, value, tone }: {
  label: string; value: string; tone?: 'ok' | 'warn' | 'bad' | 'muted';
}) {
  const cls = tone === 'bad' ? 'text-destructive'
    : tone === 'warn' ? 'text-amber-700'
    : tone === 'muted' ? 'text-muted-foreground' : '';
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function PurchaseRow({ row, t }: { row: PortalPurchase; t: (m: Msg) => string }) {
  const m = moneyOf(row);
  const label = m.derived === 'paid' ? PORTAL_MSG.billPaid
    : m.derived === 'partial' ? PORTAL_MSG.billPartial
    : m.derived === 'billed' ? PORTAL_MSG.billBilled
    : PORTAL_MSG.billUnbilled;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border px-2 py-1">
      <span>{row.purchased_on}</span>
      <span>{qty(row.seat_months, t(PORTAL_MSG.seatMonths))}</span>
      <span>{moneyText(row.amount, row.currency)}</span>
      <Badge variant="outline" className="h-4 px-1 text-[10px]">{t(label)}</Badge>
      {row.paid_on && (
        <span className="text-muted-foreground">{t(PORTAL_MSG.paidOn)} {row.paid_on}</span>
      )}
      {row.voided_at && <Badge variant="secondary" className="h-4 px-1 text-[10px]">void</Badge>}
    </div>
  );
}

function PurchaseRequestDialog({ view, t, onClose, onSent }: {
  view: PortalContractView; t: (m: Msg) => string; onClose: () => void; onSent: () => void;
}) {
  const [seats, setSeats] = useState('');
  const [months, setMonths] = useState('');
  const [note, setNote] = useState('');

  const seatMonths = useMemo(() => {
    const s = Number(seats.trim()), m = Number(months.trim());
    if (!seats.trim() || !months.trim()) return null;
    return Number.isInteger(s) && Number.isInteger(m) && s > 0 && m > 0 ? s * m : null;
  }, [seats, months]);

  const send = useMutation({
    mutationFn: () => sendPartnerRequest({
      kind: 'purchase', contractId: view.contract.id,
      seatMonths, reason: note.trim() || null,
    }),
    onSuccess: r => { r.ok ? toast.success(r.message) : toast.error(r.message); if (r.ok) onSent(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t(PORTAL_MSG.requestPurchase)}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{t(PORTAL_MSG.requestPurchaseHint)}</p>

        <div>
          <Label className="text-xs">{t(PORTAL_MSG.requestSeats)}</Label>
          <div className="flex items-center gap-2">
            <Input className="h-9" inputMode="numeric" value={seats}
              onChange={e => setSeats(e.target.value)} />
            <span className="text-xs text-muted-foreground">×</span>
            <Input className="h-9" inputMode="numeric" value={months}
              onChange={e => setMonths(e.target.value)} />
            <span className="text-xs whitespace-nowrap">
              = {qty(seatMonths, t(PORTAL_MSG.seatMonths))}
            </span>
          </div>
        </div>

        <div>
          <Label className="text-xs">{t(PORTAL_MSG.requestNote)}</Label>
          <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button disabled={send.isPending} onClick={() => send.mutate()}>
            <Send className="h-3 w-3 mr-1" />{t(PORTAL_MSG.requestSend)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
