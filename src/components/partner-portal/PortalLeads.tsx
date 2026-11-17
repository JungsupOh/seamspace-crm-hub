// 파트너 포털 — 내 리드 (LEAD-S7-7b)
//
// **`campaign_leads` 를 직접 부르는 코드가 이 파일에 없다.** 전부 `partner-lead`
// 함수를 지난다(`partnerPortalLeads.ts`). 함수가 허용 칸만 주므로, 화면은
// **받은 것만 그린다** — 없는 칸은 그릴 수도 없다.
//
// `partner_viewer` 에게는 함수가 애초에 이름·연락처를 주지 않는다. 그래서 여기서
// 숨기는 코드는 **설명을 붙이기 위한 것**이지 가리개가 아니다 — 가리개는 서버에 있다.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Info, Plus, ShieldCheck } from 'lucide-react';

import {
  canSubmit, createLead, emptyLeadForm, formProblem, getMyLeads, hasContact,
  leadSummary, protectionTone, recordContact,
  type LeadFormInput, type PortalLead,
} from '@/lib/partnerPortalLeads';
import { CONTACT_OWNER_MSG, LEAD_MSG } from '@/lib/partnerPortalMsg';
import { makeT, type PartnerLocale } from '@/lib/partner-i18n';

interface Props {
  locale: PartnerLocale;
  /** 기본 국가 — 폼을 미리 채운다 */
  country: string | null;
  role: string;
}

