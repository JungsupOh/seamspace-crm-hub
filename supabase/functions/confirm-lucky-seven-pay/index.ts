// Supabase Edge Function: confirm-lucky-seven-pay
// 럭키세븐 결제 완료 처리 — Toss 결제 승인만 처리하고, 라이선스 발급은 어드민에서 수동으로 일괄 처리.
// 1) Toss 결제 승인 (공통 헬퍼)
// 2) lucky_seven_payment_groups 업데이트 (status, paid_at, toss_payment_key, toss_order_id)

import { CORS, confirmTossPayment, buildReceiptFields, jsonResponse } from "../_shared/toss.ts";
import { notifyLuckySevenPaymentTG } from "../_shared/telegram.ts";
import { validateInput, matchVerdict } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOSS_SECRET  = Deno.env.get("TOSS_SECRET_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const iv = validateInput(await req.json());
    if (!iv.ok) return jsonResponse({ error: iv.error }, iv.status);
    const { paymentKey, orderId, amount, quoteNumber } = iv.value;

    // 1) 결제 묶음 조회 + 대조 (금액 + orderId↔견적번호 — logic.ts 참고)
    const pgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=*`,
      { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
    );
    const pgs = pgRes.ok ? await pgRes.json() : [];
    const mv = matchVerdict(pgs, iv.value);
    if (!mv.ok) return jsonResponse({ error: mv.error }, mv.status);
    if (mv.alreadyPaid) return jsonResponse({ ok: true, alreadyPaid: true });
    const pg = pgs[0];

    // 2) Toss 결제 승인
    const toss = await confirmTossPayment({ paymentKey, orderId, amount, secret: TOSS_SECRET });
    if (!toss.ok) {
      console.error("[confirm-lucky-seven-pay] Toss 승인 실패:", toss.data);
      return jsonResponse({ error: toss.data?.message ?? "Toss 결제 승인 실패" }, 400);
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

    // 4) 텔레그램 알림 (서버사이드)
    try {
      // 그룹 + 캠페인 + 진행률 조회 (best-effort)
      const grpRes = await fetch(
        `${SUPABASE_URL}/rest/v1/lucky_seven_groups?id=eq.${pg.group_id}&select=group_code,campaign_id`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
      );
      const grp = grpRes.ok ? (await grpRes.json())[0] : null;
      let campaignName: string | undefined;
      if (grp?.campaign_id) {
        const cRes = await fetch(
          `${SUPABASE_URL}/rest/v1/campaigns?id=eq.${grp.campaign_id}&select=name`,
          { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
        );
        campaignName = cRes.ok ? (await cRes.json())[0]?.name : undefined;
      }
      const allPgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?group_id=eq.${pg.group_id}&select=status`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
      );
      const allPgs = allPgRes.ok ? await allPgRes.json() as { status: string }[] : [];
      const paidCount = allPgs.filter(p => p.status === "결제완료").length;
      await notifyLuckySevenPaymentTG({
        groupCode: grp?.group_code,
        campaignName,
        payerName: pg.payer_name,
        payerOrgName: pg.buyer_org_name ?? null,
        amount,
        paidCount,
        totalCount: allPgs.length,
      });
    } catch (e) {
      console.warn("[confirm-lucky-seven-pay] 텔레그램 알림 실패:", e);
    }

    return jsonResponse({
      ok: true,
      groupId: pg.group_id,
      paymentGroupId: pg.id,
      payerEmail: pg.payer_email ?? null,
      payerName:  pg.payer_name ?? null,
      ...buildReceiptFields(toss.data, amount),
    });
  } catch (e) {
    console.error("[confirm-lucky-seven-pay] 오류:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
