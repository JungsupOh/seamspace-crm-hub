// shop-catalog 의 순수 로직 — 입력 검증과 열 목록.

/** 화면(ShopProduct)이 쓰는 열만. created_at 은 내부 값이라 뺀다. */
export const PRODUCT_COLS = [
  'id', 'name', 'description', 'price', 'original_price',
  'unit_qty', 'unit_label', 'options', 'image_url', 'detail_image_url',
  'active', 'sort_order', 'shipping_fee',
] as const;

/** 상품 수 상한. 지금 카탈로그는 10개 미만이고, 늘어도 한 화면에 다 보여 준다. */
export const MAX_PRODUCTS = 100;
const MAX_ID = 100;

export type CatalogInput = { id?: unknown };
export type CatalogVerdict =
  | { ok: true; value: { id: string | null } }
  | { ok: false; status: 400; error: string };

export function validateCatalogInput(raw: unknown): CatalogVerdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const body = raw as Record<string, unknown>;
  const unknown = Object.keys(body).filter(k => k !== 'id');
  if (unknown.length > 0) {
    return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };
  }
  if (body.id === undefined || body.id === null) return { ok: true, value: { id: null } };
  if (typeof body.id !== 'string') return { ok: false, status: 400, error: '상품 id 가 올바르지 않습니다.' };
  const id = body.id.trim();
  if (!id || id.length > MAX_ID || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return { ok: false, status: 400, error: '상품 id 가 올바르지 않습니다.' };
  }
  return { ok: true, value: { id } };
}
