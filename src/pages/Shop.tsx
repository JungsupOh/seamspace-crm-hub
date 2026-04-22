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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products?.map(p => {
              const discount = p.original_price ? Math.round((1 - p.price / p.original_price) * 100) : 0;
              return (
                <Link key={p.id} to={`/shop/${p.id}`}
                  className="bg-white rounded-2xl border border-border overflow-hidden hover:shadow-lg transition-shadow group">
                  <div className="aspect-[4/3] overflow-hidden bg-muted/30">
                    {p.image_url && (
                      <img src={p.image_url} alt={p.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    )}
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold text-base mb-1">{p.name}</h3>
                    {p.description && <p className="text-xs text-muted-foreground mb-3">{p.description}</p>}
                    <div className="flex items-center gap-2">
                      {discount > 0 && (
                        <span className="text-sm font-bold text-red-500">{discount}%</span>
                      )}
                      <span className="text-lg font-bold">{p.price.toLocaleString()}원</span>
                      {p.original_price && p.original_price > p.price && (
                        <span className="text-sm text-muted-foreground line-through">{p.original_price.toLocaleString()}원</span>
                      )}
                    </div>
                    {p.unit_label && <p className="text-xs text-muted-foreground mt-1">{p.unit_label}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* 하단 마음일기 링크 */}
        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground mb-2">AI 마음일기 이용권이 필요하신가요?</p>
          <Link to="/order-test" className="text-sm text-primary hover:underline font-medium">
            심스페이스 마음일기 주문 →
          </Link>
        </div>

        {/* 주문 조회 */}
        <div className="mt-8 text-center">
          <Link to="/shop/lookup" className="text-xs text-muted-foreground hover:underline">
            주문 조회하기
          </Link>
        </div>
      </main>

      <footer className="border-t py-8 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground/70">테바소프트 주식회사</p>
          <p>배송비: 3,000원 (50,000원 이상 무료배송) · 국내 배송만 가능</p>
          <p>문의: 042-864-5566 · sales@tebahsoft.com</p>
        </div>
      </footer>
    </div>
  );
}
