import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShoppingCart, Minus, Plus, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getShopProduct, addToCart, getCart, optionLabel, optionPrice, qtyUnitFromLabel,
         type ShopProductOption } from '@/lib/shop';
import { toast } from 'sonner';

export default function ShopProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  // 옵션 상품은 여러 옵션을 각각 수량과 함께 담을 수 있다 (100p 3권 + 200p 3권처럼).
  // 네이버 스토어와 같은 방식 — 옵션을 고르면 아래 목록에 줄이 추가된다.
  const [picks, setPicks] = useState<{ label: string; price: number; qty: number }[]>([]);
  // 옵션을 안 고르고 담기/구매를 눌렀을 때 화면에 남는 경고.
  // 토스트만으로는 금방 사라져 그냥 지나치기 쉽다.
  const [optionError, setOptionError] = useState(false);
  const optionRef = useRef<HTMLDivElement>(null);

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
  // 옵션마다 단가가 다른 상품(일기 제본)은 고른 구간의 가격이 실제 결제 단가가 된다.
  const hasPricedOptions = !!options?.some(o => typeof o === 'object');
  // 아직 아무것도 안 골랐으면 최저가를 '~부터'로 보여준다 (0원으로 보이면 오해를 준다)
  const minOptionPrice = hasPricedOptions
    ? Math.min(...options!.map(o => optionPrice(o, product.price)))
    : product.price;
  const qtyUnit = qtyUnitFromLabel(product.unit_label);

  const pickCount = picks.reduce((s, p) => s + p.qty, 0);
  const pickTotal = picks.reduce((s, p) => s + p.price * p.qty, 0);
  // 옵션 없는 상품은 기존처럼 수량 하나로 계산한다
  const lineTotal = needsOption ? pickTotal : product.price * qty;

  const addPick = (label: string, price: number) => {
    setOptionError(false);
    setPicks(prev => prev.some(p => p.label === label)
      ? prev.map(p => (p.label === label ? { ...p, qty: p.qty + 1 } : p))   // 이미 고른 옵션은 수량만 +1
      : [...prev, { label, price, qty: 1 }]);
  };
  const changePickQty = (label: string, delta: number) => {
    setPicks(prev => prev
      .map(p => (p.label === label ? { ...p, qty: p.qty + delta } : p))
      .filter(p => p.qty > 0));   // 0이 되면 목록에서 빠진다
  };
  const removePick = (label: string) => setPicks(prev => prev.filter(p => p.label !== label));

  const handleAddToCart = (): boolean => {
    const ship = product.shipping_fee ? { shippingFee: product.shipping_fee } : {};

    if (needsOption) {
      if (picks.length === 0) {
        setOptionError(true);
        toast.error(hasPricedOptions ? '페이지 구간을 선택해주세요' : '옵션을 선택해주세요');
        optionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
      }
      // 고른 옵션마다 장바구니 줄을 만든다. addToCart가 (상품+옵션) 기준으로
      // 합치므로 같은 옵션을 다시 담으면 수량이 더해진다.
      picks.forEach(pk => addToCart({
        productId: product.id,
        productName: `${product.name} (${pk.label})`,
        option: pk.label,
        qty: pk.qty,
        unitPrice: pk.price,
        ...ship,
      }));
      toast.success(`${picks.length}개 옵션 · 총 ${pickCount}${qtyUnit || '개'} 담았습니다`);
      return true;
    }

    addToCart({
      productId: product.id,
      productName: product.name,
      qty,
      unitPrice: product.price,
      ...ship,
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
              {minOptionPrice.toLocaleString()}원{hasPricedOptions && <span className="text-sm font-medium">부터</span>}
            </span>
            {product.original_price && product.original_price > product.price && (
              <span className="text-sm text-muted-foreground line-through">{product.original_price.toLocaleString()}원</span>
            )}
            {product.unit_label && (
              <span className="text-xs text-muted-foreground ml-1">/ {product.unit_label}</span>
            )}
          </div>

          {/* 옵션 — 기본 선택 없음. 고르지 않으면 담기·구매가 막힌다 */}
          {needsOption && (
            <div ref={optionRef} className="mb-3">
              {hasPricedOptions && (
                <p className={`text-[11px] mb-1.5 ${optionError ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                  {optionError
                    ? '⚠ 페이지 구간을 선택해주세요'
                    : '페이지 구간을 선택하세요 — 여러 구간을 함께 담을 수 있습니다'}
                </p>
              )}
              <div className={`flex flex-wrap gap-1.5 ${optionError ? 'rounded-lg ring-2 ring-red-400 ring-offset-2 p-1.5 -m-1.5' : ''}`}>
                {options!.map(opt => {
                  const label = optionLabel(opt);
                  const p = optionPrice(opt, product.price);
                  const on = picks.some(pk => pk.label === label);
                  return (
                    <button key={label}
                      onClick={() => addPick(label, p)}
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
            </div>
          )}

          {/* 선택한 옵션 목록 — 옵션마다 수량을 따로 정한다 */}
          {needsOption && picks.length > 0 && (
            <div className="mb-3 space-y-1.5 max-h-[164px] overflow-y-auto">
              {picks.map(pk => (
                <div key={pk.label} className="rounded-lg bg-muted/40 border border-border px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-medium truncate">{pk.label}</span>
                    <button onClick={() => removePick(pk.label)}
                      className="p-0.5 rounded hover:bg-muted shrink-0" aria-label={`${pk.label} 삭제`}>
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center border border-border rounded-lg bg-white">
                      <button onClick={() => changePickQty(pk.label, -1)}
                        className="p-1.5 hover:bg-muted transition-colors rounded-l-lg"
                        aria-label={`${pk.label} 수량 줄이기`}>
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="px-2.5 py-1 text-sm font-medium min-w-[38px] text-center whitespace-nowrap">
                        {pk.qty}{qtyUnit}
                      </span>
                      <button onClick={() => changePickQty(pk.label, 1)}
                        className="p-1.5 hover:bg-muted transition-colors rounded-r-lg"
                        aria-label={`${pk.label} 수량 늘리기`}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="text-sm font-bold tabular-nums">{(pk.price * pk.qty).toLocaleString()}원</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 합계 */}
          {needsOption ? (
            picks.length > 0 && (
              <div className="flex items-center justify-between mb-3 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">총 <strong className="text-foreground">{pickCount}{qtyUnit || '개'}</strong></span>
                <span className="text-base font-bold">총 {pickTotal.toLocaleString()}원</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center border border-border rounded-lg ml-auto">
                <button onClick={() => setQty(q => Math.max(1, q - 1))}
                  className="p-1.5 hover:bg-muted transition-colors rounded-l-lg">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="px-3 py-1.5 text-sm font-medium min-w-[32px] text-center whitespace-nowrap">
                  {qty}{qtyUnit}
                </span>
                <button onClick={() => setQty(q => q + 1)}
                  className="p-1.5 hover:bg-muted transition-colors rounded-r-lg">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="text-base font-bold shrink-0">{lineTotal.toLocaleString()}원</span>
            </div>
          )}

          {/* 일기 제본: 결제 전 필수 확인 — 버튼 위에 둬야 누르기 전에 반드시 눈에 들어온다.
              아래에 두면 화면 밖으로 밀려 그냥 지나치게 된다 */}
          {product.id === 'diary' && (
            <div className="mb-3 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2.5">
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
              <p className="mt-1">여러 학급 또는 장기 이용권이 필요하신 경우 <a href="/order" className="text-primary hover:underline font-medium">견적 요청 페이지</a>에서 맞춤 견적을 받아보세요.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
