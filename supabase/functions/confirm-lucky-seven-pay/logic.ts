// confirm-lucky-seven-pay 의 순수 로직 — 입력 검증 / 결제묶음 대조 판정.
//
// I/O 가 없다. 원래 핸들러는 "견적 조회 → 금액 검증 → Toss 승인" 이 한 덩어리라
// 아래 결함을 테스트로 증명할 수 없었다. 판정만 떼어 둔다 (021-5·6 과 같은 방식).
//
// ── 고친 결함 (021-7R §C-1) ───────────────────────────────────────────
// 원래는 `quoteNumber` 로 결제묶음을 찾고 **금액만** 검증한 뒤, 호출자가 준
// `orderId` 를 그대로 Toss 승인에 넘겼다. orderId 가 그 견적의 것인지 확인하지 않았다.
//
//   브라우저는 `orderId: paymentGroup.quote_number` 로 보낸다
//   (LuckySevenPay.tsx:86) — 즉 **orderId 는 곧 quote_number 다.**
//
// 그래서 금액이 같은 다른 결제묶음의 (paymentKey, orderId) 를 들고
// quoteNumber 만 바꿔 부르면, **엉뚱한 결제묶음이 '결제완료' 로 바뀌고**
// 그 묶음에 남의 toss_payment_key·toss_order_id 가 기록된다.
// 결제 한 건으로 두 묶음이 결제완료가 될 수 있었다.
//
// confirm-shop-payment 는 애초에 `order_id=eq.${orderId}` 로 행을 찾아 이 문제가 없다.
// 여기서는 스키마를 건드리지 않고(quote_number 로 조회하는 구조 유지) 대조 검사를 넣는다.

export type ConfirmInput = {
  paymentKey?: unknown;
  orderId?: unknown;
  amount?: unknown;
  quoteNumber?: unknown;
};

export type ParsedInput = {
  paymentKey: string;
  orderId: string;
  amount: number;
  quoteNumber: string;
};

export type InputVerdict =
  | { ok: true; value: ParsedInput }
  | { ok: false; status: 400; error: string };

/** 원본과 같은 규칙: 네 값이 모두 있어야 한다(0·빈문자는 누락으로 본다). */
export function validateInput(body: ConfirmInput): InputVerdict {
  const paymentKey = typeof body.paymentKey === 'string' ? body.paymentKey.trim() : '';
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const quoteNumber = typeof body.quoteNumber === 'string' ? body.quoteNumber.trim() : '';
  const amount = Number(body.amount);

  if (!paymentKey || !orderId || !amount || !quoteNumber) {
    return { ok: false, status: 400, error: '필수 파라미터 누락' };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: '필수 파라미터 누락' };
  }
  return { ok: true, value: { paymentKey, orderId, amount, quoteNumber } };
}

/** 조회된 결제묶음 중 판정에 쓰는 필드만. */
export type PaymentGroupRow = {
  id?: unknown;
  quote_number?: unknown;
  amount?: unknown;
  status?: unknown;
};

export type MatchVerdict =
  | { ok: true; alreadyPaid: true }
  | { ok: true; alreadyPaid: false }
  | { ok: false; status: 404 | 400; error: string };

/**
 * 결제묶음과 요청이 서로 맞는지 판정한다. **Toss 승인 전에** 불러야 한다.
 *
 * 순서가 중요하다 — 원본 순서(없음 → 이미결제 → 금액)를 지키고, 금액 검사 뒤에
 * orderId 대조를 더한다. 이미 결제된 건은 그대로 멱등 응답을 주던 동작을 보존한다.
 */
export function matchVerdict(rows: unknown, input: ParsedInput): MatchVerdict {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, status: 404, error: '견적서를 찾을 수 없습니다' };
  }
  const pg = rows[0] as PaymentGroupRow;

  if (pg.status === '결제완료') {
    return { ok: true, alreadyPaid: true };
  }
  if (Number(pg.amount) !== Number(input.amount)) {
    return { ok: false, status: 400, error: '결제 금액 불일치' };
  }
  // ★ 새로 넣는 검사 — orderId 가 이 견적의 것인지 확인한다.
  //   브라우저는 orderId = quote_number 로 보낸다(LuckySevenPay.tsx:86).
  const quoteOfRow = typeof pg.quote_number === 'string' ? pg.quote_number.trim() : '';
  if (!quoteOfRow || quoteOfRow !== input.orderId) {
    return { ok: false, status: 400, error: '주문번호가 견적서와 일치하지 않습니다' };
  }
  return { ok: true, alreadyPaid: false };
}
