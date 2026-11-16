// 공개 서버 함수들이 쓰는 **순수 헬퍼** — 환경변수를 읽지 않는다.
//
// public-fn.ts 와 나눠 둔 이유: 그쪽은 최상위에서 Deno.env 를 읽어 vitest 에서 import 할 수 없다.
// 열 제한·행 상한은 이 단위의 핵심 규칙이라 테스트로 고정해야 해서 따로 뺐다.

/** PostgREST 쿼리값 이스케이프 */
export function q(v: string): string {
  return encodeURIComponent(v);
}

/** 허용한 열만 남긴다. 서버가 더 많이 읽었더라도 밖으로는 이만큼만 나간다. */
export function pick<T extends Record<string, unknown>>(row: T, cols: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
}

export function pickAll(rows: unknown, cols: readonly string[], limit: number): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, limit).map(r => pick(r as Record<string, unknown>, cols));
}
