// 행사별 깔때기 — `/leads/funnel` (LEAD-S4 · CRM-018)
//
// 브리프 F항: 방문(리드) → 체험권 발송 → 사용 → 만료 → 구매를 **행사 단위로** 본다.
// EDUtech 은 체험권 10건 전원 발송에 사용 0·구매 0 이었다 — 그 모양이 보여야 한다.
//
// 계산은 전부 `src/lib/leadFunnel.ts` 의 순수 함수가 한다. DB 를 더 부르지 않고
// 이미 받아 둔 목록을 쓴다. **분모·분자의 뜻은 화면 하단에 그대로 보여 준다** —
// 적어 두지 않으면 "전환율 40%" 가 무엇의 40% 인지 알 수 없다.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { ArrowLeft, Mail } from 'lucide-react';

import { getCampaignNames, getLeads, type LeadRow } from '@/lib/leadsApi';
import {
  CONVERSION_STEPS, FUNNEL_BASIS, funnelsByEvent, pct, type FunnelSummary,
} from '@/lib/leadFunnel';
import { LEAD_TYPES, LEAD_TYPE_LABEL, toLeadType } from '@/lib/leadType';
import { MARKET_LABEL, toMarket } from '@/lib/leadMarket';
import { countryLabel } from '@/lib/countries';
import { todayKst } from '@/lib/leadFollowup';

const ALL = '__all__';

export default function LeadFunnel() {
  const today = todayKst();
  const { data: leads, isLoading } = useQuery({ queryKey: ['leads_all'], queryFn: getLeads });
  const { data: campaigns } = useQuery({ queryKey: ['campaign_names'], queryFn: getCampaignNames });

  const campaignName = useMemo(() => {
    const m = new Map<string, string>();
    (campaigns ?? []).forEach(c => m.set(c.id, c.name));
    return m;
  }, [campaigns]);

  const [fMarket, setFMarket] = useState(ALL);
  const [fCountry, setFCountry] = useState(ALL);
  const [fType, setFType] = useState(ALL);
  const [fOwner, setFOwner] = useState(ALL);

  const countries = useMemo(
    () => [...new Set((leads ?? []).map(l => l.country).filter(Boolean) as string[])].sort(),
    [leads]);
  const owners = useMemo(
    () => [...new Set((leads ?? []).map(l => l.owner).filter(Boolean) as string[])].sort(),
    [leads]);

  const filtered = useMemo(() => (leads ?? []).filter(l => {
    if (fMarket !== ALL && toMarket(l.market) !== fMarket) return false;
    if (fCountry !== ALL && (l.country ?? '') !== fCountry) return false;
    if (fType === 'none' && toLeadType(l.lead_type)) return false;
    if (fType !== ALL && fType !== 'none' && toLeadType(l.lead_type) !== fType) return false;
    if (fOwner !== ALL && (l.owner ?? '') !== fOwner) return false;
    return true;
  }), [leads, fMarket, fCountry, fType, fOwner]);

  const funnels = useMemo(
    () => funnelsByEvent(filtered, today, campaignName), [filtered, today, campaignName]);

  if (isLoading) return <div className="p-6"><DataTableSkeleton /></div>;

  const reset = () => { setFMarket(ALL); setFCountry(ALL); setFType(ALL); setFOwner(ALL); };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link to="/leads" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" />리드 관리
        </Link>
        <h1 className="text-xl font-semibold mt-0.5">행사별 깔때기</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          행사마다 어디까지 진행됐는지, 어디서 막혔는지 봅니다.
          리드 {filtered.length}건 · 행사 {funnels.length}개
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Pick label="시장" value={fMarket} onChange={setFMarket}
          options={[['KR', MARKET_LABEL.KR], ['INTL', MARKET_LABEL.INTL]]} />
        <Pick label="국가" value={fCountry} onChange={setFCountry}
          options={countries.map(c => [c, countryLabel(c)])} />
        <Pick label="유형" value={fType} onChange={setFType}
          options={[...LEAD_TYPES.map(t => [t, LEAD_TYPE_LABEL[t]] as [string, string]),
                    ['none', '미분류']]} />
        <Pick label="담당자" value={fOwner} onChange={setFOwner}
          options={owners.map(o => [o, o])} />
        <Button variant="ghost" size="sm" onClick={reset}>초기화</Button>
      </div>

      {funnels.length === 0
        ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            조건에 맞는 리드가 없습니다.
          </div>
        )
        : <div className="space-y-5">{funnels.map(f => <EventCard key={f.event} f={f} />)}</div>}

      {/* 숫자의 뜻 — 요구 S4-2 "분모·분자를 화면 하단에 한 줄로" */}
      <p className="text-xs text-muted-foreground border-t pt-3">{FUNNEL_BASIS}</p>
    </div>
  );
}

