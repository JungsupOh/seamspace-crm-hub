// Supabase Edge Function: shop-catalog  (공개, HARD-B2b)
//
// 공개 /shop 이 shop_products 를 공개 키로 직접 읽던 것을 대신한다.
// 상품 정보는 원래 모두에게 보여 주는 값이라 내용은 그대로다 — 바뀌는 것은
// "누가 DB 를 읽느냐"뿐이고, 그래야 shop_products 의 공개 정책을 닫을 수 있다.
//
// 돌려주는 열: 화면(src/lib/shop.ts ShopProduct)이 쓰는 13개.
//   내부 열 created_at 은 뺀다.

import { CORS, DB, SUPABASE_URL, json, pickAll, q } from '../_shared/public-fn.ts';
import { PRODUCT_COLS, MAX_PRODUCTS, validateCatalogInput } from './logic.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const v = validateCatalogInput(await req.json().catch(() => ({})));
    if (!v.ok) return json({ error: v.error }, v.status);

    const url = v.value.id
      ? `${SUPABASE_URL}/rest/v1/shop_products?id=eq.${q(v.value.id)}&limit=1`
      : `${SUPABASE_URL}/rest/v1/shop_products?active=eq.true&order=sort_order.asc&limit=${MAX_PRODUCTS}`;

    const r = await fetch(url, { headers: DB });
    if (!r.ok) return json({ error: '상품을 불러오지 못했습니다.' }, 502);
    const rows = await r.json();

    const products = pickAll(rows, PRODUCT_COLS, MAX_PRODUCTS);
    // 단건 조회는 비활성 상품도 그대로 돌려준다(원본 getShopProduct 가 active 를 보지 않는다).
    return json({ products });
  } catch (e) {
    console.error('[shop-catalog]', e);
    return json({ error: '상품을 불러오지 못했습니다.' }, 500);
  }
});
