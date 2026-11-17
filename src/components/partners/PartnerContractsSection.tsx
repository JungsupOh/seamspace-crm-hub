// 파트너 상세의 "계약" 구역 — 계약 목록·등록·수정 + 도매 구매 원장 (LEAD-S7-2b)
//
// 계산은 전부 `partnerContract.ts`·`partnerLedger.ts`·`partnerContractForm.ts` 가 한다.
// 이 파일은 **보여 주고 받는 일만** 한다 — 잔량이나 미수액을 여기서 다시 세지 않는다.
//
// 기존 커미션형 흐름(딜 등록 → 수수료)은 **건드리지 않는다.** 계약이 없는 파트너는
// 지금과 똑같이 동작하고, 이 구역은 "아직 계약이 없어요"만 보여 준다.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Ban, Lock, Plus, Receipt } from 'lucide-react';

import {
  CONTRACT_STATUS_LABEL, SETTLEMENT_HINT, SETTLEMENT_LABEL, SETTLEMENT_METHODS,
  SETTLEMENT_MONEY_LABEL, STALE_RESERVATION_MINUTES, isLiveContract, isStaleReservation,
  toSettlementMethod,
  type ContractStatus, type SettlementMethod,
} from '@/lib/partnerContract';
import {
  BILLING_LABEL, BILLING_STATUSES, RECEIVABLE_BASIS, STAGE_LABEL, amountDiffers,
  contractSummary, expectedAmount, moneyOf, receivableDays, receivableStage, statusDisagrees,
  type BillingStatus,
} from '@/lib/partnerLedger';
import {
  METHOD_LOCK_HINT, PURCHASE_EDIT_HINT, QUANTITY_HINT, contractSeatMonths, contractToForm,
  emptyContractForm, emptyPurchaseForm, isMethodLocked, money, seatMonthsLabel,
  toBillingPatch, toContractPayload, toPurchasePayload, validateContractForm,
  validatePurchaseForm, validateVoidReason, visibleFields,
  type ContractForm, type PurchaseForm,
} from '@/lib/partnerContractForm';
import {
  createContract, createPurchase, getContracts, getPartnerLicenseSeats, getPurchases,
  patchBilling, patchPurchaseNote, updateContract, voidContract, voidPurchase,
  type ContractRow, type PurchaseRowFull,
} from '@/lib/partnerContractsApi';
import { todayKst } from '@/lib/leadFollowup';

/** 계약 도입 전 발급(contract_id 가 NULL)은 어느 잔량에도 넣지 않는다. */
export const UNLINKED_ISSUE_HINT =
  '계약을 두기 전에 나간 발급입니다. 어느 계약에서 나간 것인지 기록이 없어 '
  + '**어느 계약의 잔량에도 넣지 않습니다.** 연결하려면 담당자에게 말씀해 주세요.';

/** 예약으로 남은 줄 — 사람이 치워야 한다. */
export const STALE_RESERVATION_HINT =
  '발급하다 멈춘 줄입니다(쿠폰은 안 만들어졌거나 기록이 끝나지 않았습니다). '
  + '**그만큼 잔량이 줄어들어 있습니다.** 진짜 발급이 아니라면 지워야 합니다.';

interface Props {
  partnerId: string;
  partnerCurrency?: string | null;
  /** 계약서로 고를 수 있는 파일(기존 partner_files) */
  files?: Array<{ id: string; file_type: string; file_name: string }>;
}

