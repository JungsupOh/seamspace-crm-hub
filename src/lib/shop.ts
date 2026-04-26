// ── 실물 상품 주문 시스템 ────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

// ── 타입 ──────────────────────────────────────────
export interface ShopProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  original_price?: number;         // 정가 (할인 전, null이면 할인 없음)
  unit_qty: number;
  unit_label?: string;
  options?: string[];
  image_url?: string;
  detail_image_url?: string;
  active: boolean;
  sort_order: number;
}

export interface CartItem {
  productId: string;
  productName: string;
  option?: string;
  qty: number;
  unitPrice: number;
}

export interface ShopOrder {
  id: number;
  order_id: string;
  created_at: string;
  status: '결제완료' | '배송준비' | '배송중' | '배송완료' | '취소';
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  zipcode: string;
  address: string;
  address_detail?: string;
  delivery_memo?: string;
  subtotal: number;
  shipping_fee: number;
  discount: number;
  coupon_code?: string;
  total_amount: number;
  payment_key?: string;
  toss_method?: string;
  carrier?: string;
  tracking_number?: string;
  shipped_at?: string;
  delivered_at?: string;
}

export interface ShopOrderItem {
  id: number;
  order_id: string;
  product_id: string;
  product_name: string;
  option?: string;
  qty: number;
  unit_price: number;
  subtotal: number;
}

// ── 상품 API ──────────────────────────────────────
export async function getShopProducts(): Promise<ShopProduct[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_products?active=eq.true&order=sort_order.asc`, { headers: HEADERS });
  if (!r.ok) return [];
  return r.json();
}

export async function getShopProduct(id: string): Promise<ShopProduct | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_products?id=eq.${id}&limit=1`, { headers: HEADERS });
  if (!r.ok) return null;
  const rows: ShopProduct[] = await r.json();
  return rows[0] ?? null;
}

// ── 장바구니 (localStorage) ───────────────────────
const CART_KEY = 'seamspace_cart';

export function getCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

export function saveCart(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify({ items }));
}

export function addToCart(item: CartItem) {
  const cart = getCart();
  const existing = cart.find(c => c.productId === item.productId && c.option === item.option);
  if (existing) {
    existing.qty += item.qty;
  } else {
    cart.push(item);
  }
  saveCart(cart);
}

export function updateCartQty(productId: string, option: string | undefined, qty: number) {
  const cart = getCart();
  const item = cart.find(c => c.productId === productId && c.option === option);
  if (item) {
    if (qty <= 0) {
      saveCart(cart.filter(c => !(c.productId === productId && c.option === option)));
    } else {
      item.qty = qty;
      saveCart(cart);
    }
  }
}

export function removeFromCart(productId: string, option?: string) {
  const cart = getCart().filter(c => !(c.productId === productId && c.option === option));
  saveCart(cart);
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

// 배송 불필요 상품 (디지털/알림톡 발송)
const DIGITAL_PRODUCTS = new Set(['minddiary']);

export function getCartTotal(cart: CartItem[]): { subtotal: number; shippingFee: number; total: number; needsShipping: boolean } {
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const hasPhysical = cart.some(item => !DIGITAL_PRODUCTS.has(item.productId));
  const needsShipping = hasPhysical;
  const shippingFee = !needsShipping ? 0 : subtotal >= 50000 ? 0 : 3000;
  return { subtotal, shippingFee, total: subtotal + shippingFee, needsShipping };
}

// ── 주문 API ──────────────────────────────────────
export async function lookupShopOrder(orderId: string, phone: string): Promise<{ order: ShopOrder; items: ShopOrderItem[] } | null> {
  const phoneNorm = phone.replace(/\D/g, '');
  const [orderRes, itemsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/shop_orders?order_id=eq.${encodeURIComponent(orderId)}&customer_phone=eq.${phoneNorm}&limit=1`, { headers: HEADERS }),
    fetch(`${SUPABASE_URL}/rest/v1/shop_order_items?order_id=eq.${encodeURIComponent(orderId)}`, { headers: HEADERS }),
  ]);
  if (!orderRes.ok) return null;
  const orders: ShopOrder[] = await orderRes.json();
  if (orders.length === 0) return null;
  const items: ShopOrderItem[] = itemsRes.ok ? await itemsRes.json() : [];
  return { order: orders[0], items };
}

// ── 쿠폰 검증 (개별 일련번호, 1회용) ────────────────
export interface ShopCoupon {
  id: number;
  code: string;
  batch_name: string;
  campaign_id?: string;
  discount_type: 'amount' | 'percent';
  discount_value: number;
  min_order: number;
  expires_at: string;
  is_used: boolean;
  active: boolean;
}

export interface CouponValidation {
  valid: boolean;
  discount: number;
  couponName?: string;
  error?: string;
}

export async function validateShopCoupon(code: string, subtotal: number): Promise<CouponValidation> {
  if (!code.trim()) return { valid: false, discount: 0, error: '쿠폰 코드를 입력해주세요.' };

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_coupons?code=eq.${encodeURIComponent(code.trim().toUpperCase())}&active=eq.true&limit=1`,
    { headers: HEADERS }
  );
  if (!r.ok) return { valid: false, discount: 0, error: '쿠폰 조회 실패' };
  const rows: ShopCoupon[] = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return { valid: false, discount: 0, error: '유효하지 않은 쿠폰 코드입니다.' };
  }

  const coupon = rows[0];

  if (coupon.is_used) {
    return { valid: false, discount: 0, error: '이미 사용된 쿠폰입니다.' };
  }
  if (new Date(coupon.expires_at) < new Date()) {
    return { valid: false, discount: 0, error: '만료된 쿠폰입니다.' };
  }
  if (subtotal < coupon.min_order) {
    return { valid: false, discount: 0, error: `${coupon.min_order.toLocaleString()}원 이상 주문 시 사용 가능합니다.` };
  }

  let discount = 0;
  if (coupon.discount_type === 'amount') {
    discount = coupon.discount_value;
  } else {
    discount = Math.round(subtotal * coupon.discount_value / 100);
  }
  discount = Math.min(discount, subtotal);

  return { valid: true, discount, couponName: coupon.batch_name };
}

