// ── 실물 상품 주문 시스템 ────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

// ── 타입 ──────────────────────────────────────────
// 옵션은 두 형태를 모두 받는다.
//   문자열     — 가격이 같은 단순 선택지 (예: 보드게임 '한글판' | '영문판')
//   {label,price} — 선택지마다 가격이 다른 경우 (예: 일기 제본 페이지 구간별 단가)
export type ShopProductOption = string | { label: string; price: number };

export function optionLabel(o: ShopProductOption): string {
  return typeof o === 'string' ? o : o.label;
}

// 선택한 옵션의 단가. 문자열 옵션이면 상품 기본가를 그대로 쓴다.
export function optionPrice(o: ShopProductOption | undefined, basePrice: number): number {
  if (o && typeof o === 'object' && typeof o.price === 'number') return o.price;
  return basePrice;
}

// 수량 옆에 붙일 단위. unit_label이 '1권'/'1개'처럼 명확할 때만 쓴다.
// '10개 1세트'(키링), '1학급 1개월'(마음일기)처럼 수량 단위가 애매한 상품은
// 잘못된 단위를 붙이느니 아무것도 안 붙인다.
export function qtyUnitFromLabel(unitLabel?: string | null): string {
  return unitLabel?.match(/^1([가-힣]{1,2})$/)?.[1] ?? '';
}

export interface ShopProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  original_price?: number;         // 정가 (할인 전, null이면 할인 없음)
  unit_qty: number;
  unit_label?: string;
  options?: ShopProductOption[];
  image_url?: string;
  detail_image_url?: string;
  active: boolean;
  sort_order: number;
  shipping_fee?: number | null;    // 이 상품만의 고정 배송비. null이면 공통 정책(3,000원 + 무료배송 할인)
}

export interface CartItem {
  productId: string;
  productName: string;
  option?: string;
  qty: number;
  unitPrice: number;
  shippingFee?: number;   // 담을 때의 상품 고정 배송비 스냅샷 (unitPrice와 같은 방식)
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
  // 같은 탭 안의 다른 컴포넌트가 즉시 반영하도록 커스텀 이벤트 발생
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('seamspace_cart_changed'));
  }
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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('seamspace_cart_changed'));
  }
}

// 배송 불필요 상품 (디지털/알림톡 발송)
const DIGITAL_PRODUCTS = new Set(['minddiary']);

import { calcShipping, type ShippingBreakdown } from '@/lib/shipping';

export function getCartTotal(cart: CartItem[], address?: string): {
  subtotal: number;
  shippingFee: number;
  total: number;
  needsShipping: boolean;
  shippingBreakdown: ShippingBreakdown;
} {
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const hasPhysical = cart.some(item => !DIGITAL_PRODUCTS.has(item.productId));
  const needsShipping = hasPhysical;
  // 고정 배송비 상품이 섞여 있으면 가장 비싼 것 하나만 적용한다.
  // 상품별로 합산하지 않는 이유: 이 스토어는 주문 1건에 배송비 1회 부과 구조다.
  const fixedFees = cart.map(i => i.shippingFee ?? 0).filter(f => f > 0);
  const fixedFee = fixedFees.length > 0 ? Math.max(...fixedFees) : null;
  const shippingBreakdown = calcShipping({ subtotal, needsShipping, address, fixedFee });
  return {
    subtotal,
    shippingFee: shippingBreakdown.total,
    total: subtotal + shippingBreakdown.total,
    needsShipping,
    shippingBreakdown,
  };
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
  applicable_products?: string[] | null;
}

export interface CouponValidation {
  valid: boolean;
  discount: number;
  couponName?: string;
  error?: string;
  // 어떤 상품에 적용되었는지 (UI에 표시용)
  applicableLabel?: string;
}

// cartItems가 주어지면 applicable_products와 비교해 적용 가능 여부 판단.
// - applicable_products NULL/빈배열: 전체 적용 (기존 동작)
// - 카트의 product_id가 모두 applicable에 포함: 정상 할인
// - 일부만 일치: applicable 상품 합계에만 할인 적용
// - 하나도 일치 X: 거부
export async function validateShopCoupon(
  code: string,
  subtotal: number,
  cartItems?: Array<{ productId: string; unitPrice: number; qty: number }>,
): Promise<CouponValidation> {
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

  // 적용 가능 상품 — 일치하는 상품의 합계만 할인 대상
  const applicable = coupon.applicable_products && coupon.applicable_products.length > 0
    ? coupon.applicable_products
    : null;
  let applicableSubtotal = subtotal;
  let applicableLabel: string | undefined;
  if (applicable && cartItems && cartItems.length > 0) {
    const matched = cartItems.filter(it => applicable.includes(it.productId));
    if (matched.length === 0) {
      const labels: Record<string, string> = { boardgame: '보드게임', keyring: '키링', minddiary: 'AI마음일기' };
      const names = applicable.map(p => labels[p] ?? p).join(', ');
      return { valid: false, discount: 0, error: `이 쿠폰은 ${names}에만 사용 가능합니다.` };
    }
    applicableSubtotal = matched.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    applicableLabel = matched.length === cartItems.length ? undefined : '일부 상품에만 적용';
  }

  if (applicableSubtotal < coupon.min_order) {
    return { valid: false, discount: 0, error: `${coupon.min_order.toLocaleString()}원 이상 주문 시 사용 가능합니다.` };
  }

  let discount = 0;
  if (coupon.discount_type === 'amount') {
    discount = coupon.discount_value;
  } else {
    discount = Math.round(applicableSubtotal * coupon.discount_value / 100);
  }
  discount = Math.min(discount, applicableSubtotal);

  return { valid: true, discount, couponName: coupon.batch_name, applicableLabel };
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
