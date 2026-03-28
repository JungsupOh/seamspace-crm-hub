import { useState, useEffect, useRef } from 'react';
// Toss Payments 결제창 SDK loaded via CDN (https://js.tosspayments.com/v1)
import { searchSchools, SchoolInfo } from '@/lib/neis';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Search, ChevronRight, CheckCircle2, Loader2,
  School, User, Phone, Mail, Building2, Sparkles, Tag,
  FileText, CreditCard, ArrowLeft, Printer,
} from 'lucide-react';
const nanoid = (n = 21) => crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + (b & 63).toString(36), '');

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? 'test_ck_D4yKeq5bgrpXmmoXXnJrGX0lzW6Y';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const AIRTABLE_BASE = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appsnsExBG8ZeEZEk';
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN || '';

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
  { id: '학급',     label: '학급 플랜',      shortLabel: '학급',      capacity: '최대 40명',      multiLicense: true },
  { id: '학년',     label: '학년 플랜',      shortLabel: '학년',      capacity: '최대 200명',     badge: '인기', multiLicense: true },
  { id: '학교(소)', label: '학교 플랜 (소)', shortLabel: '학교(소)', capacity: '최대 500명',    multiLicense: true },
  { id: '학교(중)', label: '학교 플랜 (중)', shortLabel: '학교(중)', capacity: '최대 1,000명', multiLicense: true },
  { id: '학교(대)', label: '학교 플랜 (대)', shortLabel: '학교(대)', capacity: '무제한',        multiLicense: true },
];

const PLAN_CAPACITY: Record<PlanKey, number> = {
  '학급': 40, '학년': 200, '학교(소)': 500, '학교(중)': 1000, '학교(대)': 99999,
};

function recommendPlan(students: number): PlanKey {
  for (const plan of PLANS) {
    if (students <= PLAN_CAPACITY[plan.id]) return plan.id;
  }
  return '학교(대)';
}

// ── 가격표 ──────────────────────────────────────────
const REG: Record<number, Record<PlanKey, number>> = {
  1:  { '학급':  40000, '학년':  180000, '학교(소)':  440000, '학교(중)':  850000, '학교(대)':  1200000 },
  4:  { '학급': 150000, '학년':  700000, '학교(소)': 1700000, '학교(중)': 3300000, '학교(대)':  4600000 },
  6:  { '학급': 200000, '학년': 1000000, '학교(소)': 2500000, '학교(중)': 4800000, '학교(대)':  6500000 },
  12: { '학급': 390000, '학년': 1950000, '학교(소)': 4800000, '학교(중)': 9500000, '학교(대)': 11000000 },
};
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

// ── 전화번호 자동 하이픈 포맷 (010-1234-5678) ─────
function formatPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
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

// ── 상품 코드 ──────────────────────────────────────
interface ProductDef {
  code: string; name: string; desc: string; icon: string;
}
const PRODUCTS: ProductDef[] = [
  { code: '01', name: 'AI마음일기', desc: '학교·기관용 AI 감정일기 서비스', icon: '📔' },
  // 추후 추가 예정
  // { code: '02', name: '마음여행 (보드게임)', desc: '감정 소통 보드게임 (한국어판)', icon: '🎲' },
  // { code: '03', name: '마음여행 (보드게임, 영문판)', desc: '감정 소통 보드게임 (영문판)', icon: '🌐' },
  // { code: '04', name: '키링', desc: '심스페이스 공식 키링', icon: '🔑' },
  // { code: '05', name: '마인드스튜디오', desc: '마음 성장 워크숍 & 프로그램', icon: '🎨' },
];

// ── 타입 ──────────────────────────────────────────
interface OrderInfo {
  school: SchoolInfo | null;
  orgName: string; contactName: string; phone: string; email: string;
  planId: PlanKey; months: number; qty: number; students: string;
}
interface QuoteRecord {
  id: string; deal_id: string; quote_number: string;
  plan?: string; qty?: number; duration?: number;
  unit_price?: number; supply_price?: number; tax_amount?: number; final_value?: number;
  quote_date?: string; notes?: string; contact_phone?: string;
}

