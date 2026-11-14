/**
 * campaign-submit-lead — 전환 전 기준값(스냅샷) + 드리프트 방지.
 *
 * **이 테스트가 존재하는 이유.** 메일 템플릿을 엣지 함수로 *복사*했다(021-4 §3-5).
 * 복사본은 언젠가 원본과 어긋난다 — 그러면 같은 신청인데 브라우저로 보냈을 때와
 * 서버로 보냈을 때 메일이 달라진다. 받는 사람은 알 수 없고 우리도 모른다.
 *
 * 그래서 두 겹으로 막는다:
 *   ① 스냅샷 — 서버가 만드는 제목/HTML/본문/참조를 글자 단위로 고정한다.
 *      전환 전후 "같은 결과"의 기준값이 이것이다.
 *   ② 드리프트 가드 — src/lib/email.ts 의 템플릿 리터럴 **원문**과
 *      엣지 함수 templates.ts 의 원문을 직접 대조한다. 한쪽만 고치면 깨진다.
 *
 * 운영 DB·네트워크를 쓰지 않는다. 전부 순수 함수다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildTrialEmail,
  buildTrialEmailJP,
  buildTrialEmailEN,
  trialCc,
} from '../../supabase/functions/campaign-submit-lead/templates';
import {
  validate,
  decideFromPrior,
  isExistingCustomer,
  exceedsSendCap,
  couponDescription,
  expiresAtFromDuration,
  normalizePhone,
  phoneCountryFor,
  MAX_SUBMISSIONS_PER_DAY,
} from '../../supabase/functions/campaign-submit-lead/logic';
import { normalizePhone as browserNormalizePhone } from '@/lib/phone';

const ROOT = resolve(__dirname, '../..');
const EMAIL_TS = readFileSync(resolve(ROOT, 'src/lib/email.ts'), 'utf8');
const TEMPLATES_TS = readFileSync(
  resolve(ROOT, 'supabase/functions/campaign-submit-lead/templates.ts'),
  'utf8',
);

// ── 대표 입력 5가지 ──────────────────────────────────
const CAMPAIGN_ID = '11111111-2222-4333-8444-555555555555';
const SUBMISSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const BASE = {
  to: 'teacher@example.com',
  contactName: '김선생',
  orgName: '한빛초등학교',
  campaignName: '2026 봄 캠페인',
  couponCode: 'TRIAL-ABCD-1234',
  durationDays: 90,
  userLimit: 40,
  serviceExpireAt: '2026-05-15',
};

describe('① 스냅샷 — 전환 전 기준값', () => {
  it('국내 KO (알림톡 채널이라 메일 템플릿은 JP 경로를 타지 않는다)', () => {
    // locale 'ko' 는 buildTrialEmail 에서 JP 템플릿으로 떨어진다
    // (campaign-trial-license.ts:126 — 'en' 만 영어, 그 외 전부 일본어 템플릿)
    const built = buildTrialEmail('ko', BASE);
    expect(built.subject).toMatchSnapshot('ko-subject');
    expect(built.html).toMatchSnapshot('ko-html');
    expect(built.text).toMatchSnapshot('ko-text');
    expect(built.cc).toMatchSnapshot('ko-cc');
    expect(built.reply_to).toBe('contact@tebahsoft.com');
  });

  it('해외 EN', () => {
    const built = buildTrialEmail('en', { ...BASE, campaignName: 'EDIX Tokyo 2026' });
    expect(built.subject).toMatchSnapshot('en-subject');
    expect(built.html).toMatchSnapshot('en-html');
    expect(built.text).toMatchSnapshot('en-text');
    expect(built.cc).toMatchSnapshot('en-cc');
  });

  it('해외 JP', () => {
    const built = buildTrialEmail('ja', { ...BASE, campaignName: 'EDIX 東京 2026' });
    expect(built.subject).toMatchSnapshot('jp-subject');
    expect(built.html).toMatchSnapshot('jp-html');
    expect(built.text).toMatchSnapshot('jp-text');
  });

  it('같은 연락처 재신청 (resend) — 인사말만 바뀌고 코드는 기존 것', () => {
    const en = buildTrialEmail('en', { ...BASE, resend: true });
    const jp = buildTrialEmail('ja', { ...BASE, resend: true });
    expect(en.subject).toMatchSnapshot('resend-en-subject');
    expect(en.html).toMatchSnapshot('resend-en-html');
    expect(jp.subject).toMatchSnapshot('resend-jp-subject');
    expect(jp.html).toMatchSnapshot('resend-jp-html');
  });

  it('이메일만 있는 해외 신청 (orgName 없음, 캠페인 참조 끔)', () => {
    const built = buildTrialEmail('en', {
      ...BASE,
      orgName: undefined,
      ccSales: false,
      cc: 'intl-partner@example.com',
    });
    expect(built.subject).toMatchSnapshot('email-only-subject');
    expect(built.cc).toMatchSnapshot('email-only-cc');
    expect(built.html).toMatchSnapshot('email-only-html');
  });

  it('쿠폰 설명 문자열', () => {
    expect(couponDescription('2026 봄 캠페인', '한빛초등학교', '김선생')).toMatchSnapshot('desc-full');
    expect(couponDescription('EDIX Tokyo', null, 'Taro')).toMatchSnapshot('desc-no-org');
  });
});

describe('② 드리프트 가드 — src/lib/email.ts 원문과 대조', () => {
  /** 들여쓰기만 다를 수 있으므로 줄 단위로 trim 해서 비교한다. */
  const norm = (s: string) =>
    s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');

  /** `start` 로 시작해 중괄호 균형이 맞는 지점까지 잘라낸다. */
  function block(src: string, start: string): string {
    const i = src.indexOf(start);
    if (i < 0) throw new Error(`블록을 찾지 못함: ${start}`);
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(i, j);
  }

  it('codeBox 가 양쪽에서 같다', () => {
    expect(norm(block(TEMPLATES_TS, 'export function codeBox')))
      .toBe(norm(block(EMAIL_TS, 'function codeBox').replace('function codeBox', 'export function codeBox')));
  });

  it('layoutJP 가 양쪽에서 같다', () => {
    expect(norm(block(TEMPLATES_TS, 'export function layoutJP')))
      .toBe(norm(block(EMAIL_TS, 'function layoutJP').replace('function layoutJP', 'export function layoutJP')));
  });

  it('layoutEN 가 양쪽에서 같다', () => {
    expect(norm(block(TEMPLATES_TS, 'export function layoutEN')))
      .toBe(norm(block(EMAIL_TS, 'function layoutEN').replace('function layoutEN', 'export function layoutEN')));
  });

  it('trialCc 가 양쪽에서 같다', () => {
    expect(norm(block(TEMPLATES_TS, 'export function trialCc')))
      .toBe(norm(block(EMAIL_TS, 'function trialCc').replace('function trialCc', 'export function trialCc')));
  });

  /** HTML 본문·plain text 는 리터럴 안의 내용만 비교한다. */
  function htmlBody(src: string, marker: string): string {
    const i = src.indexOf(marker);
    if (i < 0) throw new Error(`마커 없음: ${marker}`);
    const s = src.indexOf('`', i);
    const e = src.indexOf('`);', s);
    return norm(src.slice(s + 1, e));
  }

  it('JP 메일 HTML 본문이 양쪽에서 같다', () => {
    expect(htmlBody(TEMPLATES_TS, 'const html = layoutJP('))
      .toBe(htmlBody(EMAIL_TS, 'const html = layoutJP('));
  });

  it('EN 메일 HTML 본문이 양쪽에서 같다', () => {
    expect(htmlBody(TEMPLATES_TS, 'const html = layoutEN('))
      .toBe(htmlBody(EMAIL_TS, 'const html = layoutEN('));
  });

  it('plain text 조립이 양쪽에서 같다 (JP/EN)', () => {
    const texts = (src: string) =>
      [...src.matchAll(/const text = \[([\s\S]*?)\]\.join\('\\n'\);/g)].map(m => norm(m[1]));
    const fromTemplates = texts(TEMPLATES_TS);
    const fromEmail = texts(EMAIL_TS);
    // email.ts 에는 다른 메일의 text 도 있으므로, 복사본 2개가 그 안에 **그대로** 있어야 한다
    expect(fromTemplates.length).toBe(2);
    for (const t of fromTemplates) expect(fromEmail).toContain(t);
  });

  it('제목 조립이 양쪽에서 같다 (JP/EN)', () => {
    const jp = '`Seamspace ${params.campaignName} トライアルコード${params.resend ? \'再送\' : \'\'}のご案内${params.orgName ? ` - ${params.orgName}` : \'\'}`';
    const en = '`${params.resend ? \'Your trial code (again) — \' : \'\'}${brandPrefix}${params.campaignName} Trial Code${params.orgName ? ` - ${params.orgName}` : \'\'}`';
    for (const s of [jp, en]) {
      expect(EMAIL_TS).toContain(s);
      expect(TEMPLATES_TS).toContain(s);
    }
  });

  it('normalizePhone 이 브라우저 원본과 같은 결과를 낸다', () => {
    const cases: Array<[string, 'kr' | 'jp' | 'intl']> = [
      ['010-5157-8698', 'kr'], ['+82 10-1234-5678', 'kr'], ['', 'kr'],
      ['+81 90-1234-5678', 'jp'], ['09012345678', 'jp'], ['8190 12345678', 'jp'],
      ['+1 (415) 555-0100', 'intl'], ['abc', 'intl'],
    ];
    for (const [raw, c] of cases) {
      expect(normalizePhone(raw, c)).toBe(browserNormalizePhone(raw, c));
    }
  });
});

