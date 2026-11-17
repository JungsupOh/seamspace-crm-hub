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
  activityNoteFor,
  buildContactPatch,
  buildContactInsert,
  buildCampaignLeadTelegram,
  telegramSourceLabel,
  randomCode,
  couponExpiresAt,
  discountLabel,
  buildCouponAlimtokBody,
  buildCouponInsert,
  precheckCoupon,
  couponInsertVerdict,
  COUPON_MAX_ATTEMPTS,
  MAX_SUBMISSIONS_PER_DAY,
  type CouponSettings,
} from '../../supabase/functions/campaign-submit-lead/logic';
import { normalizePhone as browserNormalizePhone } from '@/lib/phone';

const ROOT = resolve(__dirname, '../..');
const EMAIL_TS = readFileSync(resolve(ROOT, 'src/lib/email.ts'), 'utf8');
const TEMPLATES_TS = readFileSync(
  resolve(ROOT, 'supabase/functions/campaign-submit-lead/templates.ts'),
  'utf8',
);
const LOGIC_TS = readFileSync(
  resolve(ROOT, 'supabase/functions/campaign-submit-lead/logic.ts'),
  'utf8',
);
const TELEGRAM_TS = readFileSync(resolve(ROOT, 'src/lib/telegram.ts'), 'utf8');
const LUCKYSEVEN_TS = readFileSync(resolve(ROOT, 'src/lib/luckySeven.ts'), 'utf8');
// HARD-B2a 에서 contacts 코어가 src/lib/public/leadContact.ts 로 옮겨졌다
// (공개 /order 와 관리자 화면이 같은 함수를 쓰던 것을 떼어내면서).
// 드리프트 가드의 대상도 그 파일로 옮긴다 — 비교하는 대상만 바뀌고 목적은 같다.
const LEADCONTACT_TS = readFileSync(resolve(ROOT, 'src/lib/public/leadContact.ts'), 'utf8');
const COUPONS_TS = readFileSync(resolve(ROOT, 'src/lib/campaign-coupons.ts'), 'utf8');
const INDEX_TS = readFileSync(
  resolve(ROOT, 'supabase/functions/campaign-submit-lead/index.ts'), 'utf8',
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
    const d = decideFromPrior(prior('만료'));
    // `action` 으로 좁힌 뒤에 읽는다 — `{ action: 'new' }` 에는 outcome 이 없다
    expect(d.action).toBe('block');
    if (d.action === 'block') expect(d.outcome).toBe('blocked_expired');
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

// ════════════════════════════════════════════════════
// 021-5b — contacts 등록(A) · 텔레그램 알림(B)
// ════════════════════════════════════════════════════

describe('⑧ contacts 등록 — luckySeven.ts upsertLeadContact 와 같은 동작', () => {
  const member = {
    name: '김선생', phone: '010-5157-8698',
    email: 'teacher@example.com', orgName: '한빛초등학교',
  };

  it('활동이력 문자열이 CampaignForm.tsx:274-275 와 같다', () => {
    expect(activityNoteFor('2026-11-15', '2026 봄 캠페인'))
      .toBe('[2026-11-15] 캠페인 신청 — 2026 봄 캠페인');
  });

  describe('기존 contact 매칭 시 (PATCH)', () => {
    it('빈 칸만 채운다 — 이미 있는 값은 덮지 않는다', () => {
      const { patch } = buildContactPatch(
        { id: 'c1', name: '기존이름', email: 'old@example.com', org_name: '기존학교', notes: '' },
        member,
      );
      expect(patch.name).toBeUndefined();
      expect(patch.email).toBeUndefined();
      expect(patch.org_name).toBeUndefined();
    });

    it('비어 있던 칸은 채운다', () => {
      const { patch } = buildContactPatch(
        { id: 'c1', name: '', email: null, org_name: undefined, notes: '' },
        member,
      );
      expect(patch).toMatchObject({
        name: '김선생', email: 'teacher@example.com', org_name: '한빛초등학교',
      });
    });

    it('활동이력을 맨 앞에 붙인다 (prepend)', () => {
      const note = activityNoteFor('2026-11-15', '2026 봄 캠페인');
      const { patch, activityAppended } = buildContactPatch(
        { id: 'c1', name: 'n', email: 'e', org_name: 'o', notes: '이전 메모' },
        member, note,
      );
      expect(activityAppended).toBe(true);
      expect(patch.notes).toBe(`${note}\n이전 메모`);
    });

    it('기존 메모가 비어 있으면 활동이력만 남는다', () => {
      const note = activityNoteFor('2026-11-15', 'X');
      const { patch } = buildContactPatch(
        { id: 'c1', name: 'n', email: 'e', org_name: 'o', notes: null }, member, note,
      );
      expect(patch.notes).toBe(note);
    });

    it('같은 줄이 이미 있으면 중복으로 붙이지 않는다 (오늘 재신청)', () => {
      const note = activityNoteFor('2026-11-15', '2026 봄 캠페인');
      const { patch, activityAppended } = buildContactPatch(
        { id: 'c1', name: 'n', email: 'e', org_name: 'o', notes: `${note}\n이전 메모` },
        member, note,
      );
      expect(activityAppended).toBe(false);
      expect(patch.notes).toBeUndefined();
    });

    it('활동이력이 없으면 notes 를 건드리지 않는다', () => {
      const { patch, activityAppended } = buildContactPatch(
        { id: 'c1', name: 'n', email: 'e', org_name: 'o', notes: '이전' }, member,
      );
      expect(activityAppended).toBe(false);
      expect(patch.notes).toBeUndefined();
    });
  });

  describe('신규 contact (INSERT)', () => {
    it('기본값이 원본과 같다 — contact_type 리드, lead_stage 미설정', () => {
      const body = buildContactInsert(member, '01051578698', {
        leadSource: '2026 봄 캠페인',
        activityNote: activityNoteFor('2026-11-15', '2026 봄 캠페인'),
      });
      expect(body).toEqual({
        name: '김선생',
        phone: '010-5157-8698',
        phone_normalized: '01051578698',
        email: 'teacher@example.com',
        org_name: '한빛초등학교',
        contact_type: '리드',
        lead_source: '2026 봄 캠페인',
        notes: '[2026-11-15] 캠페인 신청 — 2026 봄 캠페인',
      });
      expect('lead_stage' in body).toBe(false);
    });

    it('활동이력이 없으면 notes 키 자체가 없다', () => {
      const body = buildContactInsert(member, '01051578698', { leadSource: 'X' });
      expect('notes' in body).toBe(false);
    });

    it('leadSource 미지정 시 원본과 같은 기본값', () => {
      const body = buildContactInsert(member, '01051578698');
      expect(body.lead_source).toBe('럭키세븐 5월');
    });
  });

  it('언어별 전화 정규화 국가가 CampaignForm 과 같다 (EN→intl, JP→jp, 그 외 kr)', () => {
    expect(phoneCountryFor('en')).toBe('intl');
    expect(phoneCountryFor('ja')).toBe('jp');
    expect(phoneCountryFor('ko')).toBe('kr');
    expect(phoneCountryFor(undefined)).toBe('kr');
  });
});

describe('⑨ 텔레그램 알림 — telegram.ts:101-120 과 글자 단위로 같다', () => {
  it('전체 항목이 있을 때', () => {
    expect(buildCampaignLeadTelegram({
      campaignName: '2026 봄 캠페인',
      schoolName: '한빛초등학교',
      name: '김선생',
      phone: '010-5157-8698',
      position: '교사',
      source: '검색',
      isExistingCustomer: true,
    })).toMatchSnapshot('tg-full');
  });

  it('선택 항목이 없을 때 — 학교는 (미입력), 나머지 줄은 아예 빠진다', () => {
    expect(buildCampaignLeadTelegram({
      campaignName: 'EDIX Tokyo 2026',
      name: 'Taro',
      phone: '09012345678',
    })).toMatchSnapshot('tg-minimal');
  });

  it('기존 고객 태그는 isExistingCustomer 일 때만 붙는다', () => {
    const base = { campaignName: 'C', name: 'N', phone: 'P' };
    expect(buildCampaignLeadTelegram({ ...base, isExistingCustomer: true })).toContain('⚠️ 기존 고객');
    expect(buildCampaignLeadTelegram({ ...base, isExistingCustomer: false })).not.toContain('기존 고객');
    expect(buildCampaignLeadTelegram(base)).not.toContain('기존 고객');
  });

  it("경로가 '기타'면 sourceEtc 를 붙인다 (CampaignForm.tsx:300)", () => {
    expect(telegramSourceLabel('기타', '지인 소개')).toBe('기타 — 지인 소개');
    expect(telegramSourceLabel('기타', null)).toBe('기타 — ');
    expect(telegramSourceLabel('검색', '무시됨')).toBe('검색');
    expect(telegramSourceLabel(null, null)).toBeUndefined();
  });

  it('메시지 조립 원문이 telegram.ts 와 같다 (드리프트 가드)', () => {
    const norm = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
    // 원본은 sendTelegramNotification( 으로 감싸고, 사본은 return ( 으로 감싼다.
    // 감싸는 부분만 걷어내고 메시지 리터럴 네 줄을 대조한다.
    const grab = (src: string, open: string) => {
      const i = src.indexOf(open);
      if (i < 0) throw new Error(`마커 없음: ${open}`);
      const s = src.indexOf('`🎯', i);
      const e = src.indexOf('`\n', src.indexOf('${existingTag}', s));
      return norm(src.slice(s, e));
    };
    expect(grab(LOGIC_TS, 'export function buildCampaignLeadTelegram'))
      .toBe(grab(TELEGRAM_TS, 'export function notifyCampaignLead'));
  });

  it('변수 계산 세 줄이 원본과 같다', () => {
    for (const line of [
      "const existingTag = isExistingCustomer ? `\\n⚠️ 기존 고객` : '';",
      "const positionStr = position ? `\\n💼 ${position}` : '';",
      "const sourceStr = source ? `\\n📍 경로: ${source}` : '';",
    ]) {
      expect(TELEGRAM_TS).toContain(line);
      expect(LOGIC_TS).toContain(line);
    }
  });
});

describe('⑩ contacts 로직 원문이 luckySeven.ts 와 같다 (드리프트 가드)', () => {
  it('PATCH 분기 네 줄', () => {
    for (const line of [
      'if (!existing.name && member.name) patch.name = member.name;',
      'if (!existing.email && member.email) patch.email = member.email;',
      'if (!existing.org_name && member.orgName) patch.org_name = member.orgName;',
      "patch.notes = [activityNote.trim(), prevNotes].filter(Boolean).join('\\n');",
    ]) {
      expect(LOGIC_TS).toContain(line);
    }
    // 원본은 options.activityNote 를 쓴다 — 이름만 다르고 식은 같다
    expect(LEADCONTACT_TS).toContain('if (!existing.name && member.name) patch.name = member.name;');
    expect(LEADCONTACT_TS).toContain('if (!existing.email && member.email) patch.email = member.email;');
    expect(LEADCONTACT_TS).toContain('if (!existing.org_name && member.orgName) patch.org_name = member.orgName;');
    expect(LEADCONTACT_TS).toContain("patch.notes = [options.activityNote.trim(), prevNotes].filter(Boolean).join('\\n');");

    // 코어가 한 벌인지도 함께 고정한다 — luckySeven.ts 에 옛 본문이 남아 두 벌이 되면 안 된다
    expect(LUCKYSEVEN_TS).not.toContain('rest/v1/contacts?phone_normalized=eq.');
  });

  it('INSERT 기본값이 원본과 같다', () => {
    expect(LEADCONTACT_TS).toContain("contact_type: options.contactType ?? '리드',");
    expect(LEADCONTACT_TS).toContain("lead_source: options.leadSource ?? '럭키세븐 5월',");
    expect(LOGIC_TS).toContain("contact_type: options.contactType ?? '리드',");
    expect(LOGIC_TS).toContain("lead_source: options.leadSource ?? '럭키세븐 5월',");
  });
});

// ════════════════════════════════════════════════════
// 021-5c — 캠페인 쿠폰 (체험 이용권과 별개 기능)
// ════════════════════════════════════════════════════

const COUPON: CouponSettings = {
  enabled: true,
  code_prefix: 'SPRING',
  discount_type: 'amount',
  discount_value: 5000,
  applicable_products: ['boardgame', 'keyring'],
  expires_in_days: 30,
  max_count: 100,
  alimtok_tpl_code: 'UM_1234',
  min_order: 10000,
};

describe('⑪ 캠페인 쿠폰 — campaign-coupons.ts 와 같은 값', () => {
  it('할인 라벨 — percent / amount', () => {
    expect(discountLabel({ ...COUPON, discount_type: 'percent', discount_value: 30 })).toBe('30%');
    expect(discountLabel({ ...COUPON, discount_type: 'amount', discount_value: 5000 })).toBe('5,000원');
    expect(discountLabel({ ...COUPON, discount_type: 'amount', discount_value: 500 })).toBe('500원');
  });

  it('알림톡 요청 본문이 원본과 같다', () => {
    expect(buildCouponAlimtokBody(
      COUPON, { name: '김선생', phone: '010-5157-8698' },
      'SPRING-AB23CD', '2026-12-15T09:00:00.000Z',
    )).toEqual({
      tpl_code: 'UM_1234',
      name: '김선생',
      phone: '010-5157-8698',
      coupon_code: 'SPRING-AB23CD',
      expiry_date: '2026-12-15',   // ISO 앞 10자
      duration: '5,000원',
    });
  });

  it('shop_coupons INSERT 본문이 원본과 같다', () => {
    expect(buildCouponInsert(
      COUPON, { id: 'camp-1', name: '2026 봄 캠페인' }, 'lead-1',
      'SPRING-AB23CD', '2026-12-15T09:00:00.000Z',
    )).toEqual({
      code: 'SPRING-AB23CD',
      batch_name: '2026 봄 캠페인',
      campaign_id: 'camp-1',
      lead_id: 'lead-1',
      discount_type: 'amount',
      discount_value: 5000,
      min_order: 10000,
      expires_at: '2026-12-15T09:00:00.000Z',
      applicable_products: ['boardgame', 'keyring'],
      active: true,
    });
  });

  it('applicable_products 가 비면 null, min_order 가 없으면 0', () => {
    const body = buildCouponInsert(
      { ...COUPON, applicable_products: [], min_order: undefined },
      { id: 'c', name: 'n' }, 'l', 'CODE', 'ISO',
    );
    expect(body.applicable_products).toBeNull();
    expect(body.min_order).toBe(0);
  });

  it('만료일은 발급일 + N일 (UTC ISO)', () => {
    expect(couponExpiresAt(30, new Date('2026-11-15T09:00:00.000Z')))
      .toBe('2026-12-15T09:00:00.000Z');
  });

  it('코드 알파벳에 헷갈리는 글자(I,O,0,1)가 없다', () => {
    const code = randomCode(64, buf => { for (let i = 0; i < buf.length; i++) buf[i] = i; });
    expect(code).not.toMatch(/[IO01]/);
    expect(code).toHaveLength(64);
  });

  it('난수를 고정하면 코드가 재현된다', () => {
    const fixed = (buf: Uint8Array) => { for (let i = 0; i < buf.length; i++) buf[i] = 0; };
    expect(randomCode(6, fixed)).toBe('AAAAAA');
  });

  describe('사전 판정', () => {
    it('비활성이면 skip', () => {
      expect(precheckCoupon({ ...COUPON, enabled: false }, 0)).toEqual({ action: 'skip', reason: 'disabled' });
      expect(precheckCoupon(null, 0)).toEqual({ action: 'skip', reason: 'disabled' });
    });
    it('code_prefix 가 없으면 skip', () => {
      expect(precheckCoupon({ ...COUPON, code_prefix: '' }, 0)).toEqual({ action: 'skip', reason: 'no_prefix' });
    });
    it('max_count 에 도달하면 skip', () => {
      expect(precheckCoupon(COUPON, 100)).toEqual({ action: 'skip', reason: 'max_count' });
      expect(precheckCoupon(COUPON, 101)).toEqual({ action: 'skip', reason: 'max_count' });
      expect(precheckCoupon(COUPON, 99)).toEqual({ action: 'issue' });
    });
    it('max_count 가 null/0 이면 무제한', () => {
      expect(precheckCoupon({ ...COUPON, max_count: null }, null)).toEqual({ action: 'issue' });
      expect(precheckCoupon({ ...COUPON, max_count: 0 }, null)).toEqual({ action: 'issue' });
    });
  });

  describe('INSERT 재시도 판정 (UNIQUE 충돌)', () => {
    it('성공이면 inserted', () => {
      expect(couponInsertVerdict(true, 201)).toBe('inserted');
    });
    it('409/400 이면 재시도 — UNIQUE 충돌 가능', () => {
      expect(couponInsertVerdict(false, 409)).toBe('retry');
      expect(couponInsertVerdict(false, 400)).toBe('retry');
    });
    it('그 외 오류는 중단', () => {
      expect(couponInsertVerdict(false, 500)).toBe('abort');
      expect(couponInsertVerdict(false, 403)).toBe('abort');
    });
    it('재시도 횟수가 원본과 같다 (5회)', () => {
      expect(COUPON_MAX_ATTEMPTS).toBe(5);
      expect(COUPONS_TS).toContain('attempt < 5');
    });
  });
});

describe('⑫ 쿠폰 로직 원문이 campaign-coupons.ts 와 같다 (드리프트 가드)', () => {
  it('코드 알파벳·라벨·만료 계산이 같다', () => {
    for (const line of [
      "const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';",
      "if (s.discount_type === 'percent') return `${s.discount_value}%`;",
      'return `${s.discount_value.toLocaleString()}원`;',
      'd.setDate(d.getDate() + days);',
    ]) {
      expect(COUPONS_TS).toContain(line);
      expect(LOGIC_TS).toContain(line);
    }
  });

  it('알림톡 본문 필드가 같다', () => {
    for (const line of [
      'tpl_code:    settings.alimtok_tpl_code,',
      'coupon_code: code,',
      'duration:    discountLabel(settings),',
    ]) {
      expect(COUPONS_TS).toContain(line);
      expect(LOGIC_TS).toContain(line);
    }
  });

  it('INSERT 본문 필드가 같다', () => {
    for (const line of [
      'batch_name: params.campaign.name,',
      'min_order: settings.min_order ?? 0,',
    ].map(l => l.replace('params.campaign.name', 'campaign.name'))) {
      expect(LOGIC_TS).toContain(line);
    }
    expect(COUPONS_TS).toContain('batch_name: params.campaign.name,');
    expect(COUPONS_TS).toContain('min_order: settings.min_order ?? 0,');
    expect(COUPONS_TS).toContain(
      "applicable_products: (settings.applicable_products && settings.applicable_products.length > 0)");
    expect(LOGIC_TS).toContain(
      "applicable_products: (settings.applicable_products && settings.applicable_products.length > 0)");
  });
});

describe('⑬ 쿠폰과 체험권이 서로를 막지 않는다 (index.ts 구조 검증)', () => {
  const at = (needle: string) => {
    const i = INDEX_TS.indexOf(needle);
    if (i < 0) throw new Error(`없음: ${needle}`);
    return i;
  };

  it('브라우저와 같은 순서 — contacts → 텔레그램 → 쿠폰 → 체험권', () => {
    const contacts = at('6-a) contacts upsert');
    const telegram = at('6-b) 텔레그램 알림');
    const coupon = at('6-c) 캠페인 쿠폰');
    const trial = at("여기까지가 '신청 접수'");
    expect(contacts).toBeLessThan(telegram);
    expect(telegram).toBeLessThan(coupon);
    expect(coupon).toBeLessThan(trial);
  });

  // HARD-A H-2 로 브라우저가 이 흐름을 직접 수행하지 않게 됐다.
  // 예전 테스트는 "원본 CampaignForm 의 쿠폰→체험권 순서"를 서버 사본과 대조했는데,
  // 이제 원본이 없다 — 서버가 유일한 구현이다. 그래서 드리프트 가드의 목적(두 벌이
  // 어긋나지 않게)을 **새 불변식**으로 바꿔 못 박는다: 브라우저는 위임만 한다.
  it('CampaignForm 은 이 흐름을 직접 수행하지 않고 서버 함수에 위임한다', () => {
    const form = readFileSync(resolve(ROOT, 'src/pages/CampaignForm.tsx'), 'utf8');
    const code = form.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

    // 직접 발급·등록·알림을 하지 않는다
    expect(code).not.toContain('issueCampaignCoupon(');
    expect(code).not.toContain('issueTrialLicense(');
    expect(code).not.toContain('upsertLeadContact(');
    expect(code).not.toContain('notifyCampaignLead(');
    // campaign_leads 에 직접 INSERT 하지 않는다
    expect(code).not.toMatch(/rest\/v1\/campaign_leads/);

    // 대신 서버 함수를 부른다
    expect(code).toContain('submitCampaignLead(');
  });

  it('서버 함수를 부르는 모듈이 campaign-submit-lead 를 가리킨다', () => {
    const mod = readFileSync(resolve(ROOT, 'src/lib/campaignSubmit.ts'), 'utf8');
    expect(mod).toContain('functions/v1/campaign-submit-lead');
    // 완료 화면이 쓰는 필드가 서버 응답 모양과 같다
    for (const field of ['coupon', 'trial', 'leadId', 'priorCampaignName', 'priorIssuedAt']) {
      expect(mod, field).toContain(field);
    }
  });

  it('쿠폰 발급이 try/catch 로 감싸져 체험권을 막지 않는다', () => {
    const block = INDEX_TS.slice(at('6-c) 캠페인 쿠폰'), at("여기까지가 '신청 접수'"));
    expect(block).toContain('try {');
    expect(block).toContain('} catch (e) {');
    expect(block).toContain('쿠폰 발급 실패');
    // catch 안에서 return 하지 않는다 = 뒤의 체험권 흐름이 계속된다
    expect(block.slice(block.indexOf('} catch (e) {'))).not.toContain('return');
  });

  it('쿠폰 결과가 모든 응답 경로에 실린다 (체험권 유무와 무관)', () => {
    const returns = [...INDEX_TS.matchAll(/ok: true, leadId, isExistingCustomer: existing,/g)];
    expect(returns.length).toBeGreaterThanOrEqual(5);
    for (const m of returns) {
      expect(INDEX_TS.slice(m.index!, m.index! + 90)).toContain('coupon');
    }
  });

  it('쿠폰 설정을 요청 본문이 아니라 DB 캠페인에서 읽는다', () => {
    expect(INDEX_TS).toContain('campaign.coupon_settings');
    expect(INDEX_TS).toContain('trial_license_settings,coupon_settings&limit=1');
    // raw(요청 본문)에서 쿠폰 설정을 꺼내지 않는다
    expect(INDEX_TS).not.toContain('raw.coupon_settings');
    expect(INDEX_TS).not.toContain('lead.couponSettings');
  });

  it('서버끼리 호출에 internalHeaders 를 쓴다 (send-shop-alimtok 포함)', () => {
    for (const fn of ['create-coupon', 'send-email', 'notify-telegram', 'send-shop-alimtok']) {
      const i = INDEX_TS.indexOf(`functions/v1/${fn}`);
      expect(i, fn).toBeGreaterThan(-1);
      expect(INDEX_TS.slice(i, i + 400), fn).toContain('internalHeaders()');
    }
  });
});
