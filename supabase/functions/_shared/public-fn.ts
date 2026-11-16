// 공개(로그인 불필요) 서버 함수들이 함께 쓰는 뼈대 — HARD-B2b
//
// 왜 필요한가
//   /order·/shop·/apk 는 로그인하지 않은 방문자가 쓴다. 지금까지는 브라우저가
//   공개 키로 rest/v1 을 직접 불렀고, 그래서 그 테이블의 공개 정책을 닫을 수 없었다.
//   이제 서버 함수가 service_role 로 대신 읽고, **필요한 열만** 돌려준다.
//
// 규칙
//   · service_role 은 RLS 를 우회한다. 그러므로 "무엇을 돌려줄지"를 코드가 책임진다.
//     열 목록(pick)과 행 수 상한(limit)을 반드시 쓴다.
//   · 실패 메시지는 일반적인 문구로. "그 번호는 있는데 이메일이 틀렸다" 같은 힌트를 주지 않는다.
//   · 목록 전체를 돌려주는 형태(열거 가능)는 만들지 않는다.
//
// 순수 헬퍼(pick·pickAll·q)는 _shared/public-cols.ts 에 있다 — 테스트가 import 할 수 있게.

export { pick, pickAll, q } from './public-cols.ts';

export const CORS = {
  'Access-Control-Allow-Origin':  'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

export function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** service_role 로 rest/v1 을 부른다. RLS 를 우회하므로 호출부가 범위를 좁혀야 한다. */
export const DB: Record<string, string> = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};
