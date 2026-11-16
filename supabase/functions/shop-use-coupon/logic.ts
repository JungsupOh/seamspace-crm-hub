// shop-use-coupon 의 순수 로직 — 입력 검증과 "써도 되는가" 판정.
//
// 원본은 브라우저가 RPC `use_shop_coupon` 을 **anon 권한으로** 부르는 것이었다.
// 그 함수는 SECURITY DEFINER 가 아니라 호출자 권한으로 돌기 때문에,
// shop_coupons 의 공개 ALL 정책이 열려 있어야만 동작했다(B2b 가 닫지 못한 이유).
//
// 더 중요한 문제는 **아무 증거 없이 불릴 수 있다**는 것이었다. 원본 RPC 는
//   UPDATE shop_coupons SET is_used=true … WHERE code=p_code AND is_used=false
// 뿐이라, 코드만 알면 남의 쿠폰을 **태워 버릴 수 있었다**(돈을 벌 수는 없지만
// 쓰지 못하게 만들 수는 있다). orderId·phone 은 기록만 될 뿐 검증되지 않았다.
//
// 이제 서버가 "이 주문이 실제로 있고, 그 주문이 이 쿠폰을 썼고, 전화번호도 같다"를
// 먼저 확인한다. 결제 흐름상 이 함수는 confirm-shop-payment **뒤에** 불리므로
// (ShopComplete.tsx:41 승인 → :76 쿠폰 처리) 그 시점에 주문 행은 이미 있다.

const MAX_CODE = 64;
const MAX_ORDER = 128;

export interface UseInput {
  code: string;
  orderId: string;
  phoneNorm: string;
}

export type Verdict =
  | { ok: true; value: UseInput }
  | { ok: false; status: 400; error: string };

export function normalizePhone(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : '';
}

export function validateInput(raw: unknown): Verdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => !['code', 'orderId', 'phone'].includes(k));
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const code = typeof b.code === 'string' ? b.code.trim() : '';
  const orderId = typeof b.orderId === 'string' ? b.orderId.trim() : '';
  const phoneNorm = normalizePhone(b.phone);

  if (!code || code.length > MAX_CODE || !/^[A-Za-z0-9._-]+$/.test(code)) {
    return { ok: false, status: 400, error: '쿠폰 정보가 올바르지 않습니다.' };
  }
  if (!orderId || orderId.length > MAX_ORDER || !/^[A-Za-z0-9._-]+$/.test(orderId)) {
    return { ok: false, status: 400, error: '주문 정보가 올바르지 않습니다.' };
  }
  if (phoneNorm.length < 9) {
    return { ok: false, status: 400, error: '주문 정보가 올바르지 않습니다.' };
  }
  return { ok: true, value: { code, orderId, phoneNorm } };
}

export interface OrderRow {
  order_id?: unknown;
  customer_phone?: unknown;
  coupon_code?: unknown;
}

export type UseVerdict =
  | { allow: true }
  | { allow: false; status: 404 | 409; error: string };

/**
 * 주문이 이 쿠폰을 쓸 자격이 있는가.
 *
 * ⚠️ 실패 문구를 하나로 합친다 — "그 주문은 있는데 전화번호가 다르다" 같은 힌트를
 *    주면 주문번호를 가진 사람이 전화번호를 맞혀 볼 수 있다.
 */
export function orderVerdict(order: OrderRow | null, input: UseInput): UseVerdict {
  if (!order) return { allow: false, status: 404, error: '주문을 찾을 수 없습니다.' };

  const phone = normalizePhone(order.customer_phone);
  const coupon = typeof order.coupon_code === 'string' ? order.coupon_code.trim() : '';
  if (phone !== input.phoneNorm) return { allow: false, status: 404, error: '주문을 찾을 수 없습니다.' };
  if (coupon !== input.code) return { allow: false, status: 404, error: '주문을 찾을 수 없습니다.' };

  return { allow: true };
}

/**
 * 멱등 판정 — 원본 RPC 의 `WHERE … AND is_used = false` 와 같은 뜻이다.
 *
 * 이미 **같은 주문**이 쓴 쿠폰이면 성공으로 돌려준다(새로고침·재시도에 안전).
 * 다른 주문이 이미 썼으면 쓰지 않는다.
 */
export function usageVerdict(
  coupon: { is_used?: unknown; used_order_id?: unknown } | null,
  input: UseInput,
): { apply: boolean; already: boolean; error?: string } {
  if (!coupon) return { apply: false, already: false, error: '쿠폰을 찾을 수 없습니다.' };
  const used = coupon.is_used === true;
  if (!used) return { apply: true, already: false };
  const by = typeof coupon.used_order_id === 'string' ? coupon.used_order_id.trim() : '';
  if (by === input.orderId) return { apply: false, already: true };
  return { apply: false, already: false, error: '이미 사용된 쿠폰입니다.' };
}

/** 원본 RPC 가 쓰던 네 열과 같다. */
export function buildUsagePatch(input: UseInput, nowIso: string): Record<string, unknown> {
  return {
    is_used: true,
    used_at: nowIso,
    used_order_id: input.orderId,
    used_by_phone: input.phoneNorm,
  };
}