describe('③ 입력 검증', () => {
  const ok = {
    campaignId: CAMPAIGN_ID,
    submissionId: SUBMISSION_ID,
    locale: 'ko',
    lead: { name: '김선생', phone: '010-5157-8698', email: 'teacher@example.com' },
  };

  it('정상 입력을 통과시키고 전화번호를 정규화한다', () => {
    const r = validate(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.phoneNormalized).toBe('01051578698');
      expect(r.value.marketingConsent).toBe(false);
      expect(r.value.schoolName).toBeNull();
    }
  });

  it('캠페인 id 가 UUID 가 아니면 거부', () => {
    expect(validate({ ...ok, campaignId: 'not-a-uuid' }).ok).toBe(false);
  });

  it('멱등 키가 없거나 형식이 틀리면 거부', () => {
    expect(validate({ ...ok, submissionId: '' }).ok).toBe(false);
    expect(validate({ ...ok, submissionId: '123' }).ok).toBe(false);
  });

  it('이름·연락처·이메일이 비면 거부', () => {
    expect(validate({ ...ok, lead: { ...ok.lead, name: '  ' } }).ok).toBe(false);
    expect(validate({ ...ok, lead: { ...ok.lead, phone: '' } }).ok).toBe(false);
    expect(validate({ ...ok, lead: { ...ok.lead, email: 'not-an-email' } }).ok).toBe(false);
  });

  it('locale 은 ko/ja/en 만 받고 그 외는 ko 로 떨어진다', () => {
    for (const [input, want] of [['ja', 'ja'], ['en', 'en'], ['zz', 'ko'], [undefined, 'ko']] as const) {
      const r = validate({ ...ok, locale: input });
      expect(r.ok && r.value.locale).toBe(want);
    }
  });

  it('과도한 커스텀 항목을 잘라낸다', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 50; i++) many[`q${i}`] = 'x'.repeat(500);
    const r = validate({ ...ok, lead: { ...ok.lead, customFields: many } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value.customFields!).length).toBeLessThanOrEqual(20);
      expect(Object.values(r.value.customFields!)[0].length).toBeLessThanOrEqual(200);
    }
  });

  it('언어에 따라 전화번호 국가가 정해진다', () => {
    expect(phoneCountryFor('en')).toBe('intl');
    expect(phoneCountryFor('ja')).toBe('jp');
    expect(phoneCountryFor('ko')).toBe('kr');
  });
});

