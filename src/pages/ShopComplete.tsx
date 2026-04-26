import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
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

        // shop_orders에 저장
        const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/shop_orders`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            order_id: tossOrderId,
            status: '결제완료',
            customer_name: orderData.customer.name,
            customer_phone: orderData.customer.phone,
            customer_email: orderData.customer.email || null,
            zipcode: orderData.shipping?.zipcode || '',
            address: orderData.shipping?.address || '디지털 상품 (배송 없음)',
            address_detail: orderData.shipping?.addressDetail || null,
            delivery_memo: orderData.shipping?.memo || null,
            subtotal: orderData.subtotal,
            shipping_fee: orderData.shippingFee,
            discount: orderData.discount ?? 0,
            coupon_code: orderData.couponCode || null,
            total_amount: parseInt(amount),
            payment_key: paymentKey,
            toss_method: '카드',
            approved_at: new Date().toISOString(),
          }),
        });

        if (!orderRes.ok) {
          const err = await orderRes.json().catch(() => ({}));
          throw new Error(err.message || '주문 저장 실패');
        }

        // shop_order_items 저장
        const items = orderData.items.map((item: any) => ({
          order_id: tossOrderId,
          product_id: item.productId,
          product_name: item.productName,
          option: item.option || null,
          qty: item.qty,
          unit_price: item.unitPrice,
          subtotal: item.unitPrice * item.qty,
        }));

        await fetch(`${SUPABASE_URL}/rest/v1/shop_order_items`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(items),
        });

        // 텔레그램 알림
        const itemSummary = orderData.items.map((i: any) =>
          `${i.productName} × ${i.qty}`
        ).join(', ');
        notifyShopOrder({
          orderId: tossOrderId,
          customerName: orderData.customer.name,
          customerPhone: orderData.customer.phone,
          items: itemSummary,
          totalAmount: parseInt(amount),
          address: `${orderData.shipping.address} ${orderData.shipping.addressDetail || ''}`.trim(),
        });

        // 쿠폰 사용 처리 (일련번호 + 주문ID + 전화번호 기록)
        if (orderData.couponCode) {
          await markCouponUsed(orderData.couponCode, tossOrderId!, orderData.customer.phone);
        }

        // 장바구니 비우기 + sessionStorage 정리
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
        <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1 mb-6">
          <p>배송 준비 후 발송해 드리겠습니다.</p>
          <p>주문 조회: 주문번호와 연락처로 배송 상태를 확인할 수 있습니다.</p>
        </div>
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
