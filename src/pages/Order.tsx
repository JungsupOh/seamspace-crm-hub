import { useState, useEffect, useRef } from 'react';
import { loadPaymentWidget, PaymentWidgetInstance } from '@tosspayments/payment-widget-sdk';
import { searchSchools, SchoolInfo } from '@/lib/neis';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Search, ChevronRight, CheckCircle2, Loader2,
  School, User, Phone, Mail, Building2, Sparkles, Tag,
} from 'lucide-react';
import { nanoid } from 'nanoid';

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq';

// ── 플랜 정의 ──────────────────────────────────────
type PlanKey = '학급' | '학년' | '학교(소)' | '학교(중)' | '학교(대)';

interface PlanDef {
  id: PlanKey;
  label: string;
  shortLabel: string;
  capacity: string;
  badge?: string;
  multiLicense: boolean;
}

const PLANS: PlanDef[] = [
  { id: '학급',     label: '학급 플랜',      shortLabel: '학급',      capacity: '최대 40명',      multiLicense: false },
  { id: '학년',     label: '학년 플랜',      shortLabel: '학년',      capacity: '최대 200명',     badge: '인기', multiLicense: true },
  { id: '학교(소)', label: '학교 플랜 (소)', shortLabel: '학교(소)', capacity: '최대 500명',    multiLicense: true },
  { id: '학교(중)', label: '학교 플랜 (중)', shortLabel: '학교(중)', capacity: '최대 1,000명', multiLicense: true },
  { id: '학교(대)', label: '학교 플랜 (대)', shortLabel: '학교(대)', capacity: '무제한',        multiLicense: true },
];

// 인원수로 적합 플랜 찾기
const PLAN_CAPACITY: Record<PlanKey, number> = {
  '학급': 40, '학년': 200, '학교(소)': 500, '학교(중)': 1000, '학교(대)': 99999,
};

function recommendPlan(students: number): PlanKey {
  for (const plan of PLANS) {
    if (students <= PLAN_CAPACITY[plan.id]) return plan.id;
  }
  return '학교(대)';
}

// ── 가격표 (공급가액, VAT 별도) ─────────────────────
const REG: Record<number, Record<PlanKey, number>> = {
  1:  { '학급':  40000, '학년':  180000, '학교(소)':  440000, '학교(중)':  850000, '학교(대)':  1200000 },
  4:  { '학급': 150000, '학년':  700000, '학교(소)': 1700000, '학교(중)': 3300000, '학교(대)':  4600000 },
  6:  { '학급': 200000, '학년': 1000000, '학교(소)': 2500000, '학교(중)': 4800000, '학교(대)':  6500000 },
  12: { '학급': 390000, '학년': 1950000, '학교(소)': 4800000, '학교(중)': 9500000, '학교(대)': 11000000 },
};

// 이벤트 가격 (6개월 / 12개월) — 2026-03-31 까지
const EVT: Record<number, Record<PlanKey, number>> = {
  6:  { '학급': 180000, '학년':  780000, '학교(소)': 1980000, '학교(중)': 3780000, '학교(대)':  4980000 },
  12: { '학급': 280000, '학년': 1180000, '학교(소)': 2880000, '학교(중)': 5680000, '학교(대)':  6580000 },
};

const EVENT_END = new Date('2026-04-01');
const IS_EVENT = new Date() < EVENT_END;

function getUnitPrice(months: number, plan: PlanKey): { price: number; isEvent: boolean } {
  if (IS_EVENT && EVT[months]?.[plan] != null) return { price: EVT[months][plan], isEvent: true };
  return { price: REG[months]?.[plan] ?? 0, isEvent: false };
}

// ── 스마트 기간 추천 ────────────────────────────────
interface Suggestion {
  months: number;
  total: number;
  label: string;
  breakdown: string;
  isEvent: boolean;
  recommended: boolean;
}

