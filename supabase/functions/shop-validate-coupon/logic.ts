// shop-validate-coupon 의 순수 로직 — 입력 검증 + 할인 계산.
//
// 계산은 브라우저 원본(src/lib/shop.ts validateShopCoupon:238-288)에서
// **그대로** 옮겼다. 문구·조건·반올림을 바꾸지 않았다 — 화면에 보이는 값이 같아야 한다.
//
// 달라지는 것은 하나뿐이다: 쿠폰 행(할인율·최소주문·적용상품·사용이력 등 16개 열)이
// **브라우저로 내려가지 않는다.** 서버가 계산해서 결과만 돌려준다.

export const MAX_CODE = 64;
export const MAX_CART_ITEMS = 50;

export interface CouponRow {
  batch_name?: string;
  discount_type?: 'amount' | 'percent' | string;
  discount_value?: number;
  min_order?: number;
  expires_at?: string;
  is_used?: boolean;
  applicable_products?: string[] | null;
}

export interface CartLine { productId: string; unitPrice: number; qty: number }

export interface CouponValidation {
  valid: boolean;
  discount: number;
  couponName?: string;
  error?: string;
  applicableLabel?: string;
}

export type InputVerdict =
  | { ok: true; value: { code: string; subtotal: number; cartItems: CartLine[] } }
  | { ok: false; status: 400; error: string };

export function validateInput(raw: unknown): InputVerdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => !['code', 'subtotal', 'cartItems'].includes(k));
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const code = typeof b.code === 'string' ? b.code.trim() : '';
  if (!code || code.length > MAX_CODE) {
    // 원본과 같은 문구 — 빈 코드는 화면에서도 이 메시지를 썼다.
    return { ok: false, status: 400, error: '쿠폰 코드를 입력해주세요.' };
  }
  const subtotal = Number(b.subtotal);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }

  const cartItems: CartLine[] = [];
  if (Array.isArray(b.cartItems)) {
    if (b.cartItems.length > MAX_CART_ITEMS) {
      return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
    }
    for (const it of b.cartItems) {
      if (!it || typeof it !== 'object') return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
      const o = it as Record<string, unknown>;
      const productId = typeof o.productId === 'string' ? o.productId.trim().slice(0, 100) : '';
      const unitPrice = Number(o.unitPrice);
      const qty = Number(o.qty);
      if (!productId || !Number.isFinite(unitPrice) || !Number.isFinite(qty)) {
        return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
      }
      cartItems.push({ productId, unitPrice, qty });
    }
  }
  return { ok: true, value: { code: code.toUpperCase(), subtotal, cartItems } };
}

/** 쿠폰 행 + 장바구니로 할인을 판정한다. 원본 로직 그대로. */
export function evaluateCoupon(
  coupon: CouponRow | null,
  subtotal: number,
  cartItems: CartLine[],
  now: Date = new Date(),
): CouponValidation {
  if (!coupon) return { valid: false, discount: 0, error: '유효하지 않은 쿠폰 코드입니다.' };
  if (coupon.is_used) return { valid: false, discount: 0, error: '이미 사용된 쿠폰입니다.' };
  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return { valid: false, discount: 0, error: '만료된 쿠폰입니다.' };
  }

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

  const minOrder = Number(coupon.min_order ?? 0);
  if (applicableSubtotal < minOrder) {
    return { valid: false, discount: 0, error: `${minOrder.toLocaleString()}원 이상 주문 시 사용 가능합니다.` };
  }

  let discount = 0;
  if (coupon.discount_type === 'amount') {
    discount = Number(coupon.discount_value ?? 0);
  } else {
    discount = Math.round(applicableSubtotal * Number(coupon.discount_value ?? 0) / 100);
  }
  discount = Math.min(discount, applicableSubtotal);

  return { valid: true, discount, couponName: coupon.batch_name, applicableLabel };
}
