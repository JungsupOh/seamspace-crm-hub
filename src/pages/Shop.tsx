import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
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
          <Link to="/shop/cart" className="relative p-2 hover:bg-muted rounded-lg transition-colors">
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </Link>
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
          <div className="grid grid-cols-3 gap-4">
            <Link to="/shop/keyring" className="group">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow">
                <img src="/banner/keyring(Thmb).png" alt="감정 키링 10종" className="w-full group-hover:scale-105 transition-transform duration-300" />
              </div>
            </Link>
            <Link to="/shop/boardgame" className="group">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow">
                <img src="/banner/boardgame(Thmb).png" alt="마음여행 보드게임" className="w-full group-hover:scale-105 transition-transform duration-300" />
              </div>
            </Link>
            <Link to="/order-test" className="group">
              <div className="rounded-xl overflow-hidden border border-border hover:shadow-lg transition-shadow">
                <img src="/banner/MindDiary(Thmb).png" alt="AI 마음일기" className="w-full group-hover:scale-105 transition-transform duration-300" />
              </div>
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
