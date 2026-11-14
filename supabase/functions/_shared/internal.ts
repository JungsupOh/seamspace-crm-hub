// 내부 호출 전용 헤더 — 우리 엣지 함수끼리만 아는 비밀을 실어 보낸다.
//
// create-coupon 과 send-email 은 누구나 부를 수 있는 상태라(009-11), 호출자를
// 확인하는 보호를 넣는 중이다. 설계는 audit/021-1_guard_coupon_email_plan.md.
//
// **보내는 쪽을 먼저 배포하고, 받는 쪽은 나중에 검사한다.** 그래서 이 헬퍼는
// 시크릿이 없으면 빈 객체를 돌려준다 — 헤더가 붙지 않을 뿐 호출은 지금과 똑같이
// 되고, 예외도 나지 않는다. 받는 쪽이 아직 검사하지 않으므로 어느 쪽이든 동작한다.
//
// Authorization 은 건드리지 않는다. Edge→Edge 호출은 SERVICE_ROLE_KEY 를 Bearer 로
// 쓰면 401 UNAUTHORIZED_INVALID_JWT_FORMAT 이 나서(apk-subscribe 주석 참고) 기존
// 헤더를 그대로 둬야 하고, 그래서 인증을 별도 헤더로 분리했다.

const HEADER = "X-Internal-Secret";

/** 내부 호출 헤더. 시크릿 미설정이면 빈 객체(= 헤더 없음). */
export function internalHeaders(): Record<string, string> {
  const secret = Deno.env.get("INTERNAL_CALL_SECRET") ?? "";
  return secret ? { [HEADER]: secret } : {};
}
