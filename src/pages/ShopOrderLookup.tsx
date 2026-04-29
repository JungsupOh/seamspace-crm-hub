import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, Package, Truck, CheckCircle2, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhone } from '@/lib/utils';
import { lookupMyOrders, type ShopOrder, type ShopOrderItem } from '@/lib/shop';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  '결제완료': { label: '결제완료', color: 'text-blue-700', bg: 'bg-blue-100' },
  '배송준비': { label: '배송준비', color: 'text-amber-700', bg: 'bg-amber-100' },
  '배송중':   { label: '배송중', color: 'text-teal-700', bg: 'bg-teal-100' },
  '배송완료': { label: '배송완료', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  '취소':     { label: '취소', color: 'text-red-700', bg: 'bg-red-100' },
};

export default function ShopOrderLookup() {
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<{ order: ShopOrder; items: ShopOrderItem[] }[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(params.get('orderId') || null);

  const handleLookup = async () => {
    if (!name.trim() || !phone.trim()) {
      setError('이름과 연락처를 모두 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await lookupMyOrders(name.trim(), phone);
      if (result.length === 0) {
        setError('최근 1개월 내 주문 내역이 없습니다.');
        setOrders(null);
        return;
      }
      setOrders(result);
      if (result.length === 1) setExpandedId(result[0].order.order_id);
    } catch {
      setError('조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

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

      <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
        {/* 조회 폼 */}
        <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
          <div>
            <p className="text-sm font-medium">주문 시 입력한 정보로 조회합니다</p>
            <p className="text-xs text-muted-foreground mt-1">📅 최근 30일 이내 주문만 조회됩니다.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">이름</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
              placeholder="홍길동" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">연락처</Label>
            <Input value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
              onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
              placeholder="010-0000-0000" className="h-11" type="tel" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full h-11" disabled={loading} onClick={handleLookup}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            조회하기
          </Button>
        </div>

        {/* 주문 목록 */}
        {orders && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{orders.length}건의 주문</p>
            {orders.map(({ order, items }) => {
              const meta = STATUS_META[order.status] ?? { label: order.status, color: 'text-slate-600', bg: 'bg-slate-100' };
              const isExpanded = expandedId === order.order_id;
              const itemSummary = items.length > 0
                ? items.length === 1
                  ? items[0].product_name
                  : `${items[0].product_name} 외 ${items.length - 1}건`
                : '상품 정보 없음';

              return (
                <div key={order.order_id} className="bg-white rounded-2xl border border-border overflow-hidden">
                  {/* 요약 */}
                  <button onClick={() => setExpandedId(isExpanded ? null : order.order_id)}
                    className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-muted/20 transition-colors">
                    {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{meta.label}</span>
                        <span className="text-xs text-muted-foreground">{order.created_at.slice(0, 10)}</span>
                      </div>
                      <p className="text-sm font-medium truncate">{itemSummary}</p>
                    </div>
                    <span className="text-sm font-bold shrink-0">{order.total_amount.toLocaleString()}원</span>
                  </button>

                  {/* 상세 */}
                  {isExpanded && (
                    <div className="border-t px-4 py-3 space-y-3 text-sm">
                      <p className="text-xs text-muted-foreground font-mono">주문번호: {order.order_id}</p>

                      {/* 상품 */}
                      {items.map(item => (
                        <div key={item.id} className="flex justify-between py-1">
                          <span className="text-muted-foreground">{item.product_name}{item.option ? ` (${item.option})` : ''} × {item.qty}</span>
                          <span>{item.subtotal.toLocaleString()}원</span>
                        </div>
                      ))}
                      <div className="border-t pt-2 space-y-1 text-xs">
                        <div className="flex justify-between text-muted-foreground">
                          <span>배송비</span><span>{order.shipping_fee === 0 ? '무료' : `${order.shipping_fee.toLocaleString()}원`}</span>
                        </div>
                        <div className="flex justify-between font-bold text-sm">
                          <span>결제금액</span><span>{order.total_amount.toLocaleString()}원</span>
                        </div>
                      </div>

                      {/* 배송 */}
                      {order.address !== '디지털 상품 (배송 없음)' && (
                        <div className="border-t pt-2 text-xs text-muted-foreground space-y-0.5">
                          <p className="font-medium text-foreground text-sm">배송지</p>
                          <p>[{order.zipcode}] {order.address} {order.address_detail}</p>
                          {order.delivery_memo && <p>메모: {order.delivery_memo}</p>}
                        </div>
                      )}

                      {/* 운송장 */}
                      {(order.tracking_number || order.shipped_at) && (
                        <div className="border-t pt-2 bg-teal-50 -mx-4 px-4 py-3 -mb-3 mt-2">
                          <p className="text-xs text-teal-700 font-medium mb-1">📦 배송 정보</p>
                          {order.tracking_number && (
                            <p className="font-mono font-bold text-sm">
                              {order.carrier ? `${order.carrier} ` : ''}{order.tracking_number}
                            </p>
                          )}
                          {order.shipped_at && (
                            <p className="text-xs text-muted-foreground mt-1">
                              발송일: {new Date(order.shipped_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                          )}
                          {order.delivered_at && (
                            <p className="text-xs text-muted-foreground">
                              배송완료: {new Date(order.delivered_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
