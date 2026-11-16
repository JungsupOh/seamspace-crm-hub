// 리드 관리 — LEAD-3·4·5·6 (CRM-012·013·008·014)
//
// 왜 새 화면인가
//   James 최우선은 "팔로업이 끊기지 않게 하는 것"이다(브리프 G항). 그 화면 두 개
//   (오늘 할 팔로업 / 7일 넘게 접촉 없음)는 **캠페인 하나**가 아니라 **리드 전체**를 본다.
//   기존 /campaigns 의 리드 탭은 캠페인별이고 2,700줄짜리 파일 안에 있어서,
//   거기에 넣으면 국내 운영 화면을 건드릴 위험이 커진다. 그래서 별도 화면으로 뒀다
//   (CRM-012 가 허용한 "별도 목록, 가장 적은 변경").
//
// ⚠️ 보안: DB 호출은 전부 `leadsApi.ts` 를 거치고, 그쪽은 authedFetch(로그인 토큰)만 쓴다.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { AlertCircle, CalendarClock, Clock, Flag, Plus, Upload } from 'lucide-react';

import {
  deleteImportBatch, getActivities, getCampaignNames, getLeads, insertLeads, patchLead,
  saveActivity, buildLeadRow, type LeadRow,
} from '@/lib/leadsApi';
import { MARKET_LABEL, toMarket } from '@/lib/leadMarket';
import { REGION_LABEL, regionCounts, regionOf, type Region } from '@/lib/leadRegion';
import {
  CHANNELS, CHANNEL_LABEL, FOLLOWUP_STAGES, FUNNEL_STAGES, dueState, dueToday,
  needsCloseReason, overdueDays, stageCounts, staleDays, staleLeads, suggestFirstContactDue,
  todayKst, type Channel, type FollowupStage,
} from '@/lib/leadFollowup';
import {
  EVENT_TIMEZONES, markExistingDuplicates, parseIntlLeadExcel,
  type IntlImportResult, type IntlLeadRow,
} from '@/lib/intlLeadImport';

const ALL = '__all__';

