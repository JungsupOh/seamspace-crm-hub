import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, MessageSquare, FileText, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export default function OrderComplete() {
  const [params] = useSearchParams();
  const paymentKey = params.get('paymentKey');
  const orderId    = params.get('orderId');
  const amount     = params.get('amount');

  const [confirmed, setConfirmed] = useState(false);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paymentKey || !orderId || !amount) return;

    const session = JSON.parse(sessionStorage.getItem('toss_order_session') || '{}');
    sessionStorage.removeItem('toss_order_session');

    fetch(`${SUPABASE_URL}/functions/v1/confirm-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount),
        customerName:  session.customerName  ?? '',
        customerPhone: session.customerPhone ?? '',
        customerEmail: session.customerEmail ?? undefined,
        orgName:       session.orgName       ?? undefined,
        plan:          session.plan          ?? undefined,
        qty:           session.qty           ?? 1,
        duration:      session.duration      ?? 12,
        quoteNumber:   session.quoteNumber   ?? undefined,
      }),
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.coupon_code) {
          setCouponCode(data.coupon_code);
          setConfirmed(true);
        } else {
          setError(data.error ?? '결제 확인 중 오류가 발생했습니다.');
          setConfirmed(true);
        }
      })
      .catch(() => {
        setError('네트워크 오류로 결제 확인에 실패했습니다. 고객센터(042-864-5566)로 문의해 주세요.');
        setConfirmed(true);
      });
  }, [paymentKey, orderId, amount]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      {/* 헤더 */}
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <img src="/logo2.png" alt="Seamspace" className="h-8 w-auto" />
          <span className="font-semibold text-base">심스페이스</span>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto px-4 py-16 w-full">
        <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-6">

          {!confirmed ? (
            /* 처리 중 */
            <div className="py-8 flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 text-teal-500 animate-spin" />
              <p className="text-sm text-muted-foreground">이용권 발급 중입니다. 잠시 기다려 주세요...</p>
            </div>
          ) : error ? (
            /* 오류 */
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
                  <AlertCircle className="h-10 w-10 text-red-400" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold mb-2">이용권 발급 오류</h1>
                <p className="text-muted-foreground text-sm">결제는 완료되었으나 이용권 발급 중 문제가 발생했습니다.</p>
              </div>
              <div className="bg-red-50 rounded-xl p-4 text-left text-sm text-red-700">
                {error}
              </div>
              <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 text-sm">
                {orderId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">주문번호</span>
                    <span className="font-mono text-xs">{orderId}</span>
                  </div>
                )}
                {amount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">결제금액</span>
                    <span className="font-semibold">{Number(amount).toLocaleString('ko-KR')}원</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                고객센터: <a href="tel:042-864-5566" className="text-primary">042-864-5566</a> ·{' '}
                <a href="mailto:contact@tebahsoft.com" className="text-primary underline underline-offset-2">contact@tebahsoft.com</a>
              </p>
            </>
          ) : (
            /* 성공 */
            <>
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-teal-50 flex items-center justify-center">
                  <CheckCircle2 className="h-10 w-10 text-teal-500" />
                </div>
              </div>

              <div>
                <h1 className="text-2xl font-bold mb-2">결제가 완료되었습니다!</h1>
                <p className="text-muted-foreground text-sm">
                  이용권이 발급되어 입력하신 휴대폰 번호로 발송되었습니다.
                </p>
              </div>

              {/* 주문 정보 */}
              <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 text-sm">
                {orderId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">주문번호</span>
                    <span className="font-mono text-xs">{orderId}</span>
                  </div>
                )}
                {amount && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">결제금액</span>
                    <span className="font-semibold">{Number(amount).toLocaleString('ko-KR')}원</span>
                  </div>
                )}
                {couponCode && (
                  <div className="flex justify-between border-t pt-2 mt-1">
                    <span className="text-muted-foreground">이용권 코드</span>
                    <span className="font-mono font-bold text-teal-700 tracking-wider">{couponCode}</span>
                  </div>
                )}
              </div>

              {/* 안내 */}
              <div className="grid grid-cols-1 gap-3 text-left">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50">
                  <MessageSquare className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm text-blue-900">이용권 문자 발송</p>
                    <p className="text-xs text-blue-700 mt-0.5">입력하신 번호로 이용권 코드와 사용 안내가 발송되었습니다.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                  <FileText className="h-5 w-5 text-slate-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">세금계산서 신청</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      필요하신 경우{' '}
                      <a href="mailto:contact@tebahsoft.com" className="text-primary underline underline-offset-2">
                        contact@tebahsoft.com
                      </a>
                      로 사업자등록증을 보내주시면 발행해 드립니다.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button asChild variant="outline" className="flex-1 h-11">
                  <Link to="/order">추가 구매</Link>
                </Button>
                <Button asChild className="flex-1 h-11">
                  <a href="https://seamspace.co.kr" target="_blank" rel="noopener noreferrer">
                    서비스 바로가기
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </a>
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
