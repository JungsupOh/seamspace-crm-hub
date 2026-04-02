import { useState, useRef } from 'react';
// Toss Payments 결제창 SDK loaded via CDN (https://js.tosspayments.com/v1)
import { searchSchools, SchoolInfo } from '@/lib/neis';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Search, ChevronRight, CheckCircle2, Loader2,
  School, User, Phone, Mail, Building2, Sparkles, Tag,
  FileText, CreditCard, ArrowLeft, Printer, Send, Banknote, Gift,
} from 'lucide-react';

const nanoid = (n = 21) => crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + (b & 63).toString(36), '');

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? 'test_ck_D4yKeq5bgrpXmmoXXnJrGX0lzW6Y';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const AIRTABLE_BASE = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appsnsExBG8ZeEZEk';
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN || '';

const BANK_INFO = {
  bank: '국민은행',
  account: '940701-00-000000', // TODO: 실제 계좌번호로 변경
  holder: '테바소프트(주)',
};

// ── 플랜 정의 ──────────────────────────────────────
type PlanKey = '소수학급' | '학급' | '학년' | '학교(소)' | '학교(중)' | '학교(대)';

interface PlanDef {
  id: PlanKey;
  label: string;
  shortLabel: string;
  capacity: string;
  badge?: string;
  minMonths?: number;
}

const PLANS: PlanDef[] = [
  { id: '소수학급', label: '소수학급 플랜',   shortLabel: '소수학급',  capacity: '최대 10명', minMonths: 4 },
  { id: '학급',     label: '학급 플랜',      shortLabel: '학급',      capacity: '최대 40명' },
  { id: '학년',     label: '학년 플랜',      shortLabel: '학년',      capacity: '최대 200명',   badge: '인기' },
  { id: '학교(소)', label: '학교 플랜 (소)', shortLabel: '학교(소)',  capacity: '최대 500명' },
  { id: '학교(중)', label: '학교 플랜 (중)', shortLabel: '학교(중)', capacity: '최대 1,000명' },
  { id: '학교(대)', label: '학교 플랜 (대)', shortLabel: '학교(대)', capacity: '무제한' },
];

const PLAN_CAPACITY: Record<PlanKey, number> = {
  '소수학급': 10, '학급': 40, '학년': 200, '학교(소)': 500, '학교(중)': 1000, '학교(대)': 99999,
};

function recommendPlan(students: number): PlanKey {
  for (const plan of PLANS) {
    if (students <= PLAN_CAPACITY[plan.id]) return plan.id;
  }
  return '학교(대)';
}

// ── 가격표 ──────────────────────────────────────────
const REG: Record<number, Record<PlanKey, number>> = {
  1:  { '소수학급': 0, '학급':  40000, '학년':  180000, '학교(소)':  440000, '학교(중)':  850000, '학교(대)':  1200000 },
  4:  { '소수학급': 40000, '학급': 150000, '학년':  700000, '학교(소)': 1700000, '학교(중)': 3300000, '학교(대)':  4600000 },
  6:  { '소수학급': 60000, '학급': 200000, '학년': 1000000, '학교(소)': 2500000, '학교(중)': 4800000, '학교(대)':  6500000 },
  12: { '소수학급': 100000, '학급': 390000, '학년': 1950000, '학교(소)': 4800000, '학교(중)': 9500000, '학교(대)': 11000000 },
};
const EVT: Record<number, Record<PlanKey, number>> = {
  6:  { '소수학급': 60000, '학급': 180000, '학년':  780000, '학교(소)': 1980000, '학교(중)': 3780000, '학교(대)':  4980000 },
  12: { '소수학급': 100000, '학급': 280000, '학년': 1180000, '학교(소)': 2880000, '학교(중)': 5680000, '학교(대)':  6580000 },
};
const EVENT_END = new Date('2026-04-01');
const IS_EVENT = new Date() < EVENT_END;

function getUnitPrice(months: number, plan: PlanKey): { price: number; isEvent: boolean } {
  if (IS_EVENT && EVT[months]?.[plan] != null) return { price: EVT[months][plan], isEvent: true };
  return { price: REG[months]?.[plan] ?? 0, isEvent: false };
}

// ── 스마트 기간 추천 ────────────────────────────────
interface Suggestion {
  months: number; total: number; label: string;
  breakdown: string; isEvent: boolean; recommended: boolean;
}

function getSuggestions(targetMonths: number, plan: PlanKey): Suggestion[] {
  if (targetMonths <= 0 || targetMonths > 60) return [];
  const periods = [12, 6, 4, 1];
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
  if (dp[targetMonths].cost < Infinity) {
    const grouped: Record<number, number> = {};
    for (const m of dp[targetMonths].combo) grouped[m] = (grouped[m] ?? 0) + 1;
    const breakdown = Object.entries(grouped)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([m, q]) => `${m}개월${q > 1 ? ` × ${q}` : ''}`).join(' + ');
    results.push({ months: targetMonths, total: dp[targetMonths].cost, label: `${targetMonths}개월 구성`, breakdown, isEvent: false, recommended: false });
  }
  for (const roundUp of [6, 12]) {
    if (roundUp > targetMonths) {
      const { price, isEvent } = getUnitPrice(roundUp, plan);
      const exactCost = dp[targetMonths].cost;
      const saving = exactCost < Infinity ? exactCost - price : 0;
      results.push({ months: roundUp, total: price, label: `${roundUp}개월${isEvent ? ' (이벤트)' : ''}`,
        breakdown: saving > 0 ? `조합 대비 ${fmt(saving)} 절약` : `${roundUp - targetMonths}개월 추가 이용`,
        isEvent, recommended: saving > 0 || exactCost === Infinity });
      break;
    }
  }
  results.sort((a, b) => a.total - b.total);
  if (results.length > 0) results[0].recommended = true;
  return results;
}

function fmt(n: number) { return n.toLocaleString('ko-KR') + '원'; }

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function normalizePhone(p: string) { return p.replace(/\D/g, ''); }
function normalizeEmail(e: string) { return e.trim().toLowerCase(); }