const DEFAULT_MONTHS = IS_EVENT ? 6 : 12;

// ── Toss 결제창 섹션 (결제창 SDK / test_ck_ 키) ───
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

    // 결제창 SDK 로드 (https://js.tosspayments.com/v1)
    if (!(window as any).TossPayments) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('결제 스크립트 로드 실패'));
        document.head.appendChild(script);
      }).catch((e: unknown) => {
        setError(String(e));
        setLoading(false);
        throw e;
      });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        const msg = (e as { message?: string })?.message ?? String(e);
        setError(msg);
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
      {error && (
        <p className="text-sm text-destructive text-center bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 h-12" onClick={onBack} disabled={loading}>이전</Button>
        <Button className="flex-[2] h-12 text-base font-semibold" onClick={handlePay} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
          {fmt(amount)} 결제하기
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground px-4">
        결제 완료 즉시 이용권이 발급되어 입력하신 휴대폰 번호로 발송됩니다.<br />
        세금계산서가 필요하신 경우 결제 후 별도 신청이 가능합니다.
      </p>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────
export default function Order() {
  // 모드: entry | product-select | new | quote
  const [mode, setMode] = useState<'entry' | 'product-select' | 'new' | 'quote'>('entry');
  const [selectedProduct, setSelectedProduct] = useState<ProductDef>(PRODUCTS[0]);

  // 기관정보 경로 상태
  const [step, setStep] = useState(1);
  const [info, setInfo] = useState<OrderInfo>({
    school: null, orgName: '', contactName: '', phone: '', email: '',
    planId: '학년', months: DEFAULT_MONTHS, qty: 1, students: '',
  });
  const [aiTab, setAiTab] = useState(false);
  const [aiStudents, setAiStudents] = useState('');
  const [aiMonths, setAiMonths] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customMonths, setCustomMonths] = useState('');
  // step 3 선택: choose | quote-preview | pay
  const [step3, setStep3] = useState<'choose' | 'quote-preview' | 'pay'>('choose');

  // 견적서번호 조회 경로 상태
  const [quoteNum, setQuoteNum] = useState('');
  const [quotePhone, setQuotePhone] = useState('');
  const [quoteRecord, setQuoteRecord] = useState<QuoteRecord | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteContact, setQuoteContact] = useState({ name: '', phone: '', email: '' });
  const [quoteReadyToPay, setQuoteReadyToPay] = useState(false);

  // 새 견적 저장 상태
  const [savedQuoteNum, setSavedQuoteNum] = useState<string | null>(null);
  const [savingQuote, setSavingQuote] = useState(false);

  // 계산값
  const activePlan = PLANS.find(p => p.id === info.planId) ?? PLANS[1];
  const { price: unitPrice, isEvent: priceIsEvent } = getUnitPrice(info.months, info.planId);
  // 가격표의 금액은 VAT 포함가 → 역산으로 공급가액/부가세 분리
  const total = unitPrice * info.qty;
  const supply = Math.round(total / 1.1);
  const tax = total - supply;

  const aiStudentsNum = parseInt(aiStudents, 10);
  const aiMonthsNum   = parseInt(aiMonths, 10);
  const aiRecommendedPlan = (!isNaN(aiStudentsNum) && aiStudentsNum > 0) ? recommendPlan(aiStudentsNum) : null;
  const aiSuggestions = (aiRecommendedPlan && !isNaN(aiMonthsNum) && aiMonthsNum > 0)
    ? getSuggestions(aiMonthsNum, aiRecommendedPlan) : [];
  const customNum = parseInt(customMonths, 10);
  const suggestions = (!isNaN(customNum) && customNum > 0) ? getSuggestions(customNum, info.planId) : [];

  const selectPlan = (planId: PlanKey) => {
    const plan = PLANS.find(p => p.id === planId)!;
    setInfo(prev => ({ ...prev, planId, qty: 1, months: !plan.multiLicense && showCustom ? DEFAULT_MONTHS : prev.months }));
    setShowCustom(false); setCustomMonths('');
  };

  const step1Valid = info.orgName.trim() && info.contactName.trim() && info.phone.trim();

  // 전화번호 숫자만 추출해서 비교
  const normalizePhone = (p: string) => p.replace(/\D/g, '');

  // 견적서 조회 (Supabase deal_quotes → Airtable 03_Deals fallback)
  const handleQuoteLookup = async () => {
    if (!quoteNum.trim()) return;
    setQuoteLoading(true);
    setQuoteError('');
    setQuoteRecord(null);
    try {
      const num = quoteNum.trim();
      const enteredPhone = normalizePhone(quotePhone);

      if (!enteredPhone) {
        setQuoteError('휴대폰 번호를 입력해 주세요.');
        setQuoteLoading(false);
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
        // 전화번호 검증 (contact_phone 컬럼이 있는 경우)
        if (record.contact_phone && normalizePhone(record.contact_phone) !== enteredPhone) {
          setQuoteError('휴대폰 번호가 일치하지 않습니다. 견적서에 등록된 번호를 입력해 주세요.');
          return;
        }
        setQuoteRecord(record);
        if (record.contact_phone) {
          setQuoteContact(p => ({ ...p, phone: record.contact_phone! }));
        }
        return;
      }

      // 2차: Airtable 03_Deals에서 Quote_Number 매칭
      const atRes = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/03_Deals?filterByFormula=${encodeURIComponent(`{Quote_Number}="${num}"`)}&maxRecords=1`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const atData = await atRes.json();
      const record = atData?.records?.[0];
      if (!record) {
        setQuoteError('견적서를 찾을 수 없습니다. 번호를 다시 확인해 주세요.');
        return;
      }
      const f = record.fields;

      // 전화번호 검증
      const storedPhone = normalizePhone(f.Contact_Phone ?? '');
      if (storedPhone && storedPhone !== enteredPhone) {
        setQuoteError('휴대폰 번호가 일치하지 않습니다. 견적서에 등록된 번호를 입력해 주세요.');
        return;
      }

      // Airtable 딜 → QuoteRecord 매핑
      const mapped: QuoteRecord = {
        id: record.id,
        deal_id: record.id,
        quote_number: num,
        plan: f.Quote_Plan,
        qty: f.Quote_Qty,
        duration: f.License_Duration,
        unit_price: f.Unit_Price,
        supply_price: f.Supply_Price,
        tax_amount: f.Tax_Amount,
        final_value: f.Final_Contract_Value,
        quote_date: f.Quote_Date,
        notes: f.Notes,
        contact_phone: f.Contact_Phone,
      };
      setQuoteRecord(mapped);
      // 담당자 정보 자동 채우기
      if (f.Contact_Name || f.Contact_Phone || f.Contact_Email) {
        setQuoteContact({
          name:  f.Contact_Name  ?? '',
          phone: f.Contact_Phone ?? '',
          email: f.Contact_Email ?? '',
        });
      }
    } catch {
      setQuoteError('조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setQuoteLoading(false);
    }
  };

  const quoteFinal = quoteRecord?.final_value ?? 0;
  const quoteSupply = quoteRecord?.supply_price ?? Math.round(quoteFinal / 1.1);
  const quoteTax = quoteRecord?.tax_amount ?? (quoteFinal - quoteSupply);

  // 견적 Supabase 저장 (형식: YYYY-상품코드-순번)
  const saveWebQuote = async (): Promise<string | null> => {
    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const pCode = selectedProduct.code;
    const prefix = `${year}-${pCode}-`;
    setSavingQuote(true);
    try {
      // 현재 연도+상품코드의 최대 순번 조회
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
          quote_number: qNum,
          plan: selectedProduct.code === '01' ? activePlan.label : selectedProduct.name,
          qty: info.qty,
          duration: selectedProduct.code === '01' ? info.months : undefined,
          unit_price: selectedProduct.code === '01' ? unitPrice : undefined,
          supply_price: selectedProduct.code === '01' ? supply : undefined,
          tax_amount: selectedProduct.code === '01' ? tax : undefined,
          final_value: selectedProduct.code === '01' ? total : undefined,
          contact_phone: info.phone.replace(/\D/g, ''),
          quote_date: today,
          notes: `[웹주문] 상품: 심스페이스-${selectedProduct.name} / 기관: ${info.orgName} / 담당자: ${info.contactName} / 연락처: ${info.phone}${info.email ? ` / 이메일: ${info.email}` : ''}${info.students ? ` / 학생수: ${info.students}명` : ''}`,
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

  const goEntry = () => {
    setMode('entry'); setStep(1); setStep3('choose');
    setQuoteRecord(null); setQuoteNum(''); setQuotePhone(''); setQuoteError('');
    setQuoteReadyToPay(false); setQuoteContact({ name: '', phone: '', email: '' });
    setSavedQuoteNum(null); setSelectedProduct(PRODUCTS[0]);
  };

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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* 새롭게 견적알아보기 */}
              <button type="button" onClick={() => {
                setSelectedProduct(PRODUCTS[0]);
                PRODUCTS.length === 1 ? (setMode('new'), setStep(1)) : setMode('product-select');
              }}
                className="group bg-white rounded-2xl border-2 border-border hover:border-primary shadow-sm p-6 text-left transition-all hover:shadow-md">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                  <School className="h-6 w-6 text-primary" />
                </div>
                <h2 className="font-bold text-base mb-1">새롭게 견적알아보기</h2>
                <p className="text-sm text-muted-foreground">기관 정보와 플랜을 선택하면<br />견적서를 받거나 즉시 결제할<br />수 있습니다.</p>
                <div className="mt-4 flex items-center gap-1 text-xs text-primary font-medium">
                  시작하기 <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </button>

              {/* 받은 견적으로 결제하기 */}
              <button type="button" onClick={() => setMode('quote')}
                className="group bg-white rounded-2xl border-2 border-border hover:border-primary shadow-sm p-6 text-left transition-all hover:shadow-md">
                <div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center mb-4 group-hover:bg-teal-100 transition-colors">
                  <FileText className="h-6 w-6 text-teal-600" />
                </div>
                <h2 className="font-bold text-base mb-1">받은 견적으로 결제하기</h2>
                <p className="text-sm text-muted-foreground">견적서 번호가 있으신가요?<br />번호 조회 후 바로 결제할<br />수 있습니다.</p>
                <div className="mt-4 flex items-center gap-1 text-xs text-teal-600 font-medium">
                  번호 조회하기 <ChevronRight className="h-3.5 w-3.5" />
                </div>
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
                  onClick={() => {
                    setSelectedProduct(p);
                    setMode('new'); setStep(1);
                  }}
                  className="group bg-white rounded-2xl border-2 border-border hover:border-primary shadow-sm p-4 text-left transition-all hover:shadow-md flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0 group-hover:bg-primary/10 transition-colors">
                    {p.icon}
                  </div>
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

        {/* ══ 견적서번호 조회 경로 ═══════════════════════ */}
        {mode === 'quote' && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-xl font-bold mb-1">견적서 번호로 결제</h1>
              <p className="text-sm text-muted-foreground">담당자로부터 받은 견적서 번호를 입력해 주세요.</p>
            </div>

            {/* 번호 입력 */}
            {!quoteRecord && (
              <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">견적서 번호</Label>
                    <Input
                      value={quoteNum}
                      onChange={e => { setQuoteNum(e.target.value); setQuoteError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleQuoteLookup(); }}
                      placeholder="예: 2026-01-001"
                      className="h-11 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">담당자 휴대폰 번호 <span className="text-muted-foreground font-normal">(본인 확인용)</span></Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={quotePhone}
                        onChange={e => { setQuotePhone(formatPhone(e.target.value)); setQuoteError(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') handleQuoteLookup(); }}
                        placeholder="010-1234-5678"
                        className="h-11 pl-9"
                        type="tel"
                      />
                    </div>
                  </div>
                  {quoteError && (
                    <p className="text-sm text-destructive">{quoteError}</p>
                  )}
                  <Button
                    onClick={handleQuoteLookup}
                    disabled={quoteLoading || !quoteNum.trim() || !quotePhone.trim()}
                    className="w-full h-11"
                  >
                    {quoteLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    견적서 조회
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  견적서 번호는 담당자로부터 받은 문서에서 확인하실 수 있습니다.<br />
                  번호가 없으시다면 <button type="button" onClick={() => setMode('new')} className="underline text-primary">새롭게 견적알아보기</button>를 이용해 주세요.
                </p>
              </div>
            )}

            {/* 조회 결과 */}
            {quoteRecord && !quoteReadyToPay && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">견적서 확인</h2>
                    <span className="text-xs font-mono bg-muted px-2.5 py-1 rounded-full">{quoteRecord.quote_number}</span>
                  </div>
                  <div className="space-y-2 text-sm divide-y divide-border">
                    {quoteRecord.plan && (
                      <div className="flex justify-between py-2">
                        <span className="text-muted-foreground">플랜</span>
                        <span className="font-medium">{quoteRecord.plan}</span>
                      </div>
                    )}
                    {quoteRecord.qty != null && (
                      <div className="flex justify-between py-2">
                        <span className="text-muted-foreground">이용 인원</span>
                        <span>{quoteRecord.qty.toLocaleString('ko-KR')}명</span>
                      </div>
                    )}
                    {quoteRecord.duration != null && (
                      <div className="flex justify-between py-2">
                        <span className="text-muted-foreground">이용 기간</span>
                        <span>{quoteRecord.duration}개월</span>
                      </div>
                    )}
                    {quoteRecord.quote_date && (
                      <div className="flex justify-between py-2">
                        <span className="text-muted-foreground">견적일</span>
                        <span>{quoteRecord.quote_date}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-2">
                      <span className="text-muted-foreground">공급가액</span>
                      <span>{fmt(quoteSupply)}</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-muted-foreground">부가세 (10%)</span>
                      <span>{fmt(quoteTax)}</span>
                    </div>
                    <div className="flex justify-between pt-3 font-bold text-base">
                      <span>결제금액</span>
                      <span className="text-primary">{fmt(quoteFinal)}</span>
                    </div>
                  </div>
                  {quoteRecord.notes && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">{quoteRecord.notes}</p>
                  )}
                </div>

                {/* 담당자 정보 입력 */}
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold text-sm">결제자 정보 입력</h2>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm">담당자 이름 *</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={quoteContact.name}
                          onChange={e => setQuoteContact(p => ({ ...p, name: e.target.value }))}
                          placeholder="홍길동" className="pl-9 h-11" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">휴대폰 번호 *</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={quoteContact.phone}
                          onChange={e => setQuoteContact(p => ({ ...p, phone: formatPhone(e.target.value) }))}
                          placeholder="010-1234-5678" className="pl-9 h-11" type="tel" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">이메일 <span className="text-muted-foreground font-normal">(선택 · 영수증)</span></Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={quoteContact.email}
                          onChange={e => setQuoteContact(p => ({ ...p, email: e.target.value }))}
                          placeholder="example@school.kr" className="pl-9 h-11" type="email" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-12"
                    onClick={() => { setQuoteRecord(null); setQuoteNum(''); setQuotePhone(''); setQuoteError(''); }}>다른 번호 조회</Button>
                  <Button className="flex-[2] h-12 text-base"
                    disabled={!quoteContact.name.trim() || !quoteContact.phone.trim()}
                    onClick={() => setQuoteReadyToPay(true)}>
                    <CreditCard className="h-4 w-4 mr-2" />결제하기
                  </Button>
                </div>
              </div>
            )}

            {/* 결제 */}
            {quoteRecord && quoteReadyToPay && (
              <div className="space-y-4">
                <div className="bg-muted/40 rounded-2xl p-4 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">견적서번호</span>
                    <span className="font-mono font-medium">{quoteRecord.quote_number}</span>
                  </div>
                  {quoteRecord.plan && (
                    <div className="flex justify-between mb-1">
                      <span className="text-muted-foreground">플랜</span>
                      <span>{quoteRecord.plan}{quoteRecord.duration ? ` · ${quoteRecord.duration}개월` : ''}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-2 mt-1">
                    <span>결제금액</span>
                    <span className="text-primary">{fmt(quoteFinal)}</span>
                  </div>
                </div>
                <TossPaySection
                  amount={quoteFinal}
                  orderName={`${quoteRecord.quote_number}${quoteRecord.plan ? ` · ${quoteRecord.plan}` : ''}`}
                  customerName={quoteContact.name}
                  customerPhone={quoteContact.phone}
                  customerEmail={quoteContact.email}
                  plan={quoteRecord.plan}
                  qty={quoteRecord.qty ?? 1}
                  duration={quoteRecord.duration ?? 12}
                  quoteNumber={quoteRecord.quote_number}
                  onBack={() => setQuoteReadyToPay(false)}
                />
              </div>
            )}
          </div>
        )}

        {/* ══ 기관정보 경로 ══════════════════════════════ */}
        {mode === 'new' && (
          <>
            {/* 단계 표시 */}
            <div className="flex items-center justify-center gap-0 mb-8">
              {['기관 정보', '플랜 선택', '결제 방법'].map((s, i) => (
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
                  {i < 2 && <ChevronRight className={`h-4 w-4 mx-1 ${i + 1 < step ? 'text-primary' : 'text-muted-foreground/30'}`} />}
                </div>
              ))}
            </div>

            {/* Step 1: 기관정보 */}
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
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
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
                      <Input value={info.phone} onChange={e => setInfo(p => ({ ...p, phone: formatPhone(e.target.value) }))}
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

            {/* Step 2: 플랜 선택 */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                  {/* 탭 헤더 */}
                  <div className="flex border-b overflow-x-auto">
                    <button type="button" onClick={() => setAiTab(true)}
                      className={`relative flex-1 min-w-[72px] py-3 px-2 text-center text-xs font-medium transition-colors whitespace-nowrap
                        ${aiTab ? 'text-purple-600 border-b-2 border-purple-500 bg-purple-50/50'
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
                          <span className="absolute top-1 right-1 text-[8px] bg-orange-500 text-white px-1 py-0.5 rounded-full leading-none">{p.badge}</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* AI추천 탭 */}
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
                                    ${s.recommended ? 'border-purple-400 bg-white hover:border-purple-500'
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
                                      <p className="text-[10px] text-muted-foreground">VAT 포함가</p>
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
                    /* 플랜별 탭 */
                    <div className="p-5 space-y-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{activePlan.label}</p>
                          <p className="text-sm text-muted-foreground">{activePlan.capacity}</p>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${activePlan.multiLicense ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>
                          {activePlan.multiLicense ? '수량 분할 발송 가능' : '이용권 1장 발송'}
                        </span>
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
                                      <span className={`font-bold text-sm ${s.recommended ? 'text-teal-700' : ''}`}>{fmt(s.total)}</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {/* 학생 수 + 이용권 수량 */}
                      {(() => {
                        const studentsNum = parseInt(info.students, 10);
                        const isGradeClass = info.planId === '학급';
                        const minQty = (isGradeClass && studentsNum > 0)
                          ? Math.max(1, Math.ceil(studentsNum / 40)) : 1;
                        const capacity = isGradeClass
                          ? info.qty * 40
                          : PLAN_CAPACITY[info.planId];
                        const capacityLabel = info.planId === '학교(대)'
                          ? '무제한'
                          : `최대 ${capacity.toLocaleString('ko-KR')}명`;
                        const overCapacity = studentsNum > 0 && capacity < studentsNum;
                        return (
                          <div className="space-y-3">
                            {/* 학생 수 입력 */}
                            <div>
                              <Label className="text-sm font-medium mb-1.5 block">학생 수 (인원)</Label>
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number" min={1}
                                  value={info.students}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setInfo(p => {
                                      const n = parseInt(v, 10);
                                      const newMin = (p.planId === '학급' && n > 0) ? Math.max(1, Math.ceil(n / 40)) : p.qty;
                                      return { ...p, students: v, qty: Math.max(p.qty, newMin) };
                                    });
                                  }}
                                  placeholder="예: 120"
                                  className="h-10 w-32"
                                />
                                <span className="text-sm text-muted-foreground">명</span>
                              </div>
                            </div>
                            {/* 이용권 수량 */}
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
                            {/* 커버리지 표시 */}
                            <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 ${overCapacity ? 'bg-red-50 text-red-700' : 'bg-teal-50 text-teal-700'}`}>
                              {overCapacity
                                ? `⚠ 이용권 수량 부족 — 현재 ${capacityLabel} 커버 (학생 ${studentsNum}명)`
                                : `✓ ${capacityLabel} 이용 가능${isGradeClass && info.qty > 1 ? ` (학급 ${info.qty}개)` : ''}`}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* 금액 요약 */}
                {!aiTab && (
                  <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground">결제 금액 미리보기</h3>
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
                        <span>최종 결제금액</span><span className="text-primary">{fmt(total)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-12" onClick={() => setStep(1)}>이전</Button>
                  <Button className="flex-[2] h-12 text-base"
                    onClick={async () => {
                      await saveWebQuote();
                      setStep(3); setStep3('choose');
                    }}
                    disabled={aiTab || !unitPrice || savingQuote}>
                    {savingQuote ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    다음 <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: 결제 방법 선택 */}
            {step === 3 && step3 === 'choose' && (
              <div className="space-y-4">
                <div className="bg-muted/40 rounded-2xl p-5 text-sm space-y-2">
                  <h3 className="font-semibold text-base mb-3">주문 요약</h3>
                  {savedQuoteNum && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">견적번호</span>
                      <span className="font-mono font-medium text-primary">{savedQuoteNum}</span>
                    </div>
                  )}
                  <div className="flex justify-between"><span className="text-muted-foreground">기관</span><span className="font-medium">{info.orgName}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">담당자</span><span>{info.contactName} · {info.phone}</span></div>
                  {info.students && <div className="flex justify-between"><span className="text-muted-foreground">학생 수</span><span>{parseInt(info.students,10).toLocaleString('ko-KR')}명</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">플랜</span><span>{activePlan.label} · {info.months}개월 · 이용권 {info.qty}장</span></div>
                  <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
                    <span>결제금액</span><span className="text-primary">{fmt(total)}</span>
                  </div>
                </div>

                <p className="text-center text-sm font-medium text-muted-foreground">어떻게 진행하시겠어요?</p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => setStep3('quote-preview')}
                    className="group bg-white rounded-2xl border-2 border-border hover:border-blue-400 shadow-sm p-5 text-left transition-all hover:shadow-md">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-3 group-hover:bg-blue-100 transition-colors">
                      <FileText className="h-5 w-5 text-blue-600" />
                    </div>
                    <h3 className="font-bold text-sm mb-1">견적서 확인 후 결제</h3>
                    <p className="text-xs text-muted-foreground">견적서를 출력하거나 저장한 뒤<br />나중에 견적서 번호로 돌아와 결제할 수 있습니다.</p>
                  </button>

                  <button type="button" onClick={() => setStep3('pay')}
                    className="group bg-white rounded-2xl border-2 border-border hover:border-primary shadow-sm p-5 text-left transition-all hover:shadow-md">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/15 transition-colors">
                      <CreditCard className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-bold text-sm mb-1">즉시 결제</h3>
                    <p className="text-xs text-muted-foreground">지금 바로 결제하고<br />이용권을 즉시 발급받습니다.</p>
                  </button>
                </div>

                <Button variant="outline" className="w-full h-12" onClick={() => setStep(2)}>이전</Button>
              </div>
            )}

            {/* Step 3-A: 견적서 확인 */}
            {step === 3 && step3 === 'quote-preview' && (
              <div className="space-y-4">
                <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-5 print:shadow-none print:border-0">
                  <div className="flex items-center justify-between border-b pb-4">
                    <div>
                      <h2 className="font-bold text-lg">견 적 서</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Tebahsoft, Inc. · 심스페이스-{selectedProduct.name}</p>
                      {savedQuoteNum && <p className="text-xs font-mono text-primary mt-0.5">{savedQuoteNum}</p>}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Tebahsoft, Inc.</p>
                      <p>042-864-5566</p>
                      <p>{new Date().toLocaleDateString('ko-KR')}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <div className="flex gap-4">
                      <span className="text-muted-foreground w-16 shrink-0">기관명</span>
                      <span className="font-medium">{info.orgName}</span>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-muted-foreground w-16 shrink-0">담당자</span>
                      <span>{info.contactName}</span>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-muted-foreground w-16 shrink-0">연락처</span>
                      <span>{info.phone}</span>
                    </div>
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
                      <Sparkles className="h-3.5 w-3.5 shrink-0" />
                      신학기 이벤트 가격 적용 (2026. 3. 31. 까지)
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
                    <p>• 결제 완료 즉시 이용권이 발급되어 담당자 휴대폰으로 발송됩니다.</p>
                    <p>• 세금계산서 발행이 필요하신 경우 결제 후 별도 신청해 주세요.</p>
                    <p>• 견적 유효기간: 발급일로부터 30일</p>
                  </div>
                </div>

                <div className="bg-blue-50 rounded-2xl border border-blue-200 p-4 text-sm">
                  <p className="font-medium text-blue-800 mb-1">견적서 번호 안내</p>
                  {savedQuoteNum ? (
                    <div>
                      <p className="text-blue-700 text-xs mb-2">아래 번호를 저장해두시면 나중에 결제할 수 있습니다.</p>
                      <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-blue-200">
                        <span className="font-mono font-bold text-blue-900 text-base tracking-wider">{savedQuoteNum}</span>
                        <button type="button"
                          onClick={() => navigator.clipboard.writeText(savedQuoteNum)}
                          className="ml-auto text-xs text-blue-600 hover:text-blue-800 underline">복사</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-blue-700 text-xs">
                      견적서를 저장하시면, 결제 시 견적서 번호로 바로 결제하실 수 있습니다.<br />
                      문의: 042-864-5566
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 h-12" onClick={() => setStep3('choose')}>이전</Button>
                  <Button variant="outline" className="flex-1 h-12" onClick={() => window.print()}>
                    <Printer className="h-4 w-4 mr-2" />인쇄 / 저장
                  </Button>
                  <Button className="flex-[2] h-12" onClick={() => setStep3('pay')}>
                    <CreditCard className="h-4 w-4 mr-2" />바로 결제
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3-B: 즉시 결제 (Toss) */}
            {step === 3 && step3 === 'pay' && (
              <div className="space-y-4">
                <div className="bg-muted/40 rounded-2xl p-4 text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">기관</span><span className="font-medium">{info.orgName}</span></div>
                  {info.students && <div className="flex justify-between"><span className="text-muted-foreground">학생 수</span><span>{parseInt(info.students,10).toLocaleString('ko-KR')}명</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">플랜</span><span>{activePlan.label} · {info.months}개월 · 이용권 {info.qty}장</span></div>
                  {priceIsEvent && <div className="flex justify-between text-pink-600 text-xs"><span>이벤트 할인</span><span>적용됨</span></div>}
                  <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
                    <span>결제금액</span><span className="text-primary">{fmt(total)}</span>
                  </div>
                </div>
                <TossPaySection
                  amount={total}
                  orderName={`심스페이스(${activePlan.shortLabel}) ${info.months}개월${info.qty > 1 ? ` × ${info.qty}장` : ''}`}
                  customerName={info.contactName}
                  customerPhone={info.phone}
                  customerEmail={info.email}
                  orgName={info.orgName}
                  plan={info.planId}
                  qty={info.qty}
                  duration={info.months}
                  quoteNumber={savedQuoteNum ?? undefined}
                  onBack={() => setStep3('choose')}
                />
              </div>
            )}
          </>
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
