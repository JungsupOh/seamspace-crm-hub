// Supabase Edge Function: confirm-payment
// 1. Toss 결제 승인 (공통 헬퍼)
// 2. mDiary 이용권 생성 (create-coupon 재사용)
// 3. AlimTok 이용권 발송 (send-coupon 재사용)
// 4. order_payments 저장

import { CORS, confirmTossPayment, buildReceiptFields, jsonResponse } from "../_shared/toss.ts";

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
    const toss = await confirmTossPayment({ paymentKey, orderId, amount, secret: TOSS_SECRET });
    if (!toss.ok) {
      console.error("[confirm-payment] Toss 승인 실패:", toss.data);
      return jsonResponse({ error: toss.data?.message ?? "Toss 결제 승인 실패" }, 400);
    }
    const tossData = toss.data;
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
      return jsonResponse({ error: "이용권 생성 실패. 고객센터에 문의해 주세요.", paymentKey }, 500);
    }

    const couponCode = couponData.coupon_code!;
    console.log("[confirm-payment] 쿠폰 생성:", couponCode);

    // ── Step 3: AlimTok 발송 — iptime 직접 호출 (Edge → Edge inner call 이슈 회피) ─
    try {
      const sendBody = {
        first_name: customerName,
        phone: customerPhone.replace(/\D/g, ""),
        coupon_code: couponCode,
        user_limit: userLimit,
        duration: String(duration),
        tpl_code: "TS_6206",  // 구매이용권 (이전 send_type='buyer'에 매핑)
      };
      console.log("[confirm-payment] 알림톡 요청:", JSON.stringify(sendBody));
      const sendRes = await fetch("http://tebahsoft.iptime.org:8310/main/alimtok_coupon/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      const sendText = await sendRes.text();
      console.log(`[confirm-payment] 알림톡 응답 ${sendRes.status}:`, sendText);
    } catch (e) {
      console.error("[confirm-payment] 알림톡 예외:", e);
    }

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

    return jsonResponse({
      ok: true,
      coupon_code:   couponCode,
      customerEmail: customerEmail ?? null,
      customerName:  customerName ?? null,
      ...buildReceiptFields(tossData, amount),
    });

  } catch (e) {
    console.error("[confirm-payment] 오류:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
