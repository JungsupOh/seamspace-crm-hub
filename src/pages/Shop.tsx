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
  useEffect(() => { setCartCount(getCart().reduce((s, i) => s + i.qty, 0)); }, []);

  return (
    <div className="min-h-screen bg-muted/20">
      {/* 헤더 */}
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/shop" className="font-bold text-lg">심스페이스 스토어</Link>
          <div className="flex items-center gap-1">
            <Link to="/shop/lookup" className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground" title="주문 조회">
              <ClipboardList className="h-5 w-5" />
            </Link>
            <Link to="/shop/cart" className="relative p-2 hover:bg-muted rounded-lg transition-colors">
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

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">심스페이스 상품</h1>
          <p className="text-muted-foreground text-sm">행복한 사회정서학습을 위한 교구</p>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">로딩 중...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Link to="/shop/keyring" className="group text-center">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-2">
                <img src="/banner/keyring(Thmb).png" alt="감정 키링 10종" className="w-full group-hover:scale-105 transition-transform duration-300" />
              </div>
              {products?.find(p => p.id === 'keyring') && (() => {
                const p = products.find(p => p.id === 'keyring')!;
                const discount = p.original_price ? Math.round((1 - p.price / p.original_price) * 100) : 0;
                return (<>
                  <h3 className="font-bold text-sm">{p.name}</h3>
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
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-2">
                <img src="/banner/boardgame(Thmb).png" alt="마음여행 보드게임" className="w-full group-hover:scale-105 transition-transform duration-300" />
              </div>
              {products?.find(p => p.id === 'boardgame') && (() => {
                const p = products.find(p => p.id === 'boardgame')!;
                const discount = p.original_price ? Math.round((1 - p.price / p.original_price) * 100) : 0;
                return (<>
                  <h3 className="font-bold text-sm">{p.name}</h3>
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
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-2">
                <img src="/banner/MindDiary(Thmb).png" alt="AI 마음일기" className="w-full group-hover:scale-105 transition-transform duration-300" />
              </div>
              <h3 className="font-bold text-sm">AI 마음일기</h3>
              <div className="flex items-center justify-center gap-1.5 mt-0.5">
                <span className="text-sm font-bold">40,000원</span>
                <span className="text-xs text-muted-foreground">/ 1학급 1개월</span>
              </div>
            </Link>
            <Link to="/shop/lucky-seven" className="group text-center">
              <div className="relative rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow mb-2 aspect-square">
                <img src="/events/lucky-seven/lucky-seven-detail-1.png" alt="럭키세븐 이벤트" className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300" />
                <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">5월 한정</span>
              </div>
              <h3 className="font-bold text-sm">럭키세븐 이벤트</h3>
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
          <p>주소: 대전광역시 유성구 대학로 291, 테바소프트</p>
          <p>전화: 042-864-5566 · 이메일: sales@tebahsoft.com</p>
          <p className="pt-1">배송비: 3,000원 (50,000원 이상 무료배송) · 국내 배송만 가능</p>
        </div>
      </footer>
    </div>
  );
}