function getSuggestions(targetMonths: number, plan: PlanKey): Suggestion[] {
  if (targetMonths <= 0 || targetMonths > 60) return [];
  const periods = [12, 6, 4, 1];

  // DP — 최저 비용 조합 탐색
  const dp: { cost: number; combo: number[] }[] = Array.from(
    { length: targetMonths + 1 }, () => ({ cost: Infinity, combo: [] })
  );
  dp[0] = { cost: 0, combo: [] };
  for (let i = 1; i <= targetMonths; i++) {
    for (const p of periods) {
      if (p > i) continue;
      const { price } = getUnitPrice(p, plan);
      if (!price) continue;
      const c = dp[i - p].cost + price;
      if (c < dp[i].cost) dp[i] = { cost: c, combo: [...dp[i - p].combo, p] };
    }
  }

  const results: Suggestion[] = [];

  // 정확한 조합
  if (dp[targetMonths].cost < Infinity) {
    const grouped: Record<number, number> = {};
    for (const m of dp[targetMonths].combo) grouped[m] = (grouped[m] ?? 0) + 1;
    const breakdown = Object.entries(grouped)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([m, q]) => `${m}개월${q > 1 ? ` × ${q}` : ''}`)
      .join(' + ');
    results.push({ months: targetMonths, total: dp[targetMonths].cost, label: `${targetMonths}개월 구성`, breakdown, isEvent: false, recommended: false });
  }

  // 가장 가까운 상위 기간으로 올림 (더 저렴하면 추천)
  for (const roundUp of [6, 12]) {
    if (roundUp > targetMonths) {
      const { price, isEvent } = getUnitPrice(roundUp, plan);
      const exactCost = dp[targetMonths].cost;
      const saving = exactCost < Infinity ? exactCost - price : 0;
      results.push({
        months: roundUp,
        total: price,
        label: `${roundUp}개월${isEvent ? ' (이벤트)' : ''}`,
        breakdown: saving > 0 ? `조합 대비 ${fmt(saving)} 절약` : `${roundUp - targetMonths}개월 추가 이용`,
        isEvent,
        recommended: saving > 0 || exactCost === Infinity,
      });
      break;
    }
  }

  results.sort((a, b) => a.total - b.total);
  if (results.length > 0) results[0].recommended = true;
  return results;
}

function fmt(n: number) { return n.toLocaleString('ko-KR') + '원'; }

