// 리드 상세 — LEAD-UI2 R1 · R4 · R5 · R6 · R7
//
// 구성(위에서 아래, 요구 R5):
//   ① 기본 정보(편집 가능)  ② 같은 기관 사람들 + CC  ③ 빠른 기록
//   ④ 활동 기록 타임라인    ⑤ 다음 단위 자리 3개(접힌 상태, 기능 없음)

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Archive, ArchiveRestore, HelpCircle, Save } from 'lucide-react';

import {
  getActivities, getActivitiesForLeads, getCcLinks, patchLead, saveActivity, saveLeadEdit,
  setArchived, setCcLink, type Actor, type LeadRow,
} from '@/lib/leadsApi';
import {
  EMAIL_STATUS_HELP, EMAIL_STATUS_LABEL, QUALITY_HELP, diffTracked, emailStatusLabel,
  findEmailDuplicates, isChangeRecord, qualityLabel, type EditableLead,
} from '@/lib/leadEdit';
import { findOrgMates, recentOutreachToOrg } from '@/lib/leadOrg';
import { countryLabel } from '@/lib/countries';
import { REGION_LABEL, regionOf, type Region } from '@/lib/leadRegion';
import { MARKET_LABEL, toMarket } from '@/lib/leadMarket';
import {
  CHANNELS, CHANNEL_LABEL, FOLLOWUP_STAGES, kstDate, needsCloseReason,
  suggestFirstContactDue, todayKst, type Channel, type FollowupStage,
} from '@/lib/leadFollowup';
import {
  LEAD_TYPES, LEAD_TYPE_HINT, LEAD_TYPE_LABEL, PARTNER_CONVERSION_HINT, TAG_SUGGESTIONS,
  defaultNextAction, isReadyForPartnerConversion, isStageForeign, leadTagsOf, stagesFor,
  toggleTag, type LeadType,
} from '@/lib/leadType';
import { CountrySelect } from './CountrySelect';
import { OrgMatesPanel } from './OrgMatesPanel';
import { SignalsPanel } from './SignalsPanel';
import { ResearchPanel } from './ResearchPanel';
import { StrategyPanel } from './StrategyPanel';
import { OutreachPanel } from './OutreachPanel';
import {
  OUTCOMES, OUTCOME_LABEL, attemptNumbers, currentStrategy, nextAttemptNo,
  pendingRevision, type Outcome,
} from '@/lib/leadStrategy';
import { getSignals, getStrategies } from '@/lib/leadsApi';

const NONE = '__none__';

