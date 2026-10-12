// Supabase Edge Function: confirm-toss
//
// 토스 결제 승인만 하는 얇은 함수. {paymentKey, orderId, amount} -> 승인 결과.
// 아무것도 저장하지 않는다.
//
// 왜 따로 두는가: TOSS_SECRET_KEY 는 Supabase 시크릿에만 있고 되읽을 수 없다.
// 일기 제본 주문은 Vercel Python 함수(api/print/order.py)가 처리하는데, 거기에 쓰려고
// 결제 시크릿을 Vercel 에 한 벌 더 복사하면 유출 지점이 둘로 늘어난다. 호출로 푼다.
// 기존 confirm-* 함수들은 각자 도메인 작업이 붙어 있어 재사용할 수 없었다.

import { CORS, confirmTossPayment, jsonResponse } from "../_shared/toss.ts";

const TOSS_SECRET = Deno.env.get("TOSS_SECRET_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { paymentKey, orderId, amount } = await req.json() as {
      paymentKey: string;
      orderId: string;
      amount: number;
    };

    if (!paymentKey || !orderId || !amount) {
      return jsonResponse({ error: "paymentKey, orderId, amount 가 모두 필요합니다." }, 400);
    }
    if (!TOSS_SECRET) {
      return jsonResponse({ error: "TOSS_SECRET_KEY 시크릿이 없습니다." }, 503);
    }

    const toss = await confirmTossPayment({ paymentKey, orderId, amount, secret: TOSS_SECRET });
    if (!toss.ok) {
      console.error("[confirm-toss] 승인 실패:", toss.data);
      return jsonResponse(
        { error: toss.data?.message ?? "결제 승인에 실패했습니다.", code: toss.data?.code },
        400,
      );
    }

    const d = toss.data;
    return jsonResponse({
      ok: true,
      orderId: d.orderId,
      method: d.method ?? null,
      approvedAt: d.approvedAt ?? null,
      totalAmount: d.totalAmount ?? amount,
      receiptUrl: d.receipt?.url ?? null,
      orderName: d.orderName ?? null,
    });
  } catch (e) {
    console.error("[confirm-toss] 오류:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