// ── 학교 검색 ──────────────────────────────────────
function SchoolSearch({ onSelect }: { onSelect: (s: SchoolInfo) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SchoolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const doSearch = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setActiveIdx(-1);
    try { const r = await searchSchools(q); setResults(r); setOpen(true); }
    catch { setResults([]); }
    finally { setLoading(false); }
  };

  const handleSelect = (s: SchoolInfo) => {
    onSelect(s); setOpen(false); setQ(s.name); setActiveIdx(-1);
  };

  const scrollToItem = (idx: number) => {
    const el = listRef.current?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && results.length > 0) setOpen(true);
      setActiveIdx(prev => {
        const next = prev < results.length - 1 ? prev + 1 : 0;
        scrollToItem(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(prev => {
        const next = prev > 0 ? prev - 1 : results.length - 1;
        scrollToItem(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIdx >= 0 && results[activeIdx]) {
        handleSelect(results[activeIdx]);
      } else {
        doSearch();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input value={q} onChange={e => { setQ(e.target.value); setOpen(false); setActiveIdx(-1); }}
          onKeyDown={handleKeyDown}
          placeholder="학교명으로 검색 (예: 서울초등학교)" className="h-11" />
        <Button type="button" onClick={doSearch} disabled={loading} className="h-11 px-4 shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border bg-background shadow-xl overflow-hidden">
          <div ref={listRef} className="max-h-64 overflow-y-auto divide-y divide-border">
            {results.map((s, i) => (
              <button key={i} type="button"
                onClick={() => handleSelect(s)}
                className={`w-full text-left px-4 py-3 transition-colors ${i === activeIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'}`}>
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

// ── 상품 코드 ──────────────────────────────────────
interface ProductDef { code: string; name: string; desc: string; icon: string; }
const PRODUCTS: ProductDef[] = [
  { code: '01', name: 'AI마음일기', desc: '학교·기관용 AI 감정일기 서비스', icon: '📔' },
];

// ── 타입 ──────────────────────────────────────────
interface OrderInfo {
  school: SchoolInfo | null;
  orgName: string; contactName: string; phone: string; email: string;
  planId: PlanKey; months: number; qty: number; students: string;
}
interface QuoteRecord {
  id: string; deal_id?: string; quote_number: string;
  plan?: string; qty?: number; license_qty?: number; duration?: number;
  unit_price?: number; supply_price?: number; tax_amount?: number; final_value?: number;
  quote_date?: string; notes?: string; contact_phone?: string; contact_email?: string;
}

const DEFAULT_MONTHS = IS_EVENT ? 6 : 12;

// ── Toss 결제창 섹션 ──────────────────────────────
function TossPaySection({
  amount, orderName, customerName, customerPhone, customerEmail,
  orgName, plan, qty, duration, quoteNumber, onBack,
}: {
  amount: number; orderName: string; customerName: string;
  customerPhone: string; customerEmail?: string;
  orgName?: string; plan?: string; qty?: number; duration?: number;
  quoteNumber?: string; onBack: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const orderIdRef = useRef(nanoid());

  const handlePay = async () => {
    setLoading(true);
    setError('');
    if (!(window as any).TossPayments) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('결제 스크립트 로드 실패'));
        document.head.appendChild(script);
      }).catch((e: unknown) => { setError(String(e)); setLoading(false); throw e; });
    }
    try {
      const tossPayments = (window as any).TossPayments(TOSS_CLIENT_KEY);
      sessionStorage.setItem('toss_order_session', JSON.stringify({
        customerName,
        customerPhone: customerPhone.replace(/\D/g, ''),
        customerEmail: customerEmail || null,
        orgName: orgName || null,
        plan: plan || null,
        qty: qty ?? 1,
        duration: duration ?? 12,
        quoteNumber: quoteNumber || null,
      }));
      await tossPayments.requestPayment('카드', {
        amount,
        orderId: orderIdRef.current,
        orderName,
        customerName,
        customerEmail: customerEmail || undefined,
        customerMobilePhone: customerPhone.replace(/\D/g, ''),
        successUrl: `${window.location.origin}/order/complete`,
        failUrl:    `${window.location.origin}/order/fail`,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== 'USER_CANCEL') {
        setError((e as { message?: string })?.message ?? String(e));
      }
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 rounded-xl border border-blue-100 p-4 text-sm text-blue-800 flex items-start gap-2.5">
        <CreditCard className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
        <p>결제하기 버튼을 누르면 토스페이먼츠 결제 페이지로 이동합니다.<br />카드, 계좌이체, 무통장입금 등 다양한 결제 수단을 사용할 수 있습니다.</p>
      </div>
      {error && <p className="text-sm text-destructive text-center bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 h-12" onClick={onBack} disabled={loading}>이전</Button>
        <Button className="flex-[2] h-12 text-base font-semibold" onClick={handlePay} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
          {fmt(amount)} 결제하기
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground px-4">
        결제 완료 즉시 이용권이 발급되어 입력하신 휴대폰 번호로 발송됩니다.
      </p>
    </div>
  );
}

// ── 견적서 조회 공통 폼 ────────────────────────────
function QuoteLookupPanel({
  quoteNum, setQuoteNum,
  email, setEmail,
  phone, setPhone,
  onLookup, loading, error, hint,
}: {
  quoteNum: string; setQuoteNum: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  onLookup: () => void; loading: boolean; error: string; hint?: string;
}) {
  const canSubmit = quoteNum.trim() && (email.trim() || phone.trim());
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">견적서 번호 *</Label>
          <Input value={quoteNum} onChange={e => { setQuoteNum(e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onLookup(); }}
            placeholder="예: 2026-01-0001" className="h-11 font-mono" />
        </div>
        <p className="text-xs font-medium text-muted-foreground">이메일 또는 휴대폰 번호 중 하나를 입력하세요</p>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">이메일</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onLookup(); }}
              placeholder="example@school.kr" className="pl-9 h-11" type="email" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">휴대폰 번호</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onLookup(); }}
              placeholder="010-1234-5678" className="pl-9 h-11" type="tel" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={onLookup} disabled={loading || !canSubmit} className="w-full h-11">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          견적서 조회
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────
export default function Order() {
  type Mode = 'entry' | 'product-select' | 'quote-stage' | 'payment-stage' | 'license-stage';
  const [mode, setMode] = useState<Mode>('entry');
  const [selectedProduct, setSelectedProduct] = useState<ProductDef>(PRODUCTS[0]);

  // ── Quote Stage (견적) ─────────────────────────
  const [qStep, setQStep] = useState<1 | 2 | 3>(1);
  const [qStep3Sub, setQStep3Sub] = useState<'preview' | 'sending' | 'sent'>('preview');
  const [info, setInfo] = useState<OrderInfo>({
    school: null, orgName: '', contactName: '', phone: '', email: '',
    planId: '학년', months: DEFAULT_MONTHS, qty: 1, students: '',
  });
  const [aiTab, setAiTab] = useState(false);
  const [aiStudents, setAiStudents] = useState('');
  const [aiLicenses, setAiLicenses] = useState('');
  const [aiMonths, setAiMonths] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customMonths, setCustomMonths] = useState('');
  const [savedQuoteNum, setSavedQuoteNum] = useState<string | null>(null);
  const [savingQuote, setSavingQuote] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  // ── Payment Stage (입금) ───────────────────────
  const [pSub, setPSub] = useState<'lookup' | 'confirm' | 'toss' | 'bank' | 'bank-done'>('lookup');
  const [pQuoteNum, setPQuoteNum] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pQuote, setPQuote] = useState<QuoteRecord | null>(null);
  const [pContact, setPContact] = useState({ name: '', phone: '', email: '' });
  const [pError, setPError] = useState('');
  const [pLoading, setPLoading] = useState(false);

  // ── Step1 입력 refs ────────────────────────────
  const orgNameRef     = useRef<HTMLInputElement>(null);
  const contactNameRef = useRef<HTMLInputElement>(null);
  const phoneRef       = useRef<HTMLInputElement>(null);
  const emailRef       = useRef<HTMLInputElement>(null);

  // ── License Stage (이용권발송) ──────────────────
  const [lSub, setLSub] = useState<'lookup' | 'confirm' | 'issuing' | 'done' | 'error'>('lookup');
  const [lQuoteNum, setLQuoteNum] = useState('');
  const [lEmail, setLEmail] = useState('');
  const [lPhone, setLPhone] = useState('');
  const [lQuote, setLQuote] = useState<QuoteRecord | null>(null);
  const [lContact, setLContact] = useState({ name: '', phone: '', email: '' });
  const [lError, setLError] = useState('');
  const [lLoading, setLLoading] = useState(false);
  const [lCoupons, setLCoupons] = useState<string[]>([]);

  // ── 계산값 ────────────────────────────────────
  const activePlan = PLANS.find(p => p.id === info.planId) ?? PLANS[1];
  const { price: rawUnitPrice, isEvent: priceIsEvent } = getUnitPrice(info.months, info.planId);
  // 직접 단가가 없는 조합 기간(예: 8개월)은 최저가 조합 총액을 단가로 사용
  const unitPrice = rawUnitPrice > 0
    ? rawUnitPrice
    : (getSuggestions(info.months, info.planId)[0]?.total ?? 0);
  const total = unitPrice * info.qty;
  const supply = Math.round(total / 1.1);
  const tax = total - supply;

  const aiStudentsNum  = parseInt(aiStudents, 10);
  const aiLicensesNum  = parseInt(aiLicenses, 10);
  const aiMonthsNum    = parseInt(aiMonths, 10);

  const hasStudents  = !isNaN(aiStudentsNum) && aiStudentsNum > 0;
  const hasLicenses  = !isNaN(aiLicensesNum) && aiLicensesNum > 0;
  const hasMonths    = !isNaN(aiMonthsNum) && aiMonthsNum > 0;

  // ── 학급 플랜 옵션 계산 ────────────────────────────
  // 소형 플랜: qty = 이용권 수량 (인원분할 불가)
  const aiClassQty = Math.max(hasLicenses ? aiLicensesNum : 1, 1);
  const aiClassCapacity = aiClassQty * 40;

  // ── 상위 플랜 옵션 (학년 이상, 1장으로 이용권 자유 분할) ──
  const aiHigherPlan: PlanKey | null =
    (hasStudents || hasLicenses)
      ? (hasStudents ? recommendPlan(aiStudentsNum) : '학년')
      : null;
  // 상위 플랜이 소형이면 비교 불필요
  const showComparison = aiHigherPlan !== null && aiHigherPlan !== '학급' && aiHigherPlan !== '소수학급';

  // ── 가격 비교 (이용기간 입력 시) ───────────────────
  const aiClassSuggs  = hasMonths ? getSuggestions(aiMonthsNum, '학급') : [];
  const aiHigherSuggs = (showComparison && hasMonths) ? getSuggestions(aiMonthsNum, aiHigherPlan!) : [];

  // 각 옵션의 최저가 suggestion
  const aiClassBest  = aiClassSuggs[0];
  const aiHigherBest = aiHigherSuggs[0];

  // 총액 비교 — 학급 단독 vs 상위 플랜 단독 vs 상위+학급 보충
  const aiClassTotal  = aiClassBest  ? aiClassBest.total  * aiClassQty : null;
  let aiHigherTotal = aiHigherBest ? aiHigherBest.total : null;

  // 상위 플랜으로 인원이 부족하면 학급 보충 비용 추가
  if (aiHigherPlan && hasStudents && aiHigherTotal !== null) {
    const bCap = PLAN_CAPACITY[aiHigherPlan];
    if (bCap < aiStudentsNum) {
      const rem = aiStudentsNum - bCap;
      const fillerQty = Math.ceil(rem / 40);
      const fillerBest = hasMonths ? getSuggestions(aiMonthsNum, '학급')[0] : null;
      if (fillerBest) aiHigherTotal += fillerBest.total * fillerQty;
    }
  }

  const aiCheaper: 'class' | 'higher' | null =
    aiClassTotal !== null && aiHigherTotal !== null
      ? (aiClassTotal <= aiHigherTotal ? 'class' : 'higher')
      : null;
  const customNum = parseInt(customMonths, 10);
  const suggestions = (!isNaN(customNum) && customNum > 0) ? getSuggestions(customNum, info.planId) : [];

  const selectPlan = (planId: PlanKey) => {
    setInfo(prev => ({ ...prev, planId, qty: 1 }));
    setShowCustom(false); setCustomMonths('');
  };

  const step1Valid = !!(info.orgName.trim() && info.contactName.trim() && info.phone.trim() && info.email.trim());

  // ── 견적 저장 ─────────────────────────────────
  const saveWebQuote = async (): Promise<string | null> => {
    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const pCode = selectedProduct.code;
    const prefix = `${year}-${pCode}-`;
    setSavingQuote(true);
    try {
      const seqRes = await fetch(
        `${SUPABASE_URL}/rest/v1/deal_quotes?quote_number=like.${encodeURIComponent(prefix + '%')}&select=quote_number&order=quote_number.desc&limit=1`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      const seqData: { quote_number: string }[] = await seqRes.json();
      let seq = 1;
      if (Array.isArray(seqData) && seqData.length > 0) {
        const lastSeq = parseInt(seqData[0].quote_number.split('-')[2] ?? '0', 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }
      const qNum = `${prefix}${String(seq).padStart(4, '0')}`;

      const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/deal_quotes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          deal_id: 'web',
          quote_number: qNum,
          plan: selectedProduct.code === '01' ? activePlan.label : selectedProduct.name,
          qty: info.qty,
          duration: selectedProduct.code === '01' ? info.months : undefined,
          unit_price: selectedProduct.code === '01' ? unitPrice : undefined,
          supply_price: selectedProduct.code === '01' ? supply : undefined,
          tax_amount: selectedProduct.code === '01' ? tax : undefined,
          final_value: selectedProduct.code === '01' ? total : undefined,
          contact_phone: info.phone.replace(/\D/g, ''),
          contact_email: info.email.trim() || null,
          quote_date: today,
          notes: `[웹주문] 상품: 심스페이스-${selectedProduct.name} / 기관: ${info.orgName} / 담당자: ${info.contactName} / 연락처: ${info.phone} / 이메일: ${info.email}${info.students ? ` / 학생수: ${info.students}명` : ''}`,
        }),
      });
      if (saveRes.ok || saveRes.status === 201) {
        setSavedQuoteNum(qNum);
        return qNum;
      }
    } catch (e) {
      console.error('견적 저장 실패', e);
    } finally {
      setSavingQuote(false);
    }
    return null;
  };

  // ── 견적서 이메일 발송 ─────────────────────────
  const sendQuoteEmail = async (qNum: string) => {
    if (!info.email.trim()) return;
    setSendingEmail(true);
    try {
      const planLabel = activePlan.label;
      const payUrl = `${window.location.origin}/order`;
      const htmlBody = `
        <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
          <div style="background: #0f766e; color: white; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 700;">심스페이스 견적서</h1>
            <p style="margin: 4px 0 0; opacity: 0.85; font-size: 14px;">Seamspace — AI마음일기 서비스</p>
          </div>
          <div style="background: #f8fafc; padding: 24px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <table style="width: 100%; font-size: 14px; margin-bottom: 20px;">
              <tr><td style="color: #64748b; padding: 4px 0; width: 100px;">견적번호</td><td style="font-family: monospace; font-weight: 700; color: #0f766e;">${qNum}</td></tr>
              <tr><td style="color: #64748b; padding: 4px 0;">기관명</td><td style="font-weight: 600;">${info.orgName}</td></tr>
              <tr><td style="color: #64748b; padding: 4px 0;">담당자</td><td>${info.contactName}</td></tr>
              <tr><td style="color: #64748b; padding: 4px 0;">연락처</td><td>${info.phone}</td></tr>
              <tr><td style="color: #64748b; padding: 4px 0;">견적일</td><td>${new Date().toLocaleDateString('ko-KR')}</td></tr>
            </table>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
              <thead>
                <tr style="background: #e2e8f0;">
                  <th style="padding: 10px 12px; text-align: left; border: 1px solid #cbd5e1;">품목</th>
                  <th style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1;">수량</th>
                  <th style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1;">단가</th>
                  <th style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1;">공급가액</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 10px 12px; border: 1px solid #cbd5e1;">${planLabel} · ${info.months}개월</td>
                  <td style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1;">${info.qty}장</td>
                  <td style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1;">${fmt(unitPrice)}</td>
                  <td style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1;">${fmt(supply)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style="background: #f1f5f9;">
                  <td colspan="3" style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1; color: #64748b;">부가세 (10%)</td>
                  <td style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1;">${fmt(tax)}</td>
                </tr>
                <tr style="background: #e0f2f1;">
                  <td colspan="3" style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1; font-weight: 700;">합계</td>
                  <td style="padding: 10px 12px; text-align: right; border: 1px solid #cbd5e1; font-weight: 700; color: #0f766e;">${fmt(total)}</td>
                </tr>
              </tfoot>
            </table>
            ${priceIsEvent ? '<p style="color: #db2777; font-size: 13px; margin-bottom: 16px;">✦ 신학기 이벤트 가격 적용 (2026. 3. 31.까지)</p>' : ''}
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
              <p style="margin: 0 0 8px; font-weight: 600; font-size: 14px;">결제 방법</p>
              <p style="margin: 0 0 4px; font-size: 13px; color: #374151;">① <strong>온라인 카드 결제:</strong> <a href="${payUrl}" style="color: #0f766e;">${payUrl}</a> → 결제하기</p>
              <p style="margin: 0; font-size: 13px; color: #374151;">② <strong>계좌이체:</strong> ${BANK_INFO.bank} ${BANK_INFO.account} (예금주: ${BANK_INFO.holder})</p>
            </div>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 12px; color: #94a3b8;">
              <p style="margin: 0 0 4px;">Tebahsoft, Inc. (테바소프트 주식회사)</p>
              <p style="margin: 0 0 4px;">고객센터: 042-864-5566 · contact@tebahsoft.com</p>
              <p style="margin: 0;">견적 유효기간: 발급일로부터 30일</p>
            </div>
          </div>
        </div>
      `;
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          to: info.email.trim(),
          subject: `[심스페이스] 견적서 ${qNum} — ${info.orgName}`,
          html: htmlBody,
        }),
      });
    } catch (e) {
      console.error('이메일 발송 실패', e);
    } finally {
      setSendingEmail(false);
    }
  };

  // ── 견적서 조회 공통 로직 ──────────────────────
  const lookupQuote = async (
    quoteNum: string,
    email: string,
    phone: string,
    setLoading: (v: boolean) => void,
    setError: (v: string) => void,
    onSuccess: (q: QuoteRecord) => void,
  ) => {
    setLoading(true);
    setError('');
    try {
      const num = quoteNum.trim();
      const entEmail = normalizeEmail(email);
      const entPhone = normalizePhone(phone);

      if (!entEmail && !entPhone) {
        setError('이메일 또는 휴대폰 번호를 입력해 주세요.');
        return;
      }

      // 1차: Supabase deal_quotes 조회
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/deal_quotes?quote_number=eq.${encodeURIComponent(num)}&select=*`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      const data: QuoteRecord[] = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        const record = data[0];
        // 이메일/전화번호 중 하나가 맞으면 통과
        const storedEmail = normalizeEmail(record.contact_email ?? '');
        const storedPhone = normalizePhone(record.contact_phone ?? '');
        const emailOk = entEmail && storedEmail && storedEmail === entEmail;
        const phoneOk = entPhone && storedPhone && storedPhone === entPhone;
        const hasStoredContact = !!(storedEmail || storedPhone);
        if (hasStoredContact && !emailOk && !phoneOk) {
          setError('이메일 또는 휴대폰 번호가 일치하지 않습니다.');
          return;
        }
        onSuccess(record);
        return;
      }

      // 2차: Airtable 조회
      if (AIRTABLE_TOKEN) {
        const atRes = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_BASE}/03_Deals?filterByFormula=${encodeURIComponent(`{Quote_Number}="${num}"`)}&maxRecords=1`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
        );
        const atData = await atRes.json();
        const record = atData?.records?.[0];
        if (record) {
          const f = record.fields;
          const storedPhone = normalizePhone(f.Contact_Phone ?? '');
          const storedEmail = normalizeEmail(f.Contact_Email ?? '');
          const emailOk = entEmail && storedEmail && storedEmail === entEmail;
          const phoneOk = entPhone && storedPhone && storedPhone === entPhone;
          const hasStored = !!(storedEmail || storedPhone);
          if (hasStored && !emailOk && !phoneOk) {
            setError('이메일 또는 휴대폰 번호가 일치하지 않습니다.');
            return;
          }
          const mapped: QuoteRecord = {
            id: record.id, deal_id: record.id, quote_number: num,
            plan: f.Quote_Plan, qty: f.Quote_Qty, duration: f.License_Duration,
            unit_price: f.Unit_Price, supply_price: f.Supply_Price,
            tax_amount: f.Tax_Amount, final_value: f.Final_Contract_Value,
            quote_date: f.Quote_Date, notes: f.Notes,
            contact_phone: f.Contact_Phone, contact_email: f.Contact_Email,
          };
          onSuccess(mapped);
          return;
        }
      }

      setError('견적서를 찾을 수 없습니다. 번호를 다시 확인해 주세요.');
    } catch {
      setError('조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  // ── 이용권 발급 ───────────────────────────────
  const issueLicenses = async () => {
    if (!lQuote) return;
    setLSub('issuing');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/issue-license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          quoteNumber: lQuote.quote_number,
          customerName: lContact.name,
          customerPhone: lContact.phone.replace(/\D/g, ''),
          customerEmail: lContact.email || null,
          orgName: lQuote.notes?.match(/기관: (.+?) \//)?.[1] ?? '',
          plan: lQuote.plan ?? '',
          qty: lQuote.qty ?? 1,
          duration: lQuote.duration ?? 12,
          amount: lQuote.final_value ?? 0,
          licenseQty: lQuote.license_qty ?? lQuote.qty ?? 1,
        }),
      });
      const data: { ok?: boolean; coupon_codes?: string[]; already_issued?: boolean; error?: string } = await res.json();
      if (data.ok && data.coupon_codes) {
        setLCoupons(data.coupon_codes);
        setLSub('done');
      } else {
        setLError(data.error ?? '이용권 발급 중 오류가 발생했습니다.');
        setLSub('error');
      }
    } catch {
      setLError('네트워크 오류가 발생했습니다. 고객센터(042-864-5566)에 문의해 주세요.');
      setLSub('error');
    }
  };

  // ── 초기화 ────────────────────────────────────
  const goEntry = () => {
    setMode('entry');
    setQStep(1); setQStep3Sub('preview');
    setInfo({ school: null, orgName: '', contactName: '', phone: '', email: '', planId: '학년', months: DEFAULT_MONTHS, qty: 1, students: '' });
    setSavedQuoteNum(null); setSelectedProduct(PRODUCTS[0]);
    setPSub('lookup'); setPQuoteNum(''); setPEmail(''); setPPhone(''); setPQuote(null); setPContact({ name: '', phone: '', email: '' }); setPError('');
    setLSub('lookup'); setLQuoteNum(''); setLEmail(''); setLPhone(''); setLQuote(null); setLContact({ name: '', phone: '', email: '' }); setLError(''); setLCoupons([]);
  };

  const pFinal = pQuote?.final_value ?? 0;
  const pSupply = pQuote?.supply_price ?? Math.round(pFinal / 1.1);
  const pTax = pQuote?.tax_amount ?? (pFinal - pSupply);

  const studentsNum = parseInt(info.students, 10);
  const isGradeClass = info.planId === '학급';
  const minQty = (isGradeClass && studentsNum > 0) ? Math.max(1, Math.ceil(studentsNum / 40)) : 1;
  const capacity = isGradeClass ? info.qty * 40 : PLAN_CAPACITY[info.planId];
  const capacityLabel = info.planId === '학교(대)' ? '무제한' : `최대 ${capacity.toLocaleString('ko-KR')}명`;
  const overCapacity = studentsNum > 0 && capacity < studentsNum;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* 헤더 */}
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {mode !== 'entry' && (
              <button type="button"
                onClick={mode === 'product-select' ? () => setMode('entry') : goEntry}
                className="mr-1 p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <img src="/logo2.png" alt="Seamspace" className="h-8 w-auto" />
            <span className="font-semibold text-base">심스페이스</span>
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

        {/* ══ ENTRY ══════════════════════════════════════ */}
        {mode === 'entry' && (
          <div className="space-y-8">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">심스페이스 이용권 구매</h1>
              <p className="text-muted-foreground text-sm">학교·기관 전용 구독 서비스입니다.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {/* 견적 */}
              <button type="button"
                onClick={() => { setSelectedProduct(PRODUCTS[0]); PRODUCTS.length === 1 ? (setMode('quote-stage'), setQStep(1)) : setMode('product-select'); }}
                className="group bg-white rounded-2xl border-2 border-border hover:border-primary shadow-sm p-6 text-left transition-all hover:shadow-md flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">STEP 1</span>
                    <h2 className="font-bold text-base">견적 요청</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">기관 정보와 플랜을 선택하면 견적서가 이메일로 발송됩니다.</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary shrink-0 mt-1" />
              </button>

              {/* 결제 */}
              <button type="button" onClick={() => { setMode('payment-stage'); setPSub('lookup'); }}
                className="group bg-white rounded-2xl border-2 border-border hover:border-teal-500 shadow-sm p-6 text-left transition-all hover:shadow-md flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center shrink-0 group-hover:bg-teal-100 transition-colors">
                  <CreditCard className="h-6 w-6 text-teal-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">STEP 2</span>
                    <h2 className="font-bold text-base">결제하기</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">견적서 번호로 조회 후 카드 또는 계좌이체로 결제합니다.</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-teal-500 shrink-0 mt-1" />
              </button>

              {/* 이용권 발송 */}
              <button type="button" onClick={() => { setMode('license-stage'); setLSub('lookup'); }}
                className="group bg-white rounded-2xl border-2 border-border hover:border-purple-500 shadow-sm p-6 text-left transition-all hover:shadow-md flex items-start gap-5">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0 group-hover:bg-purple-100 transition-colors">
                  <Gift className="h-6 w-6 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">STEP 3</span>
                    <h2 className="font-bold text-base">이용권 발송</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">입금 완료 후 견적서 번호로 이용권을 발급받습니다.</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-purple-500 shrink-0 mt-1" />
              </button>
            </div>

            <div className="text-center text-xs text-muted-foreground space-y-1 pt-4">
              <p>구매 관련 문의: 042-864-5566 · contact@tebahsoft.com</p>
            </div>
          </div>
        )}

        {/* ══ 상품 선택 ════════════════════════════════ */}
        {mode === 'product-select' && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-xl font-bold mb-1">상품 선택</h1>
              <p className="text-sm text-muted-foreground">견적을 받을 상품을 선택해 주세요.</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {PRODUCTS.map(p => (
                <button key={p.code} type="button"
                  onClick={() => { setSelectedProduct(p); setMode('quote-stage'); setQStep(1); }}
                  className="group bg-white rounded-2xl border-2 border-border hover:border-primary shadow-sm p-4 text-left transition-all hover:shadow-md flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0 group-hover:bg-primary/10 transition-colors">{p.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{p.code}</span>
                      <span className="font-bold text-sm">심스페이스-{p.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0" />
                </button>
              ))}
            </div>
            <Button variant="outline" className="w-full h-11" onClick={() => setMode('entry')}>
              <ArrowLeft className="h-4 w-4 mr-2" />이전
            </Button>
          </div>
        )}

        {/* ══ STAGE 1: 견적 ══════════════════════════════ */}
        {mode === 'quote-stage' && (
          <>
            {/* 단계 표시 */}
            <div className="flex items-center justify-center gap-0 mb-8">
              {['기관 정보', '플랜 선택', '견적 발송'].map((s, i) => (
                <div key={s} className="flex items-center">
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors
                    ${i + 1 === qStep ? 'bg-primary text-primary-foreground' :
                      i + 1 < qStep ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                      ${i + 1 === qStep ? 'bg-white/30' : i + 1 < qStep ? 'bg-primary text-white' : 'bg-muted-foreground/20'}`}>
                      {i + 1 < qStep ? '✓' : i + 1}
                    </span>
                    {s}
                  </div>
                  {i < 2 && <ChevronRight className={`h-4 w-4 mx-1 ${i + 1 < qStep ? 'text-primary' : 'text-muted-foreground/30'}`} />}
                </div>
              ))}
            </div>

            {/* Step 1: 기관 정보 */}
            {qStep === 1 && (
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
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      {info.school.eduOffice} · {info.school.address}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">기관명</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input ref={orgNameRef} value={info.orgName} onChange={e => setInfo(p => ({ ...p, orgName: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); contactNameRef.current?.focus(); } }}
                      placeholder="○○초등학교" className="pl-9 h-11" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">담당자 이름 *</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input ref={contactNameRef} value={info.contactName} onChange={e => setInfo(p => ({ ...p, contactName: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); phoneRef.current?.focus(); } }}
                        placeholder="홍길동" className="pl-9 h-11" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">휴대폰 번호 *</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input ref={phoneRef} value={info.phone} onChange={e => setInfo(p => ({ ...p, phone: formatPhone(e.target.value) }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); emailRef.current?.focus(); } }}
                        placeholder="010-1234-5678" className="pl-9 h-11" type="tel" />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">이메일 * <span className="text-muted-foreground font-normal">(견적서 발송용)</span></Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input ref={emailRef} value={info.email} onChange={e => setInfo(p => ({ ...p, email: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter' && step1Valid) { e.preventDefault(); setQStep(2); } }}
                      placeholder="example@school.kr" className="pl-9 h-11" type="email" />
                  </div>
                </div>
                <Button className="w-full h-12 text-base mt-2" disabled={!step1Valid} onClick={() => setQStep(2)}>
                  다음 — 플랜 선택 <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}

            {/* Step 2: 플랜 선택 */}
            {qStep === 2 && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                  <div className="flex border-b overflow-x-auto">
                    <button type="button" onClick={() => setAiTab(true)}
                      className={`relative flex-1 min-w-[72px] py-3 px-2 text-center text-xs font-medium transition-colors whitespace-nowrap
                        ${aiTab ? 'text-purple-600 border-b-2 border-purple-500 bg-purple-50/50' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}>
                      ✨ AI추천
                    </button>
                    {PLANS.map(p => (
                      <button key={p.id} type="button" onClick={() => { selectPlan(p.id); setAiTab(false); }}
                        className={`relative flex-1 min-w-[60px] py-3 px-2 text-center text-xs font-medium transition-colors whitespace-nowrap
                          ${!aiTab && info.planId === p.id ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}>
                        {p.shortLabel}
                        {p.badge && <span className="absolute top-1 right-1 text-[8px] bg-orange-500 text-white px-1 py-0.5 rounded-full leading-none">{p.badge}</span>}
                      </button>
                    ))}
                  </div>

                  {aiTab ? (
                    <div className="p-5 space-y-5">
                      <div className="flex items-center gap-2 text-purple-700">
                        <span className="text-lg">✨</span>
                        <p className="font-semibold text-sm">학생수·이용권발급수·이용기간으로 최적 플랜을 추천합니다</p>
                      </div>

                      {/* 입력 3개 */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium">학생 수</Label>
                          <div className="flex items-center gap-1">
                            <Input type="number" value={aiStudents} onChange={e => setAiStudents(e.target.value)}
                              placeholder="예: 100" className="h-10" min={1} />
                            <span className="text-xs text-muted-foreground shrink-0">명</span>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium">이용권 발급 수</Label>
                          <div className="flex items-center gap-1">
                            <Input type="number" value={aiLicenses} onChange={e => setAiLicenses(e.target.value)}
                              placeholder="예: 5" className="h-10" min={1} />
                            <span className="text-xs text-muted-foreground shrink-0">장</span>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium">이용 기간</Label>
                          <div className="flex items-center gap-1">
                            <Input type="number" value={aiMonths} onChange={e => setAiMonths(e.target.value)}
                              placeholder="예: 6" className="h-10" min={1} max={60} />
                            <span className="text-xs text-muted-foreground shrink-0">개월</span>
                          </div>
                        </div>
                      </div>

                      {/* 이용권발급수 안내 */}
                      <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-xs text-muted-foreground space-y-1">
                        <p className="font-medium text-foreground/70">이용권 발급 수 안내</p>
                        <p>• 학급별로 구분 사용 → <strong>학급 수만큼</strong> 입력 (각 학급이 별도 코드 사용)</p>
                        <p>• 하나의 그룹으로 통합 관리 → <strong>1</strong> 입력</p>
                      </div>

                      {/* 추천 결과 */}
                      {(hasStudents || hasLicenses) && (
                        <div className="space-y-3">
                          {/* 커버리지 요약 */}
                          {hasStudents && hasLicenses && (
                            <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs text-muted-foreground">
                              학생 {aiStudentsNum}명 / 이용권 {aiLicensesNum}장
                              {aiClassQty > aiLicensesNum && (
                                <span className="text-amber-600"> — 학급 플랜은 {aiClassQty}장 필요 ({aiClassCapacity}명 커버)</span>
                              )}
                            </div>
                          )}

                          {/* 비교 옵션 표시 */}
                          {hasMonths ? (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">구매 옵션 비교</p>

                              {/* 학급 플랜 옵션 */}
                              {aiClassBest && (
                                <button type="button"
                                  onClick={() => {
                                    selectPlan('학급');
                                    setInfo(prev => ({
                                      ...prev,
                                      months: aiClassBest.months,
                                      qty: aiClassQty,
                                      students: aiStudents || prev.students,
                                    }));
                                    setAiTab(false);
                                  }}
                                  className={`w-full text-left rounded-xl border-2 p-3.5 transition-all
                                    ${aiCheaper === 'class' ? 'border-purple-400 bg-purple-50 hover:border-purple-500' : 'border-border bg-white hover:border-primary/40'}`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                        <span className="font-semibold text-sm">학급 플랜 × {aiClassQty}장</span>
                                        {aiCheaper === 'class' && <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full">더 저렴</span>}
                                        {aiClassBest.isEvent && <span className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full">이벤트</span>}
                                      </div>
                                      <p className="text-xs text-muted-foreground">{aiClassBest.label} · {aiClassCapacity}명 커버 · 이용권 {aiClassQty}개 코드</p>
                                      {aiClassQty > 1 && <p className="text-xs text-muted-foreground">{fmt(aiClassBest.total)} × {aiClassQty}장</p>}
                                    </div>
                                    <div className="text-right shrink-0 ml-3">
                                      <p className={`font-bold text-sm ${aiCheaper === 'class' ? 'text-purple-700' : ''}`}>
                                        {fmt(aiClassBest.total * aiClassQty)}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground">VAT 포함</p>
                                    </div>
                                  </div>
                                </button>
                              )}

                              {/* 상위 플랜 옵션 (학년/학교) */}
                              {showComparison && aiHigherBest && aiHigherPlan && (
                                <button type="button"
                                  onClick={() => {
                                    selectPlan(aiHigherPlan);
                                    setInfo(prev => ({
                                      ...prev,
                                      months: aiHigherBest.months,
                                      qty: hasLicenses ? aiLicensesNum : 1,
                                      students: aiStudents || prev.students,
                                    }));
                                    setAiTab(false);
                                  }}
                                  className={`w-full text-left rounded-xl border-2 p-3.5 transition-all
                                    ${aiCheaper === 'higher' ? 'border-teal-400 bg-teal-50 hover:border-teal-500' : 'border-border bg-white hover:border-primary/40'}`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                        <span className="font-semibold text-sm">{PLANS.find(p => p.id === aiHigherPlan)?.label} × 1장</span>
                                        {aiCheaper === 'higher' && <span className="text-[10px] bg-teal-500 text-white px-1.5 py-0.5 rounded-full">더 저렴</span>}
                                        {aiHigherBest.isEvent && <span className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full">이벤트</span>}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        {aiHigherBest.label} · {PLAN_CAPACITY[aiHigherPlan] >= 99999 ? '무제한' : `최대 ${PLAN_CAPACITY[aiHigherPlan].toLocaleString()}명`} ·
                                        {hasLicenses ? ` ${aiLicensesNum}개 코드로 분할 가능` : ' 자유 분할 발급'}
                                      </p>
                                    </div>
                                    <div className="text-right shrink-0 ml-3">
                                      <p className={`font-bold text-sm ${aiCheaper === 'higher' ? 'text-teal-700' : ''}`}>
                                        {fmt(aiHigherBest.total)}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground">VAT 포함</p>
                                    </div>
                                  </div>
                                </button>
                              )}

                              {/* 동일 플랜이면 단일 표시 */}
                              {!showComparison && aiClassBest && (
                                <p className="text-xs text-muted-foreground text-center">
                                  학급 플랜 {aiClassQty}장이 최적 선택입니다.
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground text-center py-2">
                              이용 기간을 입력하면 가격을 비교해드립니다.
                            </p>
                          )}
                        </div>
                      )}

                      {!hasStudents && !hasLicenses && (
                        <p className="text-sm text-muted-foreground text-center py-4">학생 수 또는 이용권 발급 수를 입력해 주세요.</p>
                      )}
                    </div>
                  ) : (
                    <div className="p-5 space-y-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{activePlan.label}</p>
                          <p className="text-sm text-muted-foreground">{activePlan.capacity}</p>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium mb-3 block">이용 기간</Label>
                        {IS_EVENT && (
                          <div className="mb-3">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-pink-600 mb-2">
                              <Sparkles className="h-3.5 w-3.5" />신학기 이벤트 특가 (~ 3/31)
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {([6, 12] as const).map(m => (
                                <button key={m} type="button"
                                  onClick={() => { setInfo(p => ({ ...p, months: m })); setShowCustom(false); }}
                                  className={`relative rounded-xl border-2 p-3.5 text-left transition-all
                                    ${info.months === m && !showCustom ? 'border-pink-500 bg-pink-50 shadow-sm' : 'border-pink-200 bg-pink-50/30 hover:border-pink-400'}`}>
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <p className="font-semibold text-sm">{m === 6 ? '6개월' : '12개월'}</p>
                                      <p className="text-[11px] text-muted-foreground">{m === 6 ? '1학기' : '1학기 + 2학기'}</p>
                                    </div>
                                    <span className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full leading-none mt-0.5">SALE</span>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground line-through mt-1.5">{fmt(REG[m][info.planId])}</p>
                                  <p className="text-base font-bold text-pink-600">{fmt(EVT[m][info.planId])}</p>
                                  {info.months === m && !showCustom && <CheckCircle2 className="absolute bottom-3 right-3 h-4 w-4 text-pink-500" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          {[1, 4].map(m => (
                            <button key={m} type="button"
                              onClick={() => { setInfo(p => ({ ...p, months: m })); setShowCustom(false); }}
                              className={`relative rounded-xl border-2 p-3.5 text-left transition-all
                                ${info.months === m && !showCustom ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/40'}`}>
                              <p className="font-semibold text-sm">{m}개월</p>
                              <p className="text-base font-bold mt-1">{fmt(REG[m][info.planId])}</p>
                              {info.months === m && !showCustom && <CheckCircle2 className="absolute bottom-3 right-3 h-4 w-4 text-primary" />}
                            </button>
                          ))}
                        </div>
                        <button type="button" onClick={() => setShowCustom(v => !v)}
                          className={`w-full text-sm border rounded-xl py-2.5 transition-colors
                            ${showCustom ? 'border-primary text-primary bg-primary/5' : 'border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 hover:text-primary'}`}>
                          {showCustom ? '직접 입력 닫기' : '+ 원하는 개월 수 직접 입력'}
                        </button>
                        {showCustom && (
                          <div className="mt-3 space-y-3">
                            <div className="flex items-center gap-2">
                              <Input type="number" value={customMonths} onChange={e => setCustomMonths(e.target.value)}
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
                                      ${s.recommended ? 'border-teal-400 bg-teal-50/60 hover:border-teal-500' : 'border-border hover:border-primary/40'}`}>
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-semibold text-sm">{s.label}</span>
                                          {s.recommended && <span className="text-[10px] bg-teal-500 text-white px-1.5 py-0.5 rounded-full">추천</span>}
                                          {s.isEvent && <span className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full">이벤트</span>}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">{s.breakdown}</p>
                                      </div>
                                      <span className={`font-bold text-sm shrink-0 ml-2 ${s.recommended ? 'text-teal-700' : ''}`}>{fmt(s.total)}</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {/* 학생 수 + 이용권 수량 */}
                      <div className="space-y-3">
                        <div>
                          <Label className="text-sm font-medium mb-1.5 block">학생 수 (인원)</Label>
                          <div className="flex items-center gap-2">
                            <Input type="number" min={1} value={info.students}
                              onChange={e => {
                                const v = e.target.value;
                                setInfo(p => {
                                  const n = parseInt(v, 10);
                                  const newMin = (p.planId === '학급' && n > 0) ? Math.max(1, Math.ceil(n / 40)) : p.qty;
                                  return { ...p, students: v, qty: Math.max(p.qty, newMin) };
                                });
                              }}
                              placeholder="예: 120" className="h-10 w-32" />
                            <span className="text-sm text-muted-foreground">명</span>
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm font-medium mb-1 block">
                            이용권 수량
                            <span className="text-xs text-muted-foreground font-normal ml-1.5">
                              {isGradeClass ? '(학급 1장 = 40명 그룹 1개)' : '(분할 발송 수)'}
                            </span>
                          </Label>
                          <div className="flex items-center gap-3 mt-1.5">
                            <button type="button"
                              onClick={() => setInfo(p => ({ ...p, qty: Math.max(minQty, p.qty - 1) }))}
                              className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">−</button>
                            <span className="w-12 text-center font-bold text-xl">{info.qty}</span>
                            <button type="button"
                              onClick={() => setInfo(p => ({ ...p, qty: Math.min(30, p.qty + 1) }))}
                              className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">+</button>
                            <span className="text-sm text-muted-foreground">장</span>
                          </div>
                        </div>
                        <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 ${overCapacity ? 'bg-red-50 text-red-700' : 'bg-teal-50 text-teal-700'}`}>
                          {overCapacity
                            ? `⚠ 이용권 수량 부족 — 현재 ${capacityLabel} 커버 (학생 ${studentsNum}명)`
                            : `✓ ${capacityLabel} 이용 가능${isGradeClass && info.qty > 1 ? ` (학급 ${info.qty}개)` : ''}`}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 금액 미리보기 */}
                {!aiTab && (
                  <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground">견적 금액 미리보기</h3>
                    <div className="space-y-2 text-sm">
                      {info.students && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">학생 수</span>
                          <span>{parseInt(info.students, 10).toLocaleString('ko-KR')}명</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">플랜</span>
                        <span>{activePlan.label} · {info.months}개월 · 이용권 {info.qty}장</span>
                      </div>
                      {priceIsEvent && (
                        <div className="flex justify-between text-pink-600 text-xs">
                          <span className="flex items-center gap-1"><Tag className="h-3 w-3" />이벤트 할인 적용</span>
                          <span>정가 {fmt((REG[info.months]?.[info.planId] ?? 0) * info.qty)} → {fmt(total)}</span>
                        </div>
                      )}
                      <div className="flex justify-between"><span className="text-muted-foreground">공급가액</span><span>{fmt(supply)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">부가세 (10%)</span><span>{fmt(tax)}</span></div>
                      <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
                        <span>최종 금액</span><span className="text-primary">{fmt(total)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-12" onClick={() => setQStep(1)}>이전</Button>
                  <Button className="flex-[2] h-12 text-base"
                    onClick={async () => {
                      const qNum = await saveWebQuote();
                      if (qNum) { setQStep(3); setQStep3Sub('preview'); }
                    }}
                    disabled={aiTab || !unitPrice || savingQuote}>
                    {savingQuote ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    견적서 생성 <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: 견적서 미리보기 + 발송 */}
            {qStep === 3 && (
              <div className="space-y-4">
                {/* 견적서 미리보기 */}
                {qStep3Sub !== 'sent' && (
                  <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-5 print:shadow-none print:border-0">
                    <div className="flex items-center justify-between border-b pb-4">
                      <div>
                        <h2 className="font-bold text-lg">견 적 서</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">Tebahsoft, Inc. · 심스페이스-{selectedProduct.name}</p>
                        {savedQuoteNum && (
                          <span className="inline-flex items-center mt-1.5 bg-teal-50 text-teal-700 border border-teal-200 rounded-md px-2.5 py-1 font-mono font-bold text-sm tracking-wide">
                            {savedQuoteNum}
                          </span>
                        )}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>042-864-5566</p>
                        <p>{new Date().toLocaleDateString('ko-KR')}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      {[['기관명', info.orgName], ['담당자', info.contactName], ['연락처', info.phone], ['이메일', info.email]].map(([k, v]) => v && (
                        <div key={k} className="flex gap-4">
                          <span className="text-muted-foreground w-16 shrink-0">{k}</span>
                          <span className="font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                    <table className="w-full text-sm border-collapse border border-border rounded-lg overflow-hidden">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="border border-border px-3 py-2 text-left font-medium">품목</th>
                          <th className="border border-border px-3 py-2 text-right font-medium">수량</th>
                          <th className="border border-border px-3 py-2 text-right font-medium">단가</th>
                          <th className="border border-border px-3 py-2 text-right font-medium">금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="border border-border px-3 py-2">{activePlan.label} · {info.months}개월</td>
                          <td className="border border-border px-3 py-2 text-right">{info.qty}장</td>
                          <td className="border border-border px-3 py-2 text-right">{fmt(unitPrice)}</td>
                          <td className="border border-border px-3 py-2 text-right font-medium">{fmt(supply)}</td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30">
                          <td colSpan={3} className="border border-border px-3 py-2 text-right text-muted-foreground">부가세 (10%)</td>
                          <td className="border border-border px-3 py-2 text-right">{fmt(tax)}</td>
                        </tr>
                        <tr className="bg-primary/5">
                          <td colSpan={3} className="border border-border px-3 py-2 text-right font-bold">합계</td>
                          <td className="border border-border px-3 py-2 text-right font-bold text-primary">{fmt(total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {priceIsEvent && (
                      <div className="flex items-center gap-2 text-xs text-pink-600 bg-pink-50 rounded-lg px-3 py-2">
                        <Sparkles className="h-3.5 w-3.5 shrink-0" />신학기 이벤트 가격 적용
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
                      <p>• 결제 후 이용권이 담당자 휴대폰으로 발송됩니다.</p>
                      <p>• 세금계산서 필요 시 결제 후 별도 신청해 주세요.</p>
                      <p>• 견적 유효기간: 발급일로부터 30일</p>
                    </div>
                  </div>
                )}

                {/* 발송 완료 */}
                {qStep3Sub === 'sent' && (
                  <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="h-8 w-8 text-teal-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold mb-1">견적서가 발송되었습니다</h2>
                      <p className="text-sm text-muted-foreground">{info.email} 로 견적서가 발송되었습니다.</p>
                    </div>
                    {savedQuoteNum && (
                      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-center space-y-1.5">
                        <p className="text-xs text-teal-600 font-medium">견적서 번호 — 저장해 두세요!</p>
                        <div className="flex items-center justify-center gap-2.5">
                          <span className="font-mono font-bold text-teal-800 text-xl tracking-widest">{savedQuoteNum}</span>
                          <button type="button" onClick={() => navigator.clipboard.writeText(savedQuoteNum)}
                            className="text-xs bg-white border border-teal-300 text-teal-700 rounded px-2 py-0.5 hover:bg-teal-100 transition-colors">복사</button>
                        </div>
                      </div>
                    )}
                    <div className="bg-blue-50 rounded-xl p-4 text-left text-sm text-blue-800 space-y-1">
                      <p className="font-medium">다음 단계 안내</p>
                      <p className="text-xs text-blue-700">견적서 번호를 저장해 두시고, 결제 준비가 되시면 메인 화면의 <strong>결제하기</strong>를 이용해 주세요.</p>
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1 h-11" onClick={() => window.print()}>
                        <Printer className="h-4 w-4 mr-2" />인쇄
                      </Button>
                      <Button className="flex-1 h-11" onClick={goEntry}>
                        처음으로
                      </Button>
                    </div>
                  </div>
                )}

                {/* 액션 버튼 */}
                {qStep3Sub !== 'sent' && (
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 h-12" onClick={() => setQStep(2)}>이전</Button>
                    <Button variant="outline" className="flex-1 h-12 print:hidden" onClick={() => window.print()}>
                      <Printer className="h-4 w-4 mr-2" />인쇄
                    </Button>
                    <Button className="flex-[2] h-12 text-base"
                      onClick={async () => {
                        setQStep3Sub('sending');
                        await sendQuoteEmail(savedQuoteNum ?? '');
                        setQStep3Sub('sent');
                      }}
                      disabled={qStep3Sub === 'sending' || !info.email}>
                      {qStep3Sub === 'sending'
                        ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />발송 중...</>
                        : <><Send className="h-4 w-4 mr-2" />이메일로 견적서 받기</>}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══ STAGE 2: 입금 ═══════════════════════════════ */}
        {mode === 'payment-stage' && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-xl font-bold mb-1">결제하기</h1>
              <p className="text-sm text-muted-foreground">견적서 번호로 조회 후 결제를 진행합니다.</p>
            </div>

            {/* 조회 */}
            {pSub === 'lookup' && (
              <QuoteLookupPanel
                quoteNum={pQuoteNum} setQuoteNum={v => { setPQuoteNum(v); setPError(''); }}
                email={pEmail} setEmail={v => { setPEmail(v); setPError(''); }}
                phone={pPhone} setPhone={v => { setPPhone(v); setPError(''); }}
                onLookup={() => lookupQuote(pQuoteNum, pEmail, pPhone, setPLoading, setPError, q => {
                  setPQuote(q);
                  setPContact({ name: '', phone: normalizePhone(pPhone) ? pPhone : (q.contact_phone ?? ''), email: pEmail || (q.contact_email ?? '') });
                  setPSub('confirm');
                })}
                loading={pLoading} error={pError}
                hint="견적서 번호는 담당자로부터 받은 견적서에서 확인하실 수 있습니다."
              />
            )}

            {/* 견적 확인 + 결제자 정보 */}
            {pSub === 'confirm' && pQuote && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">견적서 확인</h2>
                    <span className="text-xs font-mono bg-muted px-2.5 py-1 rounded-full">{pQuote.quote_number}</span>
                  </div>
                  <div className="space-y-2 text-sm divide-y divide-border">
                    {pQuote.plan && <div className="flex justify-between py-2"><span className="text-muted-foreground">플랜</span><span className="font-medium">{pQuote.plan}</span></div>}
                    {pQuote.qty != null && <div className="flex justify-between py-2"><span className="text-muted-foreground">이용권 수량</span><span>{pQuote.qty}장</span></div>}
                    {pQuote.duration != null && <div className="flex justify-between py-2"><span className="text-muted-foreground">이용 기간</span><span>{pQuote.duration}개월</span></div>}
                    {pQuote.quote_date && <div className="flex justify-between py-2"><span className="text-muted-foreground">견적일</span><span>{pQuote.quote_date}</span></div>}
                    <div className="flex justify-between py-2"><span className="text-muted-foreground">공급가액</span><span>{fmt(pSupply)}</span></div>
                    <div className="flex justify-between py-2"><span className="text-muted-foreground">부가세 (10%)</span><span>{fmt(pTax)}</span></div>
                    <div className="flex justify-between pt-3 font-bold text-base">
                      <span>결제금액</span><span className="text-primary">{fmt(pFinal)}</span>
                    </div>
                  </div>
                </div>

                {/* 결제자 정보 */}
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold text-sm">결제자 정보</h2>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm">담당자 이름 *</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={pContact.name} onChange={e => setPContact(p => ({ ...p, name: e.target.value }))}
                          placeholder="홍길동" className="pl-9 h-11" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">휴대폰 번호 *</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={pContact.phone} onChange={e => setPContact(p => ({ ...p, phone: formatPhone(e.target.value) }))}
                          placeholder="010-1234-5678" className="pl-9 h-11" type="tel" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">이메일</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={pContact.email} onChange={e => setPContact(p => ({ ...p, email: e.target.value }))}
                          placeholder="example@school.kr" className="pl-9 h-11" type="email" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 결제 방법 선택 */}
                <p className="text-center text-sm font-medium text-muted-foreground">결제 방법을 선택해 주세요</p>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button"
                    disabled={!pContact.name.trim() || !pContact.phone.trim()}
                    onClick={() => setPSub('toss')}
                    className="group bg-white rounded-2xl border-2 border-border hover:border-primary disabled:opacity-50 shadow-sm p-5 text-left transition-all hover:shadow-md">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                      <CreditCard className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-bold text-sm mb-1">카드 결제</h3>
                    <p className="text-xs text-muted-foreground">토스페이먼츠로 안전하게 결제합니다.</p>
                  </button>
                  <button type="button"
                    disabled={!pContact.name.trim() || !pContact.phone.trim()}
                    onClick={() => setPSub('bank')}
                    className="group bg-white rounded-2xl border-2 border-border hover:border-teal-500 disabled:opacity-50 shadow-sm p-5 text-left transition-all hover:shadow-md">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center mb-3">
                      <Banknote className="h-5 w-5 text-teal-600" />
                    </div>
                    <h3 className="font-bold text-sm mb-1">계좌이체</h3>
                    <p className="text-xs text-muted-foreground">입금 후 이용권 발송을 요청합니다.</p>
                  </button>
                </div>

                <Button variant="outline" className="w-full h-11" onClick={() => { setPSub('lookup'); setPQuote(null); }}>다른 견적서 조회</Button>
              </div>
            )}

            {/* 카드 결제 (Toss) */}
            {pSub === 'toss' && pQuote && (
              <div className="space-y-4">
                <div className="bg-muted/40 rounded-2xl p-4 text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">견적번호</span><span className="font-mono font-medium">{pQuote.quote_number}</span></div>
                  {pQuote.plan && <div className="flex justify-between"><span className="text-muted-foreground">플랜</span><span>{pQuote.plan}{pQuote.duration ? ` · ${pQuote.duration}개월` : ''}</span></div>}
                  <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
                    <span>결제금액</span><span className="text-primary">{fmt(pFinal)}</span>
                  </div>
                </div>
                <TossPaySection
                  amount={pFinal}
                  orderName={`${pQuote.quote_number}${pQuote.plan ? ` · ${pQuote.plan}` : ''}`}
                  customerName={pContact.name}
                  customerPhone={pContact.phone}
                  customerEmail={pContact.email}
                  plan={pQuote.plan}
                  qty={pQuote.qty ?? 1}
                  duration={pQuote.duration ?? 12}
                  quoteNumber={pQuote.quote_number}
                  onBack={() => setPSub('confirm')}
                />
              </div>
            )}

            {/* 계좌이체 */}
            {pSub === 'bank' && pQuote && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Banknote className="h-5 w-5 text-teal-600" />계좌이체 안내
                  </h2>
                  <div className="bg-teal-50 rounded-xl p-4 space-y-3">
                    <p className="text-xs text-teal-600 font-medium">아래 계좌로 입금해 주세요</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">은행</span>
                        <span className="font-semibold">{BANK_INFO.bank}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">계좌번호</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{BANK_INFO.account}</span>
                          <button type="button" onClick={() => navigator.clipboard.writeText(BANK_INFO.account)}
                            className="text-xs text-teal-600 hover:underline">복사</button>
                        </div>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">예금주</span>
                        <span className="font-semibold">{BANK_INFO.holder}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2 mt-1 font-bold">
                        <span>입금금액</span>
                        <span className="text-teal-700">{fmt(pFinal)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1.5">
                    <p>• 견적서 번호(<span className="font-mono">{pQuote.quote_number}</span>)를 입금자명에 포함해 주시면 처리가 빠릅니다.</p>
                    <p>• 입금 확인 후 이용권 발송 단계에서 이용권을 발급받으실 수 있습니다.</p>
                    <p>• 세금계산서 필요 시 <a href="mailto:contact@tebahsoft.com" className="text-primary underline underline-offset-2">contact@tebahsoft.com</a>으로 문의해 주세요.</p>
                  </div>
                </div>
                <div className="bg-purple-50 rounded-xl border border-purple-100 p-4 text-sm">
                  <p className="font-medium text-purple-800 mb-1">입금 후 이용권 받기</p>
                  <p className="text-xs text-purple-700">입금 확인 후 담당자가 이용권 발송 단계로 안내드립니다.<br />또는 메인 화면 → <strong>이용권 발송</strong>에서 직접 요청하실 수 있습니다.</p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-11" onClick={() => setPSub('confirm')}>이전</Button>
                  <Button className="flex-[2] h-11" onClick={() => setPSub('bank-done')}>확인했습니다</Button>
                </div>
              </div>
            )}

            {/* 계좌이체 완료 안내 */}
            {pSub === 'bank-done' && (
              <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-8 w-8 text-teal-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-1">입금 안내를 확인했습니다</h2>
                  <p className="text-sm text-muted-foreground">입금 완료 후 이용권 발송을 요청해 주세요.</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">견적번호</span><span className="font-mono">{pQuote?.quote_number}</span></div>
                  <div className="flex justify-between font-bold"><span>입금금액</span><span className="text-primary">{fmt(pFinal)}</span></div>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-11" onClick={goEntry}>처음으로</Button>
                  <Button className="flex-[2] h-11" onClick={() => { goEntry(); setTimeout(() => { setMode('license-stage'); setLQuoteNum(pQuote?.quote_number ?? ''); }, 50); }}>
                    <Gift className="h-4 w-4 mr-2" />이용권 발송 요청
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ STAGE 3: 이용권발송 ══════════════════════════ */}
        {mode === 'license-stage' && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-xl font-bold mb-1">이용권 발송</h1>
              <p className="text-sm text-muted-foreground">입금 완료 후 이용권을 발급받습니다.</p>
            </div>

            {/* 조회 */}
            {lSub === 'lookup' && (
              <QuoteLookupPanel
                quoteNum={lQuoteNum} setQuoteNum={v => { setLQuoteNum(v); setLError(''); }}
                email={lEmail} setEmail={v => { setLEmail(v); setLError(''); }}
                phone={lPhone} setPhone={v => { setLPhone(v); setLError(''); }}
                onLookup={() => lookupQuote(lQuoteNum, lEmail, lPhone, setLLoading, setLError, q => {
                  setLQuote(q);
                  setLContact({ name: '', phone: normalizePhone(lPhone) ? lPhone : (q.contact_phone ?? ''), email: lEmail || (q.contact_email ?? '') });
                  setLSub('confirm');
                })}
                loading={lLoading} error={lError}
                hint="입금 완료 후 진행해 주세요. 미리 요청하시면 이용권이 발급되지 않을 수 있습니다."
              />
            )}

            {/* 확인 + 수령인 정보 */}
            {lSub === 'confirm' && lQuote && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">견적서 확인</h2>
                    <span className="text-xs font-mono bg-muted px-2.5 py-1 rounded-full">{lQuote.quote_number}</span>
                  </div>
                  <div className="space-y-2 text-sm divide-y divide-border">
                    {lQuote.plan && <div className="flex justify-between py-2"><span className="text-muted-foreground">플랜</span><span className="font-medium">{lQuote.plan}</span></div>}
                    {lQuote.qty != null && <div className="flex justify-between py-2"><span className="text-muted-foreground">이용권 수량</span><span>{lQuote.license_qty ?? lQuote.qty}장</span></div>}
                    {lQuote.duration != null && <div className="flex justify-between py-2"><span className="text-muted-foreground">이용 기간</span><span>{lQuote.duration}개월</span></div>}
                    {lQuote.final_value != null && (
                      <div className="flex justify-between pt-3 font-bold text-base">
                        <span>결제금액</span><span className="text-primary">{fmt(lQuote.final_value)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 수령인 정보 */}
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold text-sm">이용권 수령인 정보</h2>
                  <p className="text-xs text-muted-foreground">입력하신 휴대폰 번호로 이용권이 발송됩니다.</p>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm">담당자 이름 *</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={lContact.name} onChange={e => setLContact(p => ({ ...p, name: e.target.value }))}
                          placeholder="홍길동" className="pl-9 h-11" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">휴대폰 번호 * <span className="text-muted-foreground font-normal">(이용권 발송)</span></Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={lContact.phone} onChange={e => setLContact(p => ({ ...p, phone: formatPhone(e.target.value) }))}
                          placeholder="010-1234-5678" className="pl-9 h-11" type="tel" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">이메일</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={lContact.email} onChange={e => setLContact(p => ({ ...p, email: e.target.value }))}
                          placeholder="example@school.kr" className="pl-9 h-11" type="email" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-12" onClick={() => { setLSub('lookup'); setLQuote(null); }}>이전</Button>
                  <Button className="flex-[2] h-12 text-base"
                    disabled={!lContact.name.trim() || !lContact.phone.trim()}
                    onClick={issueLicenses}>
                    <Gift className="h-4 w-4 mr-2" />이용권 발급 요청
                  </Button>
                </div>
              </div>
            )}

            {/* 발급 중 */}
            {lSub === 'issuing' && (
              <div className="bg-white rounded-2xl border shadow-sm p-12 text-center space-y-4">
                <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto" />
                <p className="font-medium">이용권 발급 중입니다...</p>
                <p className="text-sm text-muted-foreground">잠시만 기다려 주세요.</p>
              </div>
            )}

            {/* 발급 완료 */}
            {lSub === 'done' && (
              <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-6">
                <div className="w-20 h-20 rounded-full bg-teal-50 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-10 w-10 text-teal-500" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">이용권이 발급되었습니다!</h2>
                  <p className="text-sm text-muted-foreground">입력하신 휴대폰 번호로 이용권이 발송되었습니다.</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-left space-y-3">
                  {lCoupons.map((code, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-muted-foreground text-sm">이용권 코드 {lCoupons.length > 1 ? `(${i + 1}/${lCoupons.length})` : ''}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-teal-700 tracking-wider">{code}</span>
                        <button type="button" onClick={() => navigator.clipboard.writeText(code)}
                          className="text-xs text-teal-600 hover:underline">복사</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 text-left">
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50">
                    <Phone className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm text-blue-900">알림톡 발송 완료</p>
                      <p className="text-xs text-blue-700 mt-0.5">{lContact.phone}으로 이용권 코드와 사용 안내가 발송되었습니다.</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button asChild variant="outline" className="flex-1 h-11">
                    <a href="https://seamspace.co.kr" target="_blank" rel="noopener noreferrer">서비스 바로가기</a>
                  </Button>
                  <Button className="flex-1 h-11" onClick={goEntry}>처음으로</Button>
                </div>
              </div>
            )}

            {/* 오류 */}
            {lSub === 'error' && (
              <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                  <span className="text-3xl">⚠</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold mb-1">이용권 발급 오류</h2>
                  <p className="text-sm text-muted-foreground">잠시 후 다시 시도하거나 고객센터에 문의해 주세요.</p>
                </div>
                <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700 text-left">{lError}</div>
                <p className="text-xs text-muted-foreground">고객센터: <a href="tel:042-864-5566" className="text-primary">042-864-5566</a></p>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-11" onClick={() => setLSub('confirm')}>다시 시도</Button>
                  <Button className="flex-1 h-11" onClick={goEntry}>처음으로</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t mt-16 py-10 print:hidden bg-muted/30">
        <div className="max-w-2xl mx-auto px-4 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground/70">Tebahsoft, Inc. (테바소프트 주식회사)</p>
          <p>대표이사: 오정섭 · 사업자등록번호: 440-87-02207</p>
          <p>통신판매업 신고번호: 제2022-대전유성-0475호</p>
          <p>주소: 대전시 유성구 궁동로2번길 81, 107호</p>
          <p>고객센터: 042-864-5566 · contact@tebahsoft.com</p>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
            <a href="/terms" className="hover:text-foreground transition-colors">이용약관</a>
            <a href="/privacy" className="hover:text-foreground transition-colors">개인정보처리방침</a>
            <a href="mailto:contact@tebahsoft.com" className="hover:text-foreground transition-colors">고객문의</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
