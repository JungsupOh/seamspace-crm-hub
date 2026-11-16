// Supabase Edge Function: send-email-authed
//
// 브라우저가 부르는 **메일 발송 관문**. 설계는 audit/021-4_browser_callers_plan.md §2-3·§4.
//
// 지금은 브라우저가 anon 키로 send-email 을 직접 부른다. anon 키는 번들에 공개돼
// 있어 사실상 누구나 우리 도메인으로 메일을 보낼 수 있다(009-11). 그래서
// **로그인 JWT + 역할 검사 + 본문 검증**을 거친 뒤에만 send-email 로 넘긴다.
//
// 구조는 admin-issue-coupon:21-80 을 그대로 복제했다. 다른 점:
//   · 허용 역할에 partner_admin 을 포함한다(파트너 포털이 이용권 메일을 보낸다).
//     근거와 member·viewer 제외 이유는 logic.ts 의 ALLOWED_ROLES 주석에 적었다.
//   · 본문을 검증하고 **값은 하나도 바꾸지 않은 채** send-email 로 넘긴다.
//
// cc 정책은 건드리지 않는다. send-email:54-58 은 `cc !== null && cc !== ''` 일 때만
// RESEND_DEFAULT_CC 로 폴백하므로, cc 키가 **없는 것**과 **null·'' 인 것**이 서로 다른
// 뜻이다. buildForwardBody 가 그 구분을 그대로 옮긴다 — CRM-002 의 cc_sales 토글이
// 이 구분에 걸려 있다.
//
// 응답은 send-email 의 것을 그대로 돌려준다({ id } / { error }). 브라우저
// sendEmail() 은 res.ok 와 error 만 보므로 호출부를 고치지 않아도 된다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authVerdict, roleVerdict, validateBody, buildForwardBody } from './logic.ts';
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
    // ── 1) JWT 검증 ──
    const auth = authVerdict(req.headers.get('Authorization'));
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    // anon 키 클라이언트에 호출자 JWT 를 실어 검증한다.
    // service_role 로 검증하면 어떤 토큰이든 통과해 버린다.
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${auth.jwt}` } },
    });
    const { data: { user: caller }, error: authErr } = await anon.auth.getUser(auth.jwt);
    if (authErr || !caller) return json({ error: 'Invalid or expired token' }, 401);

    // ── 2) 역할 확인 (user_profiles 만 믿는다) ──
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileErr } = await admin
      .from('user_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (profileErr) {
      // 조회 실패·행 없음 — fail-closed. 아래 roleVerdict 가 403 으로 떨어뜨린다.
      console.warn(`[send-email-authed] user_profiles 조회 실패 user=${caller.id}`);
    }

    const rv = roleVerdict(profile?.role);
    if (!rv.ok) return json({ error: rv.error }, rv.status);

    // ── 3) 본문 검증 ──
    const bv = validateBody(await req.json().catch(() => null));
    if (!bv.ok) return json({ error: bv.error }, bv.status);

    // ── 4) send-email 로 넘김 (값 변경 없음) ──
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        // Edge→Edge 는 SERVICE_ROLE_KEY 를 Bearer 로 쓰면 401 이 난다. ANON_KEY 를 쓴다
        // (apk-subscribe:14 · apk-broadcast:13 주석과 같은 이유).
        Authorization: `Bearer ${ANON_KEY}`,
        ...internalHeaders(),
      },
      body: JSON.stringify(buildForwardBody(bv.value)),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as Record<string, unknown>)?.error) {
      const err = (data as Record<string, unknown>)?.error ?? `이메일 발송 실패 (${res.status})`;
      return json({ error: String(err) }, res.status === 200 ? 502 : res.status);
    }
    return json(data as Record<string, unknown>);
  } catch (e) {
    console.error('[send-email-authed]', e);
    return json({ error: String(e) }, 500);
  }
});