function Help({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3 w-3 text-muted-foreground inline ml-1 align-text-top" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function LeadDetail({ lead, allLeads, actor, onOpenLead }: {
  lead: LeadRow;
  allLeads: LeadRow[];
  actor: Actor;
  onOpenLead: (id: string) => void;
}) {
  const qc = useQueryClient();
  const today = todayKst();
  const refresh = () => qc.invalidateQueries({ queryKey: ['leads_all'] });

  // ── ① 기본 정보 편집 ──
  const [form, setForm] = useState<EditableLead>({});
  useEffect(() => {
    setForm({
      name: lead.name ?? '', school_name: lead.school_name ?? '', position: lead.position ?? '',
      email: lead.email ?? '', phone: lead.phone ?? '', country: lead.country ?? '',
      segment: lead.segment ?? '', segment_detail: lead.segment_detail ?? '',
      lead_type: lead.lead_type ?? '', probability: lead.probability ?? null,
      event_name: lead.event_name ?? '', owner: lead.owner ?? '',
      source_type: lead.source_type ?? '', notes: lead.notes ?? '',
      email_status: lead.email_status ?? '', followup_stage: lead.followup_stage ?? '',
    });
  }, [lead.id, lead.name, lead.school_name, lead.position, lead.email, lead.phone, lead.country,
      lead.segment, lead.segment_detail, lead.lead_type, lead.probability, lead.event_name,
      lead.owner, lead.source_type, lead.notes, lead.email_status, lead.followup_stage]);

  const set = (k: keyof EditableLead, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  // 보조 태그는 jsonb 라 EditableLead(문자열 칸들)와 따로 둔다.
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => { setTags(leadTagsOf(lead.lead_tags)); }, [lead.id, lead.lead_tags]);

  const before: EditableLead = useMemo(() => ({
    name: lead.name ?? '', school_name: lead.school_name ?? '', position: lead.position ?? '',
    email: lead.email ?? '', phone: lead.phone ?? '', country: lead.country ?? '',
    segment: lead.segment ?? '', segment_detail: lead.segment_detail ?? '',
    lead_type: lead.lead_type ?? '', probability: lead.probability ?? null,
    event_name: lead.event_name ?? '', owner: lead.owner ?? '',
    source_type: lead.source_type ?? '', notes: lead.notes ?? '',
    email_status: lead.email_status ?? '', followup_stage: lead.followup_stage ?? '',
  }), [lead]);

  const changes = useMemo(() => diffTracked(before, form), [before, form]);
  const dirty = useMemo(
    () => JSON.stringify(before) !== JSON.stringify(form), [before, form]);

  // 같은 이메일의 다른 리드 — 막지 않고 알려만 준다(R1)
  const emailDups = useMemo(
    () => (form.email && form.email !== lead.email)
      ? findEmailDuplicates(lead.id, form.email, allLeads) : [],
    [form.email, lead.email, lead.id, allLeads]);

  const tagsDirty = useMemo(
    () => JSON.stringify(leadTagsOf(lead.lead_tags)) !== JSON.stringify(tags),
    [lead.lead_tags, tags]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await saveLeadEdit(lead.id, before, form, actor);
      // 태그는 변경 기록 대상이 아니다(유형과 달리 단계 목록을 바꾸지 않는다).
      if (tagsDirty) await patchLead(lead.id, { lead_tags: tags });
      return r;
    },
    onSuccess: (r) => {
      toast.success(r.logged ? '저장하고 변경 기록을 남겼습니다' : '저장했습니다');
      refresh();
      qc.invalidateQueries({ queryKey: ['lead_activities', lead.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── 보관(R8) ──
  const [archiveReason, setArchiveReason] = useState('');
  const archive = useMutation({
    mutationFn: (on: boolean) => setArchived(lead.id, on, archiveReason, actor),
    onSuccess: () => {
      toast.success(lead.archived_at ? '보관을 해제했습니다' : '보관했습니다');
      setArchiveReason('');
      refresh();
      qc.invalidateQueries({ queryKey: ['lead_activities', lead.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── ② 같은 기관 + CC(R6·R7) ──
  const mates = useMemo(() => findOrgMates(lead, allLeads), [lead, allLeads]);
  const mateIds = useMemo(() => mates.map(m => m.lead.id), [mates]);

  const { data: mateActs } = useQuery({
    queryKey: ['org_acts', lead.id, mateIds.join(',')],
    queryFn: () => getActivitiesForLeads(mateIds),
    enabled: mateIds.length > 0,
    staleTime: 1000 * 60,
  });
  const recent = useMemo(() => {
    const r = recentOutreachToOrg(mates, mateActs ?? [], today);
    if (!r) return null;
    const who = mates.find(m => m.lead.id === r.leadId)?.lead.name ?? '';
    return { name: who, daysAgo: r.daysAgo };
  }, [mates, mateActs, today]);

  const { data: ccLinks } = useQuery({
    queryKey: ['cc_links', lead.id],
    queryFn: () => getCcLinks(lead.id),
  });
  const ccIds = useMemo(() => new Set((ccLinks ?? []).map(c => c.cc_lead_id)), [ccLinks]);

  const toggleCc = useMutation({
    mutationFn: ({ mate, on }: { mate: LeadRow; on: boolean }) => {
      const next = new Set(ccIds);
      if (on) next.add(mate.id); else next.delete(mate.id);
      const names = mates.filter(m => next.has(m.lead.id)).map(m => m.lead.name);
      return setCcLink(lead.id, mate.id, on, names, actor);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cc_links', lead.id] });
      qc.invalidateQueries({ queryKey: ['lead_activities', lead.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── ③ 빠른 기록 ──
  const [log, setLog] = useState({
    channel: 'email' as Channel, direction: 'out' as 'out' | 'in', summary: '',
    stageAfter: '', nextAction: '', nextDue: '', closeReason: '',
    outcome: '', learning: '',
  });
  useEffect(() => {
    setLog({
      channel: 'email', direction: 'out', summary: '',
      stageAfter: lead.followup_stage || '신규',
      nextAction: lead.next_action ?? '',
      nextDue: lead.next_action_due ?? suggestFirstContactDue(lead.probability),
      closeReason: lead.close_reason ?? '',
      outcome: '', learning: '',
    });
  }, [lead.id, lead.followup_stage, lead.next_action, lead.next_action_due, lead.close_reason, lead.probability]);

  const { data: acts } = useQuery({
    queryKey: ['lead_activities', lead.id],
    queryFn: () => getActivities(lead.id),
  });

  // ── LEAD-S1: 전략과 n차 접촉 ──
  const { data: strategies } = useQuery({
    queryKey: ['lead_strategies', lead.id],
    queryFn: () => getStrategies(lead.id),
  });
  const curStrategy = useMemo(() => currentStrategy(strategies ?? []), [strategies]);

  /** 타임라인에 보일 차수 — 저장된 번호를 믿지 않고 시간순으로 다시 센다. */
  const attemptMap = useMemo(() => attemptNumbers(acts ?? []), [acts]);
  const strategyVersionById = useMemo(() => {
    const m = new Map<string, number>();
    (strategies ?? []).forEach(st => m.set(st.id, st.version));
    return m;
  }, [strategies]);

  /**
   * 결과가 적힌 접촉이 있는데 아직 그것을 근거로 쓴 전략 판이 없으면
   * "전략을 고칠까요?" 를 띄운다. **자동으로 바꾸지 않는다**(명령서 지시).
   */
  const revisionHint = useMemo(
    () => pendingRevision(acts ?? [], strategies ?? []), [acts, strategies]);
  const [reviseFrom, setReviseFrom] = useState<string | null>(null);

  // 접힌 상태에서 개수만 보여 준다(요구 S1-2). 목록 자체는 패널이 따로 읽는다.
  const { data: signals } = useQuery({
    queryKey: ['lead_signals', lead.id], queryFn: () => getSignals(lead.id),
  });
  const signalCount = signals ? signals.filter(x => !x.voided_at).length : null;

  const saveLog = useMutation({
    mutationFn: () => saveActivity({
      leadId: lead.id, channel: log.channel, direction: log.direction, summary: log.summary,
      stageAfter: log.stageAfter as FollowupStage,
      nextAction: log.nextAction, nextActionDue: log.nextDue, closeReason: log.closeReason,
      actor: actor.name ?? undefined, actorUserId: actor.userId ?? null,
      // LEAD-S1 — 보낸 접촉에만 차수·전략을 붙인다(받은 기록은 차수가 없다).
      attemptNo: log.direction === 'out' ? nextAttemptNo(acts ?? []) : null,
      strategyId: log.direction === 'out' ? curStrategy?.id ?? null : null,
      outcome: log.outcome || null,
      learning: log.learning,
    }),
    onSuccess: () => {
      toast.success('기록했습니다');
      setLog(p => ({ ...p, summary: '', learning: '' }));
      refresh();
      qc.invalidateQueries({ queryKey: ['lead_activities', lead.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const needReason = needsCloseReason(log.stageAfter);
  const logBlocked = !log.summary.trim() || (needReason && !log.closeReason.trim());

  return (
    <div className="space-y-5">
      {/* 머리 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            {lead.name}
            {toMarket(lead.market) === 'INTL' && (
              <Badge variant="outline" className="h-5 px-1.5 text-[11px]">{MARKET_LABEL.INTL}</Badge>
            )}
            {lead.archived_at && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">보관됨</Badge>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {lead.school_name ?? '—'} · {countryLabel(lead.country)} ·{' '}
            {REGION_LABEL[regionOf(lead) as Region]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lead.archived_at
            ? (
              <Button size="sm" variant="outline" disabled={archive.isPending}
                onClick={() => archive.mutate(false)}>
                <ArchiveRestore className="h-4 w-4 mr-1.5" />보관 해제
              </Button>
            )
            : (
              <div className="flex items-center gap-1.5">
                <Input value={archiveReason} onChange={e => setArchiveReason(e.target.value)}
                  className="h-8 w-[150px] text-xs" placeholder="보관 사유" />
                <Button size="sm" variant="outline" disabled={archive.isPending}
                  onClick={() => archive.mutate(true)}>
                  <Archive className="h-4 w-4 mr-1.5" />보관
                </Button>
              </div>
            )}
        </div>
      </div>

      {/* LEAD-S1 — 결과가 적힌 접촉이 있는데 아직 그것을 근거로 쓴 전략 판이 없으면 묻는다.
          **자동으로 전략을 바꾸지 않는다**(명령서 지시). 사람이 눌러야 새 판이 시작된다. */}
      {revisionHint && !reviseFrom && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 flex flex-wrap
          items-center justify-between gap-2">
          <div className="text-sm">
            결과가 기록됐습니다
            {revisionHint.outcome && (
              <strong> ({OUTCOME_LABEL[revisionHint.outcome as Outcome] ?? String(revisionHint.outcome)})</strong>
            )}
            . 전략을 고칠까요?
            {revisionHint.learning && (
              <span className="block text-xs text-muted-foreground mt-0.5">
                알게 된 점: {String(revisionHint.learning)}
              </span>
            )}
          </div>
          <Button size="sm" variant="outline"
            onClick={() => setReviseFrom(revisionHint.id ?? null)}>
            새 버전 작성
          </Button>
        </div>
      )}

      {/* ① 기본 정보 */}
      <section className="space-y-2.5">
        <h3 className="text-sm font-medium">기본 정보</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <F label="이름"><Input className="h-9" value={form.name ?? ''} onChange={e => set('name', e.target.value)} /></F>
          <F label="소속"><Input className="h-9" value={form.school_name ?? ''} onChange={e => set('school_name', e.target.value)} /></F>
          <F label="직함"><Input className="h-9" value={form.position ?? ''} onChange={e => set('position', e.target.value)} /></F>
          <F label="담당자"><Input className="h-9" value={form.owner ?? ''} onChange={e => set('owner', e.target.value)} /></F>
          <F label="이메일"><Input className="h-9" value={form.email ?? ''} onChange={e => set('email', e.target.value)} /></F>
          <F label="휴대폰"><Input className="h-9" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} /></F>
          <F label="국가"><CountrySelect value={form.country} onChange={v => set('country', v ?? '')} /></F>
          <F label="행사명"><Input className="h-9" value={form.event_name ?? ''} onChange={e => set('event_name', e.target.value)} /></F>
          <F label="세그먼트">
            <Pick value={form.segment} onChange={v => set('segment', v)}
              options={['A', 'B', 'C', 'D', 'E'].map(s => [s, s])} />
          </F>
          <F label="세그먼트 상세">
            {/* LEAD-S1 S1-4 — 엑셀 등급의 세부 구분(B-교육·B-기업·C2).
                가져오기가 A~E 로 줄여 저장해 구분이 사라졌다. 값은 제시카가 채운다. */}
            <Input className="h-9" value={form.segment_detail ?? ''}
              onChange={e => set('segment_detail', e.target.value)} placeholder="B-교육 · C2" />
          </F>
          <F label="가능성 (1~5)">
            <Pick value={form.probability == null ? '' : String(form.probability)}
              onChange={v => set('probability', v ? Number(v) : null)}
              options={[5, 4, 3, 2, 1].map(n => [String(n), String(n)])} />
          </F>
          <F label="리드 유형">
            {/* LEAD-S4(CRM-015) — 유형별로 다른 것은 **단계 목록과 기본 다음 행동뿐**이다. */}
            <Pick value={form.lead_type} onChange={v => set('lead_type', v)}
              options={LEAD_TYPES.map(t => [t, LEAD_TYPE_LABEL[t]])} />
          </F>
          <F label="단계">
            {/* 유형에 맞는 단계 목록을 보여 준다. 유형이 없으면 기존(고객) 목록이다. */}
            <Pick value={form.followup_stage} onChange={v => set('followup_stage', v)}
              options={stagesFor(form.lead_type).map(s => [s, s])} />
          </F>
          <F label="출처 유형">
            <Pick value={form.source_type} onChange={v => set('source_type', v)}
              options={[['exhibition', '전시회'], ['coldmail', '콜드메일'], ['partner', '파트너 소개'],
                        ['qr', 'QR'], ['other', '기타']]} />
          </F>
          <F label={<>이메일 상태<Help text={EMAIL_STATUS_HELP} /></>}>
            <Pick value={form.email_status} onChange={v => set('email_status', v)}
              options={Object.keys(EMAIL_STATUS_LABEL).map(k => [k, emailStatusLabel(k, false)])} />
          </F>
          <F label={<>이메일 신뢰도<Help text={QUALITY_HELP} /></>}>
            <div className="h-9 flex items-center text-sm">{qualityLabel(lead.email_quality)}</div>
          </F>
        </div>
        {form.lead_type && (
          <p className="text-xs text-muted-foreground">
            {LEAD_TYPE_HINT[form.lead_type as LeadType]}
            {defaultNextAction(form.lead_type) &&
              ` · 기본 다음 행동 제안: ${defaultNextAction(form.lead_type)}`}
          </p>
        )}

        {/* 유형을 바꿔 단계가 안 맞으면 **알려만** 준다 — 값을 지우거나 바꾸면 이력이 틀어진다. */}
        {isStageForeign(form.lead_type, form.followup_stage) && (
          <p className="text-xs text-amber-700">
            ⚠️ "{form.followup_stage}" 는 이 유형의 단계가 아닙니다.
            단계를 다시 고르거나 유형을 확인하세요. (값은 그대로 둡니다)
          </p>
        )}

        {isReadyForPartnerConversion({ lead_type: form.lead_type, followup_stage: form.followup_stage }) && (
          <p className="text-xs text-muted-foreground">💡 {PARTNER_CONVERSION_HINT}</p>
        )}

        {/* 보조 태그 — 한 사람이 고객이면서 연구 파트너일 수 있다(브리프 H항) */}
        <div>
          <Label className="text-xs">보조 태그</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {TAG_SUGGESTIONS.map(t => {
              const on = tags.includes(t);
              return (
                <button key={t} type="button" onClick={() => setTags(p => toggleTag(p, t))}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    on ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'}`}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <F label="메모">
          <Textarea rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
        </F>

        {emailDups.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            같은 이메일을 쓰는 다른 리드가 <strong>{emailDups.length}건</strong> 있습니다
            ({emailDups.map(d => d.name).join(', ')}). 같은 사람이면 한쪽을 보관하세요.
            <span className="block mt-0.5 text-amber-800">저장은 막지 않습니다.</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={(!dirty && !tagsDirty) || save.isPending}
            onClick={() => save.mutate()}>
            <Save className="h-4 w-4 mr-1.5" />{save.isPending ? '저장 중…' : '저장'}
          </Button>
          {changes.length > 0 && (
            <span className="text-xs text-muted-foreground">
              활동 기록에 남습니다: {changes.map(c => c.line).join(' · ')}
            </span>
          )}
        </div>
      </section>

      {/* ② 같은 기관 */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">같은 기관 사람들</h3>
        <OrgMatesPanel
          mates={mates} ccIds={ccIds} recentWarning={recent}
          onToggleCc={(mate, on) => toggleCc.mutate({ mate, on })}
          onOpenLead={onOpenLead}
        />
      </section>

      {/* ③ 접근 전략 (LEAD-S1) — 흐름의 중심이라 기록 입력 바로 위에 둔다 */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">접근 전략</h3>
        <StrategyPanel leadId={lead.id} actor={actor}
          reviseFrom={reviseFrom}
          onRevised={() => setReviseFrom(null)} />
      </section>

      {/* ④ 아웃리치 (LEAD-S2) — 전략으로 쓰고 바로 초안을 만든다 */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">아웃리치</h3>
        {/* 같은 기관에 최근 접촉이 있으면 위에서 이미 경고하고 있다(UI2 R6 재사용) */}
        {recent && (
          <p className="text-xs text-amber-700">
            ⚠️ 이 기관에는 {recent.daysAgo}일 전 {recent.name}님에게 연락했습니다 —
            중복으로 보내지 않도록 확인하세요.
          </p>
        )}
        <OutreachPanel lead={lead} actor={actor} allLeads={allLeads} />
      </section>

      {/* ⑤ 빠른 기록 */}
      <section className="space-y-2.5">
        <h3 className="text-sm font-medium">빠른 기록</h3>
        <div className="flex flex-wrap gap-2">
          <div className="w-[110px]">
            <Label className="text-xs">채널</Label>
            <Pick value={log.channel} onChange={v => setLog(p => ({ ...p, channel: v as Channel }))}
              options={CHANNELS.map(c => [c, CHANNEL_LABEL[c]])} allowEmpty={false} />
          </div>
          <div className="w-[100px]">
            <Label className="text-xs">방향</Label>
            <Pick value={log.direction} onChange={v => setLog(p => ({ ...p, direction: v as 'out' | 'in' }))}
              options={[['out', '보냄'], ['in', '받음']]} allowEmpty={false} />
          </div>
          <div className="w-[130px]">
            <Label className="text-xs">단계</Label>
            {/* LEAD-S4: 기본 정보와 **같은 목록**을 쓴다. 한쪽만 유형을 따르면
                빠른 기록에서 그 유형에 없는 단계를 고를 수 있어 어긋난다. */}
            <Pick value={log.stageAfter} onChange={v => setLog(p => ({ ...p, stageAfter: v }))}
              options={stagesFor(lead.lead_type).map(s => [s, s])} allowEmpty={false} />
          </div>
        </div>
        <F label="무엇을 했나 (한 줄)">
          <Input className="h-9" value={log.summary}
            onChange={e => setLog(p => ({ ...p, summary: e.target.value }))}
            placeholder="예: 소개 메일 보냄 / 데모 일정 회신 받음" />
        </F>
        {needReason && (
          <F label="종료 사유 (필수)">
            <Input className="h-9" value={log.closeReason}
              onChange={e => setLog(p => ({ ...p, closeReason: e.target.value }))}
              placeholder="예: 예산 없음 / 타사 선택 / 응답 없음" />
          </F>
        )}
        {/* LEAD-S1 — 접촉의 결과와 알게 된 점. 다음 전략 판의 근거가 된다.
            LEAD-S4(a): **받은 기록(답장)에서도** 적을 수 있다 — "답장 받음" 이라는 결과를
            자연스럽게 남기려면 받은 기록에 적는 것이 맞다. 차수(attempt_no)는
            보낸 기록만 세는 규칙을 그대로 둔다(받은 것은 우리가 시도한 횟수가 아니다). */}
        {(
          <div className="flex gap-2">
            <div className="w-[150px]">
              <Label className="text-xs">결과</Label>
              <Pick value={log.outcome} onChange={v => setLog(p => ({ ...p, outcome: v }))}
                options={OUTCOMES.map(o => [o, OUTCOME_LABEL[o]])} />
            </div>
            <div className="flex-1">
              <Label className="text-xs">알게 된 점</Label>
              <Input className="h-9" value={log.learning}
                onChange={e => setLog(p => ({ ...p, learning: e.target.value }))}
                placeholder="예: 예산은 내년 3월 확정, 결정권자는 학과장" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-[2]">
            <Label className="text-xs">다음 행동</Label>
            <Input className="h-9" value={log.nextAction}
              onChange={e => setLog(p => ({ ...p, nextAction: e.target.value }))} />
          </div>
          <div className="w-[150px]">
            <Label className="text-xs">기한</Label>
            <Input type="date" className="h-9" value={log.nextDue}
              onChange={e => setLog(p => ({ ...p, nextDue: e.target.value }))} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={logBlocked || saveLog.isPending} onClick={() => saveLog.mutate()}>
            {saveLog.isPending ? '저장 중…' : '기록'}
          </Button>
          {log.direction === 'out'
            ? (
              <span className="text-xs text-muted-foreground">
                {nextAttemptNo(acts ?? [])}차 접촉으로 기록됩니다
                {curStrategy && ` · 전략 v${curStrategy.version}`}
              </span>
            )
            : (
              <span className="text-xs text-muted-foreground">
                받은 기록은 접촉 차수에 세지 않습니다
              </span>
            )}
        </div>
      </section>

      {/* ⑥ 접촉 타임라인 */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          활동 기록 {acts ? `(${acts.length})` : ''}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">지워지지 않습니다</span>
        </h3>
        {!acts || acts.length === 0
          ? <p className="text-xs text-muted-foreground">아직 기록이 없습니다.</p>
          : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {acts.map(a => {
                const isChange = isChangeRecord(a.summary);
                // LEAD-S1 — 차수는 **시간순으로 다시 센 값**을 쓴다(저장된 번호에 구멍이 생길 수 있다).
                const attempt = attemptMap.get(a.id);
                const stratV = a.strategy_id ? strategyVersionById.get(a.strategy_id) : undefined;
                return (
                  <li key={a.id}
                    className={`text-xs ${a.voided_at ? 'opacity-50' : ''}`}>
                    <div className={`flex gap-2 ${a.voided_at ? 'line-through' : ''}`}>
                      <span className="text-muted-foreground w-[76px] shrink-0 tabular-nums">
                        {kstDate(a.occurred_at)}
                      </span>
                      <span className="w-14 shrink-0 text-muted-foreground">
                        {isChange ? '변경' : `${CHANNEL_LABEL[a.channel as Channel] ?? a.channel}${a.direction === 'in' ? ' ←' : ' →'}`}
                      </span>
                      <span className={`flex-1 ${isChange ? 'text-muted-foreground' : ''}`}>{a.summary}</span>
                      {attempt && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] shrink-0">
                          {attempt}차
                        </Badge>
                      )}
                      {a.stage_after && <span className="text-muted-foreground shrink-0">{a.stage_after}</span>}
                      {a.actor && <span className="text-muted-foreground shrink-0">{a.actor}</span>}
                    </div>
                    {(a.outcome || a.learning || stratV) && (
                      <div className="ml-[92px] mt-0.5 flex flex-wrap gap-x-2 text-muted-foreground">
                        {a.outcome && (
                          <span>결과: {OUTCOME_LABEL[a.outcome as Outcome] ?? a.outcome}</span>
                        )}
                        {stratV && <span>전략 v{stratV}</span>}
                        {a.learning && <span>알게 된 점: {a.learning}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </section>

      {/* ⑦ 현장 기록 · 관심 신호 (LEAD-S1) */}
      <details className="rounded-lg border px-3 py-2" open={(signalCount ?? 0) > 0}>
        <summary className="cursor-pointer text-sm font-medium">
          현장 기록 · 관심 신호
          {signalCount !== null && (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{signalCount}</Badge>
          )}
        </summary>
        <div className="mt-3">
          <SignalsPanel leadId={lead.id} actor={actor} />
        </div>
      </details>

      {/* ⑧ 조사 메모 (LEAD-S1) */}
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">조사 메모</summary>
        <div className="mt-3">
          <ResearchPanel leadId={lead.id} actor={actor} />
        </div>
      </details>
    </div>
  );
}

function F({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}

function Pick({ value, onChange, options, allowEmpty = true }: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  allowEmpty?: boolean;
}) {
  return (
    <Select value={value || (allowEmpty ? NONE : '')} onValueChange={v => onChange(v === NONE ? '' : v)}>
      <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={NONE}>—</SelectItem>}
        {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
