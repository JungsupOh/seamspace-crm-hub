// 공개 화면이 부르는 서버 함수 입구 — HARD-B2b
//
// 여기 있는 함수는 **서버 함수(Edge Function)** 를 부른다. rest/v1 을 직접 부르지 않는다.
// 그래야 해당 테이블의 공개 정책을 닫을 수 있다(hard_b1_policy_close.md §E).
//
// 공개 키를 Authorization 에 넣는 것은 **정상**이다 — 로그인하지 않은 방문자가 쓰는 경로이고,
// 플랫폼 게이트(verify_jwt)를 통과하기 위한 값일 뿐이다. 무엇을 할 수 있는지는
// 서버 함수가 입력 검증·본인 확인·열 제한으로 좁힌다.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

/** 공개 서버 함수 호출. 실패해도 던지지 않고 null 을 돌려주는 호출부가 많아 그대로 둔다. */
export async function callPublicFn<T>(
  name: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(data && typeof data === 'object' && 'error' in data)) {
    throw new Error(`요청 실패 (${res.status})`);
  }
  return data as T;
}
