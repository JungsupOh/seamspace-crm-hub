// Supabase Edge Function: shop-lookup-orders  (공개, HARD-B2b)
//
// 공개 /shop/lookup 이 shop_orders·shop_order_items 를 공개 키로 직접 읽던 것을 대신한다.
// 조건(이름 + 휴대폰 일치, 최근 30일)은 원본과 같다 — 화면이 요구하던 입력 그대로다.
//
// 달라지는 것: 주문 행을 통째로 내려보내지 않는다. 결제 내부값(payment_key·toss_method·
// approved_at)과 고객 개인정보 열을 빼고 화면이 쓰는 열만 돌려준다.

import { CORS, DB, SUPABASE_URL, json, pickAll, q } from '../_shared/public-fn.ts';
import { ITEM_COLS, MAX_ITEMS, MAX_ORDERS, ORDER_COLS, validateInput } from './logic.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const v = validateInput(await req.json().catch(() => null));
    if (!v.ok) return json({ error: v.error }, v.status);
    const { name, phoneNorm, since } = v.value;

    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_orders?customer_name=eq.${q(name)}&customer_phone=eq.${q(phoneNorm)}` +
        `&created_at=gte.${q(since)}&order=created_at.desc&limit=${MAX_ORDERS}` +
        `&select=${[...ORDER_COLS].join(',')}`,
      { headers: DB },
    );
    if (!orderRes.ok) return json({ orders: [] });
    const orders = await orderRes.json();
    if (!Array.isArray(orders) || orders.length === 0) return json({ orders: [] });

    const ids = orders.map((o: Record<string, unknown>) => `"${String(o.order_id)}"`).join(',');
    const itemsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_order_items?order_id=in.(${ids})` +
        `&limit=${MAX_ITEMS}&select=${[...ITEM_COLS].join(',')}`,
      { headers: DB },
    );
    const allItems = itemsRes.ok ? await itemsRes.json() : [];
    const items = pickAll(allItems, ITEM_COLS, MAX_ITEMS);

    return json({
      orders: pickAll(orders, ORDER_COLS, MAX_ORDERS).map(o => ({
        order: o,
        items: items.filter(i => i.order_id === o.order_id),
      })),
    });
  } catch (e) {
    console.error('[shop-lookup-orders]', e);
    return json({ error: '조회 중 오류가 발생했습니다.' }, 500);
  }
});
