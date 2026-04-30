import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShoppingCart, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getShopProduct, addToCart, getCart } from '@/lib/shop';
import { toast } from 'sonner';

export default function ShopProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  const [selectedOption, setSelectedOption] = useState<string | undefined>();

  const { data: product, isLoading } = useQuery({
    queryKey: ['shop_product', id],
    queryFn: () => getShopProduct(id!),
    enabled: !!id,
  });

  const [cartCount, setCartCount] = useState(0);
  useEffect(() => {
    const refresh = () => setCartCount(getCart().reduce((s, i) => s + i.qty, 0));
    refresh();
    window.addEventListener('seamspace_cart_changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('seamspace_cart_changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20">
      <p className="text-muted-foreground">로딩 중...</p>
    </div>
  );

  if (!product) return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20">
      <div className="text-center">
        <p className="text-lg font-semibold mb-2">상품을 찾을 수 없습니다</p>
        <Link to="/shop" className="text-primary hover:underline text-sm">스토어로 돌아가기</Link>
      </div>
    </div>
  );

  const discount = product.original_price ? Math.round((1 - product.price / product.original_price) * 100) : 0;
  const options = product.options as string[] | null;
  const needsOption = options && options.length > 0;

  const handleAddToCart = (): boolean => {
    if (needsOption && !selectedOption) {
      toast.error('옵션을 선택해주세요');
      return false;
    }
    addToCart({
      productId: product.id,
      productName: product.name + (selectedOption ? ` (${selectedOption})` : ''),
      option: selectedOption,
      qty,
      unitPrice: product.price,
    });
    toast.success('장바구니에 담았습니다');
    return true;
  };

  const handleBuyNow = () => {
    if (handleAddToCart()) navigate('/shop/cart');
  };

  return (
    <div className="min-h-screen bg-muted/20">
      {/* 헤더 */}
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/shop" className="flex items-center gap-2 text-sm hover:text-primary">
            <ArrowLeft className="h-4 w-4" />스토어
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
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* 상세 이미지 */}
        {product.detail_image_url && (
          <div className="bg-white rounded-2xl overflow-hidden border border-border mb-6">
            <img
              src={product.detail_image_url}
              alt={product.name}
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        )}

        {/* 구매 영역 — 콤팩트 */}
        <div className="bg-white rounded-2xl border border-border p-4 sticky bottom-0 shadow-lg">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h1 className="text-lg font-bold">{product.name}</h1>
              {product.description && <p className="text-xs text-muted-foreground">{product.description}</p>}
            </div>
          </div>

          {/* 가격 + 단위 */}
          <div className="flex items-center gap-2 mb-3">
            {discount > 0 && (
              <span className="text-base font-bold text-red-500">{discount}%</span>
            )}
            <span className="text-xl font-bold">{product.price.toLocaleString()}원</span>
            {product.original_price && product.original_price > product.price && (
              <span className="text-sm text-muted-foreground line-through">{product.original_price.toLocaleString()}원</span>
            )}
            {product.unit_label && (
              <span className="text-xs text-muted-foreground ml-1">/ {product.unit_label}</span>
            )}
          </div>

          {/* 옵션 + 수량 한 줄 */}
          <div className="flex items-center gap-4 mb-3">
            {needsOption && (
              <div className="flex items-center gap-1.5">
                {options.map(opt => (
                  <button key={opt} onClick={() => setSelectedOption(opt)}
                    className={`px-3 py-1.5 rounded-lg border text-xs transition-colors
                      ${selectedOption === opt
                        ? 'border-primary bg-primary/5 text-primary font-medium'
                        : 'border-border hover:border-primary/50'}`}>
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center border border-border rounded-lg ml-auto">
              <button onClick={() => setQty(q => Math.max(1, q - 1))}
                className="p-1.5 hover:bg-muted transition-colors rounded-l-lg">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="px-3 py-1.5 text-sm font-medium min-w-[32px] text-center">{qty}</span>
              <button onClick={() => setQty(q => q + 1)}
                className="p-1.5 hover:bg-muted transition-colors rounded-r-lg">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="text-base font-bold shrink-0">{(product.price * qty).toLocaleString()}원</span>
          </div>

          {/* 버튼 */}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={handleAddToCart}>
              <ShoppingCart className="h-4 w-4 mr-1.5" />장바구니
            </Button>
            <Button className="flex-1 h-11" onClick={handleBuyNow}>
              바로 구매
            </Button>
          </div>

          {/* 마음일기: 복합권 안내 */}
          {product.id === 'minddiary' && (
            <div className="mt-3 rounded-lg bg-muted/50 border border-border px-3 py-2.5 text-xs text-muted-foreground">
              <p>📌 위 가격은 <strong>1학급(40명) 1개월</strong> 기준입니다.</p>
              <p className="mt-1">여러 학급 또는 장기 이용권이 필요하신 경우 <a href="/order-test" className="text-primary hover:underline font-medium">견적 요청 페이지</a>에서 맞춤 견적을 받아보세요.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
