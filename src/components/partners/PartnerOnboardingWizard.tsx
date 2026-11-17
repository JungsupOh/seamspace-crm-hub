// 해외 파트너 등록 마법사 (LEAD-S7-6)
//
// 브리프 K항: 한 단계씩, **중간 저장**, 필수값 누락 표시, 어디까지 했는지 보이기.
// 튀르키예가 중간에 멈춘 이유가 "한 번에 다 입력해야 하는 구조"였으므로,
// **아무 때나 저장**되고 **처음 비어 있는 단계**로 이어서 들어간다.
//
// 계약 단계는 S7-2b 의 폼 로직을 **재사용**한다(복제하지 않는다).

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';

import {
  STEPS, STEP_DEFS, canFinish, emptyDraft, partnerToDraft, progressOf,
  stepProblems, toPartnerPayload, type OnboardingDraft, type StepNo,
} from '@/lib/partnerOnboarding';
import { SETTLEMENT_LABEL, SETTLEMENT_METHODS, type SettlementMethod } from '@/lib/partnerContract';
import { QUANTITY_HINT, seatMonthsLabel } from '@/lib/partnerContractForm';
import { PARTNER_COUNTRIES, PARTNER_LOCALES } from '@/lib/partner-i18n';
import { todayKst } from '@/lib/leadFollowup';

/** 첫 관리자 계정은 **기존 흐름**으로 만든다 — 여기서 만들지 않는다. */
export const ADMIN_ACCOUNT_HINT =
  '첫 파트너 관리자 계정은 사용자 관리 화면에서 만듭니다(역할 partner_admin, 이 파트너로 연결). '
  + '그 뒤부터는 파트너 관리자가 자기 직원을 초대할 수 있습니다. '
  + '이 마법사는 계정을 만들지 않고, 메일도 보내지 않습니다.';

export const DRAFT_HINT =
  '작성 중에는 **이용권 발급 권한이 켜지지 않습니다.** 완료를 눌러야 켜집니다.';

interface Props {
  /** 이어서 쓸 파트너 행(없으면 새로 만든다) */
  initial?: Record<string, unknown> | null;
  onClose: () => void;
  onSaved: (partnerId: string | null) => void;
  /** 저장은 호출부가 한다(Partners.tsx 의 기존 create/update 경로 재사용) */
  save: (payload: ReturnType<typeof toPartnerPayload>, finish: boolean) => Promise<string | null>;
}