describe('④ 중복·기존 고객 판별', () => {
  const prior = (status: string) => ({
    coupon_code: 'OLD-CODE', status, created_at: '2026-01-01T00:00:00Z', campaign_name: '지난 캠페인',
  });

  it('기존 체험권이 없으면 신규 발급', () => {
    expect(decideFromPrior(null)).toEqual({ action: 'new' });
  });

  it("'대기'(미사용)면 기존 코드를 재발송한다", () => {
    expect(decideFromPrior(prior('대기'))).toEqual({
      action: 'resend', code: 'OLD-CODE', outcome: 'resent', leadStatus: '체험재발송',
    });
  });

  it("'사용중'이면 차단", () => {
    expect(decideFromPrior(prior('사용중'))).toEqual({
      action: 'block', code: 'OLD-CODE', outcome: 'blocked_used', leadStatus: '체험중복',
    });
  });

  it("'만료'면 차단", () => {
    expect(decideFromPrior(prior('만료')).outcome).toBe('blocked_expired');
  });

  it('구매고객이거나 체험 이력이 있으면 기존 고객', () => {
    expect(isExistingCustomer([{ contact_type: '구매고객' }], [])).toBe(true);
    expect(isExistingCustomer([], [{}])).toBe(true);
    expect(isExistingCustomer([{ contact_type: '리드' }], [])).toBe(false);
    expect(isExistingCustomer([], [])).toBe(false);
  });
});

