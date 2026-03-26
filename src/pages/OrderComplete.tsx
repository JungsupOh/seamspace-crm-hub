import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, MessageSquare, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OrderComplete() {
  const [params] = useSearchParams();
  const paymentKey = params.get('paymentKey');
  const orderId    = params.get('orderId');
  const amount     = params.get('amount');
  const [confirmed, setConfirmed] = useState(false);

  // 실제 서비스에서는 여기서 Edge Function 호출 → 결제 확인 + 이용권 발급
  // 지금은 심사용 — 결제 확인 API 호출 시뮬레이션
  useEffect(() => {
    if (!paymentKey || !orderId || !amount) return;
    // TODO: fetch('/api/confirm-payment', { paymentKey, orderId, amount })
    const t = setTimeout(() => setConfirmed(true), 800);
    return () => clearTimeout(t);
  }, [paymentKey, orderId, amount]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      {/* 헤더 */}
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm">m</div>
          <span className="font-semibold text-base">mDiary for Schools</span>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto px-4 py-16 w-full">
        <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-6">
          {/* 아이콘 */}
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
          {orderId && (
            <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">주문번호</span>
                <span className="font-mono text-xs">{orderId}</span>
              </div>
              {amount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">결제금액</span>
                  <span className="font-semibold">{Number(amount).toLocaleString('ko-KR')}원</span>
                </div>
              )}
            </div>
          )}

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
        </div>
      </main>
    </div>
  );
}
