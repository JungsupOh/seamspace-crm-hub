// Supabase Edge Function: issue-license
// 수동 결제(계좌이체 등) 후 이용권 생성+발송
// 1. mDiary 이용권 생성 (create-coupon, licenseQty개)
// 2. AlimTok 발송 (첫 번째 이용권)
// 3. order_payments 저장 (중복 방지)

const CORS = {
  "Access-Control-Allow-Origin":  "https://seamspace-crm-hub.vercel.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PLAN_CAPACITY: Record<string, number> = {
  "학급":     40,
  "학년":    200,
  "학교(소)": 500,
  "학교(중)": 1000,
  "학교(대)": 99999,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const {
      quoteNumber,
      customerName,
      customerPhone,
      customerEmail,
      orgName,
      plan,
      qty = 1,
      duration = 12,
      amount = 0,
      licenseQty,
    } = await req.json() as {
      quoteNumber?: string;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      orgName?: string;
      plan?: string;
      qty?: number;
      duration?: number;
      amount?: number;
      licenseQty?: number;
    };

    const count = Math.max(1, licenseQty ?? qty);
    const userLimit = String(PLAN_CAPACITY[plan ?? "학급"] ?? 40);
    const description = [orgName, plan, `${duration}개월`].filter(Boolean).join(" - ");

    // ── 중복 발급 방지: 이미 발급된 경우 기존 코드 반환 ──
    if (quoteNumber) {
      const existRes = await fetch(
        `${SUPABASE_URL}/rest/v1/order_payments?quote_number=eq.${encodeURIComponent(quoteNumber)}&limit=1`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      const existing: Array<{ coupon_code?: string }> = existRes.ok ? await existRes.json() : [];
      if (existing.length > 0 && existing[0].coupon_code) {
        console.log("[issue-license] 이미 발급됨:", existing[0].coupon_code);
        const codes = existing[0].coupon_code.split(",").map(s => s.trim());
        return new Response(
          JSON.stringify({ ok: true, coupon_codes: codes, already_issued: true }),
          { headers: { "Content-Type": "application/json", ...CORS } }
        );
      }
    }

    // ── 이용권 생성 ───────────────────────────────────
    const coupons: string[] = [];
    for (let i = 0; i < count; i++) {
      const couponRes = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ description, duration: String(duration), user_limit: userLimit }),
      });
      const couponData = await couponRes.json() as { coupon_code?: string; error?: string };
      if (!couponRes.ok || couponData.error) {
        throw new Error(`이용권 생성 실패: ${couponData.error ?? couponRes.status}`);
      }
      coupons.push(couponData.coupon_code!);
    }

    console.log("[issue-license] 이용권 생성:", coupons);

    // ── AlimTok 발송 (첫 번째 이용권) ─────────────────
    await fetch(`${SUPABASE_URL}/functions/v1/send-coupon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        first_name: customerName,
        phone: customerPhone.replace(/\D/g, ""),
        coupon_code: coupons[0],
        user_limit: userLimit,
        duration: String(duration),
        send_type: "buyer",
      }),
    }).catch(e => console.warn("[issue-license] AlimTok 발송 실패 (무시):", e));

    // ── order_payments 저장 ───────────────────────────
    const paymentKey = `manual_${quoteNumber ?? "noquote"}_${Date.now()}`;
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
        order_id:       paymentKey,
        amount,
        customer_name:  customerName,
        customer_phone: customerPhone.replace(/\D/g, ""),
        customer_email: customerEmail ?? null,
        org_name:       orgName ?? null,
        plan:           plan ?? null,
        qty,
        duration,
        quote_number:   quoteNumber ?? null,
        coupon_code:    coupons.join(", "),
        toss_method:    "bank_transfer",
        approved_at:    new Date().toISOString(),
      }),
    }).catch(e => console.warn("[issue-license] order_payments 저장 실패:", e));

    return new Response(
      JSON.stringify({ ok: true, coupon_codes: coupons }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );

  } catch (e) {
    console.error("[issue-license] 오류:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
