import { useState } from 'react';
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

  const cartCount = getCart().reduce((s, i) => s + i.qty, 0);

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

  const handleAddToCart = () => {
    if (needsOption && !selectedOption) {
      toast.error('옵션을 선택해주세요');
      return;
    }
    addToCart({
      productId: product.id,
      productName: product.name + (selectedOption ? ` (${selectedOption})` : ''),
      option: selectedOption,
      qty,
      unitPrice: product.price,
    });
    toast.success('장바구니에 담았습니다');
  };

  const handleBuyNow = () => {
    handleAddToCart();
    navigate('/shop/cart');
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

        {/* 구매 영역 */}
        <div className="bg-white rounded-2xl border border-border p-6 sticky bottom-0 shadow-lg">
          <h1 className="text-xl font-bold mb-1">{product.name}</h1>
          {product.description && <p className="text-sm text-muted-foreground mb-3">{product.description}</p>}

          {/* 가격 */}
          <div className="flex items-center gap-2 mb-4">
            {discount > 0 && (
              <span className="text-lg font-bold text-red-500">{discount}%</span>
            )}
            <span className="text-2xl font-bold">{product.price.toLocaleString()}원</span>
            {product.original_price && product.original_price > product.price && (
              <span className="text-base text-muted-foreground line-through">{product.original_price.toLocaleString()}원</span>
            )}
          </div>

          {product.unit_label && (
            <p className="text-xs text-muted-foreground mb-4">{product.unit_label}</p>
          )}

          {/* 옵션 선택 */}
          {needsOption && (
            <div className="mb-4">
              <p className="text-sm font-medium mb-2">옵션 선택</p>
              <div className="flex gap-2">
                {options.map(opt => (
                  <button key={opt} onClick={() => setSelectedOption(opt)}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors
                      ${selectedOption === opt
                        ? 'border-primary bg-primary/5 text-primary font-medium'
                        : 'border-border hover:border-primary/50'}`}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 수량 */}
          <div className="flex items-center gap-3 mb-5">
            <span className="text-sm font-medium">수량</span>
            <div className="flex items-center border border-border rounded-lg">
              <button onClick={() => setQty(q => Math.max(1, q - 1))}
                className="p-2 hover:bg-muted transition-colors rounded-l-lg">
                <Minus className="h-4 w-4" />
              </button>
              <span className="px-4 py-2 text-sm font-medium min-w-[40px] text-center">{qty}</span>
              <button onClick={() => setQty(q => q + 1)}
                className="p-2 hover:bg-muted transition-colors rounded-r-lg">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <span className="ml-auto text-lg font-bold">{(product.price * qty).toLocaleString()}원</span>
          </div>

          {/* 버튼 */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 h-12" onClick={handleAddToCart}>
              <ShoppingCart className="h-4 w-4 mr-2" />장바구니
            </Button>
            <Button className="flex-1 h-12" onClick={handleBuyNow}>
              바로 구매
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
