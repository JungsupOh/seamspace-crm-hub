// 021-8b-3 — 관리자 화면용 authedFetch 모듈
// 순수 테스트: 가짜 fetch · 가짜 세션을 주입해서 토큰 부착/재시도/오류/헤더 보존을 증명한다.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createAuthedFetch,
  NO_SESSION_ERROR,
  SESSION_EXPIRED_ERROR,
  type AuthedFetchDeps,
} from '@/lib/authedFetch';

const ANON_KEY = 'anon-public-key-FAKE';

function makeRes(status = 200, body = '[]') {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

/** 호출 기록을 남기는 가짜 fetch. */
function recordingFetch(...responses: Response[]) {
  const calls: Array<{ input: unknown; init: RequestInit }> = [];
  let i = 0;
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init: init ?? {} });
    return responses[Math.min(i++, responses.length - 1)];
  });
  return { impl: impl as unknown as typeof fetch, calls, mock: impl };
}

function deps(over: Partial<AuthedFetchDeps> = {}): AuthedFetchDeps {
  const f = recordingFetch(makeRes());
  return {
    getSession: async () => ({ access_token: 'TOKEN-1' }),
    refreshSession: async () => ({ access_token: 'TOKEN-2' }),
    fetchImpl: f.impl,
    ...over,
  };
}

// ⚠️ 일부러 new Headers() 로 읽지 않는다 — Headers 는 Range 를 버리므로
//    "보존됐는지"를 검사하는 데 쓸 수 없다. 평범한 객체로 읽는다.
const hdr = (init: RequestInit, name: string): string | undefined => {
  const h = init.headers as Record<string, string> | undefined;
  if (!h) return undefined;
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : h[key];
};
const authHeader = (init: RequestInit) => hdr(init, 'Authorization');

describe('authedFetch — 토큰 부착', () => {
  it('세션 access_token 을 Authorization 에 붙인다', async () => {
    const f = recordingFetch(makeRes());
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    await af('https://db/rest/v1/contacts?select=*', { headers: { apikey: ANON_KEY } });

    expect(f.calls).toHaveLength(1);
    expect(authHeader(f.calls[0].init)).toBe('Bearer TOKEN-1');
  });

  it('apikey 헤더의 공개 키는 그대로 둔다 (정상 — 토큰 자리가 아니다)', async () => {
    const f = recordingFetch(makeRes());
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    await af('https://db/rest/v1/deals', { headers: { apikey: ANON_KEY } });

    expect(hdr(f.calls[0].init, 'apikey')).toBe(ANON_KEY);
  });

  it('호출부에 공개 키 Authorization 이 남아 있어도 토큰으로 덮어쓴다', async () => {
    const f = recordingFetch(makeRes());
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    await af('https://db/rest/v1/deals', {
      headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    });

    expect(authHeader(f.calls[0].init)).toBe('Bearer TOKEN-1');
    expect(authHeader(f.calls[0].init)).not.toContain(ANON_KEY);
  });
});

describe('authedFetch — 헤더·인자·응답 보존', () => {
  it('Prefer·Content-Type·Range·Range-Unit 을 그대로 보존한다', async () => {
    const f = recordingFetch(makeRes());
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    await af('https://db/rest/v1/contacts', {
      headers: {
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        'Range-Unit': 'items',
        Range: '0-999',
      },
    });

    const init = f.calls[0].init;
    expect(hdr(init, 'Content-Type')).toBe('application/json');
    expect(hdr(init, 'Prefer')).toBe('return=representation');
    expect(hdr(init, 'Range-Unit')).toBe('items');
    // Range 는 Fetch 의 Headers 가 버리는 헤더다. airtable.ts 의 1000행 페이지네이션이
    // 여기에 걸려 있으므로, new Headers() 로 갈아끼우면 이 단언이 깨진다.
    expect(hdr(init, 'Range')).toBe('0-999');
  });

  it('method·body·그 밖의 init 을 그대로 넘긴다', async () => {
    const f = recordingFetch(makeRes());
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));
    const body = JSON.stringify({ name: '테바소프트' });

    await af('https://db/rest/v1/partners', {
      method: 'POST',
      headers: { apikey: ANON_KEY, Prefer: 'return=representation' },
      body,
      signal: undefined,
    });

    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.body).toBe(body);
    expect(f.calls[0].input).toBe('https://db/rest/v1/partners');
  });

  it('헤더를 하나도 안 준 호출도 동작한다', async () => {
    const f = recordingFetch(makeRes());
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    await af('https://db/rest/v1/deals');

    expect(authHeader(f.calls[0].init)).toBe('Bearer TOKEN-1');
  });

  it('Response 객체를 가공 없이 그대로 돌려준다', async () => {
    const res = makeRes(201, '[{"id":"x"}]');
    const f = recordingFetch(res);
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    const out = await af('https://db/rest/v1/deals', { method: 'POST' });

    expect(out).toBe(res);
    expect(out.status).toBe(201);
    expect(await out.json()).toEqual([{ id: 'x' }]);
  });

  it('401 이 아닌 오류 응답(409 등)은 던지지 않고 그대로 돌려준다', async () => {
    const f = recordingFetch(makeRes(409, '{"message":"conflict"}'));
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    const out = await af('https://db/rest/v1/deals', { method: 'POST' });

    expect(out.status).toBe(409);
    expect(f.calls).toHaveLength(1); // 재시도 없음
  });
});