export default function PortalLeads({ locale, country, role }: Props) {
  const t = makeT(locale);
  const T = (k: keyof typeof LEAD_MSG) => t(LEAD_MSG[k]);
  const qc = useQueryClient();
  const isViewer = role === 'partner_viewer';
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LeadFormInput>(() => emptyLeadForm(country ?? ''));

  const { data: leads, isLoading, error } = useQuery({
    queryKey: ['portal-leads'],
    queryFn: getMyLeads,
  });

  const sum = useMemo(() => leadSummary(leads ?? []), [leads]);
  const problem = formProblem(form);

  const submit = useMutation({
    mutationFn: () => createLead(form),
    onSuccess: r => {
      if (!r.ok) { toast.error(r.message); return; }
      // **중복이면 안내가 다르다 — 상대가 누구인지는 어디에도 없다**
      if (r.notice === 'other') toast.warning(r.message);
      else toast.success(r.message || T('submit'));
      setForm(emptyLeadForm(country ?? ''));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['portal-leads'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (k: keyof LeadFormInput, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{T('title')}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{T('intro')}</p>
          </div>
          {isViewer ? (
            <span className="text-xs text-muted-foreground">{T('viewerNoAdd')}</span>
          ) : (
            <Button size="sm" variant={open ? 'ghost' : 'outline'} onClick={() => setOpen(o => !o)}>
              {open ? T('cancel') : <><Plus className="h-4 w-4 mr-1" />{T('add')}</>}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 요약 */}
        {(leads?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-3 text-xs">
            <Sum label={T('sumTotal')} v={sum.total} />
            <Sum label={T('sumProtected')} v={sum.protectedNow} />
            {sum.ending > 0 && <Sum label={T('sumEnding')} v={sum.ending} warn />}
            {sum.noContact > 0 && <Sum label={T('sumNoContact')} v={sum.noContact} warn />}
          </div>
        )}

        {/* 등록 폼 */}
        {open && !isViewer && (
          <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 gap-2">
              <F label={`${T('schoolName')} *`}>
                <Input className="h-9" value={form.schoolName}
                  onChange={e => set('schoolName', e.target.value)} />
              </F>
              <F label={T('schoolKind')}>
                <Input className="h-9" value={form.schoolKind}
                  onChange={e => set('schoolKind', e.target.value)} />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <F label={T('person')}>
                <Input className="h-9" value={form.name}
                  onChange={e => set('name', e.target.value)} />
              </F>
              <F label={T('position')}>
                <Input className="h-9" value={form.position}
                  onChange={e => set('position', e.target.value)} />
              </F>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <F label={`${T('email')} *`}>
                <Input className="h-9" type="email" value={form.email}
                  onChange={e => set('email', e.target.value)} />
              </F>
              <F label={T('phone')}>
                <Input className="h-9" value={form.phone}
                  onChange={e => set('phone', e.target.value)} />
              </F>
              <F label={T('country')}>
                <Input className="h-9" maxLength={2} value={form.country}
                  onChange={e => set('country', e.target.value.toUpperCase())} />
              </F>
            </div>

            {/* 연락처 주체 — **동의가 여기에 달려 있다** */}
            <div className="space-y-1.5">
              <Label className="text-xs">{T('ownerAsk')} *</Label>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="contactOwner" checked={form.contactOwner === 'end_user'}
                    onChange={() => set('contactOwner', 'end_user')} />
                  {T('ownerEndUser')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="contactOwner" checked={form.contactOwner === 'partner'}
                    onChange={() => setForm(p => ({ ...p, contactOwner: 'partner', consented: false }))} />
                  {T('ownerPartner')}
                </label>
              </div>
            </div>

            {form.contactOwner === 'end_user' && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-1">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={form.consented}
                    onCheckedChange={v => set('consented', v === true)} />
                  <span>{T('consent')}</span>
                </label>
                <p className="text-[11px] text-amber-800">{T('consentWhy')}</p>
              </div>
            )}
            {form.contactOwner === 'partner' && (
              <p className="text-[11px] text-muted-foreground">{T('agentNote')}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{T('cancel')}</Button>
              <Button size="sm" disabled={!canSubmit(form) || submit.isPending}
                onClick={() => submit.mutate()}>
                {T('submit')}
              </Button>
            </div>
            {problem && (
              <p className="text-[11px] text-amber-700 text-right">
                {problem === 'consented' ? T('consentWhy') : `${T('schoolName')} · ${T('email')} · ${T('ownerAsk')}`}
              </p>
            )}
          </div>
        )}

        {/* 목록 */}
        {isLoading && <p className="text-sm text-muted-foreground">{T('loading')}</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {!isLoading && !error && (leads?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">{T('empty')}</p>
        )}

        {(leads ?? []).map(l => (
          <LeadRow key={l.id} lead={l} locale={locale} canRecord={!isViewer} />
        ))}

        {(leads?.length ?? 0) > 0 && (
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>{T('protHow')} {!isViewer && T('contactAsk')}</span>
          </p>
        )}
        {isViewer && (leads?.length ?? 0) > 0 && (
          <p className="text-[11px] text-muted-foreground">{T('viewerOnly')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function LeadRow(
  { lead, locale, canRecord }: { lead: PortalLead; locale: PartnerLocale; canRecord: boolean },
) {
  const t = makeT(locale);
  const T = (k: keyof typeof LEAD_MSG) => t(LEAD_MSG[k]);
  const qc = useQueryClient();
  const tone = protectionTone(lead.protection_days_left);
  const days = lead.protection_days_left ?? 0;

  // **날짜를 보내지 않는다** — 서버가 자기 시각으로 적는다
  const record = useMutation({
    mutationFn: () => recordContact(lead.id),
    onSuccess: r => {
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ['portal-leads'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{lead.school_name ?? '—'}</p>
          <p className="text-xs text-muted-foreground">
            {[lead.country, lead.school_kind].filter(Boolean).join(' · ') || ' '}
          </p>
        </div>
        <Badge variant="outline" className={
          tone === 'ended' ? 'border-slate-300 text-slate-500'
          : tone === 'soon' ? 'border-amber-400 text-amber-700'
          : 'border-emerald-400 text-emerald-700'}>
          <ShieldCheck className="h-3 w-3 mr-1" />
          {tone === 'ended' ? T('protEnded') : `${days} ${T('daysLeft')}`}
        </Badge>
      </div>

      {/* **없는 칸은 그리지 않는다** — 보기 전용에게는 함수가 주지 않는다 */}
      {(lead.name || lead.email || lead.phone || lead.position) && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {lead.name && <p>{T('person')}: {lead.name}{lead.position ? ` (${lead.position})` : ''}</p>}
          {lead.email && <p>{T('email')}: {lead.email}</p>}
          {lead.phone && <p>{T('phone')}: {lead.phone}</p>}
        </div>
      )}

      <div className="flex items-end justify-between gap-2">
      <p className="text-xs">
        {hasContact(lead)
          ? <>{T('lastContact')}: {String(lead.last_contact_at).slice(0, 10)}</>
          : <span className="text-amber-700">{T('noContact')}</span>}
        {lead.contact_owner && (
          <span className="text-muted-foreground ml-2">
            · {t(CONTACT_OWNER_MSG[lead.contact_owner])}
          </span>
        )}
      </p>
      {canRecord && (
        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
          disabled={record.isPending} title={T('recordHint')}
          onClick={() => record.mutate()}>
          {T('recordBtn')}
        </Button>
      )}
      </div>
    </div>
  );
}

function Sum({ label, v, warn }: { label: string; v: number; warn?: boolean }) {
  return (
    <span className={warn ? 'text-amber-700' : 'text-muted-foreground'}>
      {label} <strong className="text-foreground">{v}</strong>
    </span>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
