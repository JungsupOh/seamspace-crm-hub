// HARD-B2a — 관리자 호출을 로그인 토큰으로, 공개 경로 호출을 분리
//
// 순수 테스트(소스 정적 검사 + 가짜 fetch). 운영 DB·실제 호출 없음.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// authedFetch 는 로그인 세션을 요구한다. 운영과 같은 경로를 그대로 검증하려고
// 가짜 세션을 주입한다(세션이 없을 때의 동작은 authed-fetch.test.ts 가 증명한다).
const FAKE_TOKEN = 'session-token-FAKE';
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: FAKE_TOKEN } } }),
      refreshSession: async () => ({ data: { session: { access_token: FAKE_TOKEN } }, error: null }),
    },
  },
}));

import { upsertLeadContactCore, publicUpsertLeadContact } from '@/lib/public/leadContact';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

/** 심볼(함수) 범위를 잘라 낸다 — 파일 전체가 아니라 그 함수만 검사하려고. */
function symbolBody(src: string, name: string): string {
  const lines = src.split('\n');
  const start = lines.findIndex(l =>
    new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function|const)\\s+${name}\\b`).test(l));
  if (start < 0) throw new Error(`심볼 없음: ${name}`);
  const next = lines.findIndex((l, i) =>
    i > start && /^(?:export\s+)?(?:async\s+)?(?:function|const)\s+\w+/.test(l));
  return lines.slice(start, next < 0 ? undefined : next).join('\n');
}

/** 그 범위 안에서 평범한 fetch 로 나가는 rest/v1 호출이 있나 */
function hasAnonRest(body: string): boolean {
  const lines = body.split('\n');
  return lines.some((l, i) => {
    if (l.trim().startsWith('//')) return false;
    const m = /\b(authedFetch|fetch)\s*\(/.exec(l);
    if (!m || m[1] === 'authedFetch') return false;
    const win = lines.slice(i, i + 12).join('\n');
    return /rest\/v1\//.test(win) && !/functions\/v1\//.test(win);
  });
}

// ────────────────────────────────────────────────────────────
describe('B2a (1) 관리자 전용 모듈이 로그인 토큰으로 나간다', () => {
  const ADMIN_SYMS: Array<[string, string[]]> = [
    ['src/lib/storage.ts', [
      'getDealFiles', 'saveDealFileRecord', 'deleteDealFileRecord', 'saveDealLicenses',
      'getDealLicenses', 'getAllLicenses', 'getAllCampaignLicenses', 'getConvertedPhonesSet',
      'getSleepingCampaignLicenses', 'getDealQuotes', 'saveDealQuote', 'updateDealQuote',
      'deleteDealQuote', 'selectDealQuote', 'fetchAllDealQuoteNumbers', 'deleteDealLicense',
      'hideMdiaryCoupon', 'updateLicenseStatus', 'updateLicenseDeal', 'attachCouponToDeal',
    ]],
    ['src/lib/luckySeven.ts', [
      'refreshGroupStatus', 'findDealIdForGroupCode', 'issueLuckySevenLicenses', 'deleteLuckySevenGroup',
    ]],
    ['src/lib/deal-users.ts', ['getDealUsers', 'saveDealUsers']],
    ['src/lib/apk.ts', ['findSubscriberByEmail']],
  ];

  for (const [file, syms] of ADMIN_SYMS) {
    describe(file, () => {
      const SRC = read(file);
      for (const s of syms) {
        it(`${s} — rest/v1 을 공개 키로 부르지 않는다`, () => {
          expect(hasAnonRest(symbolBody(SRC, s)), s).toBe(false);
        });
      }
    });
  }

  it('세 모듈이 authedFetch 를 import 한다', () => {
    for (const f of ['src/lib/storage.ts', 'src/lib/luckySeven.ts', 'src/lib/deal-users.ts']) {
      expect(code(read(f)), f).toMatch(/from '(?:@\/lib|\.)\/authedFetch'/);
    }
  });

  it('관리자 헤더 상수에는 Authorization 이 없다', () => {
    expect(code(read('src/lib/storage.ts'))).toMatch(/const ADMIN_DB_HEADERS = \{\s*apikey/);
    expect(code(read('src/lib/luckySeven.ts'))).toMatch(/const ADMIN_HEADERS = \{\s*apikey/);
  });

  it('apikey 에는 공개 키를 그대로 둔다 (정상)', () => {
    for (const f of ['src/lib/storage.ts', 'src/lib/luckySeven.ts', 'src/lib/deal-users.ts']) {
      expect(code(read(f)), f).toMatch(/apikey:\s*SUPABASE_KEY/);
    }
  });
});

// ────────────────────────────────────────────────────────────
describe('B2a (2) 공개 경로는 그대로 공개 키를 쓴다', () => {
  it('src/lib/public 의 함수는 authedFetch 로 나가지 않는다', () => {
    const lead = code(read('src/lib/public/leadContact.ts'));
    const apk = code(read('src/lib/public/apkPublic.ts'));
    // leadContact 는 코어를 공유하므로 authedFetch 를 import 하지만,
    // 공개 입구(publicUpsertLeadContact)는 transport 'public' 으로 고정돼야 한다
    expect(lead).toContain("upsertLeadContactCore(member, options, 'public')");
    expect(apk).not.toContain('authedFetch');
    expect(apk).toMatch(/Authorization:\s*`Bearer \$\{SUPABASE_KEY\}`/);
  });

  it('공개 화면이 공개 입구를 쓴다', () => {
    expect(code(read('src/pages/OrderTest.tsx')))
      .toContain("publicUpsertLeadContact as upsertLeadContact");
    expect(code(read('src/pages/ApkInfo.tsx')))
      .toContain("publicFindSubscriberByEmail as findSubscriberByEmail");
  });

  it('공개 화면이 관리자용(토큰) 함수를 가져가지 않는다', () => {
    const order = code(read('src/pages/OrderTest.tsx'));
    expect(order).not.toMatch(/import \{[^}]*\bupsertLeadContact\b[^}]*\} from '@\/lib\/luckySeven'/);
    const info = code(read('src/pages/ApkInfo.tsx'));
    expect(info).not.toMatch(/import \{[^}]*\bfindSubscriberByEmail\b[^}]*\} from '@\/lib\/apk'/);
  });

  it('공개 shop·apk 조회는 손대지 않았다 (공개 키 유지)', () => {
    const shop = read('src/lib/shop.ts');
    for (const s of ['getShopProducts', 'getShopProduct', 'validateShopCoupon', 'lookupMyOrders']) {
      expect(hasAnonRest(symbolBody(shop, s)), s).toBe(true);
    }
    expect(hasAnonRest(symbolBody(read('src/lib/apk.ts'), 'listDownloadsByEmail'))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
describe('B2a (3) 공유 코어 — 구현이 한 벌이고 전송만 갈린다', () => {
  function fakeFetch(rows: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(rows), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  const MEMBER = { name: '홍길동', phone: '010-1234-5678', email: 'a@b.com', orgName: '서울초' };
  const hdr = (init: RequestInit, k: string) => (init.headers as Record<string, string>)?.[k];

  it('공개 입구는 Authorization 에 공개 키를 쓴다', async () => {
    const f = fakeFetch([{ id: 'c1', name: '홍길동', email: 'a@b.com', org_name: '서울초' }]);
    vi.stubGlobal('fetch', f.impl);
    await publicUpsertLeadContact(MEMBER);
    vi.unstubAllGlobals();

    expect(f.calls.length).toBeGreaterThan(0);
    expect(hdr(f.calls[0].init, 'Authorization')).toMatch(/^Bearer /);
    expect(hdr(f.calls[0].init, 'apikey')).toBeDefined();
  });

  it('관리자 경로(authed)는 세션 토큰으로 나간다', async () => {
    const f = fakeFetch([{ id: 'c1', name: '홍길동', email: 'a@b.com', org_name: '서울초' }]);
    vi.stubGlobal('fetch', f.impl);
    // authedFetch 는 전역 fetch 를 쓰므로 같은 가짜가 잡힌다
    await upsertLeadContactCore(MEMBER, {}, 'authed');
    vi.unstubAllGlobals();

    expect(f.calls.length).toBeGreaterThan(0);
    expect(hdr(f.calls[0].init, 'Authorization')).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(hdr(f.calls[0].init, 'apikey')).toBeDefined();
  });

  it('요청 URL·본문은 전송 방식과 무관하게 같다 (동작 변화 0)', async () => {
    const row = [{ id: 'c1', name: '', email: '', org_name: '', notes: '' }];
    const a = fakeFetch(row); vi.stubGlobal('fetch', a.impl);
    await upsertLeadContactCore(MEMBER, { activityNote: '[2026-11-16] 테스트' }, 'public');
    vi.unstubAllGlobals();
    const b = fakeFetch(row); vi.stubGlobal('fetch', b.impl);
    await upsertLeadContactCore(MEMBER, { activityNote: '[2026-11-16] 테스트' }, 'authed');
    vi.unstubAllGlobals();

    expect(a.calls.map(c => c.url)).toEqual(b.calls.map(c => c.url));
    expect(a.calls.map(c => c.init.method)).toEqual(b.calls.map(c => c.init.method));
    expect(a.calls.map(c => c.init.body)).toEqual(b.calls.map(c => c.init.body));
  });

  it('구현이 한 벌이다 — luckySeven 의 래퍼가 코어를 부른다', () => {
    const ls = code(read('src/lib/luckySeven.ts'));
    expect(ls).toContain("upsertLeadContactCore(member, options, 'authed')");
    // 옛 본문이 남아 두 벌이 되지 않았는지
    expect(ls).not.toContain("rest/v1/contacts?phone_normalized=eq.");
  });
});

// ────────────────────────────────────────────────────────────
describe('B2a (4) 정책 영향 — 관리자 anon 이 0건인 테이블', () => {
  const ADMIN_CLOSED = ['deal_files', 'deal_licenses', 'deal_quotes', 'deal_users',
                        'lucky_seven_groups', 'lucky_seven_payment_groups'];

  it('관리자 모듈에 그 테이블을 공개 키로 부르는 살아 있는 호출이 없다', () => {
    const files = ['src/lib/storage.ts', 'src/lib/luckySeven.ts', 'src/lib/deal-users.ts'];
    const DEAD = new Set(['lookupWebQuote', 'updateWebQuoteStatus', 'fetchGroupByLeaderAuth',
                          'fetchLuckySevenCampaign', 'fetchPaymentGroupByQuoteNumber',
                          'submitLuckySevenGroup']);
    for (const f of files) {
      const src = read(f);
      const lines = src.split('\n');
      let sym = '<file>';
      lines.forEach((l, i) => {
        const m = /^(?:export\s+)?(?:async\s+)?(?:function|const)\s+(\w+)/.exec(l);
        if (m) sym = m[1];
        if (l.trim().startsWith('//')) return;
        const c = /\b(authedFetch|fetch)\s*\(/.exec(l);
        if (!c || c[1] === 'authedFetch') return;
        const win = lines.slice(i, i + 12).join('\n');
        const t = /rest\/v1\/([a-zA-Z_]+)/.exec(win);
        if (!t || /functions\/v1\//.test(win)) return;
        if (ADMIN_CLOSED.includes(t[1])) {
          expect(DEAD.has(sym), `${f}:${i + 1} ${sym}() 가 ${t[1]} 를 공개 키로 부른다`).toBe(true);
        }
      });
    }
  });
});
