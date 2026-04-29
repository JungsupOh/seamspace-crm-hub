// Toss 결제 공통 헬퍼
// confirm-payment, confirm-lucky-seven-pay에서 공유.
// - Toss 승인 API 호출
// - 영수증 응답 객체 빌드 (receiptUrl/orderName/method/approvedAt 등)

export const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

export interface TossConfirmInput {
  paymentKey: string;
  orderId: string;
  amount: number;
  secret: string;
}

export interface TossConfirmResult {
  ok: boolean;
  data: any;
  status: number;     // HTTP status (실패 시 그대로 반환에 사용)
}

export async function confirmTossPayment(input: TossConfirmInput): Promise<TossConfirmResult> {
  const auth = btoa(`${input.secret}:`);
  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentKey: input.paymentKey,
      orderId:    input.orderId,
      amount:     input.amount,
    }),
  });
  const data = await res.json();
  return { ok: res.ok, data, status: res.status };
}

// 영수증 이메일에서 사용할 공통 응답 필드 빌더
export function buildReceiptFields(tossData: any, fallbackAmount: number) {
  return {
    receiptUrl: tossData?.receipt?.url ?? null,
    orderName:  tossData?.orderName ?? null,
    method:     tossData?.method ?? null,
    approvedAt: tossData?.approvedAt ?? null,
    amount:     tossData?.totalAmount ?? fallbackAmount,
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
