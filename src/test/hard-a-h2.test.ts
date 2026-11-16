// HARD-A H-2 — 공개 캠페인 폼 서버 전환 + 관리자 쿠폰 경로 서버 경유
//
// 순수 테스트(가짜 fetch 주입). 운영 DB·실제 함수 호출·메일 발송 없음.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { submitCampaignLead } from '@/lib/campaignSubmit';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const ANON = 'anon-public-key-FAKE';

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const PARAMS = {
  campaignId: '11111111-1111-4111-8111-111111111111',
  submissionId: '22222222-2222-4222-8222-222222222222',
  locale: 'ko' as const,
  lead: {
    name: '홍길동',
    phone: '010-1234-5678',
    email: 'hong@example.com',
    schoolName: '서울초등학교',
    schoolKind: '초등학교',
    position: '담임교사',
    source: '대면연수',
    sourceEtc: null,
    marketingConsent: true,
    customFields: { usage_plan: '학급운영' },
  },
};

// ────────────────────────────────────────────────────────────
describe('H-2 (1) 공개 폼이 서버 함수 한 번으로 제출한다', () => {
  it('campaign-submit-lead 를 POST 로 한 번만 부른다', async () => {
    const f = fakeFetch({ ok: true, leadId: 'L1', coupon: null, trial: null });
    await submitCampaignLead(PARAMS, f.impl);

    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toContain('/functions/v1/campaign-submit-lead');
    expect(f.calls[0].init.method).toBe('POST');
  });

  it('요청 본문이 서버 validate() 가 받는 모양 그대로다', async () => {
    const f = fakeFetch({ ok: true, leadId: 'L1', coupon: null, trial: null });
    await submitCampaignLead(PARAMS, f.impl);

    const sent = JSON.parse(String(f.calls[0].init.body));
    expect(sent).toEqual(PARAMS);              // 더 보내지도, 빠뜨리지도 않는다
    expect(Object.keys(sent).sort()).toEqual(['campaignId', 'lead', 'locale', 'submissionId']);
  });

  it('공개 경로이므로 공개 키로 부른다 (로그인 세션이 없다)', async () => {
    const f = fakeFetch({ ok: true, coupon: null, trial: null });
    await submitCampaignLead(PARAMS, f.impl);

    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toMatch(/^Bearer /);
    expect(h['Content-Type']).toBe('application/json');
    expect(h.apikey).toBeDefined();
  });

  it('완료 화면이 쓰는 필드를 그대로 돌려준다', async () => {
    const body = {
      ok: true, leadId: 'L1', isExistingCustomer: false,
      coupon: { code: 'CPN-1', isNew: true, alimtokSent: true },
      trial: {
        code: 'TRIAL-1', outcome: 'resent', alimtokSent: false, emailSent: true,
        licenseSaved: false, channel: 'email',
        priorIssuedAt: '2026-05-01T00:00:00Z', priorCampaignName: '봄 캠페인',
      },
    };
    const f = fakeFetch(body);
    const r = await submitCampaignLead(PARAMS, f.impl);

    expect(r.coupon?.code).toBe('CPN-1');
    expect(r.trial?.code).toBe('TRIAL-1');
    expect(r.trial?.outcome).toBe('resent');
    expect(r.trial?.priorCampaignName).toBe('봄 캠페인');
    expect(r.trial?.priorIssuedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('멱등 응답(deduplicated)도 그대로 전달한다', async () => {
    const f = fakeFetch({ ok: true, deduplicated: true, leadId: 'L1', status: '체험발송', coupon: null, trial: null });
    const r = await submitCampaignLead(PARAMS, f.impl);
    expect(r.deduplicated).toBe(true);
    expect(r.status).toBe('체험발송');
  });

  it('서버 오류는 던져서 화면의 기존 오류 문구 경로를 타게 한다', async () => {
    const f = fakeFetch({ error: '종료된 캠페인입니다.' }, 400);
    await expect(submitCampaignLead(PARAMS, f.impl)).rejects.toThrow('종료된 캠페인입니다.');
  });

  it('200 이지만 error 가 실려 오면 실패로 본다', async () => {
    const f = fakeFetch({ error: '처리 중 오류가 발생했습니다.' }, 200);
    await expect(submitCampaignLead(PARAMS, f.impl)).rejects.toThrow('처리 중 오류');
  });

  it('쿠폰이 없는 캠페인(coupon: null)에서도 접수는 성공이다', async () => {
    const f = fakeFetch({ ok: true, leadId: 'L1', coupon: null, trial: { code: 'T', outcome: 'new', alimtokSent: true, emailSent: false, licenseSaved: true, channel: 'alimtalk' } });
    const r = await submitCampaignLead(PARAMS, f.impl);
    expect(r.coupon).toBeNull();
    expect(r.trial?.code).toBe('T');
  });

  it('쿠폰은 나갔지만 체험권이 없을 때(trial: null)도 성공이다', async () => {
    const f = fakeFetch({ ok: true, leadId: 'L1', coupon: { code: 'C', isNew: true, alimtokSent: true }, trial: null });
    const r = await submitCampaignLead(PARAMS, f.impl);
    expect(r.coupon?.code).toBe('C');
    expect(r.trial).toBeNull();
  });

  describe('해외·일본·국내 분기는 locale 로 서버에 넘어간다', () => {
    for (const locale of ['ko', 'ja', 'en'] as const) {
      it(`locale=${locale}`, async () => {
        const f = fakeFetch({ ok: true, coupon: null, trial: null });
        await submitCampaignLead({ ...PARAMS, locale }, f.impl);
        expect(JSON.parse(String(f.calls[0].init.body)).locale).toBe(locale);
      });
    }
  });
});

// ────────────────────────────────────────────────────────────
describe('H-2 (1) CampaignForm 이 직접 쓰기를 하지 않는다', () => {
  const FORM = read('src/pages/CampaignForm.tsx');
  const C = code(FORM);

  it('campaign_leads 에 직접 INSERT 하지 않는다', () => {
    expect(C).not.toContain('rest/v1/campaign_leads');
  });

  it('contacts 를 직접 읽거나 쓰지 않는다', () => {
    expect(C).not.toContain('rest/v1/contacts');
    expect(C).not.toContain('upsertLeadContact');
  });

  it('campaign_licenses·shop_coupons·mdiary_coupons 를 건드리지 않는다', () => {
    for (const t of ['campaign_licenses', 'shop_coupons', 'mdiary_coupons']) {
      expect(C, t).not.toContain(`rest/v1/${t}`);
    }
  });

  it('텔레그램·쿠폰·체험권 발급을 직접 하지 않는다', () => {
    for (const fn of ['notifyCampaignLead', 'issueCampaignCoupon(', 'issueTrialLicense(']) {
      expect(C, fn).not.toContain(fn);
    }
  });

  // HARD-B2b 에서 캠페인 조회마저 서버 함수(campaign-public-detail)로 옮겼다.
  // 이제 CampaignForm 에 rest/v1 직접 호출이 **하나도 없다** — 더 엄격해진 것이다.
  it('rest/v1 직접 접근이 0건이다 (캠페인 조회도 서버 함수 경유)', () => {
    const tables = [...C.matchAll(/rest\/v1\/([a-zA-Z_]+)/g)].map(m => m[1]);
    expect(tables).toEqual([]);
    expect(C).toContain('campaign-public-detail');
  });

  it('화면 검증 문구는 그대로다 (서버가 다시 검증하지만 UX 는 불변)', () => {
    expect(FORM).toContain('성함을 입력해주세요.');
    expect(FORM).toContain('연락처를 입력해주세요.');
    expect(FORM).toContain('이메일을 정확히 입력해주세요.');
    expect(FORM).toContain('제출 중 오류가 발생했습니다.');
  });

  it('멱등 키를 ref 에 담아 재시도에서 같은 값을 보낸다', () => {
    expect(C).toContain('submissionIdRef');
    expect(C).toMatch(/if \(!submissionIdRef\.current\) submissionIdRef\.current = crypto\.randomUUID\(\)/);
  });

  it('custom_fields 구성 규칙이 원본과 같다', () => {
    expect(C).toContain('formCfg.usage_plan.enabled && usagePlan.trim()');
    expect(C).toContain('customFields[`custom_q${i + 1}`] = v');
  });
});

// ────────────────────────────────────────────────────────────
describe('H-2 (2) 관리자 쿠폰 생성이 admin-issue-coupon 경유다', () => {
  const COUPONS = read('src/lib/coupons.ts');
  const C = code(COUPONS);

  it('create-coupon 을 직접 부르지 않는다', () => {
    expect(C).not.toContain('functions/v1/create-coupon');
  });

  it('admin-issue-coupon 을 로그인 토큰(authedFetch)으로 부른다', () => {
    expect(C).toContain('functions/v1/admin-issue-coupon');
    expect(C).toContain('authedFetch(');
    expect(C).toContain("from '@/lib/authedFetch'");
  });

  it('공개 키를 Authorization 에 넣지 않는다 (apikey 는 유지)', () => {
    const createBlock = C.slice(C.indexOf('export async function apiCreateCoupon'),
                                C.indexOf('export async function apiSendCoupon'));
    expect(createBlock).not.toMatch(/Authorization/);
    expect(createBlock).toContain('apikey: SUPABASE_KEY');
  });

  it('시그니처와 응답 처리는 그대로다 (호출부 무변경)', () => {
    expect(C).toContain('apiCreateCoupon(description: string, duration: string, user_limit: string): Promise<string>');
    expect(C).toContain('return data.coupon_code;');
    expect(C).toContain("throw new Error(data.error || '쿠폰 생성 실패')");
  });

  it('Licenses.tsx 의 사본이 사라지고 공용 모듈을 import 한다', () => {
    const LIC = read('src/pages/Licenses.tsx');
    expect(code(LIC)).not.toContain('async function apiCreateCoupon');
    expect(code(LIC)).toContain("import { apiCreateCoupon } from '@/lib/coupons'");
  });

  it('브라우저 코드에 create-coupon 직접 호출이 남아 있지 않다', () => {
    for (const f of ['src/lib/coupons.ts', 'src/pages/Licenses.tsx', 'src/pages/Campaigns.tsx',
                     'src/lib/campaign-trial-license.ts', 'src/lib/luckySeven.ts']) {
      expect(code(read(f)), f).not.toContain('functions/v1/create-coupon');
    }
  });
});

// ────────────────────────────────────────────────────────────
describe('H-2 (3) 공개 쓰기가 필요 없어진 범위', () => {
  it('issueTrialLicense·issueCampaignCoupon 은 호출자가 없다 (죽은 코드)', () => {
    // 두 함수의 유일한 호출자였던 CampaignForm 이 서버 위임으로 바뀌었다.
    // Campaigns.tsx 는 타입과 상수만 가져간다.
    const camp = code(read('src/pages/Campaigns.tsx'));
    expect(camp).not.toContain('issueTrialLicense(');
    expect(camp).not.toContain('issueCampaignCoupon(');

    const form = code(read('src/pages/CampaignForm.tsx'));
    expect(form).not.toContain('issueTrialLicense(');
    expect(form).not.toContain('issueCampaignCoupon(');
  });

  it('공개 라우트에서 campaign_leads 에 쓰는 코드가 없다', () => {
    // /c 는 서버 경유, 럭키세븐 공개 폼은 라우트에서 분리(H-1).
    const app = code(read('src/App.tsx'));
    expect(app).toContain('LuckySevenClosed');
    const form = code(read('src/pages/CampaignForm.tsx'));
    expect(form).not.toContain('campaign_leads');
  });
});