export default function PartnerOnboardingWizard({ initial, onClose, onSaved, save }: Props) {
  const today = todayKst();
  const [draft, setDraft] = useState<OnboardingDraft>(
    () => (initial ? partnerToDraft(initial, today) : emptyDraft(today)));

  const problems = useMemo(() => stepProblems(draft), [draft]);
  const prog = useMemo(() => progressOf(draft), [draft]);
  // 이어서 쓸 때는 **처음 비어 있는 단계**로 들어간다
  const [step, setStep] = useState<StepNo>(() =>
    (initial ? progressOf(partnerToDraft(initial, today)).firstOpen : 1));

  const set = (k: keyof OnboardingDraft, v: unknown) => setDraft(p => ({ ...p, [k]: v }));
  const here = problems.filter(p => p.step === step);

  const doSave = useMutation({
    mutationFn: (finish: boolean) => save(toPartnerPayload(draft, finish), finish),
    onSuccess: (id, finish) => {
      toast.success(finish ? '등록을 끝냈습니다' : '작성 중으로 저장했습니다');
      onSaved(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>해외 파트너 등록</DialogTitle>
        </DialogHeader>

        {/* 어디까지 했는지 */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {STEP_DEFS.map(s => {
              const done = !problems.some(p => p.step === s.no);
              return (
                <button key={s.no} type="button" onClick={() => setStep(s.no)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition ${
                    s.no === step ? 'border-primary bg-primary/10 font-medium'
                      : done ? 'text-muted-foreground' : 'text-amber-700 border-amber-300'}`}>
                  {done && <Check className="h-3 w-3" />}{s.no}. {s.ko}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {STEPS.length}단계 중 <strong>{prog.done}</strong>단계 완료 ({prog.percent}%)
            {prog.done < STEPS.length && ` · 다음 할 곳: ${prog.firstOpen}단계`}
          </p>
        </div>

        <div className="space-y-3 border-t pt-3">
          {step === 1 && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="회사 이름 *">
                  <Input className="h-9" value={draft.name} onChange={e => set('name', e.target.value)} />
                </Field>
                <Field label="국가 *">
                  <select className="w-full h-9 text-sm rounded-md border bg-background px-2"
                    value={draft.country}
                    onChange={e => {
                      const c = PARTNER_COUNTRIES.find(x => x.code === e.target.value);
                      setDraft(p => ({ ...p, country: e.target.value,
                        locale: c?.locale ?? p.locale, currency: c?.currency ?? p.currency }));
                    }}>
                    <option value="">—</option>
                    {PARTNER_COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="담당자 (선택)">
                  <Input className="h-9" value={draft.contactName}
                    onChange={e => set('contactName', e.target.value)} />
                </Field>
                <Field label="언어 *">
                  <select className="w-full h-9 text-sm rounded-md border bg-background px-2"
                    value={draft.locale} onChange={e => set('locale', e.target.value)}>
                    {PARTNER_LOCALES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </Field>
                <Field label="통화 *">
                  <Input className="h-9" value={draft.currency}
                    onChange={e => set('currency', e.target.value.toUpperCase())} />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground">
                국가를 고르면 언어·통화가 기본값으로 채워집니다. 그대로 바꿀 수 있습니다.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Field label="시작일 *">
                  <Input type="date" className="h-9" value={draft.startsOn}
                    onChange={e => set('startsOn', e.target.value)} />
                </Field>
                <Field label="종료일">
                  <Input type="date" className="h-9" value={draft.endsOn}
                    onChange={e => set('endsOn', e.target.value)} />
                </Field>
                <Field label="갱신일">
                  <Input type="date" className="h-9" value={draft.renewsOn}
                    onChange={e => set('renewsOn', e.target.value)} />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground">
                계약서 파일은 파트너를 저장한 뒤 "계약 서류"에서 올리고, 계약 카드에서 고르면 됩니다.
                아직 서명 전이어도 다음 단계로 갈 수 있습니다.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <Field label="정산 방식 *">
                <select className="w-full h-9 text-sm rounded-md border bg-background px-2"
                  value={draft.settlementMethod}
                  onChange={e => set('settlementMethod', e.target.value as SettlementMethod)}>
                  <option value="">—</option>
                  {SETTLEMENT_METHODS.map(m => (
                    <option key={m} value={m}>{SETTLEMENT_LABEL[m]}</option>
                  ))}
                </select>
              </Field>
              <Field label="계약 수량 (선택)">
                <div className="flex items-center gap-2">
                  <Input className="h-9" inputMode="numeric" placeholder="인원"
                    value={draft.seats} onChange={e => set('seats', e.target.value)} />
                  <span className="text-xs text-muted-foreground">명 ×</span>
                  <Input className="h-9" inputMode="numeric" placeholder="개월"
                    value={draft.months} onChange={e => set('months', e.target.value)} />
                  <span className="text-xs whitespace-nowrap">
                    = {seatMonthsLabel(
                      draft.seats && draft.months ? Number(draft.seats) * Number(draft.months) : null)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{QUANTITY_HINT}</p>
              </Field>
              {draft.settlementMethod === 'wholesale' && (
                <Field label="연간 인원당 단가 *">
                  <Input className="h-9" inputMode="decimal" value={draft.unitPrice}
                    onChange={e => set('unitPrice', e.target.value)} />
                </Field>
              )}
              {draft.settlementMethod === 'commission' && (
                <Field label="수수료율 (%) *">
                  <Input className="h-9" inputMode="decimal" value={draft.commissionRate}
                    onChange={e => set('commissionRate', e.target.value)} />
                </Field>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={draft.canIssueLicenses}
                  onCheckedChange={v => set('canIssueLicenses', v === true)} />
                이 파트너가 이용권을 직접 발급할 수 있게 한다
              </label>
              <p className="text-[11px] text-amber-700">{DRAFT_HINT}</p>
              <p className="text-[11px] text-muted-foreground">
                계정별 발급 한도는 두지 않습니다 — 도매형은 <strong>계약 잔량이 유일한 한도</strong>입니다.
              </p>
              <Field label="메모 (선택)">
                <Textarea rows={2} value={draft.issuingNote}
                  onChange={e => set('issuingNote', e.target.value)} />
              </Field>
            </>
          )}

          {step === 5 && (
            <>
              <p className="text-sm">{ADMIN_ACCOUNT_HINT}</p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={draft.adminAcknowledged}
                  onCheckedChange={v => set('adminAcknowledged', v === true)} />
                확인했습니다
              </label>
            </>
          )}

          {step === 6 && (
            <div className="space-y-2 text-sm">
              <Row k="회사" v={`${draft.name || '—'} (${draft.country || '—'})`} />
              <Row k="언어·통화" v={`${draft.locale} · ${draft.currency}`} />
              <Row k="기간" v={`${draft.startsOn || '—'} ~ ${draft.endsOn || '미정'}`} />
              <Row k="정산 방식" v={draft.settlementMethod
                ? SETTLEMENT_LABEL[draft.settlementMethod as SettlementMethod] : '—'} />
              <Row k="계약 수량" v={seatMonthsLabel(
                draft.seats && draft.months ? Number(draft.seats) * Number(draft.months) : null)} />
              <Row k="발급 권한" v={draft.canIssueLicenses ? '켬' : '끔'} />
              {!canFinish(draft) && (
                <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5">
                  <p className="font-medium">아직 비어 있는 곳이 있습니다:</p>
                  {problems.map((p, i) => (
                    <p key={i}>· {p.step}단계 — {p.message}</p>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                완료하면 계약은 <strong>작성 중(draft)</strong> 으로 만들어 둡니다.
                유효로 올리는 것은 계약 화면에서 사람이 합니다.
              </p>
            </div>
          )}

          {/* 이 단계에서 비어 있는 곳 */}
          {step !== 6 && here.length > 0 && (
            <ul className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5">
              {here.map((p, i) => <li key={i}>{p.message}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" disabled={step === 1}
              onClick={() => setStep((step - 1) as StepNo)}>
              <ChevronLeft className="h-4 w-4" />이전
            </Button>
            <Button variant="ghost" size="sm" disabled={step === 6}
              onClick={() => setStep((step + 1) as StepNo)}>
              다음<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={doSave.isPending || !draft.name.trim()}
              onClick={() => doSave.mutate(false)}>
              작성 중으로 저장
            </Button>
            <Button size="sm" disabled={doSave.isPending || !canFinish(draft)}
              onClick={() => doSave.mutate(true)}>
              완료
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}

/** 목록 배지 */
export function OnboardingBadgeView({ status }: { status: unknown }) {
  if (status === 'draft') {
    return <Badge variant="outline" className="h-4 px-1 text-[10px] border-amber-400 text-amber-700">작성 중</Badge>;
  }
  return null;
}
