import { useContacts, useDeals } from '@/hooks/use-airtable';
import { useQuery } from '@tanstack/react-query';
import { getAllLicenses } from '@/lib/storage';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { FlaskConical, Briefcase, TrendingUp, AlertCircle, Clock, ArrowRight, CheckCircle2, LogIn, Phone, Users } from 'lucide-react';
import { DEAL_STAGE_LABELS, STAGE_COLOR, normalizeStage } from '@/lib/grades';
import { Link } from 'react-router-dom';

const fmt = (n: number) =>
  n >= 100_000_000 ? `${(n / 100_000_000).toFixed(1)}억`
  : n >= 10_000    ? `${Math.round(n / 10_000)}만`
  : n.toLocaleString();

function dday(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function Dashboard() {
  const { data: contacts, isLoading: cl } = useContacts();
  const { data: deals,    isLoading: dl } = useDeals();
  const { data: licenses, isLoading: ll } = useQuery({
    queryKey: ['licenses'],
    queryFn: getAllLicenses,
  });

  const today     = new Date().toISOString().split('T')[0];
  const thisMonth = new Date().getMonth();
  const thisYear  = new Date().getFullYear();

  // ── 이용권 지표 ──────────────────────────────────────
  const allLics = licenses ?? [];

  // 사용중 체험권
  const activeTrials = allLics.filter(l => l.status === '사용중');

  // 만료 임박 D-30 이내 (만료일 있는 사용중)
  const expiringSoon = activeTrials
    .filter(l => l.service_expire_at && l.service_expire_at >= today)
    .map(l => ({ ...l, dd: dday(l.service_expire_at!) }))
    .filter(l => l.dd <= 30)
    .sort((a, b) => a.dd - b.dd);

  // D-7 이내 긴급
  const urgentCount = expiringSoon.filter(l => l.dd <= 7).length;

  // 만료됐지만 구매 미전환 (체험권 출처)
  const expiredUnconverted = allLics.filter(
    l => l.status === '만료' && l.deal_id === 'mdiary'
  );

  // 이번 달 신규 체험
  const newTrialsThisMonth = allLics.filter(l => {
    const d = new Date(l.created_at);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear && l.deal_id === 'mdiary';
  }).length;

  // ── 딜 지표 ─────────────────────────────────────────
  const thisMonthDeals = (deals ?? []).filter(d => {
    const date = d.fields.Contract_Date || d.fields.Payment_Date;
    if (!date) return false;
    const dt = new Date(date);
    return dt.getMonth() === thisMonth && dt.getFullYear() === thisYear;
  });
  const thisMonthRevenue = thisMonthDeals.reduce((sum, d) =>
    sum + (d.fields.Final_Contract_Value ?? 0), 0);

  // 진행중 딜 (계약 완료 제외)
  const activeDeals = (deals ?? [])
    .filter(d => !['입금완료', '딜취소', 'Closed_Won', 'Closed_Lost', 'Active_User', '완료', 'Won', '이탈', 'Lost'].includes(d.fields.Deal_Stage ?? ''))
    .sort((a, b) => (b.createdTime || '').localeCompare(a.createdTime || ''))
    .slice(0, 6);

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
          <p className="text-3xl font-bold tabular-nums">{activeTrials.length}</p>
          <p className="text-xs text-muted-foreground mt-1">이번 달 +{newTrialsThisMonth}건 신규</p>
        </div>

        <div className={`surface-card ring-container p-5 ${urgentCount > 0 ? 'border-red-200 bg-red-50/40' : ''}`}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground font-medium">만료 임박</p>
            <AlertCircle className={`h-4 w-4 ${urgentCount > 0 ? 'text-red-500' : 'text-amber-500'}`} />
          </div>
          <p className={`text-3xl font-bold tabular-nums ${urgentCount > 0 ? 'text-red-600' : ''}`}>
            {expiringSoon.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {urgentCount > 0 ? <span className="text-red-500 font-medium">D-7 이내 {urgentCount}건 긴급</span> : 'D-30 이내'}
          </p>
        </div>

        <div className="surface-card ring-container p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground font-medium">미전환 만료</p>
            <Clock className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-3xl font-bold tabular-nums text-muted-foreground">{expiredUnconverted.length}</p>
          <p className="text-xs text-muted-foreground mt-1">구매 전환 대기</p>
        </div>

        <div className="surface-card ring-container p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground font-medium">이번 달 매출</p>
            <TrendingUp className="h-4 w-4 text-teal-500" />
          </div>
          <p className="text-3xl font-bold tabular-nums">
            {thisMonthRevenue > 0 ? fmt(thisMonthRevenue) : thisMonthDeals.length + '건'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">계약 {thisMonthDeals.length}건</p>
        </div>
      </div>

      {/* 영업 액션 필요 — 핵심 섹션 */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              영업 액션 필요
              {expiringSoon.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold px-2 py-0.5">
                  {expiringSoon.length}건
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">만료 D-30 이내 체험권 — 갱신/구매 전환 영업 필요</p>
          </div>
          <div />
        </div>

        {expiringSoon.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-teal-400 mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">D-30 이내 만료 예정 없음</p>
          </div>
        ) : (
          <div className="overflow-y-auto max-h-[520px] grid grid-cols-1 lg:grid-cols-2">
            {expiringSoon.map(l => {
              const urgent = l.dd <= 7;
              const soon   = l.dd <= 14;
              const loginDays = l.admin_last_login ? daysSince(l.admin_last_login) : null;
              const loginColor =
                loginDays === null ? 'text-muted-foreground'
                : loginDays <= 7  ? 'text-teal-600'
                : loginDays <= 30 ? 'text-amber-600'
                : 'text-red-500';
              return (
                <div key={l.id} className={`px-4 py-3 flex gap-3 border-b border-border hover:bg-muted/30 transition-colors ${urgent ? 'bg-red-50/30' : ''}`}>
                  {/* D-day 뱃지 */}
                  <div className={`shrink-0 w-12 text-center rounded-lg py-1.5 h-fit ${
                    urgent ? 'bg-red-100 text-red-700' : soon ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    <div className="text-[10px] font-semibold">D-{l.dd}</div>
                    <div className="text-[10px] opacity-70">{l.service_expire_at?.slice(5)}</div>
                  </div>

                  {/* 메인 정보 */}
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* 그룹명 */}
                    <p className="font-medium text-sm truncate">
                      {l.group_name || l.org_name || '-'}
                    </p>
                    {/* 쿠폰 설명 (학교명 등) — group_name 있을 때 서브텍스트로 */}
                    {l.group_name && l.org_name && (
                      <p className="text-[11px] text-muted-foreground truncate">{l.org_name}</p>
                    )}
                    {/* 교육청 */}
                    {l.edu_office_name && (
                      <p className="text-[11px] text-muted-foreground truncate">{l.edu_office_name}</p>
                    )}
                    {/* 관리자 정보 */}
                    {(l.admin_name || l.admin_phone) && (
                      <div className="flex items-center gap-2 flex-wrap">
                        {l.admin_name && (
                          <span className="text-xs font-medium text-foreground">{l.admin_name} 선생님</span>
                        )}
                        {l.admin_phone && (
                          <a href={`tel:${l.admin_phone}`}
                            className="text-xs text-primary flex items-center gap-0.5 hover:underline">
                            <Phone className="h-3 w-3" />{l.admin_phone}
                          </a>
                        )}
                      </div>
                    )}
                    {/* 사용 현황 */}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      {(l.member_count ?? 0) > 0 && (
                        <span className="flex items-center gap-0.5 text-teal-700 font-medium">
                          <Users className="h-3 w-3" />{l.member_count}명 등록
                        </span>
                      )}
                      {l.duration && <span>{l.duration}개월 · {l.user_count}명</span>}
                    </div>
                  </div>

                  {/* 최근 로그인 */}
                  <div className="shrink-0 text-right">
                    <p className={`text-xs font-medium flex items-center gap-0.5 justify-end ${loginColor}`}>
                      <LogIn className="h-3 w-3" />
                      {loginDays !== null ? `${loginDays}일 전` : '미확인'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">최근 접속</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* 체험 파이프라인 */}
        <div className="surface-card ring-container p-5">
          <h2 className="font-semibold mb-1">체험 파이프라인</h2>
          <p className="text-xs text-muted-foreground mb-4">이용권 상태별 현황</p>
          <div className="space-y-2">
            {[
              { label: '대기 (미사용)',    count: allLics.filter(l => l.status === '대기').length,   color: 'bg-slate-200', text: 'text-slate-600' },
              { label: '사용중',          count: activeTrials.length,                                color: 'bg-teal-400',  text: 'text-teal-700' },
              { label: '만료 임박 D-30',  count: expiringSoon.length,                                color: 'bg-amber-400', text: 'text-amber-700' },
              { label: '만료 (미전환)',    count: expiredUnconverted.length,                          color: 'bg-orange-300',text: 'text-orange-700' },
              { label: '구매 고객',       count: (contacts ?? []).filter(c => ['구매','유지'].includes(normalizeStage(c.fields.Lead_Stage))).length, color: 'bg-primary', text: 'text-primary-foreground' },
            ].map(row => {
              const max = Math.max(...[activeTrials.length, allLics.filter(l=>l.status==='대기').length, expiredUnconverted.length], 1);
              const pct = Math.max(Math.round((row.count / max) * 100), row.count > 0 ? 4 : 0);
              return (
                <div key={row.label} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-xs text-muted-foreground text-right">{row.label}</div>
                  <div className="flex-1 bg-muted/40 rounded-full h-5 overflow-hidden">
                    <div className={`h-full rounded-full flex items-center justify-end pr-2 ${row.color} transition-all`}
                      style={{ width: `${pct}%` }}>
                      {row.count > 0 && <span className={`text-[11px] font-semibold ${row.text}`}>{row.count}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 진행중 딜 */}
        <div className="surface-card ring-container overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Briefcase className="h-4 w-4" /> 진행중 딜
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">계약 진행 중인 건</p>
            </div>
            <Link to="/deals" className="text-xs text-primary hover:underline flex items-center gap-1">
              전체 보기 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {activeDeals.length === 0 ? (
            <div className="px-5 py-8 text-center text-muted-foreground text-sm">진행중인 딜이 없습니다</div>
          ) : (
            <div className="divide-y divide-border">
              {activeDeals.map(d => {
                const stageLabel = DEAL_STAGE_LABELS[d.fields.Deal_Stage ?? ''] ?? d.fields.Deal_Stage;
                const stageColor = STAGE_COLOR[d.fields.Deal_Stage ?? ''] ?? 'bg-muted text-muted-foreground';
                return (
                  <div key={d.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{d.fields.Org_Name || d.fields.Deal_Name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.fields.Contact_Name}
                        {d.fields.Final_Contract_Value && ` · ${fmt(d.fields.Final_Contract_Value)}`}
                      </p>
                    </div>
                    <span className={`shrink-0 ml-3 rounded-full px-2 py-0.5 text-[11px] font-medium ${stageColor}`}>
                      {stageLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