function EventCard({ f }: { f: FunnelSummary }) {
  const maxReached = Math.max(...f.steps.map(s => s.reached), 1);

  return (
    <section className="rounded-lg border p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{f.event}</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>리드 <strong className="text-foreground">{f.total}</strong></span>
          <span>아직 연락 안 함 <strong className="text-foreground">{f.untouched}</strong></span>
          <span>성사 <strong className="text-foreground">{f.won}</strong></span>
          <span>종료·보류 <strong className="text-foreground">{f.lost}</strong></span>
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3 w-3" />메일 발송 가능 <strong className="text-foreground">{f.mailable}</strong>
          </span>
        </div>
      </div>

      {/* 전환 깔때기 */}
      <div>
        <div className="text-xs font-medium mb-1.5">전환</div>
        <div className="space-y-1">
          {f.steps.map((s, i) => (
            <div key={s.step} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-muted-foreground">{s.step}</span>
              <span className="flex-1 h-5 bg-muted rounded overflow-hidden">
                <span className="block h-full bg-primary/60"
                  style={{ width: `${(s.reached / maxReached) * 100}%` }} />
              </span>
              <span className="w-10 text-right tabular-nums">{s.reached}</span>
              <span className="w-12 text-right tabular-nums text-muted-foreground"
                title={i === 0 ? '전체 대비' : '앞 단계 대비'}>
                {pct(s.stepRate)}
              </span>
              <span className="w-12 text-right tabular-nums text-muted-foreground"
                title="전체 대비">
                {pct(s.overallRate)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
          <span className="w-24 shrink-0" />
          <span className="flex-1" />
          <span className="w-10 text-right">인원</span>
          <span className="w-12 text-right">단계</span>
          <span className="w-12 text-right">전체</span>
        </div>
      </div>

      {/* 단계별 인원·체류일 */}
      <div>
        <div className="text-xs font-medium mb-1.5">단계별 인원과 평균 체류일</div>
        <div className="flex flex-wrap gap-1.5">
          {f.stages.map(s => (
            <div key={s.stage} className="rounded border px-2 py-1 text-xs">
              <span>{s.stage}</span>
              <strong className="ml-1.5 tabular-nums">{s.count}</strong>
              {s.avgDays !== null && (
                <span className="ml-1.5 text-muted-foreground">평균 {s.avgDays}일</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 분포 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Dist title="지역" rows={f.byRegion.map(r => [r.label, r.count])} />
        <Dist title="국가" rows={f.byCountry.slice(0, 8).map(r => [countryLabel(r.country, '(없음)'), r.count])} />
        <Dist title="유형" rows={f.byType.map(r => [r.label, r.count])} />
      </div>
    </section>
  );
}

function Dist({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return (
    <div>
      <div className="text-xs font-medium mb-1">{title}</div>
      {rows.length === 0
        ? <p className="text-xs text-muted-foreground">—</p>
        : (
          <ul className="space-y-0.5">
            {rows.map(([label, n]) => (
              <li key={label} className="flex justify-between text-xs">
                <span className="truncate text-muted-foreground">{label}</span>
                <span className="tabular-nums ml-2">{n}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function Pick({ label, value, onChange, options }: {
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
