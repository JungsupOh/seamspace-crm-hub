import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, Trash2, ShoppingCart, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCart, saveCart, getCartTotal, clearCart, type CartItem } from '@/lib/shop';

export default function ShopCart() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CartItem[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponError, setCouponError] = useState('');

  useEffect(() => { setItems(getCart()); }, []);

  const updateQty = (idx: number, delta: number) => {
    const next = [...items];
    next[idx] = { ...next[idx], qty: Math.max(1, next[idx].qty + delta) };
    setItems(next);
    saveCart(next);
  };

  const removeItem = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    setItems(next);
    saveCart(next);
  };

  const { subtotal, shippingFee, total, needsShipping } = getCartTotal(items);
  const finalTotal = Math.max(0, total - couponDiscount);

  const handleApplyCoupon = () => {
    // TODO: 쿠폰 검증 API 연동
    if (!couponCode.trim()) return;
    setCouponError('유효하지 않은 쿠폰 코드입니다.');
    setCouponDiscount(0);
  };

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-muted/20">
        <header className="bg-white border-b sticky top-0 z-30">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center">
            <Link to="/shop" className="flex items-center gap-2 text-sm hover:text-primary">
              <ArrowLeft className="h-4 w-4" />스토어
            </Link>
          </div>
        </header>
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <ShoppingCart className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-semibold mb-2">장바구니가 비어있습니다</p>
          <p className="text-sm text-muted-foreground mb-6">상품을 둘러보세요!</p>
          <Link to="/shop">
            <Button>쇼핑하러 가기</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/shop" className="flex items-center gap-2 text-sm hover:text-primary">
            <ArrowLeft className="h-4 w-4" />스토어
          </Link>
          <span className="font-bold">장바구니</span>
          <span className="text-sm text-muted-foreground">{items.length}개</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* 상품 목록 */}
        <div className="bg-white rounded-2xl border border-border divide-y">
          {items.map((item, idx) => (
            <div key={`${item.productId}-${item.option}`} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{item.productName}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{item.unitPrice.toLocaleString()}원</p>
              </div>
              <div className="flex items-center border border-border rounded-lg shrink-0">
                <button onClick={() => updateQty(idx, -1)} className="p-1.5 hover:bg-muted rounded-l-lg">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="px-3 text-sm font-medium">{item.qty}</span>
                <button onClick={() => updateQty(idx, 1)} className="p-1.5 hover:bg-muted rounded-r-lg">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="text-sm font-bold shrink-0 w-20 text-right">
                {(item.unitPrice * item.qty).toLocaleString()}원
              </span>
              <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {/* 쿠폰 */}
        <div className="bg-white rounded-2xl border border-border p-4">
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Tag className="h-4 w-4" />할인 쿠폰
          </p>
          <div className="flex gap-2">
            <Input value={couponCode} onChange={e => { setCouponCode(e.target.value); setCouponError(''); }}
              placeholder="쿠폰 코드 입력" className="h-10 text-sm" />
            <Button variant="outline" className="h-10 shrink-0" onClick={handleApplyCoupon}>적용</Button>
          </div>
          {couponError && <p className="text-xs text-destructive mt-1.5">{couponError}</p>}
          {couponDiscount > 0 && <p className="text-xs text-teal-600 mt-1.5">-{couponDiscount.toLocaleString()}원 할인 적용됨</p>}
        </div>

        {/* 금액 요약 */}
        <div className="bg-white rounded-2xl border border-border p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">상품 금액</span>
            <span>{subtotal.toLocaleString()}원</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">배송비</span>
            <span>{shippingFee === 0 ? '무료' : `${shippingFee.toLocaleString()}원`}</span>
          </div>
          {needsShipping && shippingFee > 0 && subtotal < 50000 && (
            <p className="text-xs text-muted-foreground">
              {(50000 - subtotal).toLocaleString()}원 더 담으면 무료배송!
            </p>
          )}
          {couponDiscount > 0 && (
            <div className="flex justify-between text-sm text-teal-600">
              <span>쿠폰 할인</span>
              <span>-{couponDiscount.toLocaleString()}원</span>
            </div>
          )}
          <div className="border-t pt-2 flex justify-between font-bold text-lg">
            <span>총 결제금액</span>
            <span>{finalTotal.toLocaleString()}원</span>
          </div>
        </div>

        {/* 주문 버튼 */}
        <Button className="w-full h-12 text-base" onClick={() => navigate('/shop/checkout')}>
          주문하기 · {finalTotal.toLocaleString()}원
        </Button>
      </main>
    </div>
  );
}
