import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, Package, Truck, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhone } from '@/lib/utils';
import { lookupShopOrder, type ShopOrder, type ShopOrderItem } from '@/lib/shop';

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  '결제완료': { label: '결제완료', color: 'text-blue-600', icon: CheckCircle2 },
  '배송준비': { label: '배송준비중', color: 'text-amber-600', icon: Package },
  '배송중':   { label: '배송중', color: 'text-teal-600', icon: Truck },
  '배송완료': { label: '배송완료', color: 'text-emerald-600', icon: CheckCircle2 },
};

export default function ShopOrderLookup() {
  const [params] = useSearchParams();
  const [orderId, setOrderId] = useState(params.get('orderId') || '');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<ShopOrder | null>(null);
  const [items, setItems] = useState<ShopOrderItem[]>([]);

  const handleLookup = async () => {
    if (!orderId.trim() || !phone.trim()) {
      setError('주문번호와 연락처를 모두 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await lookupShopOrder(orderId.trim(), phone);
      if (!result) {
        setError('주문을 찾을 수 없습니다. 주문번호와 연락처를 확인해주세요.');
        return;
      }
      setOrder(result.order);
      setItems(result.items);
    } catch {
      setError('조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const meta = order ? STATUS_META[order.status] : null;

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center">
          <Link to="/shop" className="flex items-center gap-2 text-sm hover:text-primary">
            <ArrowLeft className="h-4 w-4" />스토어
          </Link>
          <span className="flex-1 text-center font-bold">주문 조회</span>
          <span className="w-16" />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8 space-y-6">
        {!order ? (
          <div className="bg-white rounded-2xl border border-border p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">주문번호</Label>
              <Input value={orderId} onChange={e => setOrderId(e.target.value)}
                placeholder="SHOP-xxxxxx" className="h-11 font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">연락처</Label>
              <Input value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
                placeholder="010-0000-0000" className="h-11" type="tel" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full h-11" disabled={loading} onClick={handleLookup}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
              조회하기
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 상태 */}
            <div className="bg-white rounded-2xl border border-border p-6 text-center">
              {meta && <meta.icon className={`h-12 w-12 mx-auto mb-2 ${meta.color}`} />}
              <p className={`text-lg font-bold ${meta?.color}`}>{meta?.label || order.status}</p>
              <p className="text-xs text-muted-foreground mt-1">주문번호: {order.order_id}</p>
              <p className="text-xs text-muted-foreground">{order.created_at.slice(0, 10)}</p>
              {order.tracking_number && (
                <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <p className="text-xs text-muted-foreground">운송장번호</p>
                  <p className="font-mono font-bold">{order.carrier ? `${order.carrier} ` : ''}{order.tracking_number}</p>
                </div>
              )}
            </div>

            {/* 상품 */}
            <div className="bg-white rounded-2xl border border-border p-4">
              <p className="text-sm font-medium mb-3">주문 상품</p>
              {items.map(item => (
                <div key={item.id} className="flex justify-between text-sm py-1.5 border-b last:border-0">
                  <span>{item.product_name}{item.option ? ` (${item.option})` : ''} × {item.qty}</span>
                  <span className="font-medium">{item.subtotal.toLocaleString()}원</span>
                </div>
              ))}
              <div className="mt-2 pt-2 border-t space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>배송비</span><span>{order.shipping_fee === 0 ? '무료' : `${order.shipping_fee.toLocaleString()}원`}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>총 결제금액</span><span>{order.total_amount.toLocaleString()}원</span>
                </div>
              </div>
            </div>

            {/* 배송지 */}
            <div className="bg-white rounded-2xl border border-border p-4 text-sm space-y-1">
              <p className="font-medium mb-2">배송지</p>
              <p>{order.customer_name} · {order.customer_phone}</p>
              <p className="text-muted-foreground">[{order.zipcode}] {order.address} {order.address_detail}</p>
              {order.delivery_memo && <p className="text-muted-foreground">메모: {order.delivery_memo}</p>}
            </div>

            <Button variant="outline" className="w-full" onClick={() => { setOrder(null); setItems([]); }}>
              다른 주문 조회
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
