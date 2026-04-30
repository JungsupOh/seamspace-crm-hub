// 상품관리 — /shop 결제건 어드민 (실물 배송 관리 위주)
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Package, Truck, CheckCircle2, X, ExternalLink, Smartphone, Save, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { formatPhone } from '@/lib/utils';
import { apiSendCoupon } from '@/lib/coupons';
import type { ShopOrder, ShopOrderItem } from '@/lib/shop';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

// 디지털 전용 상품 ID (배송 불필요)
const DIGITAL_PRODUCTS = new Set(['minddiary']);

const STATUS_LIST = ['결제완료', '배송준비', '배송중', '배송완료', '취소'] as const;
type Status = typeof STATUS_LIST[number] | 'all';

const STATUS_BADGE: Record<typeof STATUS_LIST[number], string> = {
  결제완료: 'bg-blue-100 text-blue-700',
  배송준비: 'bg-amber-100 text-amber-700',
  배송중:   'bg-violet-100 text-violet-700',
  배송완료: 'bg-teal-100 text-teal-700',
  취소:     'bg-zinc-200 text-zinc-600',
};

const NEXT_STATUS: Record<typeof STATUS_LIST[number], typeof STATUS_LIST[number] | null> = {
  결제완료: '배송준비',
  배송준비: '배송중',
  배송중:   '배송완료',
  배송완료: null,
  취소:     null,
};

const CARRIERS = ['CJ대한통운', '롯데택배', '한진택배', '우체국', '로젠택배', '직접배송'];