export default function PartnerContractsSection({ partnerId, partnerCurrency, files }: Props) {
  const qc = useQueryClient();
  const today = todayKst();

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['partner_contracts', partnerId],
    queryFn: () => getContracts(partnerId),
  });

  const [editing, setEditing] = useState<ContractRow | null>(null);
  const [creating, setCreating] = useState(false);

  const live = useMemo(() => (contracts ?? []).filter(isLiveContract), [contracts]);
  const voided = useMemo(
    () => (contracts ?? []).filter(c => !isLiveContract(c)), [contracts]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          계약
        </h3>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => setCreating(true)}>
          <Plus className="h-3 w-3 mr-1" />계약 추가
        </Button>
      </div>

      {isLoading
        ? <p className="text-xs text-muted-foreground">불러오는 중…</p>
        : (contracts ?? []).length === 0
          ? (
            <div className="rounded border border-dashed px-3 py-4 text-xs text-muted-foreground">
              아직 계약이 없어요. <strong>계약이 없는 파트너는 지금 방식 그대로 작동합니다</strong>
              (딜 등록 → 수수료). 도매 선구매로 바꾸려면 계약을 추가하세요.
            </div>
          )
          : (
            <div className="space-y-3">
              {live.map(c => (
                <ContractCard key={c.id} contract={c} today={today}
                  onEdit={() => setEditing(c)} files={files} />
              ))}
              {voided.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    무효·취소된 계약 {voided.length}건
                  </summary>
                  <div className="mt-2 space-y-2">
                    {voided.map(c => (
                      <div key={c.id} className="rounded border px-3 py-2 opacity-70">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            {SETTLEMENT_LABEL[toSettlementMethod(c.settlement_method) ?? 'wholesale']}
                          </Badge>
                          <span>{c.starts_on} ~ {c.ends_on ?? '미정'}</span>
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">무효</Badge>
                        </div>
                        {c.void_reason && (
                          <p className="mt-1 text-muted-foreground">사유: {c.void_reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

      {(creating || editing) && (
        <ContractDialog
          partnerId={partnerId}
          partnerCurrency={partnerCurrency}
          contract={editing}
          files={files}
          today={today}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['partner_contracts', partnerId] });
            qc.invalidateQueries({ queryKey: ['receivables'] });
            setCreating(false); setEditing(null);
          }}
        />
      )}
    </section>
  );
}

// ───────────────────────── 계약 카드 ─────────────────────────

function ContractCard({ contract, today, onEdit, files }: {
  contract: ContractRow; today: string; onEdit: () => void;
  files?: Array<{ id: string; file_type: string; file_name: string }>;
}) {
  const qc = useQueryClient();
  const method = toSettlementMethod(contract.settlement_method);
  const wholesale = method === 'wholesale';

  const { data: purchases } = useQuery({
    queryKey: ['partner_purchases', contract.id],
    queryFn: () => getPurchases(contract.id),
    enabled: wholesale,
  });

  // ⚠️ 발급은 **파트너 전체**다 — 계약별로 가를 수 없다(ISSUE_LINK_PENDING).
  //    그래서 요약에 발급·잔량을 쓰지 않고, 참고용으로만 건수를 보여 준다.
  const { data: licenses } = useQuery({
    queryKey: ['partner_license_seats', contract.partner_id],
    queryFn: () => getPartnerLicenseSeats(contract.partner_id),
  });

  // LEAD-S7-3: 발급이 계약에 이어졌으므로 **이 계약의 발급만** 넣어 잔량을 센다.
  //   `contract_id` 가 NULL 인 줄(계약 도입 전 발급)은 **어느 잔량에도 넣지 않는다.**
  const mine = useMemo(
    () => (licenses ?? []).filter(l => l.contract_id === contract.id), [licenses, contract.id]);
  const unlinked = useMemo(
    () => (licenses ?? []).filter(l => !l.contract_id), [licenses]);
  const stale = useMemo(
    () => mine.filter(l => isStaleReservation(l, Date.now())), [mine]);

  const sum = useMemo(
    () => contractSummary(contract, purchases ?? [], mine, today),
    [contract, purchases, mine, today]);

  const [showLedger, setShowLedger] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const fileName = files?.find(f => f.id === contract.contract_file_id)?.file_name;

  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="h-5 px-1.5 text-[11px]">
          {SETTLEMENT_LABEL[method ?? 'wholesale']}
        </Badge>
        <Badge variant={contract.status === 'active' ? 'default' : 'secondary'}
          className="h-5 px-1.5 text-[11px]">
          {CONTRACT_STATUS_LABEL[(contract.status as ContractStatus)] ?? contract.status}
        </Badge>
        {contract.is_grant && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px]">무상 배정</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {contract.starts_on} ~ {contract.ends_on ?? '미정'}
          {contract.renews_on && ` · 갱신 ${contract.renews_on}`}
        </span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onEdit}>수정</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
            onClick={() => setVoiding(true)}>
            <Ban className="h-3 w-3 mr-1" />무효
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          계약 수량 <strong>{seatMonthsLabel(contract.contracted_seat_months)}</strong>
        </span>
        {wholesale
          ? (
            <span>
              연간 인원당 단가{' '}
              <strong>{money(contract.unit_price_per_seat_year, contract.currency)}</strong>
            </span>
          )
          : (
            <span>
              수수료율{' '}
              <strong>
                {contract.commission_rate === null ? '—' : `${contract.commission_rate}%`}
              </strong>
            </span>
          )}
        <span className="text-muted-foreground">{SETTLEMENT_MONEY_LABEL[method ?? 'wholesale']}</span>
        {fileName && <span className="text-muted-foreground">계약서: {fileName}</span>}
      </div>

      {wholesale && (
        <>
          {/* 도매 현황 한 줄 — partnerLedger 요약을 그대로 쓴다 */}
          <div className="rounded bg-muted/40 px-2.5 py-2 space-y-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>구매 <strong>{seatMonthsLabel(sum.purchased)}</strong></span>
              <span>발급 <strong>{seatMonthsLabel(sum.issued)}</strong></span>
              <span>
                잔량{' '}
                <strong className={sum.balance < 0 ? 'text-destructive' : undefined}>
                  {seatMonthsLabel(sum.balance)}
                </strong>
                {sum.balance < 0 && <span className="text-destructive"> (초과 발급)</span>}
                {sum.balance === 0 && (
                  <span className="text-amber-700"> · 더 발급할 수 없습니다</span>
                )}
              </span>
              {sum.money.map(m => (
                <span key={m.currency}>
                  미수 <strong className={m.outstanding > 0 ? 'text-amber-700' : undefined}>
                    {money(m.outstanding, m.currency)}
                  </strong>
                  {m.overpaid > 0 && (
                    <span className="text-muted-foreground"> (초과 입금 {money(m.overpaid, m.currency)})</span>
                  )}
                  {m.unknownAmounts > 0 && (
                    <span className="text-amber-700"> · 금액 모르는 줄 {m.unknownAmounts}건</span>
                  )}
                </span>
              ))}
              {sum.oldestReceivableDays !== null && (
                <span className={sum.worstStage === 'd60' ? 'text-destructive' : 'text-amber-700'}>
                  최장 미수 <strong>{sum.oldestReceivableDays}일</strong>
                  {sum.worstStage !== 'none' && ` · ${STAGE_LABEL[sum.worstStage]}`}
                </span>
              )}
            </div>
            {/* 예약으로 남은 줄 — 그만큼 잔량이 줄어 있다. 사람이 치워야 한다. */}
            {stale.length > 0 && (
              <p className="text-[11px] text-destructive flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>
                  예약 상태로 {STALE_RESERVATION_MINUTES}분 넘게 남은 발급 {stale.length}건.
                  {' '}{STALE_RESERVATION_HINT}
                </span>
              </p>
            )}
            {sum.unknownIssues > 0 && (
              <p className="text-[11px] text-amber-700">
                수량을 알 수 없는 발급 기록 {sum.unknownIssues}건 —
                그 계약은 <strong>발급이 막힙니다</strong>(잔량을 셀 수 없습니다).
              </p>
            )}
            {unlinked.length > 0 && (
              <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>
                  계약 전 발급 {unlinked.length}건 (연결 안 됨) — {UNLINKED_ISSUE_HINT}
                </span>
              </p>
            )}
            {sum.disagreeingLines > 0 && (
              <p className="text-[11px] text-amber-700">
                청구 상태와 금액이 어긋나는 줄 {sum.disagreeingLines}건 — 아래 원장에서 확인하세요.
              </p>
            )}
          </div>

          <Button size="sm" variant="ghost" className="h-7 text-xs"
            onClick={() => setShowLedger(v => !v)}>
            <Receipt className="h-3 w-3 mr-1" />
            구매 원장 {purchases ? `(${purchases.length})` : ''} {showLedger ? '접기' : '펼치기'}
          </Button>

          {showLedger && (
            <PurchaseLedger contract={contract} purchases={purchases ?? []} today={today} />
          )}
        </>
      )}

      {voiding && (
        <VoidDialog
          title="계약을 무효로 바꿉니다"
          hint="지우지 않습니다 — 무효로 표시하고 사유를 남깁니다. 이 계약에 달린 구매 기록도 그대로 남습니다."
          onClose={() => setVoiding(false)}
          onConfirm={async reason => {
            await voidContract(contract.id, reason);
            qc.invalidateQueries({ queryKey: ['partner_contracts', contract.partner_id] });
            qc.invalidateQueries({ queryKey: ['receivables'] });
            setVoiding(false);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── 구매 원장 ─────────────────────────

function PurchaseLedger({ contract, purchases, today }: {
  contract: ContractRow; purchases: PurchaseRowFull[]; today: string;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['partner_purchases', contract.id] });
    qc.invalidateQueries({ queryKey: ['receivables'] });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">{PURCHASE_EDIT_HINT}</p>
        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 ml-2"
          onClick={() => setAdding(true)}>
          <Plus className="h-3 w-3 mr-1" />구매 회차 추가
        </Button>
      </div>

      {purchases.length === 0
        ? <p className="text-xs text-muted-foreground">구매 기록이 없습니다.</p>
        : (
          <div className="space-y-1.5">
            {purchases.map(p => (
              <PurchaseRowView key={p.id} row={p} today={today} onChanged={refresh} />
            ))}
          </div>
        )}

      <p className="text-[11px] text-muted-foreground border-t pt-2">{RECEIVABLE_BASIS}</p>

      {adding && (
        <PurchaseDialog
          contract={contract} today={today}
          onClose={() => setAdding(false)}
          onSaved={() => { refresh(); setAdding(false); }}
        />
      )}
    </div>
  );
}

function PurchaseRowView({ row, today, onChanged }: {
  row: PurchaseRowFull; today: string; onChanged: () => void;
}) {
  const [billing, setBilling] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const m = moneyOf(row);
  const days = receivableDays(row, today);
  const stage = receivableStage(row, today);
  const differs = amountDiffers(row);
  const voided = !!row.voided_at;

  return (
    <div className={`rounded border px-2.5 py-2 text-xs space-y-1 ${voided ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{row.purchased_on}</span>
        <span>{seatMonthsLabel(row.seat_months)}</span>
        <span>{money(row.amount, row.currency)}</span>
        <Badge variant="outline" className="h-4 px-1 text-[10px]">
          {BILLING_LABEL[(row.billing_status as BillingStatus)] ?? String(row.billing_status)}
        </Badge>
        {voided && <Badge variant="secondary" className="h-4 px-1 text-[10px]">무효</Badge>}
        {row.invoice_no && <span className="text-muted-foreground">{row.invoice_no}</span>}
        {!voided && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[11px]"
              onClick={() => setBilling(true)}>청구·입금</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive"
              onClick={() => setVoiding(true)}>무효</Button>
          </div>
        )}
      </div>

      {!voided && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {row.invoiced_on && <span>청구 {row.invoiced_on}</span>}
          {row.paid_on && <span>입금 {row.paid_on} · {money(row.paid_amount, row.currency)}</span>}
          {m.outstanding !== null && m.outstanding > 0 && (
            <span className={stage === 'd60' ? 'text-destructive' : stage === 'd30' ? 'text-amber-700' : ''}>
              미수 {money(m.outstanding, row.currency)}
              {days !== null && ` · ${days}일 경과`}
              {stage !== 'none' && ` · ${STAGE_LABEL[stage]}`}
            </span>
          )}
          {m.overpaid > 0 && <span>초과 입금 {money(m.overpaid, row.currency)}</span>}
          {m.billed === null && <span className="text-amber-700">청구 금액이 비어 있습니다</span>}
          {differs === true && (
            <span className="text-amber-700">
              계산값 {money(expectedAmount(row), row.currency)} 와 다릅니다
            </span>
          )}
          {statusDisagrees(row) && (
            <span className="text-amber-700">상태 표시가 금액과 어긋납니다</span>
          )}
        </div>
      )}

      {row.memo && <p className="text-[11px] text-muted-foreground">{row.memo}</p>}
      {voided && row.void_reason && (
        <p className="text-[11px] text-muted-foreground">무효 사유: {row.void_reason}</p>
      )}

      {billing && (
        <BillingDialog row={row} onClose={() => setBilling(false)}
          onSaved={() => { onChanged(); setBilling(false); }} />
      )}
      {voiding && (
        <VoidDialog
          title="구매 회차를 무효로 바꿉니다"
          hint="지우지 않습니다. 금액을 잘못 적었다면 무효로 바꾼 뒤 다시 등록하세요."
          onClose={() => setVoiding(false)}
          onConfirm={async reason => {
            await voidPurchase(row.id, reason);
            onChanged(); setVoiding(false);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── 대화창들 ─────────────────────────

function Problems({ problems }: { problems: Array<{ field: string; message: string }> }) {
  if (problems.length === 0) return null;
  return (
    <ul className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive space-y-0.5">
      {problems.map((p, i) => <li key={i}>{p.message}</li>)}
    </ul>
  );
}

function ContractDialog({ partnerId, partnerCurrency, contract, files, today, onClose, onSaved }: {
  partnerId: string; partnerCurrency?: string | null; contract: ContractRow | null;
  files?: Array<{ id: string; file_type: string; file_name: string }>;
  today: string; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!contract;
  const [form, setForm] = useState<ContractForm>(() =>
    contract ? contractToForm(contract, today) : emptyContractForm(today, partnerCurrency ?? 'USD'));
  const [tried, setTried] = useState(false);

  const set = (k: keyof ContractForm, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  const problems = useMemo(() => validateContractForm(form), [form]);
  const show = visibleFields(form.settlement_method);
  const locked = isMethodLocked(isEdit);

  const save = useMutation({
    mutationFn: async () => {
      const payload = toContractPayload(form, partnerId);
      if (!payload) throw new Error('정산 방식을 고르세요.');
      if (isEdit) {
        // settlement_method 는 보내지 않는다 — 만든 뒤에는 바꾸지 않는다.
        const { partner_id: _p, settlement_method: _m, ...rest } = payload;
        await updateContract(contract!.id, rest);
      } else {
        await createContract(payload);
      }
    },
    onSuccess: () => { toast.success(isEdit ? '계약을 수정했습니다' : '계약을 등록했습니다'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '계약 수정' : '계약 추가'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">
              정산 방식 {locked && <Lock className="inline h-3 w-3 ml-1" />}
            </Label>
            <Select value={form.settlement_method} disabled={locked}
              onValueChange={v => set('settlement_method', v as SettlementMethod)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="고르세요" /></SelectTrigger>
              <SelectContent>
                {SETTLEMENT_METHODS.map(m => (
                  <SelectItem key={m} value={m}>{SETTLEMENT_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.settlement_method && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {SETTLEMENT_HINT[form.settlement_method as SettlementMethod]}
              </p>
            )}
            {locked && <p className="text-[11px] text-amber-700 mt-1">{METHOD_LOCK_HINT}</p>}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">시작일</Label>
              <Input type="date" className="h-9" value={form.starts_on}
                onChange={e => set('starts_on', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">종료일</Label>
              <Input type="date" className="h-9" value={form.ends_on}
                onChange={e => set('ends_on', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">갱신일</Label>
              <Input type="date" className="h-9" value={form.renews_on}
                onChange={e => set('renews_on', e.target.value)} />
            </div>
          </div>

          {show.quantity && (
            <div>
              <Label className="text-xs">계약 수량</Label>
              <div className="flex items-center gap-2">
                <Input className="h-9" inputMode="numeric" placeholder="인원"
                  value={form.seats} onChange={e => set('seats', e.target.value)} />
                <span className="text-xs text-muted-foreground">명 ×</span>
                <Input className="h-9" inputMode="numeric" placeholder="개월"
                  value={form.months} onChange={e => set('months', e.target.value)} />
                <span className="text-xs text-muted-foreground">개월 =</span>
                <span className="text-xs font-medium whitespace-nowrap">
                  {seatMonthsLabel(contractSeatMonths(form))}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{QUANTITY_HINT}</p>
            </div>
          )}

          {show.grant && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={form.is_grant}
                onCheckedChange={v => set('is_grant', v === true)} />
              무상 배정 (단가 0으로 처리합니다 — 행사·테스트용)
            </label>
          )}

          {show.price && !form.is_grant && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">연간 인원당 단가</Label>
                <Input className="h-9" inputMode="decimal" value={form.unit_price_per_seat_year}
                  onChange={e => set('unit_price_per_seat_year', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">통화</Label>
                <Input className="h-9" value={form.currency}
                  onChange={e => set('currency', e.target.value.toUpperCase())} />
              </div>
            </div>
          )}

          {show.currency && form.is_grant && (
            <div>
              <Label className="text-xs">통화</Label>
              <Input className="h-9" value={form.currency}
                onChange={e => set('currency', e.target.value.toUpperCase())} />
            </div>
          )}

          {show.rate && (
            <div>
              <Label className="text-xs">수수료율 (%)</Label>
              <Input className="h-9" inputMode="decimal" value={form.commission_rate}
                onChange={e => set('commission_rate', e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">상태</Label>
              <Select value={form.status}
                onValueChange={v => set('status', v as ContractStatus)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['draft', 'active', 'ended'] as const).map(s => (
                    <SelectItem key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                작성 중으로 저장해 두고 나중에 채울 수 있습니다.
              </p>
            </div>
            <div>
              <Label className="text-xs">계약서 파일</Label>
              <Select value={form.contract_file_id || '__none__'}
                onValueChange={v => set('contract_file_id', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="없음" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">없음</SelectItem>
                  {(files ?? []).map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.file_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">메모</Label>
            <Textarea rows={2} value={form.notes}
              onChange={e => set('notes', e.target.value)} />
          </div>

          {tried && <Problems problems={problems} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>닫기</Button>
          <Button disabled={save.isPending}
            onClick={() => {
              setTried(true);
              if (problems.length === 0) save.mutate();
            }}>
            {save.isPending ? '저장 중…' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseDialog({ contract, today, onClose, onSaved }: {
  contract: ContractRow; today: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<PurchaseForm>(() => emptyPurchaseForm(today, contract));
  const [tried, setTried] = useState(false);
  const set = (k: keyof PurchaseForm, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  const problems = useMemo(() => validatePurchaseForm(form), [form]);

  const preview = useMemo(() => {
    const payload = toPurchasePayload(form, contract.id);
    return payload ? expectedAmount(payload) : null;
  }, [form, contract.id]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = toPurchasePayload(form, contract.id);
      if (!payload) throw new Error('인원과 개월 수를 확인하세요.');
      await createPurchase(payload);
    },
    onSuccess: () => { toast.success('구매 회차를 등록했습니다'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>구매 회차 추가</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">구매일</Label>
            <Input type="date" className="h-9" value={form.purchased_on}
              onChange={e => set('purchased_on', e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">수량</Label>
            <div className="flex items-center gap-2">
              <Input className="h-9" inputMode="numeric" placeholder="인원"
                value={form.seats} onChange={e => set('seats', e.target.value)} />
              <span className="text-xs text-muted-foreground">명 ×</span>
              <Input className="h-9" inputMode="numeric" placeholder="개월"
                value={form.months} onChange={e => set('months', e.target.value)} />
              <span className="text-xs text-muted-foreground">개월</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{QUANTITY_HINT}</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">연간 인원당 단가</Label>
              <Input className="h-9" inputMode="decimal" value={form.unit_price_per_seat_year}
                onChange={e => set('unit_price_per_seat_year', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">통화</Label>
              <Input className="h-9" value={form.currency}
                onChange={e => set('currency', e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label className="text-xs">청구 금액</Label>
              <Input className="h-9" inputMode="decimal" value={form.amount}
                onChange={e => set('amount', e.target.value)} />
            </div>
          </div>
          {preview !== null && (
            <p className="text-[11px] text-muted-foreground">
              계산값 {money(preview, form.currency)} — 할인·절삭이 있으면 그대로 두셔도 됩니다.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">청구서 번호</Label>
              <Input className="h-9" value={form.invoice_no}
                onChange={e => set('invoice_no', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">청구 상태</Label>
              <Select value={form.billing_status}
                onValueChange={v => set('billing_status', v as BillingStatus)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{BILLING_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">청구일</Label>
              <Input type="date" className="h-9" value={form.invoiced_on}
                onChange={e => set('invoiced_on', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">입금일</Label>
              <Input type="date" className="h-9" value={form.paid_on}
                onChange={e => set('paid_on', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">입금액</Label>
              <Input className="h-9" inputMode="decimal" value={form.paid_amount}
                onChange={e => set('paid_amount', e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            일부만 들어왔으면 들어온 금액만 적으세요. 미수액은 청구 금액에서 빼서 보여 줍니다.
          </p>

          <div>
            <Label className="text-xs">메모</Label>
            <Textarea rows={2} value={form.memo}
              onChange={e => set('memo', e.target.value)} />
          </div>

          {tried && <Problems problems={problems} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>닫기</Button>
          <Button disabled={save.isPending}
            onClick={() => { setTried(true); if (problems.length === 0) save.mutate(); }}>
            {save.isPending ? '저장 중…' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BillingDialog({ row, onClose, onSaved }: {
  row: PurchaseRowFull; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<PurchaseForm>(() => ({
    purchased_on: row.purchased_on, seats: '1', months: '1',
    unit_price_per_seat_year: '', currency: String(row.currency ?? ''),
    amount: row.amount === null || row.amount === undefined ? '' : String(row.amount),
    invoice_no: String(row.invoice_no ?? ''),
    billing_status: (row.billing_status as BillingStatus) ?? 'unbilled',
    invoiced_on: row.invoiced_on ? String(row.invoiced_on).slice(0, 10) : '',
    paid_on: row.paid_on ? String(row.paid_on).slice(0, 10) : '',
    paid_amount: row.paid_amount === null || row.paid_amount === undefined ? '' : String(row.paid_amount),
    memo: String(row.memo ?? ''),
  }));
  const [tried, setTried] = useState(false);
  const set = (k: keyof PurchaseForm, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  // 금액·수량은 고치지 않으므로 그 검사는 빼고 본다 — 청구·입금 칸만 본다.
  const problems = useMemo(
    () => validatePurchaseForm(form).filter(p =>
      ['billing_status', 'invoiced_on', 'paid_on', 'paid_amount'].includes(p.field)),
    [form]);

  const save = useMutation({
    mutationFn: async () => {
      await patchBilling(row.id, toBillingPatch(form));
      if ((form.memo || '') !== String(row.memo ?? '')) {
        await patchPurchaseNote(row.id, { memo: form.memo.trim() || null });
      }
    },
    onSuccess: () => { toast.success('청구·입금을 기록했습니다'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>청구·입금 기록</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {row.purchased_on} · {seatMonthsLabel(row.seat_months)} ·{' '}
            청구 금액 {money(row.amount, row.currency)}
          </p>
          <p className="text-[11px] text-amber-700">
            금액·수량·구매일은 여기서 고칠 수 없습니다. 잘못 적었다면 <strong>무효 후 재등록</strong>하세요.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">청구 상태</Label>
              <Select value={form.billing_status}
                onValueChange={v => set('billing_status', v as BillingStatus)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{BILLING_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">청구서 번호</Label>
              <Input className="h-9" value={form.invoice_no}
                onChange={e => set('invoice_no', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">청구일</Label>
              <Input type="date" className="h-9" value={form.invoiced_on}
                onChange={e => set('invoiced_on', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">입금일</Label>
              <Input type="date" className="h-9" value={form.paid_on}
                onChange={e => set('paid_on', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">입금액</Label>
              <Input className="h-9" inputMode="decimal" value={form.paid_amount}
                onChange={e => set('paid_amount', e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">메모</Label>
            <Textarea rows={2} value={form.memo}
              onChange={e => set('memo', e.target.value)} />
          </div>

          {tried && <Problems problems={problems} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>닫기</Button>
          <Button disabled={save.isPending}
            onClick={() => { setTried(true); if (problems.length === 0) save.mutate(); }}>
            {save.isPending ? '저장 중…' : '기록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ title, hint, onClose, onConfirm }: {
  title: string; hint: string; onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const problems = validateVoidReason(reason);
  const run = useMutation({
    mutationFn: () => onConfirm(reason),
    onSuccess: () => toast.success('무효로 바꿨습니다'),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div>
          <Label className="text-xs">사유 (필수)</Label>
          <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="예: 금액을 잘못 적어 다시 등록함" />
        </div>
        {tried && <Problems problems={problems} />}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>닫기</Button>
          <Button variant="destructive" disabled={run.isPending}
            onClick={() => { setTried(true); if (problems.length === 0) run.mutate(); }}>
            {run.isPending ? '처리 중…' : '무효로 바꾸기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
