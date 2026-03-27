// Supabase Edge Function: confirm-payment
// 1. Toss 결제 승인 API 호출
// 2. mDiary 이용권 생성 (create-coupon 재사용)
// 3. AlimTok 이용권 발송 (send-coupon 재사용)

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOSS_SECRET  = Deno.env.get("TOSS_SECRET_KEY")!;

const PLAN_CAPACITY: Record<string, number> = {
  "학급":    40,
  "학년":   200,
  "학교(소)": 500,
  "학교(중)": 1000,
  "학교(대)": 99999,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const {
      paymentKey,
      orderId,
      amount,
      customerName,
      customerPhone,
      customerEmail,
      orgName,
      plan,
      qty = 1,
      duration = 12,
      quoteNumber,
    } = await req.json() as {
      paymentKey: string;
      orderId: string;
      amount: number;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      orgName?: string;
      plan?: string;
      qty?: number;
      duration?: number;
      quoteNumber?: string;
    };

    // ── Step 1: Toss 결제 승인 ────────────────────────
    const tossAuth = btoa(`${TOSS_SECRET}:`);
    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${tossAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      console.error("[confirm-payment] Toss 승인 실패:", tossData);
      return new Response(
        JSON.stringify({ error: tossData.message ?? "Toss 결제 승인 실패" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    console.log("[confirm-payment] Toss 승인 성공:", tossData.paymentKey);

    // ── Step 2: mDiary 이용권 생성 ────────────────────
    const userLimit = String(PLAN_CAPACITY[plan ?? "학급"] ?? 40);
    const description = [orgName, plan, `${duration}개월`].filter(Boolean).join(" - ");

    const couponRes = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        description,
        duration: String(duration),
        user_limit: userLimit,
      }),
    });

    const couponData = await couponRes.json() as { coupon_code?: string; error?: string };
    if (!couponRes.ok || couponData.error) {
      console.error("[confirm-payment] 쿠폰 생성 실패:", couponData.error);
      // 결제는 됐으므로 에러 반환하되 paymentKey 포함
      return new Response(
        JSON.stringify({ error: "이용권 생성 실패. 고객센터에 문의해 주세요.", paymentKey }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const couponCode = couponData.coupon_code!;
    console.log("[confirm-payment] 쿠폰 생성:", couponCode);

    // ── Step 3: AlimTok 발송 ─────────────────────────
    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-coupon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        first_name: customerName,
        phone: customerPhone.replace(/\D/g, ""),
        coupon_code: couponCode,
        user_limit: userLimit,
        duration: String(duration),
        send_type: "buyer",
      }),
    });

    const sendData = await sendRes.json().catch(() => ({}));
    console.log("[confirm-payment] AlimTok 발송:", sendData);

    // ── Step 4: Supabase order_payments 저장 ─────────
    await fetch(`${SUPABASE_URL}/rest/v1/order_payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        payment_key:    paymentKey,
        order_id:       orderId,
        amount,
        customer_name:  customerName,
        customer_phone: customerPhone.replace(/\D/g, ""),
        customer_email: customerEmail ?? null,
        org_name:       orgName ?? null,
        plan:           plan ?? null,
        qty,
        duration,
        quote_number:   quoteNumber ?? null,
        coupon_code:    couponCode,
        toss_method:    tossData.method ?? null,
        approved_at:    tossData.approvedAt ?? null,
      }),
    }).catch(e => console.warn("[confirm-payment] order_payments 저장 실패 (무시):", e));

    return new Response(
      JSON.stringify({ ok: true, coupon_code: couponCode }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );

  } catch (e) {
    console.error("[confirm-payment] 오류:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