// 쿠폰 사용 처리 (Supabase RPC — 주문ID + 전화번호 기록)
export async function markCouponUsed(code: string, orderId: string, phone: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/use_shop_coupon`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ p_code: code, p_order_id: orderId, p_phone: phone }),
  }).catch(() => {});
}

// 쿠폰 배치 생성 (관리자용)
export async function createCouponBatch(params: {
  batchName: string;
  prefix: string;
  count: number;
  campaignId?: string;
  discountType: 'amount' | 'percent';
  discountValue: number;
  minOrder: number;
  expiresAt: string;
}): Promise<ShopCoupon[]> {
  const randomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자 제외 (0O1I)
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => chars[b % chars.length]).join('');
  };
  const coupons = [];
  const usedCodes = new Set<string>();
  for (let i = 0; i < params.count; i++) {
    let code: string;
    do { code = `${params.prefix}-${randomCode()}`; } while (usedCodes.has(code));
    usedCodes.add(code);
    coupons.push({
      code,
      batch_name: params.batchName,
      campaign_id: params.campaignId || null,
      discount_type: params.discountType,
      discount_value: params.discountValue,
      min_order: params.minOrder,
      expires_at: params.expiresAt,
    });
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_coupons`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(coupons),
  });
  if (!r.ok) throw new Error('쿠폰 배치 생성 실패');
  return r.json();
}

// 고객용: 이름+전화번호로 최근 1개월 주문 목록 조회
export async function lookupMyOrders(name: string, phone: string): Promise<{ order: ShopOrder; items: ShopOrderItem[] }[]> {
  const phoneNorm = phone.replace(/\D/g, '');
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const orderRes = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_orders?customer_name=eq.${encodeURIComponent(name)}&customer_phone=eq.${phoneNorm}&created_at=gte.${encodeURIComponent(oneMonthAgo)}&order=created_at.desc`,
    { headers: HEADERS }
  );
  if (!orderRes.ok) return [];
  const orders: ShopOrder[] = await orderRes.json();
  if (!Array.isArray(orders) || orders.length === 0) return [];

  const orderIds = orders.map(o => o.order_id);
  const itemsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_order_items?order_id=in.(${orderIds.map(id => `"${id}"`).join(',')})`,
    { headers: HEADERS }
  );
  const allItems: ShopOrderItem[] = itemsRes.ok ? await itemsRes.json() : [];

  return orders.map(o => ({
    order: o,
    items: Array.isArray(allItems) ? allItems.filter(i => i.order_id === o.order_id) : [],
  }));
}

// 관리자용: 전체 주문 조회
export async function getAllShopOrders(): Promise<ShopOrder[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_orders?order=created_at.desc&limit=500`, { headers: HEADERS });
  if (!r.ok) return [];
  return r.json();
}

// 관리자용: 주문 상태 업데이트
export async function updateShopOrderStatus(orderId: string, updates: Partial<ShopOrder>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/shop_orders?order_id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(updates),
  });
}
