import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShoppingCart, Minus, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getShopProduct, addToCart, getCart, optionLabel, optionPrice,
         type ShopProductOption } from '@/lib/shop';
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
  const options = (product.options ?? null) as ShopProductOption[] | null;
  const needsOption = !!options && options.length > 0;
  const selected = options?.find(o => optionLabel(o) === selectedOption);
  // 옵션마다 단가가 다른 상품(일기 제본)은 선택한 구간의 가격이 실제 결제 단가가 된다.
  const hasPricedOptions = !!options?.some(o => typeof o === 'object');
  const unitPrice = optionPrice(selected, product.price);
  // 아직 옵션을 안 골랐으면 최저가를 '~부터'로 보여준다 (0원으로 보이면 오해를 준다)
  const minOptionPrice = hasPricedOptions
    ? Math.min(...options!.map(o => optionPrice(o, product.price)))
    : product.price;
  const displayPrice = selected ? unitPrice : minOptionPrice;

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
      unitPrice,
      ...(product.shipping_fee ? { shippingFee: product.shipping_fee } : {}),
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
              src={product.detail_image_url.replace(/\.(png|jpe?g)$/i, '.webp')}
              alt={product.name}
              className="w-full h-auto"
              loading="lazy"
              decoding="async"
            />
          </div>
        )}

        {/* 일기 제본: 비용 안내 — 상세 이미지에는 가격표가 없어 본문으로 제공한다
            (이미지에 박아두면 단가가 바뀔 때마다 이미지를 다시 만들어야 한다) */}
        {product.id === 'diary' && (
          <div className="bg-white rounded-2xl border border-border p-5 mb-6">
            <h2 className="text-base font-bold mb-1">비용 안내</h2>
            <p className="text-xs text-muted-foreground mb-1">권 당 제작 비용을 안내 드립니다.</p>
            <p className="text-xs text-muted-foreground mb-4">
              페이지 수에 따라 제작 비용이 달라집니다.
              보통은 <strong className="text-foreground">1 페이지에 1개의 일기</strong>가 들어갑니다. (글자 수 1,200자 기준)
            </p>

            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2">페이지 수</th>
                    <th className="text-right font-medium px-3 py-2">권 당 제작 비용</th>
                  </tr>
                </thead>
                <tbody>
                  {(options ?? []).map(opt => (
                    <tr key={optionLabel(opt)} className="border-t border-border">
                      <td className="px-3 py-2">{optionLabel(opt)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {optionPrice(opt, product.price).toLocaleString()}원
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li>· 최소 페이지 수 <strong className="text-foreground">36p</strong> 부터 제작 가능합니다.</li>
              <li>· 배송비 <strong className="text-foreground">3,500원</strong> 별도 (제작 상품이라 무료배송 대상이 아닙니다)</li>
            </ul>
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
            <span className="text-xl font-bold">
              {displayPrice.toLocaleString()}원{hasPricedOptions && !selected && <span className="text-sm font-medium">부터</span>}
            </span>
            {product.original_price && product.original_price > product.price && (
              <span className="text-sm text-muted-foreground line-through">{product.original_price.toLocaleString()}원</span>
            )}
            {product.unit_label && (
              <span className="text-xs text-muted-foreground ml-1">/ {product.unit_label}</span>
            )}
          </div>

          {/* 옵션 + 수량 한 줄 */}
          {needsOption && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {options!.map(opt => {
                const label = optionLabel(opt);
                const p = optionPrice(opt, product.price);
                const on = selectedOption === label;
                return (
                  <button key={label} onClick={() => setSelectedOption(label)}
                    className={`px-3 py-1.5 rounded-lg border text-xs transition-colors
                      ${on ? 'border-primary bg-primary/5 text-primary font-medium'
                           : 'border-border hover:border-primary/50'}`}>
                    {label}
                    {hasPricedOptions && (
                      <span className={`ml-1.5 tabular-nums ${on ? '' : 'text-muted-foreground'}`}>
                        {p.toLocaleString()}원
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-4 mb-3">
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
            <span className="text-base font-bold shrink-0">{(displayPrice * qty).toLocaleString()}원</span>
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

          {/* 일기 제본: 결제 전 필수 확인 — 페이지 수를 잘못 고르면 재결제/환불이 발생한다 */}
          {product.id === 'diary' && (
            <div className="mt-3 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2.5">
              <p className="flex items-start gap-1.5 text-xs font-bold text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                주의사항: 반드시, 심스페이스 담당자와 출력 가능한 일기 개수와 가격에 대한 문의 후에 결제해 주세요.
              </p>
              <p className="mt-1.5 pl-[22px] text-[11px] text-amber-800">
                일기 개수에 따라 페이지 수가 달라져 결제 금액이 바뀝니다.
                문의: <a href="tel:042-864-5566" className="font-medium underline">042-864-5566</a>
                {' · '}
                <a href="mailto:sales@tebahsoft.com" className="font-medium underline">sales@tebahsoft.com</a>
              </p>
            </div>
          )}

          {/* 마음일기: 복합권 안내 */}
          {product.id === 'minddiary' && (
            <div className="mt-3 rounded-lg bg-muted/50 border border-border px-3 py-2.5 text-xs text-muted-foreground">
              <p>📌 위 가격은 <strong>1학급(40명) 1개월</strong> 기준입니다.</p>
              <p className="mt-1">여러 학급 또는 장기 이용권이 필요하신 경우 <a href="/order" className="text-primary hover:underline font-medium">견적 요청 페이지</a>에서 맞춤 견적을 받아보세요.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
