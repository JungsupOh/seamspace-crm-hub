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
  getActivities, getActivitiesForLeads, getCcLinks, saveActivity, saveLeadEdit, setArchived,
  setCcLink, type Actor, type LeadRow,
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
import { CountrySelect } from './CountrySelect';
import { OrgMatesPanel } from './OrgMatesPanel';

const NONE = '__none__';

/** 다음 단위(LEAD-S)에서 채울 자리 — 지금은 안내 문구만. */
const COMING = [
  { title: '현장 기록 · 관심 신호', desc: '부스에서 들은 관심사(보드게임·가격·LMS 연동·특수교육 등) 태그와 자유 메모' },
  { title: '조사 메모', desc: '기관을 찾아본 내용과 근거 링크' },
  { title: '접근 전략 버전', desc: '전략 1판·2판… 덮어쓰지 않고 쌓는다. 근거·목표·접근 각도·쓸 수 있는 사실·하지 않을 말' },
];

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
      segment: lead.segment ?? '', probability: lead.probability ?? null,
      event_name: lead.event_name ?? '', owner: lead.owner ?? '',
      source_type: lead.source_type ?? '', notes: lead.notes ?? '',
      email_status: lead.email_status ?? '', followup_stage: lead.followup_stage ?? '',
    });
  }, [lead.id, lead.name, lead.school_name, lead.position, lead.email, lead.phone, lead.country,
      lead.segment, lead.probability, lead.event_name, lead.owner, lead.source_type,
      lead.notes, lead.email_status, lead.followup_stage]);

  const set = (k: keyof EditableLead, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const before: EditableLead = useMemo(() => ({
    name: lead.name ?? '', school_name: lead.school_name ?? '', position: lead.position ?? '',
    email: lead.email ?? '', phone: lead.phone ?? '', country: lead.country ?? '',
    segment: lead.segment ?? '', probability: lead.probability ?? null,
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

  const save = useMutation({
    mutationFn: () => saveLeadEdit(lead.id, before, form, actor),
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
  });
  useEffect(() => {
    setLog({
      channel: 'email', direction: 'out', summary: '',
      stageAfter: lead.followup_stage || '신규',
      nextAction: lead.next_action ?? '',
      nextDue: lead.next_action_due ?? suggestFirstContactDue(lead.probability),
      closeReason: lead.close_reason ?? '',
    });
  }, [lead.id, lead.followup_stage, lead.next_action, lead.next_action_due, lead.close_reason, lead.probability]);

  const { data: acts } = useQuery({
    queryKey: ['lead_activities', lead.id],
    queryFn: () => getActivities(lead.id),
  });

  const saveLog = useMutation({
    mutationFn: () => saveActivity({
      leadId: lead.id, channel: log.channel, direction: log.direction, summary: log.summary,
      stageAfter: log.stageAfter as FollowupStage,
      nextAction: log.nextAction, nextActionDue: log.nextDue, closeReason: log.closeReason,
      actor: actor.name ?? undefined, actorUserId: actor.userId ?? null,
    }),
    onSuccess: () => {
      toast.success('기록했습니다');
      setLog(p => ({ ...p, summary: '' }));
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
          <F label="가능성 (1~5)">
            <Pick value={form.probability == null ? '' : String(form.probability)}
              onChange={v => set('probability', v ? Number(v) : null)}
              options={[5, 4, 3, 2, 1].map(n => [String(n), String(n)])} />
          </F>
          <F label="단계">
            <Pick value={form.followup_stage} onChange={v => set('followup_stage', v)}
              options={FOLLOWUP_STAGES.map(s => [s, s])} />
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
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
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

      {/* ③ 빠른 기록 */}
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
            <Pick value={log.stageAfter} onChange={v => setLog(p => ({ ...p, stageAfter: v }))}
              options={FOLLOWUP_STAGES.map(s => [s, s])} allowEmpty={false} />
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
        <Button size="sm" disabled={logBlocked || saveLog.isPending} onClick={() => saveLog.mutate()}>
          {saveLog.isPending ? '저장 중…' : '기록'}
        </Button>
      </section>

      {/* ④ 타임라인 */}
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
                return (
                  <li key={a.id}
                    className={`text-xs flex gap-2 ${a.voided_at ? 'opacity-50 line-through' : ''}`}>
                    <span className="text-muted-foreground w-[76px] shrink-0 tabular-nums">
                      {kstDate(a.occurred_at)}
                    </span>
                    <span className="w-14 shrink-0 text-muted-foreground">
                      {isChange ? '변경' : `${CHANNEL_LABEL[a.channel as Channel] ?? a.channel}${a.direction === 'in' ? ' ←' : ' →'}`}
                    </span>
                    <span className={`flex-1 ${isChange ? 'text-muted-foreground' : ''}`}>{a.summary}</span>
                    {a.stage_after && <span className="text-muted-foreground shrink-0">{a.stage_after}</span>}
                    {a.actor && <span className="text-muted-foreground shrink-0">{a.actor}</span>}
                  </li>
                );
              })}
            </ul>
          )}
      </section>

      {/* ⑤ 다음 단위 자리 */}
      <section className="space-y-1.5">
        {COMING.map(c => (
          <details key={c.title} className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              {c.title} <span className="text-xs">— 준비 중</span>
            </summary>
            <p className="mt-1.5 text-xs text-muted-foreground">{c.desc}</p>
            <p className="mt-1 text-xs text-muted-foreground">다음 단위에서 채웁니다.</p>
          </details>
        ))}
      </section>
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