async function fetchOrders(): Promise<ShopOrder[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_orders?order=created_at.desc&limit=500`, { headers: HEADERS });
  if (!r.ok) throw new Error('주문 목록 조회 실패');
  return r.json();
}

// 주문 cascade 삭제: shop_order_items + 디지털 발급분(deals/quotes/users/licenses) + shop_orders
async function deleteShopOrder(orderId: string): Promise<{ items: number; licenses: number; deals: number }> {
  const counts = { items: 0, licenses: 0, deals: 0 };

  // 1) 디지털 발급분: deals (quote_number 패턴 = orderId 또는 orderId-N)
  const dealsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/deals?quote_number=like.${encodeURIComponent(orderId)}*&select=id`,
    { headers: HEADERS },
  );
  const dealIds: string[] = dealsRes.ok ? (await dealsRes.json() as { id: string }[]).map(d => d.id) : [];

  if (dealIds.length > 0) {
    const inFilter = `(${dealIds.map(id => `"${id}"`).join(',')})`;
    // 1-1) deal_licenses
    const licDel = await fetch(
      `${SUPABASE_URL}/rest/v1/deal_licenses?deal_id=in.${inFilter}`,
      { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=representation' } },
    );
    if (licDel.ok) counts.licenses = ((await licDel.json()) as unknown[]).length;
    // 1-2) deal_quotes
    await fetch(
      `${SUPABASE_URL}/rest/v1/deal_quotes?deal_id=in.${inFilter}`,
      { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=minimal' } },
    );
    // 1-3) deal_users
    await fetch(
      `${SUPABASE_URL}/rest/v1/deal_users?deal_id=in.${inFilter}`,
      { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=minimal' } },
    );
    // 1-4) deals
    const dDel = await fetch(
      `${SUPABASE_URL}/rest/v1/deals?id=in.${inFilter}`,
      { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=representation' } },
    );
    if (dDel.ok) counts.deals = ((await dDel.json()) as unknown[]).length;
  }

  // 2) shop_order_items
  const itemsDel = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_order_items?order_id=eq.${encodeURIComponent(orderId)}`,
    { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=representation' } },
  );
  if (itemsDel.ok) counts.items = ((await itemsDel.json()) as unknown[]).length;

  // 3) shop_orders
  const oDel = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_orders?order_id=eq.${encodeURIComponent(orderId)}`,
    { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=minimal' } },
  );
  if (!oDel.ok) {
    const err = await oDel.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `주문 삭제 실패 (${oDel.status})`);
  }

  return counts;
}

async function fetchOrderItems(orderId: string): Promise<ShopOrderItem[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_order_items?order_id=eq.${encodeURIComponent(orderId)}`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}

// 주문 ID 기반으로 발급된 쿠폰 목록 조회 (deals.quote_number 가 orderId 또는 orderId-N 형태)
async function fetchIssuedLicensesByOrderId(orderId: string): Promise<Array<{
  coupon_code: string; duration: string; user_count: string; contact_name: string; contact_phone: string;
}>> {
  // 1) quote_number 패턴 매칭으로 deal id 조회 (orderId, orderId-1, orderId-2, ...)
  const dealsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/deals?quote_number=like.${encodeURIComponent(orderId)}*&select=id`,
    { headers: HEADERS },
  );
  if (!dealsRes.ok) return [];
  const deals: Array<{ id: string }> = await dealsRes.json();
  if (deals.length === 0) return [];

  // 2) 각 deal에 묶인 deal_licenses 조회
  const dealIds = deals.map((d) => d.id).join(',');
  const licRes = await fetch(
    `${SUPABASE_URL}/rest/v1/deal_licenses?deal_id=in.(${dealIds})&select=coupon_code,duration,user_count,contact_name,contact_phone`,
    { headers: HEADERS },
  );
  if (!licRes.ok) return [];
  return licRes.json();
}

export default function ShopOrders() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const ordersQuery = useQuery({ queryKey: ['shop-orders'], queryFn: fetchOrders });
  const orders = ordersQuery.data ?? [];

  // 디지털 전용 주문 판별 (모든 아이템이 디지털인지)
  const itemsByOrder = useQuery({
    queryKey: ['shop-orders-items-bulk'],
    queryFn: async () => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/shop_order_items?select=order_id,product_id&limit=2000`,
        { headers: HEADERS },
      );
      if (!r.ok) return new Map<string, string[]>();
      const rows: { order_id: string; product_id: string }[] = await r.json();
      const map = new Map<string, string[]>();
      for (const row of rows) {
        const arr = map.get(row.order_id) ?? [];
        arr.push(row.product_id);
        map.set(row.order_id, arr);
      }
      return map;
    },
  });

  const isDigitalOnly = (orderId: string): boolean => {
    const ids = itemsByOrder.data?.get(orderId);
    if (!ids || ids.length === 0) return false;
    return ids.every((id) => DIGITAL_PRODUCTS.has(id));
  };

  const isMixed = (orderId: string): boolean => {
    const ids = itemsByOrder.data?.get(orderId);
    if (!ids || ids.length === 0) return false;
    const hasDigital  = ids.some((id) => DIGITAL_PRODUCTS.has(id));
    const hasPhysical = ids.some((id) => !DIGITAL_PRODUCTS.has(id));
    return hasDigital && hasPhysical;
  };

  // 디지털 전용 주문은 상품관리에서 제외 (딜관리에서 처리)
  // itemsByOrder가 로딩 중이면 모두 표시 (잠깐 노출되어도 OK)
  const physicalOrders = useMemo(() => {
    if (!itemsByOrder.data) return orders;
    return orders.filter((o) => !isDigitalOnly(o.order_id));
  }, [orders, itemsByOrder.data]);

  const filtered = useMemo(() => {
    let list = physicalOrders;
    if (statusFilter !== 'all') list = list.filter((o) => o.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((o) =>
        o.order_id.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.includes(q),
      );
    }
    return list;
  }, [physicalOrders, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: physicalOrders.length };
    for (const s of STATUS_LIST) c[s] = physicalOrders.filter((o) => o.status === s).length;
    return c;
  }, [physicalOrders]);

  const updateMutation = useMutation({
    mutationFn: async (params: {
      id: number;
      status?: typeof STATUS_LIST[number];
      carrier?: string;
      trackingNumber?: string;
    }) => {
      const body: Record<string, unknown> = {};
      if (params.status) {
        body.status = params.status;
        if (params.status === '배송중') body.shipped_at = new Date().toISOString();
        if (params.status === '배송완료') body.delivered_at = new Date().toISOString();
      }
      if (params.carrier !== undefined) body.carrier = params.carrier || null;
      if (params.trackingNumber !== undefined) body.tracking_number = params.trackingNumber || null;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_orders?id=eq.${params.id}`, {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('업데이트 실패');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shop-orders'] });
      toast.success('업데이트 완료');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedOrder = orders.find((o) => o.order_id === selectedOrderId) ?? null;

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">상품관리</h1>
          <p className="text-sm text-muted-foreground mt-1">실물 상품 배송 관리 — 디지털만 있는 주문은 <span className="underline">/딜관리</span>에서 관리됩니다.</p>
        </div>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="주문번호/이름/전화 검색"
          className="h-9 w-64"
        />
      </div>

      {/* 상태 필터 칩 */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs border ${statusFilter === 'all' ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-muted'}`}
        >
          전체 <span className="opacity-70 ml-1">{counts.all}</span>
        </button>
        {STATUS_LIST.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs border ${statusFilter === s ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-muted'}`}
          >
            {s} <span className="opacity-70 ml-1">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {ordersQuery.isLoading ? (
        <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">주문이 없습니다.</div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left px-3 py-2">주문일</th>
                <th className="text-left px-3 py-2">주문번호</th>
                <th className="text-left px-3 py-2">유형</th>
                <th className="text-left px-3 py-2">고객</th>
                <th className="text-right px-3 py-2">금액</th>
                <th className="text-left px-3 py-2">배송</th>
                <th className="text-left px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const mixed = isMixed(o.order_id);
                return (
                  <tr
                    key={o.id}
                    onClick={() => setSelectedOrderId(o.order_id)}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                  >
                    <td className="px-3 py-2 text-muted-foreground">{o.created_at?.slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{o.order_id}</td>
                    <td className="px-3 py-2">
                      {mixed ? (
                        <Badge variant="outline" className="gap-1 text-[10px] border-violet-300 text-violet-700"><Package className="h-3 w-3" /> 혼합</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-[10px]"><Package className="h-3 w-3" /> 실물</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div>{o.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{formatPhone(o.customer_phone)}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{(o.total_amount ?? 0).toLocaleString()}원</td>
                    <td className="px-3 py-2 text-xs">
                      {o.tracking_number ? (
                        <div>
                          <div>{o.carrier ?? '-'}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{o.tracking_number}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">미입력</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_BADGE[o.status as keyof typeof STATUS_BADGE] ?? ''}`}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && (
        <OrderDetailDialog
          order={selectedOrder}
          onClose={() => setSelectedOrderId(null)}
          onUpdate={(p) => updateMutation.mutate({ id: selectedOrder.id, ...p })}
          updating={updateMutation.isPending}
          onDeleted={() => {
            setSelectedOrderId(null);
            qc.invalidateQueries({ queryKey: ['shop-orders'] });
            qc.invalidateQueries({ queryKey: ['shop-orders-items-bulk'] });
          }}
        />
      )}
    </div>
  );
}

// ── 상세 다이얼로그 ───────────────────────────────────
function OrderDetailDialog(props: {
  order: ShopOrder;
  onClose: () => void;
  onUpdate: (p: { status?: typeof STATUS_LIST[number]; carrier?: string; trackingNumber?: string }) => void;
  updating: boolean;
  onDeleted: () => void;
}) {
  const { order, onClose, onUpdate, updating, onDeleted } = props;
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [trackingNumber, setTrackingNumber] = useState(order.tracking_number ?? '');
  const [resending, setResending] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const counts = await deleteShopOrder(order.order_id);
      const parts: string[] = [`주문 1건`];
      if (counts.items > 0) parts.push(`상품 ${counts.items}건`);
      if (counts.deals > 0) parts.push(`딜 ${counts.deals}건`);
      if (counts.licenses > 0) parts.push(`라이선스 ${counts.licenses}건`);
      toast.success(`삭제 완료 (${parts.join(', ')})`);
      setDeleteConfirmOpen(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '주문 삭제 실패');
    } finally {
      setDeleting(false);
    }
  };

  const itemsQuery = useQuery({
    queryKey: ['shop-order-items', order.order_id],
    queryFn: () => fetchOrderItems(order.order_id),
  });

  const items = itemsQuery.data ?? [];
  const physicalItems = items.filter((it) => !DIGITAL_PRODUCTS.has(it.product_id));
  const digitalItems  = items.filter((it) => DIGITAL_PRODUCTS.has(it.product_id));
  const hasDigital    = digitalItems.length > 0;
  const hasPhysical   = physicalItems.length > 0;

  // 디지털 아이템이 있는 경우만 발급 쿠폰 조회 (재발송용)
  const licensesQuery = useQuery({
    queryKey: ['shop-order-licenses', order.order_id],
    queryFn: () => fetchIssuedLicensesByOrderId(order.order_id),
    enabled: hasDigital,
  });

  const physicalSubtotal = physicalItems.reduce((s, it) => s + (it.subtotal ?? 0), 0);
  const digitalSubtotal  = digitalItems.reduce((s, it) => s + (it.subtotal ?? 0), 0);

  const handleResendAlimtok = async () => {
    const licenses = licensesQuery.data ?? [];
    if (licenses.length === 0) {
      toast.error('발급된 쿠폰을 찾지 못했습니다 (딜관리 기록 없음).');
      return;
    }
    setResending(true);
    let ok = 0, fail = 0;
    for (const lic of licenses) {
      try {
        await apiSendCoupon({
          first_name: lic.contact_name || order.customer_name,
          phone:      (lic.contact_phone || order.customer_phone).replace(/\D/g, ''),
          coupon_code: lic.coupon_code,
          user_limit: lic.user_count,
          duration:   lic.duration,
          send_type:  'buyer',
        });
        ok++;
      } catch (e) {
        console.error('재발송 실패:', lic.coupon_code, e);
        fail++;
      }
    }
    setResending(false);
    if (ok > 0 && fail === 0) toast.success(`알림톡 ${ok}건 재발송 성공`);
    else if (ok > 0 && fail > 0) toast.warning(`${ok}건 성공, ${fail}건 실패`);
    else toast.error(`재발송 실패 (${fail}건)`);
  };

  // order(서버 응답)이 갱신되면 폼 상태도 동기화
  useEffect(() => {
    setCarrier(order.carrier ?? '');
    setTrackingNumber(order.tracking_number ?? '');
  }, [order.id, order.carrier, order.tracking_number]);

  const next = NEXT_STATUS[order.status as keyof typeof NEXT_STATUS];

  // 미저장 변경 여부
  const dirty =
    (carrier || '') !== (order.carrier ?? '') ||
    (trackingNumber || '') !== (order.tracking_number ?? '');

  const handleSaveTracking = () => {
    if (!dirty) return;
    onUpdate({ carrier, trackingNumber });
  };

  const handleAdvance = () => {
    if (!next) return;
    if (next === '배송중' && !trackingNumber) {
      toast.error('송장번호를 입력해주세요.');
      return;
    }
    // 단계 전환 시 송장 정보도 함께 저장
    onUpdate({ status: next, carrier, trackingNumber });
  };

  const handleCancel = () => {
    if (!confirm('주문을 취소 처리하시겠습니까?')) return;
    onUpdate({ status: '취소' });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{order.order_id}</span>
            <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_BADGE[order.status as keyof typeof STATUS_BADGE] ?? ''}`}>
              {order.status}
            </span>
            {hasDigital && hasPhysical && <Badge variant="outline" className="gap-1 text-[10px] border-violet-300 text-violet-700"><Package className="h-3 w-3" /> 혼합</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* 주문자 */}
          <section>
            <p className="text-xs font-semibold mb-2 text-muted-foreground">주문자</p>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">이름</span><span>{order.customer_name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">연락처</span><span>{formatPhone(order.customer_phone)}</span></div>
              {order.customer_email && (
                <div className="flex justify-between"><span className="text-muted-foreground">이메일</span><span>{order.customer_email}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">주문일</span><span>{order.created_at?.slice(0, 16).replace('T', ' ')}</span></div>
            </div>
          </section>

          {/* 디지털 쿠폰 (디지털 아이템이 있는 경우 — 혼합 카트 포함) */}
          {hasDigital && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  <Smartphone className="h-3 w-3 inline-block mr-1" />
                  발급 이용권 (딜관리에서 처리)
                </p>
                <span className="text-[10px] text-muted-foreground">디지털 합계 {digitalSubtotal.toLocaleString()}원</span>
              </div>
              {licensesQuery.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (licensesQuery.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">발급 이력 없음</p>
              ) : (
                <div className="rounded border bg-teal-50 dark:bg-teal-950/20 divide-y divide-teal-100 text-xs">
                  {(licensesQuery.data ?? []).map((lic) => (
                    <div key={lic.coupon_code} className="px-3 py-2 flex justify-between items-center">
                      <span className="font-mono font-semibold">{lic.coupon_code}</span>
                      <span className="text-muted-foreground text-[10px]">
                        {lic.duration}개월 / {lic.user_count}명
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Button
                onClick={handleResendAlimtok}
                disabled={resending || licensesQuery.isLoading || (licensesQuery.data ?? []).length === 0}
                size="sm"
                variant="outline"
                className="mt-2 w-full"
              >
                {resending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                알림톡 재발송 ({(licensesQuery.data ?? []).length}건)
              </Button>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                구매자 핸드폰({formatPhone(order.customer_phone)})으로 이용권 코드 알림톡을 다시 보냅니다.
              </p>
            </section>
          )}

          {/* 배송지 (실물 아이템 있는 경우) */}
          {hasPhysical && (
            <section>
              <p className="text-xs font-semibold mb-2 text-muted-foreground">배송지</p>
              <div className="bg-muted/30 rounded p-3 text-xs space-y-0.5">
                <p>({order.zipcode}) {order.address}</p>
                {order.address_detail && <p className="text-muted-foreground">{order.address_detail}</p>}
                {order.delivery_memo && <p className="text-muted-foreground italic">메모: {order.delivery_memo}</p>}
              </div>
              {(order.tracking_number || order.shipped_at || order.delivered_at) && (
                <div className="mt-2 bg-teal-50 dark:bg-teal-950/20 border border-teal-200 rounded p-3 text-xs space-y-0.5">
                  {order.carrier || order.tracking_number ? (
                    <p>
                      <span className="text-teal-700 dark:text-teal-300 font-medium">운송장: </span>
                      {order.carrier ? `${order.carrier} ` : ''}
                      <span className="font-mono">{order.tracking_number ?? '—'}</span>
                    </p>
                  ) : null}
                  {order.shipped_at && (
                    <p className="text-muted-foreground">발송: {new Date(order.shipped_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  )}
                  {order.delivered_at && (
                    <p className="text-muted-foreground">배송완료: {new Date(order.delivered_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* 상품 — 실물/디지털 분리 표시 */}
          <section>
            <p className="text-xs font-semibold mb-2 text-muted-foreground">상품 내역</p>
            {itemsQuery.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <div className="space-y-2">
                {hasPhysical && (
                  <div className="rounded border divide-y text-xs">
                    <div className="px-3 py-1.5 bg-muted/30 text-[10px] text-muted-foreground flex justify-between">
                      <span><Package className="h-3 w-3 inline mr-1" />실물 (배송 필요)</span>
                      <span>합계 {physicalSubtotal.toLocaleString()}원</span>
                    </div>
                    {physicalItems.map((it) => (
                      <div key={it.id} className="px-3 py-2 flex justify-between">
                        <div>
                          <div>{it.product_name} {it.option && <span className="text-muted-foreground">({it.option})</span>}</div>
                          <div className="text-muted-foreground">× {it.qty}</div>
                        </div>
                        <div className="text-right">{(it.subtotal ?? 0).toLocaleString()}원</div>
                      </div>
                    ))}
                  </div>
                )}
                {hasDigital && (
                  <div className="rounded border divide-y text-xs opacity-70">
                    <div className="px-3 py-1.5 bg-muted/30 text-[10px] text-muted-foreground flex justify-between">
                      <span><Smartphone className="h-3 w-3 inline mr-1" />디지털 (딜관리에서 처리)</span>
                      <span>합계 {digitalSubtotal.toLocaleString()}원</span>
                    </div>
                    {digitalItems.map((it) => (
                      <div key={it.id} className="px-3 py-2 flex justify-between">
                        <div>
                          <div>{it.product_name} {it.option && <span className="text-muted-foreground">({it.option})</span>}</div>
                          <div className="text-muted-foreground">× {it.qty}</div>
                        </div>
                        <div className="text-right">{(it.subtotal ?? 0).toLocaleString()}원</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-2 space-y-0.5 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">소계</span><span>{order.subtotal.toLocaleString()}원</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">배송비</span><span>{order.shipping_fee === 0 ? '무료' : `${order.shipping_fee.toLocaleString()}원`}</span></div>
              {order.discount > 0 && (
                <div className="flex justify-between text-teal-600"><span>할인</span><span>-{order.discount.toLocaleString()}원</span></div>
              )}
              <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>결제 금액 (실물+디지털)</span><span>{order.total_amount.toLocaleString()}원</span></div>
            </div>
          </section>

          {/* 배송 정보 입력 (실물 아이템 있고 미완료 상태일 때) */}
          {hasPhysical && order.status !== '취소' && order.status !== '배송완료' && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground">배송 정보</p>
                {dirty && (
                  <span className="text-[10px] text-amber-600 font-medium">● 미저장 변경</span>
                )}
              </div>
              <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2 items-end">
                <div>
                  <Label className="text-xs">택배사</Label>
                  <Select value={carrier} onValueChange={setCarrier}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      {CARRIERS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">송장번호</Label>
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && dirty && !updating) handleSaveTracking(); }}
                    placeholder="숫자만 입력"
                    className="h-9 text-xs"
                  />
                </div>
                <Button onClick={handleSaveTracking} disabled={updating || !dirty} size="sm" className="h-9">
                  {updating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  저장
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                저장 후 고객이 주문 조회에서 운송장 번호를 확인할 수 있습니다.
              </p>
            </section>
          )}

          {/* 액션 */}
          <section className="flex gap-2 pt-2 border-t">
            {next && (
              <Button onClick={handleAdvance} disabled={updating} className="flex-1">
                {updating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> :
                 next === '배송준비' ? <Package className="h-4 w-4 mr-1" /> :
                 next === '배송중'   ? <Truck className="h-4 w-4 mr-1" /> :
                                       <CheckCircle2 className="h-4 w-4 mr-1" />}
                {next}로 변경
              </Button>
            )}
            {order.status !== '취소' && order.status !== '배송완료' && (
              <Button variant="outline" onClick={handleCancel} disabled={updating}>
                <X className="h-4 w-4 mr-1" /> 주문 취소
              </Button>
            )}
            <Button variant="ghost" asChild>
              <a href={`/shop/lookup?orderId=${order.order_id}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" /> 고객 조회 화면
              </a>
            </Button>
          </section>

          {/* 주문 삭제 — 위험 영역 */}
          <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-destructive">주문 삭제</div>
              <div className="text-xs text-muted-foreground">
                {hasDigital
                  ? '⚠️ 디지털 발급분(딜/이용권)도 함께 삭제됩니다. mDiary 쿠폰은 외부 시스템이라 삭제 안 됨.'
                  : order.status === '결제완료' || order.status === '배송준비' || order.status === '배송중'
                  ? '⚠️ 결제 환불은 별도 처리 필요. 주문 데이터만 삭제됩니다.'
                  : '주문 데이터를 영구 삭제합니다.'}
              </div>
            </div>
            <Button size="sm" variant="destructive" disabled={updating || deleting} onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" /> 주문 삭제
            </Button>
          </section>
        </div>

        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>주문 {order.order_id} 삭제</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>다음 데이터가 영구 삭제됩니다:</p>
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                    <li>주문 정보 (shop_orders) 1건</li>
                    <li>주문 상품 ({items.length}건)</li>
                    {hasDigital && <li>자동 생성된 딜 + 견적 + 이용권 (디지털 {digitalItems.length}건)</li>}
                  </ul>
                  {(order.status === '결제완료' || order.status === '배송준비' || order.status === '배송중') && (
                    <p className="text-destructive font-medium pt-1">
                      ⚠️ Toss 환불은 별도로 처리하세요.
                    </p>
                  )}
                  {hasDigital && (
                    <p className="text-destructive font-medium">
                      ⚠️ mDiary 발급된 쿠폰은 외부 시스템이라 그대로 남습니다.
                    </p>
                  )}
                  <p className="pt-1">계속하시겠습니까?</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
                  {deleting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  삭제
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