describe('⑤ 발송 상한·만기일', () => {
  it(`하루 ${MAX_SUBMISSIONS_PER_DAY}건을 넘으면 막는다`, () => {
    expect(exceedsSendCap(0)).toBe(false);
    expect(exceedsSendCap(MAX_SUBMISSIONS_PER_DAY - 1)).toBe(false);
    expect(exceedsSendCap(MAX_SUBMISSIONS_PER_DAY)).toBe(true);
    expect(exceedsSendCap(99)).toBe(true);
  });

  it('만기일은 발급일 + N개월 (YYYY-MM-DD)', () => {
    expect(expiresAtFromDuration(3, new Date('2026-02-15T00:00:00Z'))).toBe('2026-05-15');
    expect(expiresAtFromDuration(1, new Date('2026-12-31T00:00:00Z'))).toBe('2027-01-31');
  });
});

describe('⑥ trialCc — 참조 규칙', () => {
  it('기본은 undefined (send-email 이 sales@ 를 붙인다)', () => {
    expect(trialCc(undefined, undefined)).toBeUndefined();
    expect(trialCc(true, undefined)).toBeUndefined();
  });
  it('추가 cc 가 있으면 sales@ 와 함께 배열로', () => {
    expect(trialCc(true, 'x@example.com')).toEqual(['sales@tebahsoft.com', 'x@example.com']);
  });
  it('sales@ 를 끄면 null (= 참조 없음)', () => {
    expect(trialCc(false, undefined)).toBeNull();
  });
  it('sales@ 를 꺼도 캠페인 추가 cc 는 살아 있다', () => {
    expect(trialCc(false, 'x@example.com')).toEqual(['x@example.com']);
  });
});

describe('⑦ JP/EN 선택 규칙', () => {
  it("'en' 만 영어, 나머지는 일본어 템플릿", () => {
    expect(buildTrialEmail('en', BASE).html).toBe(buildTrialEmailEN(BASE).html);
    expect(buildTrialEmail('ja', BASE).html).toBe(buildTrialEmailJP(BASE).html);
    expect(buildTrialEmail('ko', BASE).html).toBe(buildTrialEmailJP(BASE).html);
    expect(buildTrialEmail(undefined, BASE).html).toBe(buildTrialEmailJP(BASE).html);
  });

  it("제목에 'Seamspace' 가 이미 있으면 영어 접두어를 생략한다", () => {
    expect(buildTrialEmailEN({ ...BASE, campaignName: 'Seamspace Expo' }).subject)
      .not.toContain('Seamspace Seamspace');
  });
});
