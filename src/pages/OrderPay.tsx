// 견적서 번호 기반 결제 페이지 — /order/pay/:quoteNumber
// 1) 이메일 입력 폼 (deal_quotes.contact_email 매칭 = password 역할, privacy)
// 2) 매칭 OK → 견적 요약 + Toss 카드 결제
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? '';
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY };

const nanoid = (n = 8) => crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + (b & 63).toString(36), '');

declare global { interface Window { TossPayments?: any } }

interface DealQuoteRow {
  quote_number: string;
  // 연락처: 견적행은 웹=buyer_*, CRM=비어있음 → 아래에서 통합(email/name/phone)으로 정규화
  contact_email: string | null;
  contact_phone: string | null;
  buyer_email: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  org_name: string | null;
  plan: string | null;
  duration: number | string | null;
  qty: number | string | null;
  unit_price: number | null;
  final_value: number | null;
  supply_price: number | null;
  tax_amount: number | null;
  // 정규화된 연락처 (견적행 우선, 비면 연결 딜에서 보강)
  email: string | null;
  name: string | null;
  phone: string | null;
}

export default function OrderPay() {
  const { quoteNumber } = useParams<{ quoteNumber: string }>();

  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<DealQuoteRow | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // 1) 견적서 조회 (deal_quotes에 contact_name 컬럼 없음 — buyer_* 사용. CRM 견적은 연결 딜에서 보강)
  useEffect(() => {
    if (!quoteNumber) { setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/deal_quotes?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=quote_number,deal_id,contact_email,contact_phone,buyer_email,buyer_name,buyer_phone,org_name,plan,duration,qty,unit_price,final_value,supply_price,tax_amount&limit=1`,
          { headers: HEADERS },
        );
        const rows: (DealQuoteRow & { deal_id?: string })[] = r.ok ? await r.json() : [];
        if (!Array.isArray(rows) || rows.length === 0) return;
        const q = rows[0];
        let email = q.contact_email || q.buyer_email || null;
        let name = q.buyer_name || null;
        let phone = q.contact_phone || q.buyer_phone || null;
        // 견적행에 연락처가 비어있으면(주로 CRM 견적) 연결 딜에서 보강
        if ((!email || !name || !phone) && q.deal_id) {
          try {
            const dr = await fetch(
              `${SUPABASE_URL}/rest/v1/deals?id=eq.${encodeURIComponent(q.deal_id)}&select=contact_email,contact_name,contact_phone&limit=1`,
              { headers: HEADERS },
            );
            const drows = dr.ok ? await dr.json() as { contact_email?: string; contact_name?: string; contact_phone?: string }[] : [];
            if (drows[0]) {
              email = email || drows[0].contact_email || null;
              name = name || drows[0].contact_name || null;
              phone = phone || drows[0].contact_phone || null;
            }
          } catch { /* ignore */ }
        }
        setQuote({ ...q, email, name, phone });
      } finally {
        setLoading(false);
      }
    })();
  }, [quoteNumber]);

  // sessionStorage 인증 캐시 (재진입 시 다시 입력 안 받음)
  useEffect(() => {
    if (!quoteNumber) return;
    const cached = sessionStorage.getItem(`order_pay_auth_${quoteNumber}`);
    if (cached === 'ok') setAuthed(true);
  }, [quoteNumber]);

  // 2) 이메일 검증
  const handleVerifyEmail = () => {
    if (!quote) return;
    setAuthError(null);
    const input = emailInput.trim().toLowerCase();
    const target = (quote.email || '').trim().toLowerCase();
    if (!input) {
      setAuthError('이메일을 입력해주세요.');
      return;
    }
    if (!target) {
      setAuthError('견적서에 이메일이 등록되어 있지 않습니다. 영업 담당자에게 문의해주세요.');
      return;
    }
    if (input !== target) {
      setAuthError('이메일이 견적서와 일치하지 않습니다.');
      return;
    }
    setAuthed(true);
    sessionStorage.setItem(`order_pay_auth_${quoteNumber}`, 'ok');
  };

  // 3) Toss 결제 호출
  const handlePay = async () => {
    if (!quote || !quote.final_value) return;
    setSubmitting(true);
    setPaymentError(null);
    try {
      if (!window.TossPayments) {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1';
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Toss SDK 로드 실패'));
          document.head.appendChild(script);
        });
      }
      const toss = window.TossPayments(TOSS_CLIENT_KEY);
      const orderId = `WEB-${quote.quote_number}-${nanoid()}`;
      const planLabel = quote.plan ? quote.plan.replace('플랜', '') : '심스페이스';
      const durationStr = quote.duration ? `${quote.duration}개월` : '';
      const qtyStr = quote.qty ? ` × ${quote.qty}` : '';
      const orderName = `${planLabel} ${durationStr}${qtyStr}`.trim();

      // OrderComplete가 읽을 세션 정보
      sessionStorage.setItem('toss_order_session', JSON.stringify({
        customerName: quote.name || '',
        customerPhone: (quote.phone || '').replace(/\D/g, ''),
        customerEmail: quote.email || undefined,
        orgName: quote.org_name || undefined,
        plan: quote.plan || undefined,
        qty: Number(quote.qty || 1),
        duration: Number(quote.duration || 12),
        quoteNumber: quote.quote_number,
      }));

      await toss.requestPayment('카드', {
        amount: quote.final_value,
        orderId,
        orderName,
        customerName: quote.name || '',
        customerMobilePhone: (quote.phone || '').replace(/\D/g, ''),
        customerEmail: quote.email || undefined,
        successUrl: `${window.location.origin}/order/complete`,
        failUrl: `${window.location.origin}/order/fail`,
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'USER_CANCEL') {
        setPaymentError(e instanceof Error ? e.message : '결제 오류가 발생했습니다');
        console.error(e);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── 렌더 ──
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">견적서를 찾을 수 없습니다</h1>
          <p className="text-sm text-muted-foreground mb-4">견적서 번호를 다시 확인해주세요.<br />문의: sales@tebahsoft.com</p>
          <Link to="/order"><Button variant="outline" className="w-full">견적서 번호 직접 입력</Button></Link>
        </div>
      </div>
    );
  }

  const planLabel = quote.plan ? `심스페이스(AI마음일기) ${quote.plan.replace('플랜', '')} 플랜` : '심스페이스';

  return (
    <div className="min-h-screen bg-muted/20 py-6 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <h1 className="text-base font-semibold">견적서 결제</h1>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{quote.quote_number}</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!authed ? (
            // ── 이메일 검증 단계 ──
            <>
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
                  견적서를 받으신 <strong>이메일 주소</strong>를 입력해주세요. 다른 분이 견적서 번호만으로 결제 정보를 조회할 수 없도록 보호합니다.
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">이메일 <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={emailInput}
                    onChange={(e) => { setEmailInput(e.target.value); setAuthError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyEmail(); }}
                    placeholder="email@example.com"
                    type="email"
                    className="h-10 text-sm pl-8"
                    autoFocus
                  />
                </div>
                {authError && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3" /> {authError}
                  </p>
                )}
              </div>

              <Button onClick={handleVerifyEmail} className="w-full h-11">
                확인 <ArrowLeft className="h-4 w-4 ml-2 rotate-180" />
              </Button>

              <p className="text-[10px] text-muted-foreground text-center">
                견적서를 못 받으셨거나 이메일이 기억나지 않으시면 sales@tebahsoft.com으로 문의해주세요.
              </p>
            </>
          ) : (
            // ── 결제 단계 ──
            <>
              <div className="bg-teal-50 dark:bg-teal-950/20 border border-teal-200 rounded-lg p-2.5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
                <span className="text-xs text-teal-800 dark:text-teal-100">이메일 확인 완료</span>
              </div>

              <div className="rounded-lg bg-muted/30 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">인수자</span><span>{quote.org_name || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">담당자</span><span>{quote.name || '-'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">상품</span><span className="text-right">{planLabel}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">기간 / 수량</span><span>{quote.duration}개월 × {quote.qty}</span></div>
                {quote.supply_price !== null && (
                  <div className="flex justify-between text-xs text-muted-foreground"><span>공급가</span><span>{quote.supply_price.toLocaleString('ko-KR')}원</span></div>
                )}
                {quote.tax_amount !== null && (
                  <div className="flex justify-between text-xs text-muted-foreground"><span>부가세</span><span>{quote.tax_amount.toLocaleString('ko-KR')}원</span></div>
                )}
                <div className="border-t border-border pt-1.5 flex justify-between font-bold">
                  <span>결제 금액</span>
                  <span className="text-primary">{(quote.final_value ?? 0).toLocaleString('ko-KR')}원</span>
                </div>
              </div>

              {paymentError && <div className="bg-destructive/10 text-destructive text-xs rounded p-2">{paymentError}</div>}

              <Button onClick={handlePay} disabled={submitting || !quote.final_value} className="w-full h-11">
                {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />결제 진행 중...</> : `${(quote.final_value ?? 0).toLocaleString('ko-KR')}원 카드 결제하기`}
              </Button>

              <p className="text-[10px] text-muted-foreground text-center">
                카드 결제만 가능합니다 · 결제 완료 시 입력된 휴대폰으로 이용권이 발송됩니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
