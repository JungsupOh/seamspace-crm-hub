// Supabase Edge Function: send-shop-alimtok
// /shop 어드민(상품관리)이 호출 — UH_5417 배송 알림 등 shop 전용 알림톡
// 프론트가 직접 iptime을 부르면 CORS 막힘 → 이 함수로 우회

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const ALIMTOK_SEND_URL = "http://tebahsoft.iptime.org:8310/main/alimtok_send/";

// 지원 템플릿 — shop 전용
type ShopTplCode = "UH_5417" | "UH_5411";

interface RequestBody {
  tpl_code:         ShopTplCode;
  name:             string;
  phone:            string;
  product_name?:    string;
  delivery_address?: string;
  invoice_number?:  string;
  // 향후 확장 가능
  group_name?:      string;
  user_limit?:      string;
  duration?:        string;
  expiry_date?:     string;
  coupon_code?:     string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json() as RequestBody;
    if (!body.tpl_code || !body.name || !body.phone) {
      return new Response(
        JSON.stringify({ error: "tpl_code, name, phone 필수" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    // tpl_code별 필수 파라미터 검증 + body 정리 (빈 값 제거)
    const payload: Record<string, string> = {
      tpl_code: body.tpl_code,
      name:     body.name,
      phone:    body.phone,
    };
    const optional: (keyof RequestBody)[] = [
      'product_name', 'delivery_address', 'invoice_number',
      'group_name', 'user_limit', 'duration', 'expiry_date', 'coupon_code',
    ];
    for (const k of optional) {
      const v = body[k];
      if (v) payload[k] = String(v);
    }

    console.log("[send-shop-alimtok] 요청:", JSON.stringify(payload));

    const r = await fetch(ALIMTOK_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    console.log(`[send-shop-alimtok] 응답 ${r.status}:`, text);

    if (!r.ok) {
      return new Response(
        JSON.stringify({ error: `iptime 응답 ${r.status}`, body: text }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }

    return new Response(
      JSON.stringify({ ok: true, response: parsed ?? text }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (e) {
    console.error("[send-shop-alimtok] 예외:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
});
