// Supabase Edge Function: confirm-lucky-seven-pay
// 럭키세븐 결제 완료 처리 — Toss 결제 승인만 처리하고, 라이선스 발급은 어드민에서 수동으로 일괄 처리.
// 1) Toss 결제 승인
// 2) lucky_seven_payment_groups 업데이트 (status, paid_at, toss_payment_key, toss_order_id)

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOSS_SECRET  = Deno.env.get("TOSS_SECRET_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { paymentKey, orderId, amount, quoteNumber } = await req.json() as {
      paymentKey: string;
      orderId: string;
      amount: number;
      quoteNumber: string;
    };

    if (!paymentKey || !orderId || !amount || !quoteNumber) {
      return new Response(
        JSON.stringify({ error: "필수 파라미터 누락" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    // 1) 결제 묶음 조회 + 금액 검증
    const pgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=*`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    const pgs = pgRes.ok ? await pgRes.json() : [];
    if (!Array.isArray(pgs) || pgs.length === 0) {
      return new Response(
        JSON.stringify({ error: "견적서를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }
    const pg = pgs[0];
    if (pg.status === "결제완료") {
      return new Response(
        JSON.stringify({ ok: true, alreadyPaid: true }),
        { headers: { "Content-Type": "application/json", ...CORS } },
      );
    }
    if (Number(pg.amount) !== Number(amount)) {
      return new Response(
        JSON.stringify({ error: "결제 금액 불일치" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    // 2) Toss 결제 승인
    const tossAuth = btoa(`${TOSS_SECRET}:`);
    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: { Authorization: `Basic ${tossAuth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      console.error("[confirm-lucky-seven-pay] Toss 승인 실패:", tossData);
      return new Response(
        JSON.stringify({ error: tossData.message ?? "Toss 결제 승인 실패" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
      );
    }

    // 3) payment_groups 업데이트
    const upRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?id=eq.${pg.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          status: "결제완료",
          paid_at: new Date().toISOString(),
          toss_order_id: orderId,
          toss_payment_key: paymentKey,
        }),
      },
    );
    if (!upRes.ok) {
      console.warn("[confirm-lucky-seven-pay] payment_groups 업데이트 실패");
    }

    return new Response(
      JSON.stringify({
        ok: true,
        groupId: pg.group_id,
        paymentGroupId: pg.id,
        method: tossData.method ?? null,
        approvedAt: tossData.approvedAt ?? null,
        receiptUrl: tossData.receipt?.url ?? null,
        orderName: tossData.orderName ?? null,
        amount: tossData.totalAmount ?? amount,
        payerEmail: pg.payer_email ?? null,
        payerName: pg.payer_name ?? null,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (e) {
    console.error("[confirm-lucky-seven-pay] 오류:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
});
