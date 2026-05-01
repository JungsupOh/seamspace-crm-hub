import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShoppingCart, ClipboardList } from 'lucide-react';
import { getShopProducts, getCart } from '@/lib/shop';
import { useState, useEffect } from 'react';

export default function Shop() {
  const { data: products, isLoading } = useQuery({
    queryKey: ['shop_products'],
    queryFn: getShopProducts,
  });
  const [cartCount, setCartCount] = useState(0);
  useEffect(() => {
    const refresh = () => setCartCount(getCart().reduce((s, i) => s + i.qty, 0));
    refresh();
    window.addEventListener('seamspace_cart_changed', refresh);
    window.addEventListener('storage', refresh); // 다른 탭 변경 동기화
    return () => {
      window.removeEventListener('seamspace_cart_changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return (
    <div className="min-h-screen bg-muted/20">
      {/* 헤더 */}
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/shop" className="font-bold text-lg">심스페이스 스토어</Link>
          <div className="flex items-center gap-2">
            <Link
              to="/shop/lookup"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground"
            >
              <ClipboardList className="h-4 w-4" />
              <span>주문 조회</span>
            </Link>
            <Link
              to="/shop/cart"
              className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-muted rounded-lg transition-colors"
            >
              <ShoppingCart className="h-4 w-4" />
              <span>장바구니</span>
              {cartCount > 0 && (
                <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">심스페이스 상품</h1>
          <p className="text-muted-foreground text-sm">행복한 사회정서학습을 위한 교구</p>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">로딩 중...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Link to="/shop/keyring" className="group text-center">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-3">
                <img src="/banner/keyring(Thmb).webp" alt="감정 키링 10종" className="w-full aspect-[16/9] object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
              </div>
              {products?.find(p => p.id === 'keyring') && (() => {
                const p = products.find(p => p.id === 'keyring')!;
                const discount = p.original_price ? Math.round((1 - p.price / p.original_price) * 100) : 0;
                return (<>
                  <h3 className="font-bold text-base">{p.name}</h3>
                  <div className="flex items-center justify-center gap-1.5 mt-0.5">
                    {discount > 0 && <span className="text-xs font-bold text-red-500">{discount}%</span>}
                    <span className="text-sm font-bold">{p.price.toLocaleString()}원</span>
                    {p.original_price && p.original_price > p.price && (
                      <span className="text-xs text-muted-foreground line-through">{p.original_price.toLocaleString()}원</span>
                    )}
                  </div>
                </>);
              })()}
            </Link>
            <Link to="/shop/boardgame" className="group text-center">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-3">
                <img src="/banner/boardgame(Thmb).webp" alt="마음여행 보드게임" className="w-full aspect-[16/9] object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
              </div>
              {products?.find(p => p.id === 'boardgame') && (() => {
                const p = products.find(p => p.id === 'boardgame')!;
                const discount = p.original_price ? Math.round((1 - p.price / p.original_price) * 100) : 0;
                return (<>
                  <h3 className="font-bold text-base">{p.name}</h3>
                  <div className="flex items-center justify-center gap-1.5 mt-0.5">
                    {discount > 0 && <span className="text-xs font-bold text-red-500">{discount}%</span>}
                    <span className="text-sm font-bold">{p.price.toLocaleString()}원</span>
                    {p.original_price && p.original_price > p.price && (
                      <span className="text-xs text-muted-foreground line-through">{p.original_price.toLocaleString()}원</span>
                    )}
                  </div>
                </>);
              })()}
            </Link>
            <Link to="/shop/minddiary" className="group text-center">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-3">
                <img src="/banner/MindDiary(Thmb).webp" alt="AI 마음일기" className="w-full aspect-[16/9] object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
              </div>
              <h3 className="font-bold text-base">AI 마음일기</h3>
              <div className="flex items-center justify-center gap-1.5 mt-0.5">
                <span className="text-sm font-bold">40,000원</span>
                <span className="text-xs text-muted-foreground">/ 1학급 1개월</span>
              </div>
            </Link>
            <Link to="/shop/lucky-seven" className="group text-center">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-2 relative">
                <img src="/events/lucky-seven/lucky-seven-thumnail-2.webp" alt="럭키세븐 이벤트" className="w-full aspect-[16/9] object-cover block group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
                <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">5월 한정</span>
              </div>
              <h3 className="font-bold text-base">럭키세븐 이벤트</h3>
              <div className="flex items-center justify-center gap-1.5 mt-0.5">
                <span className="text-xs font-bold text-red-500">58%</span>
                <span className="text-sm font-bold">100,000원</span>
                <span className="text-xs text-muted-foreground line-through">240,000원</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">학급플랜 7개월권 / 1인</p>
            </Link>
          </div>
        )}
      </main>

      <footer className="border-t py-8 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground/70">테바소프트 주식회사</p>
          <p>대표이사: 오정섭 · 사업자등록번호: 440-87-02207</p>
          <p>통신판매업신고: 제 2022-대전유성-0475호</p>
          <p>주소: 대전광역시 유성구 대학로99, 510호 (궁동, 대전팁스타운)</p>
          <p>전화: 042-864-5566 · 이메일: sales@tebahsoft.com</p>
          <p className="pt-1">배송비: 3,000원 (50,000원 이상 무료배송) · 국내 배송만 가능</p>
        </div>
      </footer>
    </div>
  );
}
