// Supabase Edge Function: shop-validate-coupon  (공개, HARD-B2b)
//
// 공개 /shop 결제 화면이 shop_coupons 를 공개 키로 직접 읽던 것을 대신한다.
// 원본은 쿠폰 행을 통째로 받아 브라우저에서 계산했다 — 할인율·최소주문·적용상품·
// 사용이력이 다 내려갔고, 코드만 바꿔 가며 **쿠폰을 쓸어볼 수도** 있었다.
// 이제 서버가 읽고 계산해서 `{ valid, discount, couponName, error, applicableLabel }` 만 준다.

import { CORS, DB, SUPABASE_URL, json, q } from '../_shared/public-fn.ts';
import { evaluateCoupon, validateInput, type CouponRow } from './logic.ts';

/** 계산에 필요한 열만 읽는다. id·code·used_* ·lead_id·campaign_id 는 읽지도 않는다. */
const COUPON_COLS = 'batch_name,discount_type,discount_value,min_order,expires_at,is_used,applicable_products';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const v = validateInput(await req.json().catch(() => null));
    if (!v.ok) {
      // 입력 오류도 화면이 기대하는 모양으로 돌려준다(원본은 valid:false 를 썼다).
      return json({ valid: false, discount: 0, error: v.error });
    }
    const { code, subtotal, cartItems } = v.value;

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_coupons?code=eq.${q(code)}&active=eq.true&select=${COUPON_COLS}&limit=1`,
      { headers: DB },
    );
    if (!r.ok) return json({ valid: false, discount: 0, error: '쿠폰 조회 실패' });
    const rows = await r.json() as CouponRow[];
    const coupon = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    return json({ ...evaluateCoupon(coupon, subtotal, cartItems) });
  } catch (e) {
    console.error('[shop-validate-coupon]', e);
    return json({ valid: false, discount: 0, error: '쿠폰 조회 실패' });
  }
});
