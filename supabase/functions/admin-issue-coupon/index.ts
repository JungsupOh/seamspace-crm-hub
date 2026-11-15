// Supabase Edge Function: admin-issue-coupon
//
// 국내 관리자 화면(/campaigns, /licenses)의 쿠폰 생성을 받는 **관문**.
// 설계는 audit/021-4_browser_callers_plan.md §2-1·§2-2.
//
// 지금은 브라우저가 anon 키로 create-coupon 을 직접 부른다. anon 키는 번들에
// 공개돼 있어 사실상 누구나 쿠폰을 찍을 수 있다(009-6·009-11). 그래서
// **로그인 JWT + 역할 검사**를 거친 뒤에만 create-coupon 으로 넘긴다.
//
// 구조는 partner-issue-license:33-77 을 그대로 복제했다. 다른 점은 하나:
//   partner-issue-license 는 partner_admin 도 통과시키지만,
//   **이 함수는 admin / sub_admin 만** 통과시킨다(국내 관리자 전용).
//
// **이 함수는 아직 아무도 호출하지 않는다.** 브라우저 연결은 021-8 에서 한다.
// 그래서 배포해도 운영 동작이 바뀌지 않는다.
//
// 응답은 브라우저 apiCreateCoupon(src/lib/coupons.ts:8-17)이 기대하는 모양 그대로다:
//   성공 { coupon_code } / 실패 { error }
// 덕분에 나중에 coupons.ts 한 곳만 바꾸면 Licenses.tsx 까지 함께 전환된다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authVerdict, roleVerdict, validate } from './logic.ts';
import { internalHeaders } from '../_shared/internal.ts';

const CORS = {
  'Access-Control-Allow-Origin':  'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // ── 1) JWT 검증 ── (partner-issue-license:33-42)
    const auth = authVerdict(req.headers.get('Authorization'));
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    // anon 키 클라이언트에 호출자 JWT 를 실어 검증한다.
    // service_role 로 검증하면 어떤 토큰이든 통과해 버린다 — 원본과 같은 방식을 지킨다.
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${auth.jwt}` } },
    });
    const { data: { user: caller }, error: authErr } = await anon.auth.getUser(auth.jwt);
    if (authErr || !caller) return json({ error: 'Invalid or expired token' }, 401);

    // ── 2) 역할 확인 ── (partner-issue-license:44-63)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile } = await admin
      .from('user_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    // 요청 본문의 신원 정보를 믿지 않는다 — 서버가 DB 에서 다시 읽는다.
    const role: string = profile?.role ?? caller.user_metadata?.role ?? '';
    const verdict = roleVerdict(role);
    if (!verdict.ok) return json({ error: verdict.error }, verdict.status);

    // ── 3) 입력 검증 ──
    const raw = await req.json().catch(() => null);
    const input = validate(raw);
    if (!input.ok) return json({ error: input.error }, input.status);

    // ── 4) 쿠폰 생성 (create-coupon, service-role) ──
    // partner-issue-license:117-125 와 같은 호출 방식.
    const couponRes = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        ...internalHeaders(),
      },
      body: JSON.stringify(input.value),
    });
    const couponJson = await couponRes.json().catch(() => ({}));
    if (!couponRes.ok || !couponJson.coupon_code) {
      return json({ error: `쿠폰 생성 실패: ${couponJson.error ?? couponRes.status}` }, 502);
    }

    // 누가 발급했는지 남긴다 — 화면에는 안 보이지만 추적에 필요하다.
    console.log(`[admin-issue-coupon] 발급 by=${caller.id} role=${role}`);

    // 브라우저 apiCreateCoupon 이 data.coupon_code 만 읽는다.
    return json({ coupon_code: couponJson.coupon_code });
  } catch (e) {
    console.error('[admin-issue-coupon]', e);
    return json({ error: String(e) }, 500);
  }
});