export default function Leads() {
  const qc = useQueryClient();
  const today = todayKst();

  const { data: leads, isLoading } = useQuery({
    queryKey: ['leads_all'],
    queryFn: getLeads,
    staleTime: 1000 * 60 * 2,
  });
  const { data: campaigns } = useQuery({ queryKey: ['campaign_names'], queryFn: getCampaignNames });
  const campaignName = useMemo(() => {
    const m = new Map<string, string>();
    (campaigns ?? []).forEach(c => m.set(c.id, c.name));
    return m;
  }, [campaigns]);

  // ── 필터 ──
  const [fMarket, setFMarket] = useState<string>(ALL);
  const [fRegion, setFRegion] = useState<string>(ALL);
  const [fEvent, setFEvent] = useState<string>(ALL);
  const [fCountry, setFCountry] = useState<string>(ALL);
  const [fOwner, setFOwner] = useState<string>(ALL);
  const [fStage, setFStage] = useState<string>(ALL);
  const [q, setQ] = useState('');

  const eventNames = useMemo(
    () => [...new Set((leads ?? []).map(l => l.event_name).filter(Boolean) as string[])].sort(),
    [leads]);
  const countries = useMemo(
    () => [...new Set((leads ?? []).map(l => l.country).filter(Boolean) as string[])].sort(),
    [leads]);
  const owners = useMemo(
    () => [...new Set((leads ?? []).map(l => l.owner).filter(Boolean) as string[])].sort(),
    [leads]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (leads ?? []).filter(l => {
      if (fMarket !== ALL && toMarket(l.market) !== fMarket) return false;
      if (fRegion !== ALL && regionOf(l) !== fRegion) return false;
      if (fEvent !== ALL && (l.event_name ?? '') !== fEvent) return false;
      if (fCountry !== ALL && (l.country ?? '') !== fCountry) return false;
      if (fOwner !== ALL && (l.owner ?? '') !== fOwner) return false;
      if (fStage !== ALL && (l.followup_stage || '신규') !== fStage) return false;
      if (needle) {
        const hay = [l.name, l.school_name, l.email, l.event_name, l.country, l.notes]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [leads, fMarket, fRegion, fEvent, fCountry, fOwner, fStage, q]);

  const due = useMemo(() => dueToday(filtered, today), [filtered, today]);
  const stale = useMemo(() => staleLeads(filtered, 7, today), [filtered, today]);
  const funnel = useMemo(() => stageCounts(filtered), [filtered]);
  const regions = useMemo(() => regionCounts(filtered), [filtered]);

  // 가능성순 정렬(1순위 가능성 내림, 2순위 최근 등록)
  const byProbability = useMemo(
    () => [...filtered].sort((a, b) =>
      (b.probability ?? 0) - (a.probability ?? 0) ||
      String(b.created_at).localeCompare(String(a.created_at))),
    [filtered]);

  const [activityFor, setActivityFor] = useState<LeadRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const resetFilters = () => {
    setFMarket(ALL); setFRegion(ALL); setFEvent(ALL);
    setFCountry(ALL); setFOwner(ALL); setFStage(ALL); setQ('');
  };

  if (isLoading) return <div className="p-6"><DataTableSkeleton /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">리드 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {leads?.length ?? 0}건 · 필터 결과 {filtered.length}건
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1.5" />해외 명단 가져오기
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />리드 추가
          </Button>
        </div>
      </div>

      {/* 지역별 건수 요약 — CRM-008 */}
      <div className="flex flex-wrap gap-2">
        {regions.map(r => (
          <button key={r.region} type="button"
            onClick={() => setFRegion(fRegion === r.region ? ALL : r.region)}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              fRegion === r.region ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
            <div className="text-xs text-muted-foreground">{r.label}</div>
            <div className="text-lg font-semibold leading-tight">{r.count}</div>
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[150px]">
          <Label className="text-xs">검색</Label>
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·소속·메일" className="h-9" />
        </div>
        <FilterSelect label="시장" value={fMarket} onChange={setFMarket}
          options={[['KR', MARKET_LABEL.KR], ['INTL', MARKET_LABEL.INTL]]} />
        <FilterSelect label="행사" value={fEvent} onChange={setFEvent}
          options={eventNames.map(e => [e, e])} />
        <FilterSelect label="국가" value={fCountry} onChange={setFCountry}
          options={countries.map(c => [c, c])} />
        <FilterSelect label="담당자" value={fOwner} onChange={setFOwner}
          options={owners.map(o => [o, o])} />
        <FilterSelect label="단계" value={fStage} onChange={setFStage}
          options={FOLLOWUP_STAGES.map(s => [s, s])} />
        <Button variant="ghost" size="sm" onClick={resetFilters}>초기화</Button>
      </div>

      <Tabs defaultValue="due">
        <TabsList>
          <TabsTrigger value="due">
            <CalendarClock className="h-4 w-4 mr-1.5" />오늘 할 팔로업
            {due.length > 0 && <Badge variant="secondary" className="ml-1.5">{due.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="stale">
            <Clock className="h-4 w-4 mr-1.5" />7일 넘게 접촉 없음
            {stale.length > 0 && <Badge variant="secondary" className="ml-1.5">{stale.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="all">
            <Flag className="h-4 w-4 mr-1.5" />전체 (가능성순)
          </TabsTrigger>
          <TabsTrigger value="funnel">단계별</TabsTrigger>
        </TabsList>

        <TabsContent value="due" className="mt-4">
          {due.length === 0
            ? <Empty text="오늘 할 팔로업이 없습니다." />
            : <LeadTable rows={due} today={today} campaignName={campaignName}
                onLog={setActivityFor} showDue />}
        </TabsContent>

        <TabsContent value="stale" className="mt-4">
          <p className="text-sm text-muted-foreground mb-3">
            마지막 접촉(없으면 등록일)에서 7일이 지난 리드입니다. 한 번도 연락하지 않은 리드가 여기에 보입니다.
          </p>
          {stale.length === 0
            ? <Empty text="7일 넘게 접촉 없는 리드가 없습니다." />
            : <LeadTable rows={stale} today={today} campaignName={campaignName}
                onLog={setActivityFor} showStale />}
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          {byProbability.length === 0
            ? <Empty text="리드가 없습니다." />
            : <LeadTable rows={byProbability} today={today} campaignName={campaignName}
                onLog={setActivityFor} showDue showStale />}
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <div className="space-y-1.5 max-w-xl">
            {funnel.map(f => {
              const max = Math.max(...funnel.map(x => x.count), 1);
              const isResult = !FUNNEL_STAGES.includes(f.stage);
              return (
                <button key={f.stage} type="button"
                  onClick={() => setFStage(fStage === f.stage ? ALL : f.stage)}
                  className="w-full flex items-center gap-3 text-left group">
                  <span className={`w-24 shrink-0 text-sm ${isResult ? 'text-muted-foreground' : ''}`}>
                    {f.stage}
                  </span>
                  <span className="flex-1 h-6 bg-muted rounded overflow-hidden">
                    <span className={`block h-full ${isResult ? 'bg-muted-foreground/30' : 'bg-primary/60'}
                      group-hover:opacity-80`} style={{ width: `${(f.count / max) * 100}%` }} />
                  </span>
                  <span className="w-12 text-right text-sm tabular-nums">{f.count}</span>
                </button>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {activityFor && (
        <ActivityDialog lead={activityFor} onClose={() => setActivityFor(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['leads_all'] }); setActivityFor(null); }} />
      )}
      {newOpen && (
        <NewLeadDialog onClose={() => setNewOpen(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['leads_all'] }); setNewOpen(false); }} />
      )}
      {importOpen && (
        <ImportDialog existing={leads ?? []} onClose={() => setImportOpen(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['leads_all'] }); setImportOpen(false); }} />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="w-[140px]">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>전체</SelectItem>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─────────────────────────── 목록 ───────────────────────────

function LeadTable({ rows, today, campaignName, onLog, showDue, showStale }: {
  rows: LeadRow[]; today: string; campaignName: Map<string, string>;
  onLog: (l: LeadRow) => void; showDue?: boolean; showStale?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">이름 · 소속</th>
            <th className="px-3 py-2 text-left font-medium">지역 · 국가</th>
            <th className="px-3 py-2 text-left font-medium">행사</th>
            <th className="px-3 py-2 text-center font-medium">세그</th>
            <th className="px-3 py-2 text-center font-medium">가능성</th>
            <th className="px-3 py-2 text-left font-medium">단계</th>
            <th className="px-3 py-2 text-left font-medium">다음 행동</th>
            {showDue && <th className="px-3 py-2 text-left font-medium">기한</th>}
            {showStale && <th className="px-3 py-2 text-right font-medium">무접촉</th>}
            <th className="px-3 py-2 text-left font-medium">담당</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(l => {
            const ds = dueState(l, today);
            const od = overdueDays(l, today);
            const sd = staleDays(l, today);
            return (
              <tr key={l.id} className={ds === 'overdue' ? 'bg-destructive/5' : ''}>
                <td className="px-3 py-2">
                  <div className="font-medium flex items-center gap-1.5">
                    {l.name}
                    {toMarket(l.market) === 'INTL' && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">해외</Badge>
                    )}
                    {l.email_status === 'hold' && (
                      <Badge variant="destructive" className="h-4 px-1 text-[10px]">발송보류</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{l.school_name ?? '—'}</div>
                </td>
                <td className="px-3 py-2">
                  <div>{REGION_LABEL[regionOf(l) as Region]}</div>
                  <div className="text-xs text-muted-foreground">{l.country ?? '—'}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {l.event_name ?? (l.campaign_id ? campaignName.get(l.campaign_id) ?? '—' : '—')}
                </td>
                <td className="px-3 py-2 text-center">{l.segment ?? '—'}</td>
                <td className="px-3 py-2 text-center tabular-nums">{l.probability ?? '—'}</td>
                <td className="px-3 py-2">{l.followup_stage || '신규'}</td>
                <td className="px-3 py-2 text-xs max-w-[220px] truncate" title={l.next_action ?? ''}>
                  {l.next_action ?? '—'}
                </td>
                {showDue && (
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {l.next_action_due
                      ? <span className={ds === 'overdue' ? 'text-destructive font-semibold' : ''}>
                          {l.next_action_due}
                          {ds === 'overdue' && (
                            <span className="ml-1 inline-flex items-center gap-0.5">
                              <AlertCircle className="h-3 w-3" />{od}일 지남
                            </span>
                          )}
                          {ds === 'today' && <span className="ml-1">오늘</span>}
                        </span>
                      : '—'}
                  </td>
                )}
                {showStale && (
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {sd === null ? '—' : `${sd}일`}
                  </td>
                )}
                <td className="px-3 py-2 text-xs">{l.owner ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => onLog(l)}>기록</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────── 활동 기록 입력(빠르게) ───────────────────

function ActivityDialog({ lead, onClose, onSaved }: {
  lead: LeadRow; onClose: () => void; onSaved: () => void;
}) {
  const [channel, setChannel] = useState<Channel>('email');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [summary, setSummary] = useState('');
  const [stageAfter, setStageAfter] = useState<string>(lead.followup_stage || '신규');
  const [nextAction, setNextAction] = useState(lead.next_action ?? '');
  const [nextDue, setNextDue] = useState(lead.next_action_due ?? suggestFirstContactDue(lead.probability));
  const [closeReason, setCloseReason] = useState(lead.close_reason ?? '');

  const { data: acts } = useQuery({
    queryKey: ['lead_activities', lead.id],
    queryFn: () => getActivities(lead.id),
  });

  const save = useMutation({
    mutationFn: () => saveActivity({
      leadId: lead.id, channel, direction, summary,
      stageAfter: stageAfter as FollowupStage,
      nextAction, nextActionDue: nextDue, closeReason,
    }),
    onSuccess: () => { toast.success('기록했습니다'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const needReason = needsCloseReason(stageAfter);
  const blocked = !summary.trim() || (needReason && !closeReason.trim());

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {lead.name}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{lead.school_name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">채널</Label>
              <Select value={channel} onValueChange={v => setChannel(v as Channel)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map(c => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-xs">방향</Label>
              <Select value={direction} onValueChange={v => setDirection(v as 'out' | 'in')}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="out">보냄</SelectItem>
                  <SelectItem value="in">받음</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-xs">단계</Label>
              <Select value={stageAfter} onValueChange={setStageAfter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FOLLOWUP_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">무엇을 했나 (한 줄)</Label>
            <Input value={summary} onChange={e => setSummary(e.target.value)} className="h-9"
              placeholder="예: 소개 메일 보냄 / 데모 일정 회신 받음" autoFocus />
          </div>

          {needReason && (
            <div>
              <Label className="text-xs">종료 사유 (필수)</Label>
              <Input value={closeReason} onChange={e => setCloseReason(e.target.value)} className="h-9"
                placeholder="예: 예산 없음 / 타사 선택 / 응답 없음" />
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex-[2]">
              <Label className="text-xs">다음 행동</Label>
              <Input value={nextAction} onChange={e => setNextAction(e.target.value)} className="h-9"
                placeholder="예: 2차 메일 / 데모 일정 잡기" />
            </div>
            <div className="w-[150px]">
              <Label className="text-xs">기한</Label>
              <Input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>닫기</Button>
            <Button disabled={blocked || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? '저장 중…' : '기록'}
            </Button>
          </div>

          <div className="pt-3 border-t">
            <div className="text-xs font-medium mb-2">
              활동 기록 {acts ? `(${acts.length})` : ''}
              <span className="ml-1.5 font-normal text-muted-foreground">지워지지 않습니다</span>
            </div>
            {!acts || acts.length === 0
              ? <p className="text-xs text-muted-foreground">아직 기록이 없습니다.</p>
              : (
                <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                  {acts.map(a => (
                    <li key={a.id} className={`text-xs flex gap-2 ${a.voided_at ? 'opacity-50 line-through' : ''}`}>
                      <span className="text-muted-foreground w-[88px] shrink-0 tabular-nums">
                        {a.occurred_at.slice(0, 10)}
                      </span>
                      <span className="w-14 shrink-0">
                        {CHANNEL_LABEL[a.channel as Channel] ?? a.channel}
                        {a.direction === 'in' ? ' ←' : ' →'}
                      </span>
                      <span className="flex-1">{a.summary}</span>
                      {a.stage_after && <span className="text-muted-foreground">{a.stage_after}</span>}
                      {a.actor && <span className="text-muted-foreground">{a.actor}</span>}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────── 리드 추가 ───────────────────────

function NewLeadDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [market, setMarket] = useState<'KR' | 'INTL'>('INTL');
  const [f, setF] = useState({
    name: '', email: '', phone: '', school_name: '', country: '',
    event_name: '', segment: '', probability: '', owner: '', notes: '',
  });
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const row = buildLeadRow({
        market, name: f.name, email: f.email, phone: f.phone,
        school_name: f.school_name, country: f.country, event_name: f.event_name,
        segment: f.segment || undefined,
        probability: f.probability ? Number(f.probability) : undefined,
        owner: f.owner, notes: f.notes, source_type: 'other',
      });
      await insertLeads([row]);
    },
    onSuccess: () => { toast.success('리드를 추가했습니다'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // 열쇠 검사는 leadMarket.leadKey 와 같은 규칙이다(여기서는 버튼만 막는다).
  const keyOk = market === 'KR'
    ? f.phone.replace(/\D/g, '').length >= 9
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim().toLowerCase());

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">리드 추가</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">시장</Label>
            <Select value={market} onValueChange={v => setMarket(v as 'KR' | 'INTL')}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="KR">{MARKET_LABEL.KR} — 휴대폰이 열쇠</SelectItem>
                <SelectItem value="INTL">{MARKET_LABEL.INTL} — 이메일이 열쇠</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="이름" value={f.name} onChange={v => set('name', v)} />
            <Field label="소속" value={f.school_name} onChange={v => set('school_name', v)} />
            <Field label={market === 'INTL' ? '이메일 (필수)' : '이메일'}
              value={f.email} onChange={v => set('email', v)} />
            <Field label={market === 'KR' ? '휴대폰 (필수)' : '휴대폰'}
              value={f.phone} onChange={v => set('phone', v)} />
            <Field label="국가" value={f.country} onChange={v => set('country', v)}
              placeholder="SG · Singapore · 싱가포르" />
            <Field label="행사명" value={f.event_name} onChange={v => set('event_name', v)} />
            <div>
              <Label className="text-xs">세그먼트</Label>
              <Select value={f.segment || ALL} onValueChange={v => set('segment', v === ALL ? '' : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>—</SelectItem>
                  {['A', 'B', 'C', 'D', 'E'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">가능성 (1~5)</Label>
              <Select value={f.probability || ALL} onValueChange={v => set('probability', v === ALL ? '' : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>—</SelectItem>
                  {[5, 4, 3, 2, 1].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Field label="담당자" value={f.owner} onChange={v => set('owner', v)} />
          </div>
          <div>
            <Label className="text-xs">메모</Label>
            <Textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={2} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button disabled={!f.name.trim() || !keyOk || save.isPending} onClick={() => save.mutate()}>
              추가
            </Button>
          </div>
          {!keyOk && (
            <p className="text-xs text-muted-foreground">
              {market === 'KR' ? '국내 리드는 휴대폰이 필요합니다.' : '해외 리드는 이메일이 필요합니다.'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} className="h-9" placeholder={placeholder} />
    </div>
  );
}

// ─────────────────── 해외 명단 가져오기 ───────────────────

function ImportDialog({ existing, onClose, onSaved }: {
  existing: LeadRow[]; onClose: () => void; onSaved: () => void;
}) {
  const [parsed, setParsed] = useState<(IntlImportResult & { sheetNames: string[] }) | null>(null);
  const [eventName, setEventName] = useState('');
  const [tz, setTz] = useState('480');
  const [sheet, setSheet] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reparse = async (f: File, sheetName?: string) => {
    try {
      const r = await parseIntlLeadExcel(f, {
        eventName, tzOffsetMinutes: Number(tz), sheetName, sourceType: 'exhibition',
      });
      setParsed(r);
      if (!sheetName && r.sheetNames.length > 0) setSheet(r.sheetNames[0]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const split = useMemo(
    () => parsed ? markExistingDuplicates(parsed.rows, existing.map(e => e.email_normalized)) : null,
    [parsed, existing]);

  const doImport = async () => {
    if (!split || split.fresh.length === 0) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const rows = split.fresh.map((r: IntlLeadRow) => ({
        ...buildLeadRow({
          market: 'INTL', name: r.name, email: r.email ?? undefined, phone: r.phone ?? undefined,
          school_name: r.school_name ?? undefined, country: r.country ?? undefined,
          event_name: r.event_name ?? eventName, segment: r.segment ?? undefined,
          source_type: r.source_type, notes: r.notes ?? undefined,
          email_quality: r.email_quality, email_status: r.email_status,
          import_batch_id: id,
        }),
        position: r.position,
        custom_fields: r.custom_fields,
        created_at: r.visited_at ?? undefined,
      }));
      await insertLeads(rows);
      setBatchId(id);
      toast.success(`${rows.length}건 가져왔습니다`);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!batchId) return;
    setBusy(true);
    try {
      await deleteImportBatch(batchId);
      toast.success('가져오기를 취소했습니다');
      setBatchId(null);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const REASON_LABEL: Record<string, string> = {
    noEmail: '이메일 없음', badEmail: '이메일 형식 오류',
    dupInFile: '파일 내 이메일 중복', excludedGrade: "등급이 '제외'",
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">해외 명단 가져오기</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            이메일을 열쇠로 가져옵니다(국내 휴대폰 기준과 섞이지 않습니다).
            수신 동의는 <strong>동의 없음</strong>으로 저장되고, 발송 보류·신뢰도 낮음은 표시됩니다.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[180px]">
              <Label className="text-xs">행사명</Label>
              <Input value={eventName} onChange={e => setEventName(e.target.value)} className="h-9"
                placeholder="2026 EDUtech Asia" />
            </div>
            <div className="w-[180px]">
              <Label className="text-xs">행사 시간대</Label>
              <Select value={tz} onValueChange={v => { setTz(v); if (file) reparse(file, sheet); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TIMEZONES.map(t => (
                    <SelectItem key={t.minutes} value={String(t.minutes)}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {parsed && parsed.sheetNames.length > 1 && (
              <div className="w-[180px]">
                <Label className="text-xs">시트</Label>
                <Select value={sheet} onValueChange={v => { setSheet(v); if (file) reparse(file, v); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {parsed.sheetNames.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">엑셀 파일</Label>
            <Input type="file" accept=".xlsx,.xls,.csv" className="h-9"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { setFile(f); setBatchId(null); reparse(f); }
              }} />
          </div>

          {parsed && split && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                <Stat label="전체 행" value={parsed.total} />
                <Stat label="가져올 건수" value={split.fresh.length} accent />
                <Stat label="이미 등록" value={split.dupInDb.length} />
                <Stat label="제외" value={parsed.excluded.length} />
              </div>

              {(parsed.holdCount > 0 || parsed.lowQualityCount > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  발송 보류 <strong>{parsed.holdCount}</strong>건 ·
                  이메일 신뢰도 낮음(2 이하) <strong>{parsed.lowQualityCount}</strong>건 —
                  가져오되 <strong>표시</strong>만 합니다. 메일을 보낼 때 제외하세요.
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">열 매핑 보기</summary>
                <table className="mt-2 w-full">
                  <tbody className="divide-y">
                    {Object.entries(parsed.headerMap).map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-1 w-24 text-muted-foreground">{k}</td>
                        <td className="py-1">{v ?? <span className="text-muted-foreground">(없음)</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.unmapped.length > 0 && (
                  <p className="mt-1.5 text-muted-foreground">
                    맞추지 못한 열(원본으로 보관): {parsed.unmapped.join(' · ')}
                  </p>
                )}
              </details>

              {parsed.excluded.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    제외된 {parsed.excluded.length}건 보기
                  </summary>
                  <ul className="mt-2 space-y-0.5">
                    {parsed.excluded.map(e => (
                      <li key={e.rowNo} className="flex gap-2">
                        <span className="w-12 text-muted-foreground tabular-nums">{e.rowNo}행</span>
                        <span className="w-32">{REASON_LABEL[e.reason] ?? e.reason}</span>
                        <span className="text-muted-foreground">{e.org}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                {batchId
                  ? (
                    <>
                      <span className="text-xs text-muted-foreground mr-auto">가져왔습니다.</span>
                      <Button variant="outline" disabled={busy} onClick={undo}>가져오기 취소</Button>
                      <Button onClick={onClose}>닫기</Button>
                    </>
                  )
                  : (
                    <>
                      <Button variant="outline" onClick={onClose}>취소</Button>
                      <Button disabled={busy || split.fresh.length === 0} onClick={doImport}>
                        {busy ? '가져오는 중…' : `${split.fresh.length}건 가져오기`}
                      </Button>
                    </>
                  )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-2 ${accent ? 'border-primary bg-primary/5' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