describe('authedFetch — 401 재시도', () => {
  it('401 이면 refreshSession 후 새 토큰으로 1회 재시도한다', async () => {
    const f = recordingFetch(makeRes(401, '{}'), makeRes(200, '[]'));
    const refreshSession = vi.fn(async () => ({ access_token: 'TOKEN-2' }));
    const af = createAuthedFetch(deps({ fetchImpl: f.impl, refreshSession }));

    const out = await af('https://db/rest/v1/contacts', { headers: { apikey: ANON_KEY } });

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
    expect(authHeader(f.calls[0].init)).toBe('Bearer TOKEN-1');
    expect(authHeader(f.calls[1].init)).toBe('Bearer TOKEN-2');
    expect(out.status).toBe(200);
  });

  it('재시도도 401 이면 **더 재시도하지 않고** 그 응답을 돌려준다', async () => {
    const f = recordingFetch(makeRes(401, '{}'), makeRes(401, '{}'), makeRes(200, '[]'));
    const refreshSession = vi.fn(async () => ({ access_token: 'TOKEN-2' }));
    const af = createAuthedFetch(deps({ fetchImpl: f.impl, refreshSession }));

    const out = await af('https://db/rest/v1/contacts');

    expect(f.calls).toHaveLength(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(out.status).toBe(401);
  });

  it('재시도도 원래 헤더(apikey·Prefer)를 보존한다', async () => {
    const f = recordingFetch(makeRes(401, '{}'), makeRes(200, '[]'));
    const af = createAuthedFetch(deps({ fetchImpl: f.impl }));

    await af('https://db/rest/v1/partners', {
      method: 'PATCH',
      headers: { apikey: ANON_KEY, Prefer: 'return=minimal' },
      body: '{}',
    });

    expect(hdr(f.calls[1].init, 'apikey')).toBe(ANON_KEY);
    expect(hdr(f.calls[1].init, 'Prefer')).toBe('return=minimal');
    expect(f.calls[1].init.method).toBe('PATCH');
    expect(f.calls[1].init.body).toBe('{}');
  });

  it('refreshSession 이 실패하면 만료 오류를 던진다', async () => {
    const f = recordingFetch(makeRes(401, '{}'));
    const af = createAuthedFetch(deps({ fetchImpl: f.impl, refreshSession: async () => null }));

    await expect(af('https://db/rest/v1/contacts')).rejects.toThrow(SESSION_EXPIRED_ERROR);
    expect(f.calls).toHaveLength(1);
  });
});

describe('authedFetch — 세션 없음 (폴백 금지)', () => {
  it('세션이 없으면 오류를 던진다', async () => {
    const af = createAuthedFetch(deps({ getSession: async () => null }));
    await expect(af('https://db/rest/v1/contacts')).rejects.toThrow(NO_SESSION_ERROR);
  });

  it('access_token 이 빈 문자열이어도 오류를 던진다', async () => {
    const af = createAuthedFetch(deps({ getSession: async () => ({ access_token: '' }) }));
    await expect(af('https://db/rest/v1/contacts')).rejects.toThrow(NO_SESSION_ERROR);
  });

  // ── 음성 테스트 ───────────────────────────────────────────────
  // "세션 없으면 공개 키로 보낸다" 폴백을 되살리면 fetch 가 불려서 이 테스트가 깨진다.
  it('세션이 없으면 요청 자체를 보내지 않는다 (공개 키 폴백이 되살아나면 실패)', async () => {
    const f = recordingFetch(makeRes());
    const af = createAuthedFetch(deps({ getSession: async () => null, fetchImpl: f.impl }));

    await expect(af('https://db/rest/v1/contacts', { headers: { apikey: ANON_KEY } })).rejects.toThrow();

    expect(f.mock).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
  });

  it('refreshSession 실패 시에도 재요청을 보내지 않는다 (폴백 금지)', async () => {
    const f = recordingFetch(makeRes(401, '{}'));
    const af = createAuthedFetch(deps({ fetchImpl: f.impl, refreshSession: async () => null }));

    await expect(af('https://db/rest/v1/contacts')).rejects.toThrow();

    expect(f.calls).toHaveLength(1); // 첫 호출뿐. 공개 키로 다시 던지지 않는다.
  });
});

describe('authedFetch — 소스 정적 검사', () => {
  const SRC = readFileSync(resolve(__dirname, '../lib/authedFetch.ts'), 'utf-8');
  // 주석(// 줄, /* */ 블록)을 걷어낸 '실제 코드'만 검사한다 —
  // 금지 패턴을 설명하는 주석 자체가 걸리면 안 되므로.
  const codeOnly = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');

  it('모듈 자체가 공개 키(ANON_KEY)를 참조하지 않는다', () => {
    expect(codeOnly).not.toContain('ANON_KEY');
    expect(codeOnly).not.toContain('SUPABASE_KEY');
  });

  it('new Headers() 로 헤더를 갈아끼우지 않는다 (Range 가 버려진다)', () => {
    expect(codeOnly).not.toContain('new Headers(');
  });

  it('Authorization 에 들어가는 값은 token 변수뿐이다', () => {
    const bearers = [...codeOnly.matchAll(/Bearer \$\{(\w+)\}/g)].map(m => m[1]);
    expect(bearers).toEqual(['token']);
  });
});
