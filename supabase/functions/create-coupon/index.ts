// Supabase Edge Function: create-coupon
// 1. mDiary 로그인 → ss_access_token 쿠키 획득
// 2. Bearer 토큰으로 쿠폰 생성

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const BASE_URL  = "https://diaryapi.seamspace.me";
const LOGIN_URL  = `${BASE_URL}/mDiary_app/login/`;
const COUPON_URL = `${BASE_URL}/mDiary_app/coupon_create/`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { description, duration = "1", user_limit = "40" } = await req.json() as {
      description: string;
      duration?: string;
      user_limit?: string;
    };

    const username = Deno.env.get("MDIARY_USERNAME");
    const password = Deno.env.get("MDIARY_PASSWORD");
    if (!username || !password) throw new Error("MDIARY_USERNAME 또는 MDIARY_PASSWORD 시크릿이 설정되지 않았습니다");

    // ── Step 1: 로그인하여 ss_access_token 쿠키 획득 ──
    const loginForm = new URLSearchParams({ username, password });
    const loginRes = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginForm.toString(),
      redirect: "manual",
    });

    // Set-Cookie 헤더에서 ss_access_token 추출
    const setCookieHeader = loginRes.headers.get("set-cookie") ?? "";
    const tokenMatch = setCookieHeader.match(/ss_access_token=([^;]+)/);
    if (!tokenMatch) {
      const body = await loginRes.text().catch(() => "(no body)");
      throw new Error(`로그인 실패 (${loginRes.status}): ss_access_token 없음. body: ${body}`);
    }
    const accessToken = tokenMatch[1];

    // ── Step 2: Bearer 토큰으로 쿠폰 생성 ──
    const couponForm = new URLSearchParams({
      username,
      password,
      descript:   description,
      duration,
      user_limit,
    });

    const couponRes = await fetch(COUPON_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: couponForm.toString(),
    });

    if (!couponRes.ok) {
      const errBody = await couponRes.text().catch(() => "");
      throw new Error(`mDiary 쿠폰 생성 오류: ${couponRes.status} - ${errBody}`);
    }

    const data = await couponRes.json() as { status: string; code: string; server_status?: unknown };
    if (data.status !== "success") throw new Error(`쿠폰 생성 실패: ${JSON.stringify(data)}`);

    return new Response(JSON.stringify({ coupon_code: data.code }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });

  } catch (e) {
    console.error("[create-coupon]", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
