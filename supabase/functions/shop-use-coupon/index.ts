// Supabase Edge Function: shop-use-coupon  (공개, HARD-B2c)
//
// 공개 /shop/complete 가 RPC `use_shop_coupon` 을 **anon 권한으로** 부르던 것을 대신한다.
// 그 RPC 는 SECURITY DEFINER 가 아니라서 shop_coupons 의 공개 ALL 정책이 열려 있어야
// 동작했고, 그래서 B2b 가 이 테이블을 닫지 못했다(hard_b2b_result.md §D-2).
//
// 결제 승인(confirm-shop-payment)은 건드리지 않는다. 이 함수는 승인 **뒤에** 불린다.
//
// RPC 를 SECURITY DEFINER 로 바꾸지 않고 서버 함수로 옮긴 이유는 logic.ts 머리말과
// 결과 문서 §A 에 적었다 — 요약하면 DEFINER 로 바꾸면 "닫힌 것처럼 보이지만
// 코드만 알면 남의 쿠폰을 태울 수 있는" 상태가 **영구히** 남는다.

import { CORS, DB, SUPABASE_URL, json, q } from '../_shared/public-fn.ts';
import {
  buildUsagePatch, orderVerdict, usageVerdict, validateInput,
  type OrderRow,
} from './logic.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const v = validateInput(await req.json().catch(() => null));
    if (!v.ok) return json({ error: v.error }, v.status);
    const input = v.value;

    // ① 주문이 실제로 있고, 그 주문이 이 쿠폰을 썼는가 — 원본에는 없던 확인이다.
    const or = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_orders?order_id=eq.${q(input.orderId)}` +
        `&select=order_id,customer_phone,coupon_code&limit=1`,
      { headers: DB },
    );
    if (!or.ok) return json({ error: '처리 중 오류가 발생했습니다.' }, 502);
    const orows = await or.json();
    const order = Array.isArray(orows) && orows.length > 0 ? orows[0] as OrderRow : null;

    const ov = orderVerdict(order, input);
    if (!ov.allow) return json({ error: ov.error }, ov.status);

    // ② 쿠폰 상태 — 같은 주문이 이미 썼으면 성공으로 본다(멱등).
    const cr = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_coupons?code=eq.${q(input.code)}&select=is_used,used_order_id&limit=1`,
      { headers: DB },
    );
    if (!cr.ok) return json({ error: '처리 중 오류가 발생했습니다.' }, 502);
    const crows = await cr.json();
    const coupon = Array.isArray(crows) && crows.length > 0
      ? crows[0] as { is_used?: unknown; used_order_id?: unknown }
      : null;

    const uv = usageVerdict(coupon, input);
    if (uv.already) return json({ ok: true, already: true });
    if (!uv.apply) return json({ error: uv.error ?? '쿠폰을 사용할 수 없습니다.' }, 409);

    // ③ 사용 처리. `is_used=is.false` 를 조건에 넣어 동시 호출에서도 한 번만 바뀐다
    //    (원본 RPC 의 `AND is_used = false` 와 같은 뜻이다).
    const up = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_coupons?code=eq.${q(input.code)}&is_used=is.false`,
      {
        method: 'PATCH',
        headers: { ...DB, Prefer: 'return=representation' },
        body: JSON.stringify(buildUsagePatch(input, new Date().toISOString())),
      },
    );
    if (!up.ok) return json({ error: '처리 중 오류가 발생했습니다.' }, 502);
    const changed = await up.json();
    const n = Array.isArray(changed) ? changed.length : 0;

    // 0건이면 그 사이에 누가 먼저 썼다는 뜻이다. 화면 흐름을 막지 않도록 성공으로 돌려준다
    // (원본도 실패를 무시했다 — markCouponUsed 는 .catch(() => {}) 였다).
    return json({ ok: true, already: n === 0 });
  } catch (e) {
    console.error('[shop-use-coupon]', e);
    return json({ error: '처리 중 오류가 발생했습니다.' }, 500);
  }
});