// ── 단계 표시 ──────────────────────────────────────
function StepBar({ step }: { step: number }) {
  const steps = ['기관 정보', '플랜 선택', '결제'];
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors
            ${i + 1 === step ? 'bg-primary text-primary-foreground' :
              i + 1 < step ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
              ${i + 1 === step ? 'bg-white/30' : i + 1 < step ? 'bg-primary text-white' : 'bg-muted-foreground/20'}`}>
              {i + 1 < step ? '✓' : i + 1}
            </span>
            {s}
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className={`h-4 w-4 mx-1 ${i + 1 < step ? 'text-primary' : 'text-muted-foreground/30'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── 학교 검색 ──────────────────────────────────────
function SchoolSearch({ onSelect }: { onSelect: (s: SchoolInfo) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SchoolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const doSearch = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try { const r = await searchSchools(q); setResults(r); setOpen(true); }
    catch { setResults([]); }
    finally { setLoading(false); }
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input value={q} onChange={e => { setQ(e.target.value); setOpen(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } }}
          placeholder="학교명으로 검색 (예: 서울초등학교)" className="h-11" />
        <Button type="button" onClick={doSearch} disabled={loading} className="h-11 px-4 shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border bg-background shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto divide-y divide-border">
            {results.map((s, i) => (
              <button key={i} type="button"
                onClick={() => { onSelect(s); setOpen(false); setQ(s.name); }}
                className="w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{s.kind}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{s.eduOffice} · {s.address}</p>
              </button>
            ))}
          </div>
        </div>
      )}
      {open && results.length === 0 && !loading && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border bg-background shadow-xl px-4 py-3 text-sm text-muted-foreground">
          검색 결과가 없습니다.
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────
interface OrderInfo {
  school: SchoolInfo | null;
  orgName: string;
  contactName: string;
  phone: string;
  email: string;
  planId: PlanKey;
  months: number;
  qty: number;
}

const DEFAULT_MONTHS = IS_EVENT ? 6 : 12;

export default function Order() {
  const [step, setStep]     = useState(1);
  const [info, setInfo]     = useState<OrderInfo>({
    school: null, orgName: '', contactName: '', phone: '', email: '',
    planId: '학년', months: DEFAULT_MONTHS, qty: 1,
  });
  const [showCustom, setShowCustom]     = useState(false);
  const [customMonths, setCustomMonths] = useState('');
  const [aiTab, setAiTab]               = useState(false);  // AI추천 탭 활성 여부
  const [aiStudents, setAiStudents]     = useState('');     // AI추천: 원하는 인원수
  const [aiMonths, setAiMonths]         = useState('');     // AI추천: 원하는 기간(개월)
  const [payWidget, setPayWidget]       = useState<PaymentWidgetInstance | null>(null);
  const [widgetLoading, setWidgetLoading] = useState(false);
  const [agreementRef, setAgreementRef] = useState<ReturnType<PaymentWidgetInstance['renderAgreement']> | null>(null);
  const paymentMethodRef = useRef<HTMLDivElement>(null);
  const agreementDivRef  = useRef<HTMLDivElement>(null);
  const orderIdRef       = useRef(nanoid());

  const activePlan = PLANS.find(p => p.id === info.planId) ?? PLANS[1];
  const { price: unitPrice, isEvent: priceIsEvent } = getUnitPrice(info.months, info.planId);
  const supply = unitPrice * info.qty;
  const tax    = Math.round(supply * 0.1);
  const total  = supply + tax;

  const customNum = parseInt(customMonths, 10);
  const suggestions = (!isNaN(customNum) && customNum > 0) ? getSuggestions(customNum, info.planId) : [];

  // AI추천 계산
  const aiStudentsNum = parseInt(aiStudents, 10);
  const aiMonthsNum   = parseInt(aiMonths, 10);
  const aiRecommendedPlan = (!isNaN(aiStudentsNum) && aiStudentsNum > 0)
    ? recommendPlan(aiStudentsNum) : null;
  const aiSuggestions = (aiRecommendedPlan && !isNaN(aiMonthsNum) && aiMonthsNum > 0)
    ? getSuggestions(aiMonthsNum, aiRecommendedPlan) : [];

  // 결제 위젯 초기화 (step 3 진입 시)
  useEffect(() => {
    if (step !== 3) return;
    setWidgetLoading(true);
    const customerKey = `cus_${nanoid(12)}`;
    loadPaymentWidget(TOSS_CLIENT_KEY, customerKey)
      .then(async widget => {
        await widget.renderPaymentMethods('#toss-payment-widget', { value: total });
        const ag = await widget.renderAgreement('#toss-agreement-widget');
        setAgreementRef(ag);
        setPayWidget(widget);
      })
      .catch(e => console.error('위젯 로드 실패', e))
      .finally(() => setWidgetLoading(false));
  }, [step]);

  useEffect(() => {
    if (!payWidget) return;
    payWidget.updateAmount(total);
  }, [total, payWidget]);

  // 플랜 변경 시 qty 리셋
  const selectPlan = (planId: PlanKey) => {
    const plan = PLANS.find(p => p.id === planId)!;
    setInfo(prev => ({ ...prev, planId, qty: 1, months: !plan.multiLicense && showCustom ? DEFAULT_MONTHS : prev.months }));
    setShowCustom(false);
    setCustomMonths('');
  };

  const handlePay = async () => {
    if (!payWidget) return;
    try {
      const agreed = await agreementRef?.isAgreed?.();
      if (agreed === false) { alert('이용약관에 동의해 주세요.'); return; }
      await payWidget.requestPayment({
        orderId: orderIdRef.current,
        orderName: `${info.orgName} · ${activePlan.label} ${info.months}개월${info.qty > 1 ? ` × ${info.qty}` : ''}`,
        customerName: info.contactName,
        customerEmail: info.email || undefined,
        customerMobilePhone: info.phone.replace(/\D/g, ''),
        successUrl: `${window.location.origin}/order/complete`,
        failUrl: `${window.location.origin}/order/fail`,
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'USER_CANCEL') alert('결제 중 오류가 발생했습니다. 다시 시도해 주세요.');
    }
  };

  const step1Valid = info.orgName.trim() && info.contactName.trim() && info.phone.trim();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* 헤더 */}
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm">m</div>
            <span className="font-semibold text-base">mDiary for Schools</span>
          </div>
          <a href="https://seamspace.co.kr" target="_blank" rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">서비스 소개 →</a>
        </div>
      </header>

      {/* 이벤트 배너 */}
      {IS_EVENT && (
        <div className="bg-gradient-to-r from-pink-500 to-purple-600 text-white text-center py-2.5 px-4 text-sm font-medium">
          <Sparkles className="inline h-4 w-4 mr-1.5 mb-0.5" />
          신학기 이벤트 진행 중 — 최대 40% 할인 (~ 2026. 3. 31.)
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">이용권 구매</h1>
          <p className="text-muted-foreground text-sm">
            기관 정보를 입력하고 원하는 플랜을 선택하면<br />결제 즉시 이용권이 발급됩니다.
          </p>
        </div>

        <StepBar step={step} />

        {/* ── Step 1: 기관/담당자 정보 ───────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <School className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-base">기관 정보</h2>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">학교/기관 검색</Label>
              <SchoolSearch onSelect={s => setInfo(p => ({ ...p, school: s, orgName: s.name }))} />
              {info.school && (
                <div className="flex items-center gap-1.5 text-xs text-teal-700 bg-teal-50 px-3 py-1.5 rounded-lg mt-1">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  {info.school.eduOffice} · {info.school.address}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">기관명 <span className="text-muted-foreground font-normal">(학교 검색 후 자동입력)</span></Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={info.orgName} onChange={e => setInfo(p => ({ ...p, orgName: e.target.value }))}
                  placeholder="○○초등학교" className="pl-9 h-11" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">담당자 이름 *</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={info.contactName} onChange={e => setInfo(p => ({ ...p, contactName: e.target.value }))}
                    placeholder="홍길동" className="pl-9 h-11" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">휴대폰 번호 *</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input value={info.phone} onChange={e => setInfo(p => ({ ...p, phone: e.target.value }))}
                    placeholder="010-1234-5678" className="pl-9 h-11" type="tel" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">이메일 <span className="text-muted-foreground font-normal">(선택 · 영수증 발송)</span></Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={info.email} onChange={e => setInfo(p => ({ ...p, email: e.target.value }))}
                  placeholder="example@school.kr" className="pl-9 h-11" type="email" />
              </div>
            </div>

            <Button className="w-full h-12 text-base mt-2" disabled={!step1Valid} onClick={() => setStep(2)}>
              다음 — 플랜 선택 <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Step 2: 플랜 선택 ──────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            {/* 플랜 탭 */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
              {/* 탭 헤더 */}
              <div className="flex border-b overflow-x-auto">
                {/* AI추천 탭 */}
                <button type="button" onClick={() => { setAiTab(true); }}
                  className={`relative flex-1 min-w-[72px] py-3 px-2 text-center text-xs font-medium transition-colors whitespace-nowrap
                    ${aiTab
                      ? 'text-purple-600 border-b-2 border-purple-500 bg-purple-50/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}>
                  ✨ AI추천
                </button>
                {PLANS.map(p => (
                  <button key={p.id} type="button" onClick={() => { selectPlan(p.id); setAiTab(false); }}
                    className={`relative flex-1 min-w-[60px] py-3 px-2 text-center text-xs font-medium transition-colors whitespace-nowrap
                      ${!aiTab && info.planId === p.id
                        ? 'text-primary border-b-2 border-primary bg-primary/5'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}>
                    {p.shortLabel}
                    {p.badge && (
                      <span className="absolute top-1 right-1 text-[8px] bg-orange-500 text-white px-1 py-0.5 rounded-full leading-none">
                        {p.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── AI추천 탭 내용 ── */}
              {aiTab ? (
                <div className="p-5 space-y-5">
                  <div className="flex items-center gap-2 text-purple-700">
                    <span className="text-lg">✨</span>
                    <p className="font-semibold text-sm">인원수와 기간을 입력하면 최적 플랜을 추천해드립니다</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">학생 수 (명)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" value={aiStudents} onChange={e => setAiStudents(e.target.value)}
                          placeholder="예: 150" className="h-10" min={1} />
                        <span className="text-sm text-muted-foreground shrink-0">명</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">이용 기간 (개월)</Label>
                      <div className="flex items-center gap-1.5">
                        <Input type="number" value={aiMonths} onChange={e => setAiMonths(e.target.value)}
                          placeholder="예: 6" className="h-10" min={1} max={60} />
                        <span className="text-sm text-muted-foreground shrink-0">개월</span>
                      </div>
                    </div>
                  </div>

                  {aiRecommendedPlan && (
                    <div className="bg-purple-50 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-600 font-semibold text-sm">추천 플랜</span>
                        <span className="bg-purple-600 text-white text-xs px-2.5 py-0.5 rounded-full font-medium">
                          {PLANS.find(p => p.id === aiRecommendedPlan)?.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {PLAN_CAPACITY[aiRecommendedPlan] === 99999 ? '무제한' : `최대 ${PLAN_CAPACITY[aiRecommendedPlan].toLocaleString()}명`}
                        </span>
                      </div>

                      {aiSuggestions.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground font-medium">최적 구매 방법</p>
                          {aiSuggestions.map((s, i) => (
                            <button key={i} type="button"
                              onClick={() => {
                                selectPlan(aiRecommendedPlan);
                                setInfo(prev => ({ ...prev, months: s.months }));
                                setAiTab(false);
                              }}
                              className={`w-full text-left rounded-xl border-2 p-3.5 transition-all
                                ${s.recommended
                                  ? 'border-purple-400 bg-white hover:border-purple-500'
                                  : 'border-border bg-white hover:border-primary/40'}`}>
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-sm">{s.label}</span>
                                    {s.recommended && <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full">추천</span>}
                                    {s.isEvent && <span className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full">이벤트</span>}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{s.breakdown}</p>
                                </div>
                                <div className="text-right shrink-0 ml-3">
                                  <p className={`font-bold text-sm ${s.recommended ? 'text-purple-700' : ''}`}>{fmt(s.total)}</p>
                                  <p className="text-[10px] text-muted-foreground">VAT 포함 {fmt(Math.round(s.total * 1.1))}</p>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : !isNaN(aiMonthsNum) && aiMonthsNum > 0 ? (
                        <p className="text-xs text-muted-foreground">계산 중...</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">이용 기간을 입력하면 최적 구매 방법을 추천해드립니다.</p>
                      )}
                    </div>
                  )}

                  {!aiRecommendedPlan && (
                    <p className="text-sm text-muted-foreground text-center py-4">학생 수를 입력하면 적합한 플랜을 찾아드립니다.</p>
                  )}
                </div>
              ) : (

              /* ── 플랜별 탭 내용 ── */
              <div className="p-5 space-y-5">
                {/* 플랜 설명 */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{activePlan.label}</p>
                    <p className="text-sm text-muted-foreground">{activePlan.capacity}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    activePlan.multiLicense
                      ? 'bg-teal-50 text-teal-700'
                      : 'bg-slate-100 text-slate-600'}`}>
                    {activePlan.multiLicense ? '수량 분할 발송 가능' : '이용권 1장 발송'}
                  </span>
                </div>

                {/* 이용 기간 선택 */}
                <div>
                  <Label className="text-sm font-medium mb-3 block">이용 기간</Label>

                  {/* 이벤트 기간 (이벤트 중일 때만) */}
                  {IS_EVENT && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-pink-600 mb-2">
                        <Sparkles className="h-3.5 w-3.5" />
                        신학기 이벤트 특가 (~ 3/31)
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {([6, 12] as const).map(m => (
                          <button key={m} type="button"
                            onClick={() => { setInfo(p => ({ ...p, months: m })); setShowCustom(false); }}
                            className={`relative rounded-xl border-2 p-3.5 text-left transition-all
                              ${info.months === m && !showCustom
                                ? 'border-pink-500 bg-pink-50 shadow-sm'
                                : 'border-pink-200 bg-pink-50/30 hover:border-pink-400'}`}>
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-semibold text-sm">{m === 6 ? '6개월' : '12개월'}</p>
                                <p className="text-[11px] text-muted-foreground">{m === 6 ? '1학기' : '1학기 + 2학기'}</p>
                              </div>
                              <span className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full leading-none mt-0.5">SALE</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground line-through mt-1.5">{fmt(REG[m][info.planId])}</p>
                            <p className="text-base font-bold text-pink-600">{fmt(EVT[m][info.planId])}</p>
                            {info.months === m && !showCustom && (
                              <CheckCircle2 className="absolute bottom-3 right-3 h-4 w-4 text-pink-500" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 일반 기간 */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {[1, 4].map(m => (
                      <button key={m} type="button"
                        onClick={() => { setInfo(p => ({ ...p, months: m })); setShowCustom(false); }}
                        className={`relative rounded-xl border-2 p-3.5 text-left transition-all
                          ${info.months === m && !showCustom
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-border hover:border-primary/40'}`}>
                        <p className="font-semibold text-sm">{m}개월</p>
                        <p className="text-base font-bold mt-1">{fmt(REG[m][info.planId])}</p>
                        {info.months === m && !showCustom && (
                          <CheckCircle2 className="absolute bottom-3 right-3 h-4 w-4 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* 직접 입력 토글 */}
                  <button type="button"
                    onClick={() => setShowCustom(v => !v)}
                    className={`w-full text-sm border rounded-xl py-2.5 transition-colors
                      ${showCustom
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 hover:text-primary'}`}>
                    {showCustom ? '직접 입력 닫기' : '+ 원하는 개월 수 직접 입력'}
                  </button>

                  {/* 직접 입력 + 추천 */}
                  {showCustom && (
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <Input type="number" value={customMonths}
                          onChange={e => setCustomMonths(e.target.value)}
                          placeholder="예: 9" className="h-10 w-28" min={1} max={60} />
                        <span className="text-sm text-muted-foreground">개월</span>
                      </div>

                      {suggestions.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground font-medium">최저가 구매 방법 추천</p>
                          {suggestions.map((s, i) => (
                            <button key={i} type="button"
                              onClick={() => { setInfo(p => ({ ...p, months: s.months })); setShowCustom(false); setCustomMonths(''); }}
                              className={`w-full text-left rounded-xl border-2 p-3.5 transition-all
                                ${s.recommended
                                  ? 'border-teal-400 bg-teal-50/60 hover:border-teal-500'
                                  : 'border-border hover:border-primary/40'}`}>
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-sm">{s.label}</span>
                                    {s.recommended && (
                                      <span className="text-[10px] bg-teal-500 text-white px-1.5 py-0.5 rounded-full">추천</span>
                                    )}
                                    {s.isEvent && (
                                      <span className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full">이벤트</span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{s.breakdown}</p>
                                </div>
                                <span className={`font-bold text-sm ${s.recommended ? 'text-teal-700' : ''}`}>{fmt(s.total)}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 이용권 수량 (학년플랜 이상) */}
                {activePlan.multiLicense && (
                  <div>
                    <Label className="text-sm font-medium mb-1 block">
                      이용권 수량
                      <span className="text-xs text-muted-foreground font-normal ml-1.5">(이용권 1장 = 그룹 1개 관리)</span>
                    </Label>
                    <div className="flex items-center gap-3 mt-2">
                      <button type="button"
                        onClick={() => setInfo(p => ({ ...p, qty: Math.max(1, p.qty - 1) }))}
                        className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">−</button>
                      <span className="w-12 text-center font-bold text-xl">{info.qty}</span>
                      <button type="button"
                        onClick={() => setInfo(p => ({ ...p, qty: Math.min(30, p.qty + 1) }))}
                        className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">+</button>
                      <span className="text-sm text-muted-foreground">장</span>
                    </div>
                  </div>
                )}
              </div>
              )} {/* end aiTab ? ... : (...) */}
            </div>

            {/* 금액 요약 — AI추천 탭에서는 숨김 */}
            {!aiTab && (<>
            <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground">결제 금액 미리보기</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">플랜</span>
                  <span>{activePlan.label} · {info.months}개월{info.qty > 1 ? ` × ${info.qty}장` : ''}</span>
                </div>
                {priceIsEvent && (
                  <div className="flex justify-between text-pink-600 text-xs">
                    <span className="flex items-center gap-1"><Tag className="h-3 w-3" />이벤트 할인 적용</span>
                    <span>정가 {fmt(REG[info.months]?.[info.planId] * info.qty ?? 0)} → {fmt(supply)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">공급가액</span>
                  <span>{fmt(supply)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">부가세 (10%)</span>
                  <span>{fmt(tax)}</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
                  <span>최종 결제금액</span>
                  <span className="text-primary">{fmt(total)}</span>
                </div>
              </div>
            </div>

            </>)} {/* end !aiTab */}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setStep(1)}>이전</Button>
              <Button className="flex-[2] h-12 text-base" onClick={() => setStep(3)} disabled={aiTab || !unitPrice}>
                결제하기 <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: 결제 ───────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border shadow-sm p-5">
              <h2 className="font-semibold text-base mb-3">주문 요약</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">기관</span>
                  <span className="font-medium">{info.orgName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">담당자</span>
                  <span>{info.contactName} · {info.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">플랜</span>
                  <span>{activePlan.label} {info.months}개월{info.qty > 1 ? ` × ${info.qty}장` : ''}</span>
                </div>
                {priceIsEvent && (
                  <div className="flex justify-between text-pink-600 text-xs">
                    <span>이벤트 할인</span>
                    <span>적용됨</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
                  <span>결제금액</span>
                  <span className="text-primary">{fmt(total)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border shadow-sm p-5">
              {widgetLoading && (
                <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">결제 모듈 로딩 중...</span>
                </div>
              )}
              <div id="toss-payment-widget" ref={paymentMethodRef} />
              <div id="toss-agreement-widget" ref={agreementDivRef} className="mt-4" />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12" onClick={() => setStep(2)}>이전</Button>
              <Button className="flex-[2] h-12 text-base font-semibold" onClick={handlePay}
                disabled={widgetLoading || !payWidget}>
                {fmt(total)} 결제하기
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground px-4">
              결제 완료 즉시 이용권이 발급되어 입력하신 휴대폰 번호로 발송됩니다.<br />
              세금계산서가 필요하신 경우 결제 후 별도 신청이 가능합니다.
            </p>
          </div>
        )}
      </main>

      <footer className="border-t mt-16 py-8">
        <div className="max-w-2xl mx-auto px-4 text-center text-xs text-muted-foreground space-y-1">
          <p>씸스페이스(주) · 042-864-5566 · tebahsoft@tebahsoft.com</p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <a href="/terms" className="hover:text-foreground transition-colors">이용약관</a>
            <a href="/privacy" className="hover:text-foreground transition-colors">개인정보처리방침</a>
            <a href="mailto:tebahsoft@tebahsoft.com" className="hover:text-foreground transition-colors">고객문의</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
