import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertTriangle, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearCart, markCouponUsed } from '@/lib/shop';
import { notifyShopOrder } from '@/lib/telegram';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export default function ShopComplete() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [issuedCoupons, setIssuedCoupons] = useState<Array<{ productName: string; couponCode: string; alimtokOk?: boolean }>>([]);

  useEffect(() => {
    const paymentKey = params.get('paymentKey');
    const tossOrderId = params.get('orderId');
    const amount = params.get('amount');

    if (!paymentKey || !tossOrderId || !amount) {
      setStatus('error');
      setError('결제 정보가 올바르지 않습니다.');
      return;
    }

    const confirm = async () => {
      try {
        // sessionStorage에서 주문 정보 로드
        const raw = sessionStorage.getItem('shop_order');
        if (!raw) {
          setStatus('error');
          setError('주문 정보를 찾을 수 없습니다. 이미 처리된 주문일 수 있습니다.');
          return;
        }
        const orderData = JSON.parse(raw);

        // Edge Function 호출 — Toss 승인 + DB INSERT + 디지털 자동발급 + 영수증 응답
        const confirmRes = await fetch(`${SUPABASE_URL}/functions/v1/confirm-shop-payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
          },
          body: JSON.stringify({
            paymentKey,
            orderId: tossOrderId,
            amount: Number(amount),
            customer: {
              name:  orderData.customer.name,
              phone: orderData.customer.phone,
              email: orderData.customer.email || '',
            },
            shipping: orderData.shipping,
            items:    orderData.items,
            subtotal: orderData.subtotal,
            shippingFee: orderData.shippingFee,
            discount:    orderData.discount ?? 0,
            couponCode:  orderData.couponCode ?? null,
          }),
        });
        const data = await confirmRes.json();
        if (!confirmRes.ok || data.error) {
          throw new Error(data.error || '결제 승인 실패');
        }

        // 영수증 이메일은 Toss가 자동 발송 — 중복 방지를 위해 우리 발송 X

        // 텔레그램 알림 (어드민용)
        const itemSummary = orderData.items.map((i: { productName: string; qty: number }) =>
          `${i.productName} × ${i.qty}`,
        ).join(', ');
        notifyShopOrder({
          orderId: tossOrderId,
          customerName: orderData.customer.name,
          customerPhone: orderData.customer.phone,
          items: itemSummary,
          totalAmount: Number(amount),
          address: orderData.shipping
            ? `${orderData.shipping.address} ${orderData.shipping.addressDetail || ''}`.trim()
            : '디지털 상품 (배송 없음)',
        });

        // 할인쿠폰 사용 처리 (localStorage 기반이라 클라이언트 유지)
        if (orderData.couponCode) {
          await markCouponUsed(orderData.couponCode, tossOrderId, orderData.customer.phone);
        }

        // 발급된 디지털 쿠폰 화면 표시
        if (Array.isArray(data.issuedCoupons)) setIssuedCoupons(data.issuedCoupons);

        // 정리
        clearCart();
        sessionStorage.removeItem('shop_order');
        sessionStorage.removeItem('shop_coupon');

        setOrderId(tossOrderId);
        setStatus('success');
      } catch (e) {
        console.error('주문 처리 실패:', e);
        setStatus('error');
        setError(e instanceof Error ? e.message : '주문 처리 중 오류가 발생했습니다.');
      }
    };

    confirm();
  }, [params]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">주문을 처리하고 있습니다...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">주문 처리 오류</h1>
          <p className="text-sm text-muted-foreground mb-6">{error}</p>
          <p className="text-xs text-muted-foreground mb-4">
            결제는 완료되었을 수 있습니다. 아래 연락처로 문의해 주세요.
          </p>
          <p className="text-xs text-muted-foreground">
            전화: 042-864-5566 · 이메일: sales@tebahsoft.com
          </p>
          <Link to="/shop" className="block mt-4">
            <Button variant="outline">스토어로 돌아가기</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
        <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2">주문이 완료되었습니다!</h1>
        <p className="text-sm text-muted-foreground mb-4">
          주문번호: <span className="font-mono font-bold text-foreground">{orderId}</span>
        </p>

        {issuedCoupons.length > 0 ? (
          <div className="rounded-lg bg-teal-50 dark:bg-teal-950/20 border border-teal-200 px-4 py-3 mb-4 text-left space-y-2">
            {issuedCoupons.some((c) => c.alimtokOk === false) ? (
              <div className="flex items-center gap-1.5 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>이용권은 발급되었으나 알림톡 발송에 실패했습니다. 아래 코드를 보관해주세요.</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-teal-800 dark:text-teal-100">
                <Smartphone className="h-3.5 w-3.5" />
                <span>이용권이 알림톡으로 발송되었습니다</span>
              </div>
            )}
            {issuedCoupons.map((c, i) => (
              <div key={i} className="text-xs flex justify-between">
                <span className="text-muted-foreground">{c.productName}</span>
                <span className="font-mono font-semibold">{c.couponCode}</span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground pt-1 border-t">
              문의: sales@tebahsoft.com
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1 mb-6">
            <p>배송 준비 후 발송해 드리겠습니다.</p>
            <p>주문 조회: 주문번호와 연락처로 배송 상태를 확인할 수 있습니다.</p>
          </div>
        )}

        <div className="flex gap-3">
          <Link to="/shop" className="flex-1">
            <Button variant="outline" className="w-full">스토어</Button>
          </Link>
          <Link to={`/shop/lookup?orderId=${orderId}`} className="flex-1">
            <Button className="w-full">주문 조회</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
