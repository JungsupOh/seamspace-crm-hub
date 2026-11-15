// 관리자 화면 전용 — rest/v1 을 **로그인 세션 토큰**으로 부른다 (021-8b-3).
//
// 왜 필요한가
//   관리자 화면 상당수가 `Authorization: Bearer <공개 anon 키>` 로 rest/v1 을 불렀다.
//   공개 키는 번들에 들어 있어 누구나 꺼낼 수 있으므로, 그 호출은 사실상 비인증이다.
//   여기를 로그인 사용자의 access_token 으로 바꾸면 RLS 가 authenticated 역할로 평가된다.
//
// 설계 규칙
//   · fetch 와 **같은 인자·같은 Response** 를 쓴다. 호출부는 Authorization 만 빼면 된다.
//       fetch(url, { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, ... } })
//     → authedFetch(url, { headers: { apikey: KEY, ... } })
//   · apikey 헤더에는 지금처럼 공개 키를 넣는다. 그게 정상이다(프로젝트 식별용).
//     공개 키가 들어가면 안 되는 곳은 **Authorization 뿐**이다.
//   · 세션이 없으면 **오류를 던진다**. 공개 키로 조용히 폴백하지 않는다 —
//     폴백은 "로그인했는데 권한이 모자란" 상황을 "익명으로 다 보이는" 상황으로 되돌린다.
//   · 401 이면 refreshSession 후 **1회만** 재시도한다(ES256 서명키 회전 대응,
//     Users.tsx 의 adminAuthFetch 와 같은 규칙).

import { supabase } from '@/lib/supabase';

export const NO_SESSION_ERROR = '로그인이 필요합니다.';
export const SESSION_EXPIRED_ERROR = '세션이 만료되었습니다. 다시 로그인해 주세요.';

/** 토큰 하나만 알면 되는 최소 세션 모양. supabase Session 전체를 요구하지 않는다. */
export interface TokenSource {
  access_token: string;
}

export interface AuthedFetchDeps {
  /** 현재 세션(없으면 null). */
  getSession: () => Promise<TokenSource | null>;
  /** 강제 갱신한 세션(실패하면 null). */
  refreshSession: () => Promise<TokenSource | null>;
  fetchImpl: typeof fetch;
}

export type AuthedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 호출부가 준 헤더를 그대로 두고 Authorization 만 덮어쓴다.
 *
 *  ⚠️ 여기서 `new Headers(...)` 를 쓰면 안 된다. Fetch 의 Headers 는 `Range` 를
 *     금지 헤더로 보고 **조용히 버린다**(값도 오류도 없이 사라진다). airtable.ts 의
 *     fetchAll 은 Range 로 1000행씩 페이지를 넘기므로, 버려지면 목록이 1000행에서
 *     잘린다 — 오류 없이. 그래서 평범한 객체로 병합해 호출부 헤더를 손대지 않는다. */
function withBearer(headers: HeadersInit | undefined, token: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((v, k) => { out[k] = v; });
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
  } else if (headers) {
    Object.assign(out, headers);
  }
  // 호출부에 공개 키 Authorization 이 남아 있어도 여기서 토큰으로 덮인다(이중 안전장치).
  // 표기가 'authorization' 일 수도 있으니 대소문자 무시하고 먼저 걷어낸다.
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === 'authorization') delete out[k];
  }
  out.Authorization = `Bearer ${token}`;
  return out;
}

export function createAuthedFetch(deps: AuthedFetchDeps): AuthedFetch {
  return async function authedFetch(input, init = {}) {
    const session = await deps.getSession();
    if (!session?.access_token) throw new Error(NO_SESSION_ERROR);

    const callOnce = (token: string) =>
      deps.fetchImpl(input, { ...init, headers: withBearer(init.headers, token) });

    const res = await callOnce(session.access_token);
    if (res.status !== 401) return res;

    const refreshed = await deps.refreshSession();
    if (!refreshed?.access_token) throw new Error(SESSION_EXPIRED_ERROR);
    return callOnce(refreshed.access_token);
  };
}

/** 실제 supabase 세션을 쓰는 기본 인스턴스. 화면은 이걸 import 한다. */
export const authedFetch: AuthedFetch = createAuthedFetch({
  getSession: async () => (await supabase.auth.getSession()).data.session ?? null,
  refreshSession: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    return error ? null : (data.session ?? null);
  },
  fetchImpl: (input, init) => fetch(input, init),
});
