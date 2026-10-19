// 고객 주문 완료 (/shop/print/student/complete)
//
// 두 경로로 들어온다.
//  · 결제를 거친 경우 — 토스가 successUrl 로 보내므로 쿼리에 paymentKey/orderId/amount 가 있다.
//    **주문은 여기서 넣는다**(승인 → 주문 순서를 지켜야 한다).
//  · 결제가 꺼진 Sandbox — 주문 페이지가 이미 주문을 넣고 state 로 결과를 넘겨 준다.

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertTriangle, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { placeCustomerOrder, saveCustomerSession, type CustomerOrderResult } from '@/lib/print-customer';
import { formatWon, formatYm, type ShippingInput } from '@/lib/print';
import { PENDING_KEY } from './PrintStudent';

interface Pending {
  session: string;
  bookTicket: string;
  shipping: ShippingInput;
  includeSecret: boolean;
  amount: number;
  name: string;
  books: { volume: number; from: string; to: string; pages: number }[];
}

export default function PrintStudentComplete() {
  const [params] = useSearchParams();
  const location = useLocation();
  const passed = (location.state ?? null) as { order: CustomerOrderResult; name: string } | null;

  const [order, setOrder] = useState<CustomerOrderResult | null>(passed?.order ?? null);
  const [name, setName] = useState(passed?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (order || ran.current) return;
    ran.current = true;          // 결제 승인은 한 번만. StrictMode 재실행 방지.

    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = params.get('amount');
    const raw = sessionStorage.getItem(PENDING_KEY);

    if (!paymentKey || !orderId || !raw) {
      setError('주문 정보를 찾을 수 없습니다. 이미 처리된 주문일 수 있습니다.');
      return;
    }
    const pending = JSON.parse(raw) as Pending;
    setName(pending.name);

    void (async () => {
      try {
        const res = await placeCustomerOrder({
          session: pending.session,
          bookTicket: pending.bookTicket,
          shipping: pending.shipping,
          includeSecret: pending.includeSecret,
          paymentKey,
          orderId,
          amount: Number(amount),
        });
        setOrder(res);
        sessionStorage.removeItem(PENDING_KEY);
        saveCustomerSession(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '주문 처리에 실패했습니다.';
        setError(msg);
        // 결제는 됐는데 제작 접수가 안 된 경우 — 고객이 다시 결제하면 안 된다.
        setManual(/제작 접수|지연/.test(msg));
      }
    })();
  }, [params, order]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <img src="/logo2.png" alt="Seamspace" className="h-7 w-auto" />
          <span className="font-semibold text-sm">나의 이야기 출력</span>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto px-4 py-16 w-full">
        <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-5">
          {!order && !error && (
            <div className="py-8 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">주문을 접수하고 있습니다…</p>
            </div>
          )}

          {error && (
            <>
              <AlertTriangle className="h-12 w-12 mx-auto text-amber-500" />
              <h1 className="text-xl font-bold">{manual ? '확인이 필요합니다' : '주문을 완료하지 못했습니다'}</h1>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{error}</p>
              {manual && (
                <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-3">
                  <b>다시 결제하지 마세요.</b> 결제는 정상 처리되었습니다.
                  담당자가 확인 후 연락드립니다.
                </p>
              )}
              <p className="text-xs text-muted-foreground">고객센터 042-864-5566</p>
            </>
          )}

          {order && (
            <>
              <CheckCircle2 className="h-14 w-14 mx-auto text-teal-500" />
              <h1 className="text-2xl font-bold">주문이 완료되었습니다</h1>
              <p className="text-sm text-muted-foreground">
                {name && <b>{name}</b>}{name && '님의 '}일기책을 만들기 시작합니다.
                <span className="block mt-1">진행 상황은 카카오 알림톡으로 알려 드립니다.</span>
              </p>

              <div className="text-left rounded-xl border divide-y text-sm">
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">주문번호</span>
                  <span className="font-mono font-medium">{order.orderRef}</span>
                </div>
                {order.volumes.map(v => (
                  <div key={v.volume} className="flex justify-between px-3 py-2">
                    <span>
                      {order.volumes.length > 1 && <b className="mr-1.5">{v.volume}권</b>}
                      {formatYm(v.from)} ~ {formatYm(v.to)}
                    </span>
                    <span className="text-muted-foreground">{v.pages}페이지</span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2.5 font-semibold">
                  <span>결제 금액</span>
                  <span className="tabular-nums">{formatWon(order.totalAmount)}</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                제작·배송에 영업일 기준 약 10일이 걸립니다
              </p>

              {order.receiptUrl && (
                <a href={order.receiptUrl} target="_blank" rel="noreferrer"
                  className="text-xs text-primary hover:underline block">영수증 보기</a>
              )}
            </>
          )}

          <div className="pt-2">
            <Button asChild variant="outline"><Link to="/shop">쇼핑 계속하기</Link></Button>
          </div>
        </div>
      </main>
    </div>
  );
}
