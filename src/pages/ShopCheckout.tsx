import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCart, getCartTotal, clearCart, type CartItem } from '@/lib/shop';
import { formatPhone } from '@/lib/utils';
import { notifyShopOrder } from '@/lib/telegram';
import { toast } from 'sonner';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? '';

const nanoid = (n = 16) => crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + (b & 63).toString(36), '');

declare global {
  interface Window { TossPayments?: any; }
}

export default function ShopCheckout() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CartItem[]>([]);
  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    zipcode: '', address: '', addressDetail: '', memo: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const cart = getCart();
    if (cart.length === 0) { navigate('/shop/cart'); return; }
    setItems(cart);
  }, [navigate]);

  const { subtotal, shippingFee, total } = getCartTotal(items);
  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Daum 우편번호 검색
  const openPostcode = () => {
    if (!(window as any).daum?.Postcode) {
      const script = document.createElement('script');
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = () => openPostcode();
      document.head.appendChild(script);
      return;
    }
    new (window as any).daum.Postcode({
      oncomplete: (data: any) => {
        f('zipcode', data.zonecode);
        f('address', data.address);
      },
    }).open();
  };

  const canSubmit = form.name.trim() && form.phone.trim() && form.zipcode && form.address;

  const handlePayment = async () => {
    if (!canSubmit) { toast.error('필수 정보를 입력해주세요'); return; }
    setSubmitting(true);

    try {
      const orderId = `SHOP-${nanoid()}`;
      const orderName = items.length === 1
        ? items[0].productName
        : `${items[0].productName} 외 ${items.length - 1}건`;

      // 주문 정보를 sessionStorage에 저장 (결제 완료 후 사용)
      sessionStorage.setItem('shop_order', JSON.stringify({
        orderId,
        items,
        customer: { name: form.name, phone: form.phone.replace(/\D/g, ''), email: form.email },
        shipping: { zipcode: form.zipcode, address: form.address, addressDetail: form.addressDetail, memo: form.memo },
        subtotal, shippingFee, total,
      }));

      // Toss Payments 결제
      if (!window.TossPayments) {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1';
        await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
      }

      const toss = window.TossPayments(TOSS_CLIENT_KEY);
      await toss.requestPayment('카드', {
        amount: total,
        orderId,
        orderName,
        customerName: form.name,
        customerMobilePhone: form.phone.replace(/\D/g, ''),
        customerEmail: form.email || undefined,
        successUrl: `${window.location.origin}/shop/complete`,
        failUrl: `${window.location.origin}/shop/fail`,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== 'USER_CANCEL') {
        toast.error('결제 오류가 발생했습니다');
        console.error(e);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center">
          <Link to="/shop/cart" className="flex items-center gap-2 text-sm hover:text-primary">
            <ArrowLeft className="h-4 w-4" />장바구니
          </Link>
          <span className="flex-1 text-center font-bold">주문/결제</span>
          <span className="w-16" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* 주문 상품 요약 */}
        <div className="bg-white rounded-2xl border border-border p-4">
          <p className="text-sm font-medium mb-3">주문 상품</p>
          {items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span className="text-muted-foreground">{item.productName} × {item.qty}</span>
              <span>{(item.unitPrice * item.qty).toLocaleString()}원</span>
            </div>
          ))}
          <div className="border-t mt-2 pt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">배송비</span>
            <span>{shippingFee === 0 ? '무료' : `${shippingFee.toLocaleString()}원`}</span>
          </div>
          <div className="border-t mt-2 pt-2 flex justify-between font-bold">
            <span>총 결제금액</span>
            <span>{total.toLocaleString()}원</span>
          </div>
        </div>

        {/* 주문자 정보 */}
        <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
          <p className="text-sm font-medium">주문자 정보</p>
          <div className="space-y-1.5">
            <Label className="text-xs">이름 *</Label>
            <Input value={form.name} onChange={e => f('name', e.target.value)} placeholder="홍길동" className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">연락처 *</Label>
            <Input value={form.phone} onChange={e => f('phone', formatPhone(e.target.value))} placeholder="010-0000-0000" className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">이메일</Label>
            <Input value={form.email} onChange={e => f('email', e.target.value)} placeholder="email@example.com" type="email" className="h-10" />
          </div>
        </div>

        {/* 배송지 */}
        <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
          <p className="text-sm font-medium">배송지</p>
          <div className="flex gap-2">
            <Input value={form.zipcode} readOnly placeholder="우편번호" className="h-10 w-28" />
            <Button variant="outline" className="h-10" onClick={openPostcode}>주소 검색</Button>
          </div>
          <Input value={form.address} readOnly placeholder="기본 주소" className="h-10" />
          <Input value={form.addressDetail} onChange={e => f('addressDetail', e.target.value)}
            placeholder="상세 주소 (동/호수)" className="h-10" />
          <Input value={form.memo} onChange={e => f('memo', e.target.value)}
            placeholder="배송 메모 (선택)" className="h-10" />
        </div>

        {/* 결제 버튼 */}
        <Button className="w-full h-12 text-base" disabled={!canSubmit || submitting} onClick={handlePayment}>
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {total.toLocaleString()}원 결제하기
        </Button>

        <p className="text-[10px] text-muted-foreground text-center">
          주문 내용을 확인하였으며, 결제에 동의합니다.
        </p>
      </main>
    </div>
  );
}
