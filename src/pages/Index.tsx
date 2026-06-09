import { useState } from 'react';
import type { AirtableRecord } from '@/lib/airtable';
import type { DealFields } from '@/types/airtable';
import { useContacts, useDeals } from '@/hooks/use-airtable';

type AirtableRecordOfDeal = AirtableRecord<DealFields>;
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllLicenses, getSleepingCampaignLicenses, getAllCampaignLicenses, getConvertedPhonesSet, type DealLicenseRecord, type SleepingCampaignLicense } from '@/lib/storage';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { FlaskConical, Briefcase, TrendingUp, AlertCircle, Clock, ArrowRight, CheckCircle2, LogIn, Phone, Users, Send, ChevronDown, MessageSquare, Moon } from 'lucide-react';
import { DEAL_STAGES, DEAL_STAGE_LABELS, STAGE_COLOR, isClosedDeal } from '@/lib/grades';
import { Link } from 'react-router-dom';
import { DealQuickView } from '@/components/DealQuickView';
import { LicenseQuickView, type LicenseQuickViewData } from '@/components/LicenseQuickView';
import { Button } from '@/components/ui/button';
import { AlimtalkSendDialog } from '@/components/AlimtalkSendDialog';
import { getRecentSendLogs, buildSentMap, isAlreadySent, canSendUH2821, lastUH2821SentAt, nextUH2821ResendAt, todayUHStage, type AlimtalkRecipient } from '@/lib/alimtalk';
import { RevenueTrendChart } from '@/components/dashboard/RevenueTrendChart';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const REST_HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY };

const fmt = (n: number) =>
  n >= 100_000_000 ? `${(n / 100_000_000).toFixed(1)}억`
  : n >= 10_000    ? `${Math.round(n / 10_000).toLocaleString()}만`
  : n.toLocaleString();

const num = (n: number) => n.toLocaleString();

