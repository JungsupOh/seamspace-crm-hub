// 럭키세븐 이벤트 상세 페이지 — /shop/lucky-seven
// 일반 shop 상품과 달리 장바구니 X, 럭키세븐 신청 폼으로 직접 연결
import { Link } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, ClipboardList, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCart } from '@/lib/shop';
import { useState, useEffect } from 'react';

const DETAIL_IMAGES = [
  '/events/lucky-seven/lucky-seven-detail-1.png',
  '/events/lucky-seven/lucky-seven-detail-2.png',
  '/events/lucky-seven/lucky-seven-detail-3.png',
];

export default function ShopLuckySeven() {
  const [cartCount, setCartCount] = useState(0);
  useEffect(() => { setCartCount(getCart().reduce((s, i) => s + i.qty, 0)); }, []);

  return (
    <div className="min-h-screen bg-muted/20">
      {/* 헤더 */}
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/shop" className="flex items-center gap-2 text-sm hover:text-primary">
            <ArrowLeft className="h-4 w-4" />스토어
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/shop/lookup" className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground" title="주문 조회">
              <ClipboardList className="h-5 w-5" />
            </Link>
            <Link to="/shop/cart" className="relative p-2 hover:bg-muted rounded-lg">
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-32">
        {/* 상세 이미지 3장 연속 */}
        <div className="bg-white rounded-2xl overflow-hidden border border-border">
          {DETAIL_IMAGES.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`럭키세븐 이벤트 상세 ${i + 1}`}
              className="w-full h-auto block"
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
      </main>

      {/* 하단 고정 CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border shadow-lg z-40">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <h1 className="text-base font-bold flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-amber-500" />
                럭키세븐 이벤트
              </h1>
              <p className="text-xs text-muted-foreground">5월 한정 · 7명 공동 신청 시</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-xs font-bold text-red-500">58%</span>
                <span className="text-lg font-bold">100,000원</span>
              </div>
              <p className="text-[10px] text-muted-foreground line-through">정상가 240,000원</p>
            </div>
          </div>

          <Link to="/event/lucky-seven">
            <Button className="w-full h-11 text-sm font-semibold">
              지금 신청하기 <ArrowLeft className="h-4 w-4 ml-2 rotate-180" />
            </Button>
          </Link>

          <p className="text-[10px] text-muted-foreground text-center mt-1.5">
            신청 후 견적서가 이메일로 발송됩니다 · 카드 결제만 가능
          </p>
        </div>
      </div>
    </div>
  );
}
