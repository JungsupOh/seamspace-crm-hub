// Supabase Edge Function: send-coupon
// AlimTok API로 이용권 발송 (TS_6205: 체험 / TS_6206: 구매)

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const ALIMTOK_URL   = "http://tebahsoft.iptime.org:8310/main/alimtok_coupon/";
const TPL_TRIAL     = "TS_6205";  // 체험권
const TPL_BUYER     = "TS_6206";  // 구매이용권

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const {
      first_name,
      phone,
      coupon_code,
      user_limit,
      duration,
      send_type = "buyer",  // "trial" | "buyer"
    } = await req.json() as {
      first_name: string;
      phone: string;
      coupon_code: string;
      user_limit: string;
      duration: string;
      send_type?: string;
    };

    const tpl_code = send_type === "trial" ? TPL_TRIAL : TPL_BUYER;

    const res = await fetch(ALIMTOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name, phone, coupon_code, user_limit, duration, tpl_code }),
    });

    if (!res.ok) throw new Error(`AlimTok API 오류: ${res.status}`);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
