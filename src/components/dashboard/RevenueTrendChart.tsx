// 매출 추이 차트 — 1~12월 X축에 작년/올해 막대 2개 클러스터 (현금주의)
// 작년 데이터: prior_year_revenue 테이블 (부가세 신고 기반 SEED)
// 올해 데이터: deals.Payment_Date 월별 합계
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PriorRow { month: number; amount: number }
interface DealLite {
  fields: {
    Payment_Date?: string;
    Final_Contract_Value?: number;
  };
}

interface Props {
  deals: DealLite[];
  priorYearRows: PriorRow[];
  currentYear: number;
  /** 현재 월 (0-indexed). 누계/전월비 계산용 */
  currentMonth: number;
}

interface ChartRow {
  label: string;
  monthIdx: number;
  작년: number;
  이번해: number;
  count: number;
  yoy: number | null;
}

const fmtKRW = (n: number) => n >= 10000000
  ? `${(n / 10000000).toFixed(1)}천만`
  : n >= 10000
  ? `${Math.round(n / 10000).toLocaleString()}만`
  : n.toLocaleString();

const fmtFull = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function RevenueTrendChart({ deals, priorYearRows, currentYear, currentMonth }: Props) {
  // 1) 올해 월별 합계 + 입금건수
  const thisYear: number[] = Array(12).fill(0);
  const thisYearCount: number[] = Array(12).fill(0);
  for (const d of deals) {
    const date = d.fields.Payment_Date;
    if (!date) continue;
    const dt = new Date(date);
    if (dt.getFullYear() !== currentYear) continue;
    thisYear[dt.getMonth()] += d.fields.Final_Contract_Value ?? 0;
    thisYearCount[dt.getMonth()] += 1;
  }

  // 2) 작년 월별
  const lastYear: number[] = Array(12).fill(0);
  for (const r of priorYearRows) {
    const idx = r.month - 1;
    if (idx >= 0 && idx < 12) lastYear[idx] = Number(r.amount) || 0;
  }

  // 3) 차트 데이터
  const chartData: ChartRow[] = Array.from({ length: 12 }, (_, i) => {
    const cur = thisYear[i];
    const prev = lastYear[i];
    const yoy = prev > 0 ? ((cur - prev) / prev) * 100 : null;
    return { label: `${i + 1}월`, monthIdx: i, 작년: prev, 이번해: cur, count: thisYearCount[i], yoy };
  });

  // 4) KPI
  const cumThisYear = thisYear.reduce((s, v) => s + v, 0);
  // 작년 동기간 누계 (1월 ~ currentMonth)
  const cumLastYearSamePeriod = lastYear.slice(0, currentMonth + 1).reduce((s, v) => s + v, 0);
  const cumYoY = cumLastYearSamePeriod > 0
    ? ((cumThisYear - cumLastYearSamePeriod) / cumLastYearSamePeriod) * 100
    : null;
  const monthsElapsed = thisYear.slice(0, currentMonth + 1).filter(v => v > 0).length || 1;
  const avg = Math.round(cumThisYear / monthsElapsed);
  // 전월비 — 가장 최근 매출 발생 월 vs 그 직전 매출 발생 월
  let mom: number | null = null;
  for (let i = currentMonth; i >= 1; i--) {
    if (thisYear[i] > 0) {
      // i 이전에서 0보다 큰 월 찾기
      for (let j = i - 1; j >= 0; j--) {
        if (thisYear[j] > 0) {
          mom = ((thisYear[i] - thisYear[j]) / thisYear[j]) * 100;
          break;
        }
      }
      break;
    }
  }

  return (
    <div className="surface-card ring-container p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-teal-500" />
            매출 추이 <span className="text-xs text-muted-foreground font-normal">· 입금일 기준 ({currentYear}년)</span>
          </h2>
        </div>
      </div>

      {/* KPI 영역 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground mb-1">{currentYear}년 누계</p>
          <p className="text-lg font-bold tabular-nums">{fmtFull(cumThisYear)}</p>
          {cumYoY !== null ? (
            <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${cumYoY > 0 ? 'text-teal-700' : cumYoY < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
              {cumYoY > 0 ? <TrendingUp className="h-3 w-3" /> : cumYoY < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              YoY {cumYoY > 0 ? '+' : ''}{cumYoY.toFixed(1)}% (작년 동기간 {fmtFull(cumLastYearSamePeriod)})
            </p>
          ) : (
            <p className="text-[11px] mt-0.5 text-muted-foreground">작년 동기간 데이터 없음</p>
          )}
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground mb-1">월평균</p>
          <p className="text-lg font-bold tabular-nums">{fmtFull(avg)}</p>
          <p className="text-[11px] mt-0.5 text-muted-foreground">매출 발생 {monthsElapsed}개월 평균</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3 col-span-2 md:col-span-1">
          <p className="text-xs text-muted-foreground mb-1">전월비 (MoM)</p>
          {mom !== null ? (
            <p className={`text-lg font-bold tabular-nums flex items-center gap-1 ${mom > 0 ? 'text-teal-700' : mom < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
              {mom > 0 ? <TrendingUp className="h-4 w-4" /> : mom < 0 ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
              {mom > 0 ? '+' : ''}{mom.toFixed(1)}%
            </p>
          ) : (
            <p className="text-lg font-bold text-muted-foreground">—</p>
          )}
          <p className="text-[11px] mt-0.5 text-muted-foreground">최근 매출월 / 직전 매출월</p>
        </div>
      </div>

      {/* 차트 */}
      <div className="w-full" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v) => fmtKRW(Number(v))}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as ChartRow;
                return (
                  <div className="bg-popover border border-border rounded-md shadow-md px-3 py-2 text-xs space-y-0.5 min-w-[180px]">
                    <p className="font-semibold mb-1">{currentYear}년 {label}</p>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">작년</span>
                      <span className="tabular-nums">{fmtFull(row.작년)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-teal-700 font-medium">이번해</span>
                      <span className="tabular-nums font-semibold">{fmtFull(row.이번해)}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-muted-foreground">
                      <span>입금건수</span>
                      <span>{row.count}건</span>
                    </div>
                    {row.yoy !== null && (
                      <div className={`flex justify-between gap-3 pt-1 mt-1 border-t border-border ${row.yoy > 0 ? 'text-teal-700' : row.yoy < 0 ? 'text-red-600' : ''}`}>
                        <span className="font-medium">YoY</span>
                        <span className="font-semibold tabular-nums">{row.yoy > 0 ? '+' : ''}{row.yoy.toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="rect"
              iconSize={10}
              wrapperStyle={{ fontSize: 11 }}
            />
            <Bar dataKey="작년" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
            <Bar dataKey="이번해" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