function dday(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

type ExpiringLic = DealLicenseRecord & {
  dd: number;
  sentStage?: string;
  effectiveName?:  string | null;
  effectivePhone?: string | null;
  phoneSource?:    'license' | 'admin' | 'deal' | null;
  dupCount?:       number;   // 같은 번호로 묶인 이용권 수 (대표 행, 2 이상일 때만)
};
type GroupKey = 'urgent' | 'soon' | 'warn' | 'warnLate' | 'rest';

const GROUP_META: Record<GroupKey, { label: string; range: string; stage: string; color: string; bg: string }> = {
  urgent:   { label: '🔴 긴급',    range: 'D-1 (오늘 ~ 1일)', stage: 'D-1', color: 'text-red-700',    bg: 'bg-red-50/50' },
  soon:     { label: '🟠 임박',    range: 'D-2 ~ D-3',        stage: 'D-3', color: 'text-orange-700', bg: 'bg-orange-50/50' },
  warn:     { label: '🟡 경고',    range: 'D-6 ~ D-7',        stage: 'D-7', color: 'text-amber-700',  bg: 'bg-amber-50/50' },
  warnLate: { label: '🟡 경고-폴백', range: 'D-4 ~ D-5',       stage: 'D-7', color: 'text-amber-600',  bg: 'bg-amber-50/30' },
  rest:     { label: '⚪ 관찰',    range: 'D-8 ~ D-30',       stage: '',    color: 'text-slate-600',  bg: 'bg-slate-50/50' },
};

const groupOf = (dd: number): GroupKey => {
  if (dd <= 1) return 'urgent';
  if (dd <= 3) return 'soon';
  if (dd <= 5) return 'warnLate';
  if (dd <= 7) return 'warn';
  return 'rest';
};

const toRecipient = (l: ExpiringLic): AlimtalkRecipient => ({
  license_id:     l.id,
  license_source: l.deal_id === 'mdiary' ? 'mdiary' : 'deal',
  name:           l.effectiveName  ?? l.admin_name  ?? '',
  phone:          l.effectivePhone ?? l.admin_phone ?? '',
  group_name:     l.group_name ?? l.org_name ?? null,
  user_limit:     String(l.user_count ?? ''),
  duration:       String(l.duration ?? ''),
  expiry_date:    l.service_expire_at ?? null,
  coupon_code:    null,
});

export default function Dashboard() {
  const qc = useQueryClient();
  const { isLoading: cl } = useContacts();
  const { data: deals,    isLoading: dl } = useDeals();
  const { data: licenses, isLoading: ll } = useQuery({
    queryKey: ['licenses'],
    queryFn: getAllLicenses,
  });
  const { data: sendLogs } = useQuery({
    queryKey: ['alimtalk_logs_recent'],
    queryFn:  getRecentSendLogs,
    staleTime: 30 * 1000,
  });
  const { data: sleepingLicenses } = useQuery({
    queryKey: ['sleeping_campaign_licenses'],
    queryFn:  getSleepingCampaignLicenses,
    staleTime: 60 * 1000,
  });
  const { data: campaignLics } = useQuery({
    queryKey: ['campaign_licenses_all'],
    queryFn:  getAllCampaignLicenses,
    staleTime: 60 * 1000,
  });
  const { data: convertedPhonesSet } = useQuery({
    queryKey: ['converted_phones_set'],
    queryFn:  getConvertedPhonesSet,
    staleTime: 60 * 1000,
  });

  // 작년 월별 매출 (부가세 신고 기준 SEED)
  const currentYear = new Date().getFullYear();
  const { data: priorYearRows } = useQuery({
    queryKey: ['prior_year_revenue', currentYear - 1],
    queryFn: async () => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/prior_year_revenue?year=eq.${currentYear - 1}&select=month,amount`,
        { headers: REST_HEADERS },
      );
      return r.ok ? (await r.json() as { month: number; amount: number }[]) : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // 발송 다이얼로그 state
  const [sendOpen, setSendOpen] = useState(false);
  const [sendGroup, setSendGroup] = useState<GroupKey | null>(null);
  const [restOpen, setRestOpen] = useState(false);
  const [sleepingOpen, setSleepingOpen] = useState(true);          // 기본 펼침
  const [sleepingSendOpen, setSleepingSendOpen] = useState(false);

  // 딜 빠른 보기 state
  const [quickDeal, setQuickDeal] = useState<AirtableRecordOfDeal | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const openDealQuickView = (deal: AirtableRecordOfDeal) => {
    setQuickDeal(deal);
    setQuickOpen(true);
  };

  // 라이선스 빠른 보기 state (CRM Deal 매핑 없는 직접 발급 라이선스용)
  const [quickLicense, setQuickLicense] = useState<LicenseQuickViewData | null>(null);
  const [quickLicenseOpen, setQuickLicenseOpen] = useState(false);

  // license 클릭 처리 — deal 매핑 있으면 DealQuickView, 없으면 LicenseQuickView
  const dealMap = new Map((deals ?? []).map(d => [d.id, d]));
  const openLicenseDeal = (l: ExpiringLic) => {
    const matched = l.deal_id !== 'mdiary' && l.deal_id ? dealMap.get(l.deal_id) : undefined;
    if (matched) {
      openDealQuickView(matched);
    } else {
      setQuickLicense(l as LicenseQuickViewData);
      setQuickLicenseOpen(true);
    }
  };

  const today     = new Date().toISOString().split('T')[0];
  const thisMonth = new Date().getMonth();
  const thisYear  = new Date().getFullYear();

  // ── 이용권 지표 ──────────────────────────────────────
  const allLics = licenses ?? [];

  // 사용중 체험권
  const activeTrials = allLics.filter(l => l.status === '사용중');

  // 만료 임박 D-30 이내 (만료일 있는 사용중) — D-0(당일 만료)도 포함하기 위해 dd >= 0
  const sentMap = sendLogs ? buildSentMap(sendLogs) : new Set<string>();
  const expiringSoon: ExpiringLic[] = activeTrials
    .filter(l => l.service_expire_at)
    .map(l => ({ ...l, dd: dday(l.service_expire_at!) } as ExpiringLic))
    .filter(l => l.dd >= 0 && l.dd <= 30)
    .map(l => {
      const source = l.deal_id === 'mdiary' ? 'mdiary' : 'deal';
      // 어떤 stage가 발송됐는지 확인 (D-1 / D-3 / D-7 순으로 가장 강한 stage)
      let sentStage: string | undefined;
      for (const s of ['D-1', 'D-3', 'D-7']) {
        if (isAlreadySent(sentMap, source, l.id, 'UD_5369', s)) { sentStage = s; break; }
      }
      // 수령자 우선순위: 각 이용권 자체(contact_*) → mDiary 그룹관리자(admin_*) → 딜 대표연락처(폴백)
      // 한 학교 딜에 매달린 여러 이용권이 대표연락처 1명으로 뭉쳐 잘못 표시/발송되던 문제 방지.
      // 이름·번호는 같은 출처로 묶음(번호 기준) — 실제 발송 대상 번호와 표시 이름이 어긋나지 않도록.
      const matchedDeal = l.deal_id !== 'mdiary' ? dealMap.get(l.deal_id) : undefined;
      const fallbackName  = matchedDeal?.fields.Contact_Name  ?? null;
      const fallbackPhone = matchedDeal?.fields.Contact_Phone ?? null;
      const licName  = l.contact_name?.trim()  || null;
      const licPhone = l.contact_phone?.trim() || null;
      let effectiveName:  string | null;
      let effectivePhone: string | null;
      let phoneSource: 'license' | 'admin' | 'deal' | null;
      if (licPhone) {
        effectiveName = licName ?? fallbackName;
        effectivePhone = licPhone;
        phoneSource = 'license';
      } else if (l.admin_phone) {
        effectiveName = l.admin_name ?? fallbackName;
        effectivePhone = l.admin_phone;
        phoneSource = 'admin';
      } else {
        effectiveName = licName ?? l.admin_name ?? fallbackName;
        effectivePhone = fallbackPhone;
        phoneSource = fallbackPhone ? 'deal' : null;
      }
      return { ...l, sentStage, effectiveName, effectivePhone, phoneSource };
    })
    .sort((a, b) => a.dd - b.dd);

  // 같은 번호(대표 수령자)에 여러 이용권이 묶이는 경우 → 한 명만 대표로 표시/발송.
  // 가장 임박한 건(dd 최소, 위 sort로 먼저 등장)을 대표로, 묶인 건수는 dupCount로 부착.
  // 번호 없는 건은 개별 유지. (다른 사람끼리는 번호가 달라 묶이지 않음)
  const phoneTotal = new Map<string, number>();
  expiringSoon.forEach(l => {
    const p = (l.effectivePhone ?? '').replace(/\D/g, '');
    if (p) phoneTotal.set(p, (phoneTotal.get(p) ?? 0) + 1);
  });
  const seenPhone = new Set<string>();
  const expiringDeduped: ExpiringLic[] = expiringSoon.filter(l => {
    const p = (l.effectivePhone ?? '').replace(/\D/g, '');
    if (!p) return true;
    if (seenPhone.has(p)) return false;
    seenPhone.add(p);
    return true;
  }).map(l => {
    const p = (l.effectivePhone ?? '').replace(/\D/g, '');
    const cnt = p ? (phoneTotal.get(p) ?? 1) : 1;
    return cnt > 1 ? { ...l, dupCount: cnt } : l;
  });

  // D-7 이내 긴급
  const urgentCount = expiringDeduped.filter(l => l.dd <= 7).length;

  // 그룹별 분류 (대표만)
  const groups: Record<GroupKey, ExpiringLic[]> = {
    urgent: [], soon: [], warn: [], warnLate: [], rest: [],
  };
  expiringDeduped.forEach(l => groups[groupOf(l.dd)].push(l));

  // 그룹별 발송 대상 (이미 해당 stage 발송된 사람 + 연락처 없는 사람 제외)
  const targetsForGroup = (key: GroupKey): { send: ExpiringLic[]; skipped: number } => {
    const list = groups[key];
    if (key === 'rest') return { send: [], skipped: list.length };
    const stage = GROUP_META[key].stage;
    const valid = list.filter(l => l.effectiveName && l.effectivePhone);
    const send = valid.filter(l => l.sentStage !== stage);
    const skipped = (list.length - valid.length) + (valid.length - send.length);
    return { send, skipped };
  };

  const handleOpenSend = (key: GroupKey) => { setSendGroup(key); setSendOpen(true); };
  const sendTargets = sendGroup ? targetsForGroup(sendGroup) : null;

  // ── 잠자는 체험권 — 캠페인 등록 미등록자 ─────────
  const sleeping: SleepingCampaignLicense[] = sleepingLicenses ?? [];
  const sleepingRecent30 = sleeping.filter(c => {
    const d = new Date(c.created_at).getTime();
    return Date.now() - d <= 30 * 86400_000;
  });

  // 재발송 정책: 매주 월요일 또는 매월 1일이 마지막 발송 후 한 번이라도 지났을 때 활성화
  const allLogs = sendLogs ?? [];
  const sleepingSendable = sleeping.filter(c => canSendUH2821(allLogs, 'campaign', c.id));
  const sleepingPaused   = sleeping.length - sleepingSendable.length;

  const sleepingRecipients: AlimtalkRecipient[] = sleepingSendable.map(c => ({
    license_id:     c.id,
    license_source: 'campaign',
    name:           c.contact_name,
    phone:          c.contact_phone,
    group_name:     c.org_name ?? null,
    user_limit:     c.user_count,
    duration:       c.duration,
    expiry_date:    null,
    coupon_code:    c.coupon_code,
  }));

  // 만료됐지만 구매 미전환 (체험권 출처)
  const expiredUnconverted = allLics.filter(
    l => l.status === '만료' && l.deal_id === 'mdiary'
  );

  // 이번 달 신규 체험
  const newTrialsThisMonth = allLics.filter(l => {
    const d = new Date(l.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear && l.deal_id === 'mdiary';
  }).length;

  // ── 딜 지표 — 매출은 현금주의(입금일 기준) ─────────
  const thisMonthDeals = (deals ?? []).filter(d => {
    const date = d.fields.Payment_Date;
    if (!date) return false;
    const dt = new Date(date);
    return dt.getMonth() === thisMonth && dt.getFullYear() === thisYear;
  });
  const thisMonthRevenue = thisMonthDeals.reduce((sum, d) =>
    sum + (d.fields.Final_Contract_Value ?? 0), 0);

  // 진행중 딜 (종료 단계 제외) — 정렬은 ActiveDealsSection 내에서 사용자 선택
  const activeDeals = (deals ?? [])
    .filter(d => !isClosedDeal(d.fields.Deal_Stage));

  if (cl || dl || ll) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">대시보드</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="surface-card ring-container p-5 h-24 animate-pulse bg-muted/30 rounded-xl" />)}
      </div>
      <DataTableSkeleton columns={4} rows={5} />
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">대시보드</h1>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="surface-card ring-container p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground font-medium">체험 활성</p>
            <FlaskConical className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-3xl font-bold tabular-nums">{num(activeTrials.length)}</p>
          <p className="text-xs text-muted-foreground mt-1">이번 달 +{num(newTrialsThisMonth)}건 신규</p>
        </div>

        <div className={`surface-card ring-container p-5 ${urgentCount > 0 ? 'border-red-200 bg-red-50/40' : ''}`}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground font-medium">만료 임박</p>
            <AlertCircle className={`h-4 w-4 ${urgentCount > 0 ? 'text-red-500' : 'text-amber-500'}`} />
          </div>
          <p className={`text-3xl font-bold tabular-nums ${urgentCount > 0 ? 'text-red-600' : ''}`}>
            {num(expiringDeduped.length)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {urgentCount > 0 ? <span className="text-red-500 font-medium">D-7 이내 {num(urgentCount)}건 긴급</span> : 'D-30 이내'}
          </p>
        </div>

        <div className="surface-card ring-container p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground font-medium">미전환 만료</p>
            <Clock className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-3xl font-bold tabular-nums text-muted-foreground">{num(expiredUnconverted.length)}</p>
          <p className="text-xs text-muted-foreground mt-1">구매 전환 대기</p>
        </div>

        <div className="surface-card ring-container p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground font-medium">이번 달 매출</p>
            <TrendingUp className="h-4 w-4 text-teal-500" />
          </div>
          <p className="text-3xl font-bold tabular-nums">
            {thisMonthRevenue > 0 ? fmt(thisMonthRevenue) : num(thisMonthDeals.length) + '건'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">입금 {num(thisMonthDeals.length)}건 · 입금일 기준</p>
        </div>
      </div>

      {/* 매출 추이 — 작년 / 올해 클러스터 막대 */}
      <RevenueTrendChart
        deals={deals ?? []}
        priorYearRows={priorYearRows ?? []}
        currentYear={currentYear}
        currentMonth={thisMonth}
      />

      {/* 영업 액션 필요 — 그룹별 만기 알림 */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              영업 액션 필요 — 만기 알림
              {expiringDeduped.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5">
                  {expiringDeduped.length}건
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">D-day 그룹별 만기 알림 일괄 발송 (단계별 1회 보장)</p>
          </div>
        </div>

        {expiringDeduped.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-teal-400 mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">D-30 이내 만료 예정 없음</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {(['urgent', 'soon', 'warn', 'warnLate'] as GroupKey[]).map(key => (
              <ExpiryGroupSection
                key={key}
                groupKey={key}
                items={groups[key]}
                onSend={() => handleOpenSend(key)}
                onLicenseClick={openLicenseDeal}
              />
            ))}
            {/* 관찰 그룹 (D-8~D-30) — 접힘 */}
            {groups.rest.length > 0 && (
              <div className={GROUP_META.rest.bg}>
                <button
                  onClick={() => setRestOpen(o => !o)}
                  className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-slate-100/50">
                  <div className="flex items-center gap-2 text-xs">
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${restOpen ? '' : '-rotate-90'}`} />
                    <span className={`font-medium ${GROUP_META.rest.color}`}>{GROUP_META.rest.label}</span>
                    <span className="text-muted-foreground">{GROUP_META.rest.range}</span>
                    <span className="ml-1 rounded-full bg-slate-200 text-slate-700 text-[10px] font-semibold px-1.5">
                      {groups.rest.length}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">발송 대상 아님</span>
                </button>
                {restOpen && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 max-h-[400px] overflow-y-auto">
                    {groups.rest.map(l => <ExpiringCard key={l.id} l={l} onClick={() => openLicenseDeal(l)} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 일괄 발송 다이얼로그 — 만기 알림 */}
      {sendGroup && sendTargets && (
        <AlimtalkSendDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          title={`만기 알림 일괄 발송 — ${GROUP_META[sendGroup].label} (${GROUP_META[sendGroup].range})`}
          recipients={sendTargets.send.map(toRecipient)}
          alreadySentCount={sendTargets.skipped}
          tpl_code="UD_5369"
          stage={GROUP_META[sendGroup].stage}
          onSent={() => {
            qc.invalidateQueries({ queryKey: ['alimtalk_logs_recent'] });
          }}
        />
      )}

      {/* 일괄 발송 다이얼로그 — 잠자는 체험권 미등록 알림 */}
      <AlimtalkSendDialog
        open={sleepingSendOpen}
        onOpenChange={setSleepingSendOpen}
        title="잠자는 체험권 미등록 알림 일괄 발송"
        recipients={sleepingRecipients}
        alreadySentCount={sleepingPaused}
        tpl_code="UH_2821"
        stage={todayUHStage()}
        onSent={() => {
          qc.invalidateQueries({ queryKey: ['alimtalk_logs_recent'] });
        }}
      />

      {/* 딜 빠른 보기 다이얼로그 (진행중 딜 / 영업 액션 항목 클릭 시) */}
      <DealQuickView open={quickOpen} onOpenChange={setQuickOpen} deal={quickDeal} />

      {/* 라이선스 빠른 보기 (CRM Deal 매핑 없는 직접 발급 — 5-2반하다 같은 케이스) */}
      <LicenseQuickView open={quickLicenseOpen} onOpenChange={setQuickLicenseOpen} license={quickLicense} />

      {/* 진행중 딜 — full-width 강조, 가장 자주 보는 영역 */}
      <ActiveDealsSection deals={activeDeals} onDealClick={openDealQuickView} />

      {/* 체험 파이프라인 — 캠페인 등록 체험권 기준 (full-width) */}
      <div className="space-y-6">
        <div className="surface-card ring-container p-5">
          <h2 className="font-semibold mb-1">체험 파이프라인</h2>
          <p className="text-xs text-muted-foreground mb-4">캠페인을 통한 체험권 발송 → 구매 전환 흐름</p>
          {(() => {
            const camAll = campaignLics ?? [];
            const camPending  = camAll.filter(l => l.status === '대기').length;
            const camActive   = camAll.filter(l => l.status === '사용중');
            const camExpiring = camActive.filter(l => {
              if (!l.service_expire_at) return false;
              const dd = dday(l.service_expire_at);
              return dd >= 0 && dd <= 30;
            }).length;
            const camExpired  = camAll.filter(l => l.status === '만료').length;
            const phones = convertedPhonesSet ?? new Set<string>();
            const camConverted = camAll.filter(l => {
              const p = (l.contact_phone ?? '').replace(/\D/g, '');
              return p && phones.has(p);
            }).length;

            const rows = [
              { label: '대기 (미사용)',     count: camPending,    color: 'bg-slate-200',   text: 'text-slate-600' },
              { label: '사용중',           count: camActive.length, color: 'bg-teal-400',  text: 'text-teal-700' },
              { label: '만료 임박 D-30',   count: camExpiring,   color: 'bg-amber-400',   text: 'text-amber-700' },
              { label: '만료',             count: camExpired,    color: 'bg-orange-300',  text: 'text-orange-700' },
              { label: '딜 전환',          count: camConverted,  color: 'bg-primary',     text: 'text-primary-foreground' },
            ];
            const max = Math.max(camAll.length, 1);
            return (
              <div className="space-y-2">
                {rows.map(row => {
                  const pct = Math.max(Math.round((row.count / max) * 100), row.count > 0 ? 4 : 0);
                  return (
                    <div key={row.label} className="flex items-center gap-3">
                      <div className="w-24 shrink-0 text-xs text-muted-foreground text-right">{row.label}</div>
                      <div className="flex-1 bg-muted/40 rounded-full h-5 overflow-hidden">
                        <div className={`h-full rounded-full flex items-center justify-end pr-2 ${row.color} transition-all`}
                          style={{ width: `${pct}%` }}>
                          {row.count > 0 && <span className={`text-[11px] font-semibold ${row.text}`}>{num(row.count)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground text-right pt-1">
                  총 캠페인 라이선스 {num(camAll.length)}건 (전체 체험권 활성 {num(activeTrials.length)}건은 KPI 카드 참조)
                </p>
              </div>
            );
          })()}

          {/* 잠자는 체험권 액션 바 — 캠페인 등록된 미등록 체험권 */}
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSleepingOpen(o => !o)}
                className="flex items-center gap-2 text-left">
                <Moon className="h-4 w-4 text-indigo-500" />
                <span className="text-sm font-medium">잠자는 체험권</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform text-muted-foreground ${sleepingOpen ? '' : '-rotate-90'}`} />
              </button>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">총 <strong className="text-foreground tabular-nums">{num(sleeping.length)}</strong>건</span>
                <span className="text-muted-foreground">· 최근 30일 <strong className="text-amber-600 tabular-nums">{num(sleepingRecent30.length)}</strong></span>
                <span className="text-muted-foreground">· 발송가능 <strong className="text-teal-600 tabular-nums">{num(sleepingSendable.length)}</strong></span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              캠페인을 통해 발급되었지만 아직 사용 시작 안 한 체험권 (전체 캠페인 통합) · 매주 월요일/매월 1일 재발송 가능
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={sleepingSendable.length === 0}
                onClick={() => setSleepingSendOpen(true)}>
                <MessageSquare className="h-3.5 w-3.5 mr-1" />
                {sleepingSendable.length > 0
                  ? `미등록 알림 ${num(sleepingSendable.length)}명 발송`
                  : (sleepingPaused > 0 ? '대기 중 (다음 월요일/1일)' : '대상 없음')}
              </Button>
              <Link to="/campaigns" className="text-[11px] text-primary hover:underline">
                캠페인별 보기 →
              </Link>
              {sleepingPaused > 0 && (
                <span className="text-[10px] text-muted-foreground ml-auto">{num(sleepingPaused)}명 다음 트리거 대기</span>
              )}
            </div>
            {sleepingOpen && (
              <div className="mt-2 max-h-[280px] overflow-y-auto rounded border border-border divide-y divide-border">
                {sleeping.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">잠자는 체험권 없음</div>
                ) : sleeping.slice(0, 50).map(c => {
                  const days = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400_000);
                  const last = lastUH2821SentAt(allLogs, 'campaign', c.id);
                  const sendable = canSendUH2821(allLogs, 'campaign', c.id);
                  const nextAt = last && !sendable ? nextUH2821ResendAt(last) : null;
                  return (
                    <div key={c.id} className={`px-3 py-1.5 text-[11px] flex items-center gap-2 ${!sendable ? 'opacity-60' : ''}`}>
                      <span className="font-mono text-muted-foreground shrink-0">{c.coupon_code}</span>
                      <span className="text-muted-foreground shrink-0">D+{num(days)}</span>
                      <span className="font-medium truncate">{c.contact_name}</span>
                      <span className="text-muted-foreground truncate">{c.org_name ?? '-'}</span>
                      {c.campaign_name && (
                        <span className="text-[10px] text-indigo-600 truncate shrink-0 max-w-[180px]">[{c.campaign_name}]</span>
                      )}
                      <span className="ml-auto text-muted-foreground shrink-0 whitespace-nowrap">{c.duration}개월·{num(Number(c.user_count))}명</span>
                      {sendable ? (
                        last ? (
                          <span className="text-teal-600 shrink-0 whitespace-nowrap" title={`마지막 발송: ${last.toLocaleDateString()}`}>🔁</span>
                        ) : (
                          <span className="text-teal-600 shrink-0 whitespace-nowrap" title="첫 발송 가능">📞</span>
                        )
                      ) : (
                        <span className="text-amber-600 shrink-0 whitespace-nowrap" title={nextAt ? `다음 발송: ${nextAt.toLocaleDateString()}` : ''}>⏳</span>
                      )}
                    </div>
                  );
                })}
                {sleeping.length > 50 && (
                  <div className="px-3 py-2 text-center text-[10px] text-muted-foreground">
                    ... 외 {num(sleeping.length - 50)}건 (캠페인 페이지에서 전체 보기)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>


      </div>
    </div>
  );
}

// ── 만기 임박 그룹 섹션 ──────────────────────────────
function ExpiryGroupSection({
  groupKey, items, onSend, onLicenseClick,
}: {
  groupKey: GroupKey;
  items: ExpiringLic[];
  onSend: () => void;
  onLicenseClick: (l: ExpiringLic) => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = GROUP_META[groupKey];
  const stage = meta.stage;

  const validForSend = items.filter(l => l.effectiveName && l.effectivePhone);
  const sendable = validForSend.filter(l => l.sentStage !== stage);
  const alreadySent = validForSend.filter(l => l.sentStage === stage).length;
  const noContact = items.length - validForSend.length;

  if (items.length === 0) return null;

  return (
    <div className={meta.bg}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-black/[0.02]">
        <div className="flex items-center gap-2 text-xs">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className={`font-medium text-sm ${meta.color}`}>{meta.label}</span>
          <span className="text-muted-foreground">{meta.range}</span>
          <span className="ml-1 rounded-full bg-white text-foreground text-[10px] font-semibold px-1.5 py-0.5 ring-1 ring-border">
            {items.length}
          </span>
          {alreadySent > 0 && (
            <span className="text-[10px] text-muted-foreground">· 발송 {alreadySent}건</span>
          )}
          {noContact > 0 && (
            <span className="text-[10px] text-red-500">· 연락처없음 {noContact}건</span>
          )}
        </div>
        <Button
          size="sm"
          variant={sendable.length > 0 ? 'default' : 'outline'}
          disabled={sendable.length === 0}
          onClick={(e) => { e.stopPropagation(); onSend(); }}
          className="h-7 text-[11px]">
          <Send className="h-3 w-3 mr-1" />
          {sendable.length > 0 ? `${sendable.length}명 일괄 발송` : (alreadySent > 0 ? '전원 발송 완료' : '대상 없음')}
        </Button>
      </button>
      {open && (
        <div className="grid grid-cols-1 lg:grid-cols-2 max-h-[420px] overflow-y-auto border-t border-border/50">
          {items.map(l => <ExpiringCard key={l.id} l={l} onClick={() => onLicenseClick(l)} />)}
        </div>
      )}
    </div>
  );
}

// ── 만기 임박 카드 (그룹 안에서 한 항목) ──────────────────
function ExpiringCard({ l, onClick }: { l: ExpiringLic; onClick?: () => void }) {
  const loginDays = l.admin_last_login ? daysSince(l.admin_last_login) : null;
  const loginColor =
    loginDays === null ? 'text-muted-foreground'
    : loginDays <= 7  ? 'text-teal-600'
    : loginDays <= 30 ? 'text-amber-600'
    : 'text-red-500';

  const clickable = !!onClick;
  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={`px-4 py-3 flex gap-3 border-b border-border hover:bg-muted/30 transition-colors ${clickable ? 'cursor-pointer' : ''}`}>
      <div className={`shrink-0 w-12 text-center rounded-lg py-1.5 h-fit ${
        l.dd <= 1 ? 'bg-red-100 text-red-700'
        : l.dd <= 3 ? 'bg-orange-100 text-orange-700'
        : l.dd <= 7 ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-600'
      }`}>
        <div className="text-[10px] font-semibold">D-{l.dd}</div>
        <div className="text-[10px] opacity-70">{l.service_expire_at?.slice(5)}</div>
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <p className="font-medium text-sm truncate">
          {l.group_name || l.org_name || '-'}
          {l.sentStage && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-teal-100 text-teal-700 text-[10px] font-semibold px-1.5 py-0.5">
              <CheckCircle2 className="h-2.5 w-2.5" />{l.sentStage} 발송됨
            </span>
          )}
        </p>
        {l.group_name && l.org_name && (
          <p className="text-[11px] text-muted-foreground truncate">{l.org_name}</p>
        )}
        {l.edu_office_name && (
          <p className="text-[11px] text-muted-foreground truncate">{l.edu_office_name}</p>
        )}
        {(l.effectiveName || l.effectivePhone) && (
          <div className="flex items-center gap-2 flex-wrap">
            {l.effectiveName && (
              <span className="text-xs font-medium text-foreground">{l.effectiveName} 선생님</span>
            )}
            {(l.dupCount ?? 0) > 1 && (
              <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded" title={`같은 번호로 이용권 ${l.dupCount}건 — 대표 1건만 발송`}>
                외 {l.dupCount! - 1}건
              </span>
            )}
            {l.effectivePhone && (
              <a href={`tel:${l.effectivePhone}`}
                onClick={e => e.stopPropagation()}
                className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                <Phone className="h-3 w-3" />{l.effectivePhone}
              </a>
            )}
            {l.phoneSource === 'deal' && (
              <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" title="운영DB에 사용자 정보 없음 — CRM 결제자 연락처 사용">
                결제자
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {(l.member_count ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-teal-700 font-medium">
              <Users className="h-3 w-3" />{l.member_count}명 등록
            </span>
          )}
          {l.duration && <span>{l.duration}개월 · {l.user_count}명</span>}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className={`text-xs font-medium flex items-center gap-0.5 justify-end ${loginColor}`}>
          <LogIn className="h-3 w-3" />
          {loginDays !== null ? `${loginDays}일 전` : '미확인'}
        </p>
        <p className="text-[10px] text-muted-foreground">최근 접속</p>
      </div>
    </div>
  );
}

// ── 진행중 딜 섹션 (full-width, 정렬 가능 컬럼) ───────
type DealSortKey = 'date' | 'stage';
type SortDir = 'asc' | 'desc';
const STAGE_ORDER: Record<string, number> = Object.fromEntries(
  DEAL_STAGES.map((s, i) => [s, i])
);

function getDealLastDate(d: AirtableRecordOfDeal): string | null {
  const f = d.fields;
  const dates = [
    f.Quote_Date, f.Order_Date, f.Contract_Date, f.Payment_Date,
    f.Receipt_Date, f.License_Send_Date, f.Created_Date,
  ].filter(Boolean) as string[];
  return dates.length > 0
    ? dates.slice().sort().reverse()[0]
    : (d.createdTime?.split('T')[0] ?? null);
}

function ActiveDealsSection({
  deals, onDealClick,
}: {
  deals: AirtableRecordOfDeal[];
  onDealClick: (d: AirtableRecordOfDeal) => void;
}) {
  const [sortKey, setSortKey] = useState<DealSortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const expiredDeals = deals.filter(d => {
    const isQuoteStage = ['체험권', '견적', '계약체결/구매'].includes(d.fields.Deal_Stage ?? '');
    const quoteAge = d.fields.Quote_Date ? daysSince(d.fields.Quote_Date) : null;
    return isQuoteStage && quoteAge !== null && quoteAge > 28;
  });

  const sortedDeals = [...deals].sort((a, b) => {
    if (sortKey === 'date') {
      const dA = getDealLastDate(a) ?? '';
      const dB = getDealLastDate(b) ?? '';
      return sortDir === 'desc' ? dB.localeCompare(dA) : dA.localeCompare(dB);
    }
    // stage
    const sA = STAGE_ORDER[a.fields.Deal_Stage ?? ''] ?? 999;
    const sB = STAGE_ORDER[b.fields.Deal_Stage ?? ''] ?? 999;
    return sortDir === 'asc' ? sA - sB : sB - sA;
  });

  const handleSort = (key: DealSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  };

  const sortIcon = (key: DealSortKey) =>
    sortKey !== key ? '' : sortDir === 'asc' ? ' ↑' : ' ↓';

  return (
    <div className="surface-card ring-container overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Briefcase className="h-4 w-4" /> 진행중 딜
            {deals.length > 0 && (
              <span className="ml-1 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold px-2 py-0.5">
                {num(deals.length)}건
              </span>
            )}
            {expiredDeals.length > 0 && (
              <span className="ml-1 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold px-2 py-0.5">
                ⚠ {num(expiredDeals.length)}건 28일+
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            계약 진행 중인 딜 — 견적 후 28일 경과 시 빨간색 강조 (딜취소 검토 권장)
          </p>
        </div>
        <Link to="/deals" className="text-xs text-primary hover:underline flex items-center gap-1">
          전체 보기 <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {deals.length === 0 ? (
        <div className="px-5 py-8 text-center text-muted-foreground text-sm">진행중인 딜이 없습니다</div>
      ) : (
        <>
          {/* 컬럼 헤더 (정렬 가능) */}
          <div className="px-5 py-2 bg-muted/30 border-b border-border flex items-center gap-3 text-[11px] font-medium text-muted-foreground">
            <button
              onClick={() => handleSort('date')}
              className={`w-24 shrink-0 text-left hover:text-foreground transition-colors ${sortKey === 'date' ? 'text-foreground' : ''}`}>
              변경일{sortIcon('date')}
            </button>
            <span className="flex-1">학교 · 담당자 · 연락처</span>
            <button
              onClick={() => handleSort('stage')}
              className={`w-28 shrink-0 text-center hover:text-foreground transition-colors ${sortKey === 'stage' ? 'text-foreground' : ''}`}>
              단계{sortIcon('stage')}
            </button>
            <span className="w-24 shrink-0 text-right">금액</span>
          </div>

          <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
            {sortedDeals.map(d => <ActiveDealRow key={d.id} d={d} onClick={() => onDealClick(d)} />)}
          </div>
        </>
      )}
    </div>
  );
}

function ActiveDealRow({ d, onClick }: { d: AirtableRecordOfDeal; onClick: () => void }) {
  const f = d.fields;
  const stageLabel = DEAL_STAGE_LABELS[f.Deal_Stage ?? ''] ?? f.Deal_Stage ?? '-';
  const stageColor = STAGE_COLOR[f.Deal_Stage ?? ''] ?? 'bg-muted text-muted-foreground';

  const lastDate = getDealLastDate(d);
  const lastDays = lastDate ? daysSince(lastDate) : null;

  // 견적 28일 경과
  const isQuoteStage = ['체험권', '견적', '계약체결/구매'].includes(f.Deal_Stage ?? '');
  const quoteAge = f.Quote_Date ? daysSince(f.Quote_Date) : null;
  const expired = isQuoteStage && quoteAge !== null && quoteAge > 28;

  return (
    <div
      onClick={onClick}
      className={`px-5 py-2 flex items-center gap-3 hover:bg-muted/40 transition-colors cursor-pointer ${expired ? 'bg-red-50/40' : ''}`}>
      {/* 1. 변경일 (좌측 주요 지표) */}
      <div className="w-24 shrink-0">
        {lastDate ? (
          <>
            <p className="text-xs font-medium tabular-nums">{lastDate}</p>
            <p className="text-[10px] text-muted-foreground">
              {lastDays === 0 ? '오늘' : `${num(lastDays ?? 0)}일 전`}
            </p>
          </>
        ) : <span className="text-[10px] text-muted-foreground">—</span>}
      </div>

      {/* 2. 학교 · 담당자 · 연락처 (+ 메모) */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{f.Org_Name || f.Deal_Name || '-'}</span>
          {f.Contact_Name && <span className="text-xs text-muted-foreground">· {f.Contact_Name}</span>}
          {f.Contact_Phone && (
            <a href={`tel:${f.Contact_Phone}`}
              onClick={e => e.stopPropagation()}
              className="text-xs text-primary hover:underline flex items-center gap-0.5">
              <Phone className="h-3 w-3" />{f.Contact_Phone}
            </a>
          )}
          {expired && (
            <span className="text-[10px] text-red-600 font-semibold whitespace-nowrap">
              ⚠ 견적 {num(quoteAge ?? 0)}일+
            </span>
          )}
        </div>
        {f.Notes && (
          <p className="text-[11px] text-muted-foreground line-clamp-1" title={f.Notes}>
            💬 {f.Notes}
          </p>
        )}
      </div>

      {/* 3. 단계 */}
      <div className="w-28 shrink-0 flex justify-center">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stageColor} whitespace-nowrap`}>
          {stageLabel}
        </span>
      </div>

      {/* 4. 금액 */}
      <div className="w-24 shrink-0 text-right">
        {f.Final_Contract_Value != null && f.Final_Contract_Value > 0 ? (
          <p className="text-sm font-semibold tabular-nums">
            {f.Final_Contract_Value >= 10_000
              ? `${Math.round(f.Final_Contract_Value / 10_000).toLocaleString()}만`
              : f.Final_Contract_Value.toLocaleString()}
          </p>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
