# src/lib/public — 로그인하지 않은 방문자가 쓰는 rest/v1 호출

여기 있는 함수는 **공개 키(anon)** 로 Supabase REST 를 부른다. 그게 맞다 —
`/order`·`/shop`·`/apk/info`·`/c` 를 쓰는 사람은 로그인하지 않았다.

**HARD-B2a 에서 이 폴더를 만든 이유**는, 같은 함수를 관리자 화면과 공개 화면이
함께 쓰던 것을 떼어내 **HARD-B2b 에서 통째로 서버 함수로 갈아끼우기 쉽게** 모으는 것이다.
관리자 쪽은 전부 로그인 토큰(`authedFetch`)으로 옮겼다.

## 여기 있는 것

| 함수 | 쓰는 화면 | 건드리는 테이블 | B2b 에서 옮길 곳 |
|---|---|---|---|
| `publicUpsertLeadContact` | `/order`(OrderTest.tsx) | `contacts` SELECT·UPDATE·INSERT | 주문 접수 서버 함수 |
| `publicFindSubscriberByEmail` | `/apk/info`(ApkInfo.tsx) | `apk_subscribers` SELECT | APK 조회 서버 함수 |

## 규칙

- 이 폴더의 함수는 **공개 키를 쓰는 것이 정상**이다. `authedFetch` 를 쓰지 않는다.
- 관리자 화면이 같은 일을 해야 하면 **여기서 가져다 쓰지 말고** 원래 모듈의
  관리자용 함수(로그인 토큰)를 쓴다. 공유하면 정책을 닫을 수 없게 된다.
- 구현은 한 벌만 둔다. 관리자용 래퍼가 같은 코어를 `transport: 'authed'` 로 부른다
  (`src/lib/email.ts` 의 `MailTransport` 와 같은 방식, HARD-A H-3).
