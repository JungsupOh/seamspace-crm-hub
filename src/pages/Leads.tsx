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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, ArrowLeft, CalendarClock, Clock, Flag, Plus, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { LeadDetail } from '@/components/leads/LeadDetail';
import { countryLabel, countryShort } from '@/lib/countries';
import { emailStatusLabel, excludeArchived, isMailable } from '@/lib/leadEdit';
import { getStrategyHeads } from '@/lib/leadsApi';
import { currentStrategy } from '@/lib/leadStrategy';
import { LEAD_TYPES, LEAD_TYPE_LABEL, leadTypeLabel, toLeadType } from '@/lib/leadType';
// LEAD-S7-7b: 파트너가 넣은 리드 구분·보호 기간 (계산은 서버와 같은 규칙)
import { contactOwnerLabel, isPartnerLead, partnerLeadTone, protectionLabel }
  from '@/lib/leadPartner';

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

  /**
   * LEAD-S1 — 목록에 "현재 전략 vN"과 "다음 접촉 계획"을 작게 보여 준다.
   * 리드마다 따로 부르지 않고 **한 번에 읽어** 리드별 최대 버전만 남긴다
   * (리드 270건에 각각 조회하면 화면이 멈춘다).
   */
  const { data: strategyHeads } = useQuery({
    queryKey: ['strategy_heads'], queryFn: getStrategyHeads, staleTime: 1000 * 60 * 2,
  });
  const strategyByLead = useMemo(() => {
    const m = new Map<string, { version: number; next_contact_plan?: string | null }>();
    for (const h of strategyHeads ?? []) {
      const prev = m.get(h.lead_id);
      if (!prev || h.version > prev.version) {
        m.set(h.lead_id, { version: h.version, next_contact_plan: h.next_contact_plan });
      }
    }
    return m;
  }, [strategyHeads]);
  const campaignName = useMemo(() => {
    const m = new Map<string, string>();
    (campaigns ?? []).forEach(c => m.set(c.id, c.name));
    return m;
  }, [campaigns]);

  const { userProfile, currentUser } = useAuth();
  const actor = useMemo(
    () => ({ name: userProfile?.name ?? userProfile?.email ?? null, userId: currentUser?.id ?? null }),
    [userProfile, currentUser]);

  // ── 필터 ──
  const [fMarket, setFMarket] = useState<string>(ALL);
  const [fRegion, setFRegion] = useState<string>(ALL);
  const [fEvent, setFEvent] = useState<string>(ALL);
  const [fCountry, setFCountry] = useState<string>(ALL);
  const [fOwner, setFOwner] = useState<string>(ALL);
  const [fStage, setFStage] = useState<string>(ALL);
  const [fMail, setFMail] = useState<string>(ALL);
  const [fStrategy, setFStrategy] = useState<string>(ALL);
  const [fType, setFType] = useState<string>(ALL);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');

  /**
   * 행사 선택지 — **event_name 과 캠페인 이름을 합친다**(요구 R2).
   *
   * 원인: 가져오기에서 행사명을 비워 둘 수 있었고, 실제로 **270건 전부 비어 있다.**
   * 그래서 event_name 만으로 목록을 만들면 선택지가 하나도 없어 '전체'만 보였다.
   * 리드 185건은 campaign_id 가 있으므로 캠페인 이름으로는 고를 수 있다.
   */
  const eventOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads ?? []) {
      if (l.event_name?.trim()) set.add(l.event_name.trim());
      else if (l.campaign_id) {
        const n = campaignName.get(l.campaign_id);
        if (n) set.add(n);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [leads, campaignName]);

  /** 그 리드가 속한 행사 이름(행사명 우선, 없으면 캠페인 이름). */
  const eventOf = useCallback((l: LeadRow): string => {
    if (l.event_name?.trim()) return l.event_name.trim();
    if (l.campaign_id) return campaignName.get(l.campaign_id) ?? '';
    return '';
  }, [campaignName]);
  const countries = useMemo(
    () => [...new Set((leads ?? []).map(l => l.country).filter(Boolean) as string[])].sort(),
    [leads]);
  const owners = useMemo(
    () => [...new Set((leads ?? []).map(l => l.owner).filter(Boolean) as string[])].sort(),
    [leads]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (leads ?? []).filter(l => {
      // 보관본은 기본으로 숨긴다(요구 R8)
      if (!showArchived && l.archived_at) return false;
      if (fMarket !== ALL && toMarket(l.market) !== fMarket) return false;
      if (fRegion !== ALL && regionOf(l) !== fRegion) return false;
      if (fEvent !== ALL && eventOf(l) !== fEvent) return false;
      if (fCountry !== ALL && (l.country ?? '') !== fCountry) return false;
      if (fOwner !== ALL && (l.owner ?? '') !== fOwner) return false;
      if (fStage !== ALL && (l.followup_stage || '신규') !== fStage) return false;
      // 메일 발송 가능 / 발송 보류 (요구 R4)
      if (fMail === 'mailable' && !isMailable(l)) return false;
      if (fMail === 'hold' && l.email_status !== 'hold') return false;
      // LEAD-S1 — 전략이 아직 없는 리드를 찾아 채우려는 용도
      if (fStrategy === 'none' && strategyByLead.has(l.id)) return false;
      if (fStrategy === 'has' && !strategyByLead.has(l.id)) return false;
      // LEAD-S4 — 유형. 'none' 은 아직 분류하지 않은 리드를 찾는 용도다.
      if (fType === 'none' && toLeadType(l.lead_type)) return false;
      if (fType !== ALL && fType !== 'none' && toLeadType(l.lead_type) !== fType) return false;
      if (needle) {
        const hay = [l.name, l.school_name, l.email, eventOf(l), countryLabel(l.country, ''), l.notes]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [leads, fMarket, fRegion, fEvent, fCountry, fOwner, fStage, fMail, fStrategy, fType,
      showArchived, q, eventOf, strategyByLead]);

  // "오늘 할 팔로업"·"7일 넘게 접촉 없음"은 **보관본을 반드시 뺀다**(요구 R8).
  // "보관된 리드 보기"를 켜도 이 두 목록에는 넣지 않는다 — 시험 리드가 거기 남으면
  // 매일 아침 목록이 지저분해져 화면을 안 보게 된다.
  const activeOnly = useMemo(() => excludeArchived(filtered), [filtered]);
  const due = useMemo(() => dueToday(activeOnly, today), [activeOnly, today]);
  const stale = useMemo(() => staleLeads(activeOnly, 7, today), [activeOnly, today]);
  const funnel = useMemo(() => stageCounts(filtered), [filtered]);
  const regions = useMemo(() => regionCounts(filtered), [filtered]);

  // 가능성순 정렬(1순위 가능성 내림, 2순위 최근 등록)
  const byProbability = useMemo(
    () => [...filtered].sort((a, b) =>
      (b.probability ?? 0) - (a.probability ?? 0) ||
      String(b.created_at).localeCompare(String(a.created_at))),
    [filtered]);

  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState('due');

  // 선택한 리드를 URL 에 담는다 — 새로고침해도 같은 리드가 열린다(요구 R5)
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('lead');
  const selectLead = useCallback((id: string | null) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) next.set('lead', id); else next.delete('lead');
      return next;
    }, { replace: true });
  }, [setParams]);

  const selected = useMemo(
    () => (leads ?? []).find(l => l.id === selectedId) ?? null, [leads, selectedId]);

  /** 지금 탭에 보이는 목록 — 키보드 이동과 상세 선택이 이것을 따른다. */
  const visible = useMemo(() => {
    if (tab === 'due') return due;
    if (tab === 'stale') return stale;
    return byProbability;
  }, [tab, due, stale, byProbability]);

  // ↑/↓ 로 이전·다음 리드 (입력 중에는 동작하지 않는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (visible.length === 0) return;
      e.preventDefault();
      const i = visible.findIndex(l => l.id === selectedId);
      const next = e.key === 'ArrowDown'
        ? Math.min(visible.length - 1, i < 0 ? 0 : i + 1)
        : Math.max(0, i < 0 ? 0 : i - 1);
      selectLead(visible[next].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedId, selectLead]);

  const resetFilters = () => {
    setFMarket(ALL); setFRegion(ALL); setFEvent(ALL);
    setFCountry(ALL); setFOwner(ALL); setFStage(ALL); setFMail(ALL); setFStrategy(ALL);
    setFType(ALL); setShowArchived(false); setQ('');
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
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/leads/funnel">행사별 깔때기</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/outreach">아웃리치 큐</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/leads/facts">쓸 수 있는 사실</Link>
          </Button>
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
          options={eventOptions.map(e => [e, e])} />
        <FilterSelect label="국가" value={fCountry} onChange={setFCountry}
          options={countries.map(c => [c, countryLabel(c)])} />
        <FilterSelect label="담당자" value={fOwner} onChange={setFOwner}
          options={owners.map(o => [o, o])} />
        <FilterSelect label="단계" value={fStage} onChange={setFStage}
          options={FOLLOWUP_STAGES.map(s => [s, s])} />
        <FilterSelect label="메일" value={fMail} onChange={setFMail}
          options={[['mailable', '발송 가능만'], ['hold', '발송 보류만']]} />
        <FilterSelect label="전략" value={fStrategy} onChange={setFStrategy}
          options={[['none', '전략 없음'], ['has', '전략 있음']]} />
        <FilterSelect label="유형" value={fType} onChange={setFType}
          options={[...LEAD_TYPES.map(t => [t, LEAD_TYPE_LABEL[t]] as [string, string]),
                    ['none', '미분류']]} />
        <label className="flex items-center gap-1.5 h-9 text-xs cursor-pointer">
          <Checkbox checked={showArchived} onCheckedChange={v => setShowArchived(v === true)} />
          보관된 리드 보기
        </label>
        <Button variant="ghost" size="sm" onClick={resetFilters}>초기화</Button>
      </div>

      {/* 목록 ↔ 상세 (Gmail 방식, 요구 R5) */}
      <div className="flex gap-4 items-start">
        {/* 왼쪽: 탭 + 목록. 좁은 화면에서는 상세가 열리면 숨는다. */}
        <div className={`${selected ? 'hidden lg:block' : 'block'} flex-1 min-w-0 relative`}>
          <Tabs value={tab} onValueChange={setTab}>
            {/* ⚠️ 겹침 수정(UI2 fix1): shadcn 기본 TabsList 는 `inline-flex h-10` 이고
                TabsTrigger 는 `whitespace-nowrap` 이라 **줄바꿈도 축소도 하지 않는다.**
                상세가 열리면 왼쪽 칸이 좁아지는데(lg 에서 약 400px) 탭줄 자연 폭은
                약 556px 이라 156px 이 바깥으로 흘러나왔고, DOM 에서 나중에 오는
                상세 패널이 그 위에 그려져 마지막 탭(단계별)을 가렸다.
                `flex-wrap` + `h-auto` 로 좁아지면 두 줄이 되게 한다 — 탭을 잘라 내지
                않으므로 어떤 폭에서도 네 개가 모두 눌린다. */}
            <TabsList className="flex-wrap h-auto min-h-10 gap-1 justify-start">
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

            <TabsContent value="due" className="mt-3">
              {due.length === 0
                ? <Empty text="오늘 할 팔로업이 없습니다." />
                : <LeadList rows={due} today={today} eventOf={eventOf} strategyByLead={strategyByLead}
                    selectedId={selectedId} onSelect={selectLead} showDue />}
            </TabsContent>

            <TabsContent value="stale" className="mt-3">
              <p className="text-sm text-muted-foreground mb-2">
                마지막 접촉(없으면 등록일)에서 7일이 지난 리드입니다. 한 번도 연락하지 않은 리드가 여기에 보입니다.
              </p>
              {stale.length === 0
                ? <Empty text="7일 넘게 접촉 없는 리드가 없습니다." />
                : <LeadList rows={stale} today={today} eventOf={eventOf} strategyByLead={strategyByLead}
                    selectedId={selectedId} onSelect={selectLead} showStale />}
            </TabsContent>

            <TabsContent value="all" className="mt-3">
              {byProbability.length === 0
                ? <Empty text="리드가 없습니다." />
                : <LeadList rows={byProbability} today={today} eventOf={eventOf}
                    strategyByLead={strategyByLead}
                    selectedId={selectedId} onSelect={selectLead} showDue showStale />}
            </TabsContent>

            <TabsContent value="funnel" className="mt-3">
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
          {tab !== 'funnel' && (
            <p className="mt-2 text-xs text-muted-foreground">
              ↑ / ↓ 로 이전·다음 리드를 볼 수 있습니다.
            </p>
          )}
        </div>

        {/* 오른쪽: 상세. 좁은 화면에서는 전체 폭으로 열린다.
            폭을 단계적으로 둔다 — lg(1024~1279px)에서 560px 이면 왼쪽이 400px 까지
            눌려 탭줄이 넘쳤다(UI2 fix1). `relative z-10` 과 `bg-background` 는
            앞으로 무엇이 넘치더라도 상세가 그 아래로 깔리지 않게 하는 안전장치다. */}
        {selected && (
          <div className="w-full lg:w-[440px] xl:w-[560px] 2xl:w-[620px] shrink-0 relative z-10 rounded-lg border bg-background p-4">
            <Button variant="ghost" size="sm" className="lg:hidden mb-2 -ml-2"
              onClick={() => selectLead(null)}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />목록으로
            </Button>
            <LeadDetail lead={selected} allLeads={leads ?? []} actor={actor}
              onOpenLead={selectLead} />
          </div>
        )}
      </div>

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

function LeadList({ rows, today, eventOf, strategyByLead, selectedId, onSelect, showDue, showStale }: {
  rows: LeadRow[]; today: string; eventOf: (l: LeadRow) => string;
  strategyByLead: Map<string, { version: number; next_contact_plan?: string | null }>;
  selectedId: string | null; onSelect: (id: string) => void;
  showDue?: boolean; showStale?: boolean;
}) {
  return (
    <div className="rounded-lg border divide-y max-h-[70vh] overflow-y-auto">
      {rows.map(l => {
        const ds = dueState(l, today);
        const od = overdueDays(l, today);
        const sd = staleDays(l, today);
        const on = l.id === selectedId;
        return (
          <button key={l.id} type="button" onClick={() => onSelect(l.id)}
            className={`w-full text-left px-3 py-2.5 transition
              ${on ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted/50 border-l-2 border-l-transparent'}
              ${ds === 'overdue' ? 'bg-destructive/5' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-sm">{l.name}</span>
                  {toMarket(l.market) === 'INTL' && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">해외</Badge>
                  )}
                  {l.lead_type && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {leadTypeLabel(l.lead_type)}
                    </Badge>
                  )}
                  {isPartnerLead(l) && (
                    <Badge variant="outline"
                      className={`h-4 px-1 text-[10px] ${
                        partnerLeadTone(l, new Date()) === 'open'
                          ? 'border-slate-300 text-slate-500'
                          : partnerLeadTone(l, new Date()) === 'ending'
                            ? 'border-amber-400 text-amber-700'
                            : 'border-emerald-400 text-emerald-700'}`}
                      title={['파트너가 등록한 리드', contactOwnerLabel(l.contact_owner),
                              protectionLabel(l, new Date())].filter(Boolean).join(' · ')}>
                      파트너 · {protectionLabel(l, new Date())}
                    </Badge>
                  )}
                  {l.email_status === 'hold' && (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]"
                      title={emailStatusLabel(l.email_status)}>발송 보류</Badge>
                  )}
                  {l.archived_at && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">보관됨</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {l.school_name ?? '—'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                  <span>{countryShort(l.country)}</span>
                  <span>{l.followup_stage || '신규'}</span>
                  <span>
                    가능성 {l.probability ?? '—'}
                    {l.segment && ` · ${l.segment}`}
                    {l.segment_detail && ` (${l.segment_detail})`}
                  </span>
                  {eventOf(l) && <span className="truncate max-w-[140px]">{eventOf(l)}</span>}
                </div>
                {/* LEAD-S1 — 현재 전략 버전과 다음 접촉 계획 */}
                {strategyByLead.get(l.id) && (
                  <div className="text-xs mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      v{strategyByLead.get(l.id)!.version}
                    </Badge>
                    {strategyByLead.get(l.id)!.next_contact_plan && (
                      <span className="text-muted-foreground truncate max-w-[200px]">
                        {strategyByLead.get(l.id)!.next_contact_plan}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0 text-xs">
                {showDue && l.next_action_due && (
                  <div className={ds === 'overdue' ? 'text-destructive font-semibold' : ''}>
                    {ds === 'overdue'
                      ? <span className="inline-flex items-center gap-0.5">
                          <AlertCircle className="h-3 w-3" />{od}일 지남
                        </span>
                      : ds === 'today' ? '오늘' : l.next_action_due}
                  </div>
                )}
                {showStale && sd !== null && (
                  <div className="text-muted-foreground tabular-nums">무접촉 {sd}일</div>
                )}
                {l.owner && <div className="text-muted-foreground">{l.owner}</div>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
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
              {/* LEAD-UI2 R2: 행사명을 비워 둘 수 있어서 가져온 270건 전부 빈값이 됐고,
                  그 결과 행사 필터에 선택지가 하나도 없었다. 이제 **필수**다. */}
              <Label className="text-xs">행사명 (필수)</Label>
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
                              <Button disabled={busy || split.fresh.length === 0 || !eventName.trim()}
                        onClick={doImport}>
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
