// shop-lookup-orders 의 순수 로직 — 입력 검증과 열 목록.
//
// "알고 있다는 증거": 이름 + 휴대폰이 **둘 다** 일치해야 한다(원본과 같다).
// 원본은 최근 30일로도 좁혔다 — 그 조건도 그대로 둔다.

export const MAX_ORDERS = 20;
export const MAX_ITEMS  = 200;
const MAX_NAME = 50;

/** 화면(ShopOrderLookup)이 쓰는 열만. 결제 내부값(payment_key·toss_method·approved_at)과
 *  개인정보 일부(customer_*)는 뺀다 — 조회한 본인이 이미 아는 값이고 화면에 쓰지 않는다. */
export const ORDER_COLS = [
  'order_id', 'created_at', 'status',
  'zipcode', 'address', 'address_detail', 'delivery_memo',
  'subtotal', 'shipping_fee', 'discount', 'total_amount',
  'carrier', 'tracking_number', 'shipped_at', 'delivered_at',
] as const;

export const ITEM_COLS = ['order_id', 'product_name', 'option', 'qty', 'unit_price', 'subtotal'] as const;

export type LookupVerdict =
  | { ok: true; value: { name: string; phoneNorm: string; since: string } }
  | { ok: false; status: 400; error: string };

export function validateInput(raw: unknown, now: Date = new Date()): LookupVerdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => !['name', 'phone'].includes(k));
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const phoneRaw = typeof b.phone === 'string' ? b.phone : '';
  const phoneNorm = phoneRaw.replace(/\D/g, '');

  if (!name || name.length > MAX_NAME) return { ok: false, status: 400, error: '이름과 연락처를 입력해 주세요.' };
  // 너무 짧은 번호로 쓸어보는 것을 막는다(원본에는 없던 최소한의 방어).
  if (phoneNorm.length < 9 || phoneNorm.length > 15) {
    return { ok: false, status: 400, error: '이름과 연락처를 입력해 주세요.' };
  }
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { ok: true, value: { name, phoneNorm, since } };
}
