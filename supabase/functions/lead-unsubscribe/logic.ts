// lead-unsubscribe 의 순수 로직 — 입력 검증과 응답 모양.
//
// ⚠️ 이 함수는 **공개**다(로그인 없이 누구나 부른다). 그래서 두 가지를 지킨다.
//   ① 응답에 **리드 정보를 담지 않는다.** 이름·이메일·기관이 나가면 토큰을 주운 사람이
//      "이 토큰은 누구"인지 알게 된다.
//   ② **없는 토큰도 같은 응답**을 준다. 다르게 답하면 토큰을 넣어 보며
//      "어떤 토큰이 실재하는지" 가려낼 수 있다(열거 공격).
//
// 멱등: 이미 거부한 토큰을 다시 보내도 성공으로 답한다 — 사람이 링크를 두 번 눌렀을 때
// 오류를 보여 줄 이유가 없다.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TokenVerdict =
  | { ok: true; token: string }
  | { ok: false };

/**
 * 토큰 검증.
 *
 * 실패에 사유를 담지 않는다 — 호출부가 **없는 토큰과 같은 응답**을 주기 때문이다.
 * uuid 모양이 아니면 DB 를 부르지도 않는다(쓸모없는 조회를 막는다).
 */
export function validateToken(raw: unknown): TokenVerdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => k !== 'token');
  if (unknown.length > 0) return { ok: false };
  const t = typeof b.token === 'string' ? b.token.trim() : '';
  if (!UUID_RE.test(t)) return { ok: false };
  return { ok: true, token: t };
}

/**
 * 응답 — **성공과 실패가 같다.**
 *
 * 사람에게는 "처리됐다"로 보이고, 실제로 거부 처리가 됐는지는 알려 주지 않는다.
 * 그래야 토큰을 주운 사람이 유효성을 가려낼 수 없다.
 */
export const GENERIC_OK = {
  ok: true,
  message_en: 'You have been unsubscribed. You will no longer receive marketing emails from us.',
  message_ko: '수신 거부가 처리되었습니다. 앞으로 마케팅 메일을 보내지 않습니다.',
} as const;

/** 서버가 실제로 고장난 경우에만 다른 응답을 준다(그때는 다시 시도하라고 해야 한다). */
export const GENERIC_ERROR = {
  ok: false,
  message_en: 'Something went wrong. Please try again in a moment.',
  message_ko: '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
} as const;

/** 활동 기록 한 줄. 사람이 직접 거부한 것이므로 방향은 `in`(받은 것)이다. */
export function unsubscribeActivity(leadId: string, nowIso: string): Record<string, unknown> {
  return {
    lead_id: leadId,
    occurred_at: nowIso,
    channel: 'other',
    direction: 'in',
    summary: '[수신 거부] 본인이 링크로 거부',
    actor: '시스템',
  };
}

/** 리드에 쓸 값. 동의도 함께 끈다 — 거부했는데 동의가 true 로 남으면 안 된다. */
export function unsubscribePatch(nowIso: string): Record<string, unknown> {
  return { unsubscribed_at: nowIso, marketing_consent: false };
}
