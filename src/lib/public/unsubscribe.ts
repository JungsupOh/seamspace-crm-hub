// 공개 수신 거부 — 서버 함수 입구 (LEAD-S2)
//
// `src/lib/public/` 규칙: 공개 화면은 DB 를 직접 만지지 않고 **서버 함수**를 부른다
// (HARD-B2b). 공개 키를 Authorization 에 넣는 것은 플랫폼 게이트를 지나기 위한 것뿐이고,
// 무엇을 할 수 있는지는 서버 함수가 정한다.

import { callPublicFn } from './publicApi';

export interface UnsubscribeResult {
  ok?: boolean;
  message_en?: string;
  message_ko?: string;
}

/**
 * 수신 거부 처리.
 *
 * ⚠️ 이 함수는 **버튼을 눌렀을 때만** 불려야 한다. 화면이 열리는 것만으로 부르면
 *    메일 미리보기 로봇이 사람 대신 거부해 버린다(요구 S2-1).
 */
export function requestUnsubscribe(token: string): Promise<UnsubscribeResult> {
  return callPublicFn<UnsubscribeResult>('lead-unsubscribe', { token });
}
