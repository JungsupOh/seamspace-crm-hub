// 결제 링크 만들기 — HARD-B2c
//
// /order/pay/<견적번호> 는 번호만으로 열린다(원본 동작). 번호는 순번이라 세어 볼 수
// 있으므로, 메일로 보내는 링크에는 서버가 발급한 서명 토큰을 붙인다.
//
// ⚠️ 토큰이 없으면 **옛 모양 그대로** 돌려준다. 이미 나간 메일의 링크를 끊지 않기
//    위해서다(서버도 경고 모드에서는 토큰 없는 요청을 지금처럼 받아 준다).
//    강제 모드로 넘어가려면 **관리자가 보내는 링크까지** 토큰을 받아야 한다 —
//    지금은 공개 /order 경로만 토큰을 받는다. 절차는 audit/hard_b2c_result.md §E-3.

export function buildPayUrl(origin: string, quoteNumber: string, token?: string | null): string {
  const base = `${origin}/order/pay/${encodeURIComponent(quoteNumber)}`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}
