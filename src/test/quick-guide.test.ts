/**
 * CRM-022 — 퀵가이드 첨부·안내 문구.
 *
 * 증명하는 것:
 *   ① 브라우저(src/lib/quickGuide.ts)와 서버(campaign-submit-lead/quick-guide.ts)의 헬퍼가 바이트 단위로 같다
 *   ② 브라우저 email.ts 를 **실제로 실행**해 만든 메일(제목·HTML·텍스트·참조·첨부)이
 *      서버 templates.ts + quick-guide.ts 가 만든 것과 같다 (영어·일본어)
 *   ③ 언어별 첨부 파일 목록·순서, 실제 PDF 파일 존재와 용량 (Resend 한도 여유)
 *   ④ 구매 이용권 메일의 언어별 첨부, 옛 흐름 문구·옛 경로 참조가 없다
 *
 * 네트워크·운영 DB 없음. fetch 는 public 폴더의 파일을 읽어 돌려주는 가짜로 대체한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  QUICK_GUIDE_FILES, TUTORIAL_URL, guideLang, guideFileUrl,
  guideBlockHtml, guideBlockText, fetchGuideAttachments,
  type GuideLang,
} from '@/lib/quickGuide';
import { buildTrialEmailEN, buildTrialEmailJP, buildTrialEmail } from '../../supabase/functions/campaign-submit-lead/templates';
import {
  sendTrialLicenseEmailEN, sendTrialLicenseEmailJP, sendPurchaseLicenseEmail,
} from '@/lib/email';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const norm = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');

const SERVER_BASE = 'https://seamspace-crm-hub.vercel.app';
const LANGS: GuideLang[] = ['ko', 'ja', 'en'];
const RESEND_LIMIT = 40 * 1024 * 1024;

// ── fetch 가짜: /docs/... 는 public 에서, send-email 은 본문을 붙잡아 둔다 ──
type Sent = { url: string; body: Record<string, unknown> };
function installFetch(opts: { spaFallback?: boolean; missing?: string } = {}) {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: { body?: string }) => {
    const url = String(input);
    if (url.includes('/functions/v1/send-email')) {
      sent.push({ url, body: JSON.parse(init!.body!) });
      return { ok: true, status: 200, json: async () => ({ id: 'test' }) };
    }
    const path = decodeURIComponent(url.replace(SERVER_BASE, ''));
    if (opts.missing && path.endsWith(opts.missing)) {
      return opts.spaFallback
        ? { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('<!doctype html>').buffer }
        : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const buf = readFileSync(resolve(ROOT, 'public' + path));
    return {
      ok: true, status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  }));
  return sent;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const TRIAL = {
  to: 'teacher@example.com', contactName: 'Taro', orgName: 'Sample School',
  campaignName: 'EDIX Tokyo 2026', couponCode: 'TRIAL-ABCD-1234',
  durationDays: 90, userLimit: 40,
};

describe('① 헬퍼 두 벌이 같다', () => {
  it('src/lib/quickGuide.ts 와 campaign-submit-lead/quick-guide.ts 가 바이트 단위로 같다', () => {
    expect(read('supabase/functions/campaign-submit-lead/quick-guide.ts')).toBe(read('src/lib/quickGuide.ts'));
  });
});

describe('③ 첨부 목록·실제 파일·용량', () => {
  it('언어별 개수·순서 (en 7 / ja 7 / ko 6)', () => {
    expect(QUICK_GUIDE_FILES.en.map(f => f.file)).toEqual([
      'Seamspace_QuickGuide_EN_01_How_To_Start.pdf', 'Seamspace_QuickGuide_EN_02_Sign_Up_and_Login.pdf',
      'Seamspace_QuickGuide_EN_03_Admin_Page.pdf', 'Seamspace_QuickGuide_EN_04_Group_Journal.pdf',
      'Seamspace_QuickGuide_EN_05_Wall.pdf', 'Seamspace_QuickGuide_EN_06_Worksheet.pdf',
      'Seamspace_QuickGuide_EN_07_Newsletter.pdf',
    ]);
    expect(QUICK_GUIDE_FILES.ja).toHaveLength(7);
    expect(QUICK_GUIDE_FILES.ko).toHaveLength(6);
    expect(QUICK_GUIDE_FILES.ja[3].file).toBe('Seamspace_QuickGuide_JA_04_Shared_Story.pdf');
    expect(QUICK_GUIDE_FILES.ko[0].file).toBe('Seamspace_QuickGuide_KO_01_Basic_Usage.pdf');
  });

  // CRM-022c — 영어 파일명에도 언어 코드를 붙였다(옛 이름에는 EN_ 이 없었다).
  // 세 언어가 같은 규칙을 쓰는지 한 곳에서 못 박는다.
  it('파일명이 언어별 규칙을 따른다 (EN_ / JA_ / KO_ + 두 자리 번호)', () => {
    const RULE: Record<string, RegExp> = {
      en: /^Seamspace_QuickGuide_EN_\d{2}_[A-Za-z0-9_]+\.pdf$/,
      ja: /^Seamspace_QuickGuide_JA_\d{2}_[A-Za-z0-9_]+\.pdf$/,
      ko: /^Seamspace_QuickGuide_KO_\d{2}_[A-Za-z0-9_]+\.pdf$/,
    };
    for (const lang of LANGS) {
      for (const f of QUICK_GUIDE_FILES[lang]) {
        expect(f.file, `${lang}: ${f.file}`).toMatch(RULE[lang]);
      }
    }
  });

  it('번호가 1부터 빠짐없이 이어진다', () => {
    for (const lang of LANGS) {
      const nums = QUICK_GUIDE_FILES[lang].map(f => Number(f.file.match(/_(\d{2})_/)![1]));
      expect(nums, lang).toEqual(nums.map((_, i) => i + 1));
    }
  });

  it('모든 파일이 public/docs/quick-guide/<lang>/ 에 있고 PDF 이며, 요청 크기가 Resend 한도에 여유가 있다', () => {
    for (const lang of LANGS) {
      let raw = 0;
      for (const f of QUICK_GUIDE_FILES[lang]) {
        const p = resolve(ROOT, 'public/docs/quick-guide', lang, f.file);
        expect(existsSync(p), p).toBe(true);
        expect(readFileSync(p).subarray(0, 4).toString('latin1'), f.file).toBe('%PDF');
        raw += statSync(p).size;
      }
      const base64Total = Math.ceil(raw / 3) * 4;
      // 메일 한 통 = base64 첨부 합계 + (본문은 수십 KB). 한도의 25% 이내여야 한다.
      expect(base64Total, lang).toBeLessThan(RESEND_LIMIT * 0.25);
    }
  });

  it('옛 public/docs PDF 는 그대로 있다 (삭제 금지) — 참조만 끊었다', () => {
    for (const f of [
      'Quick Guide_How To Start (En).pdf', 'Quick Guide_How To Start (KR).pdf', 'Quick Guide_HowToStart(JP).pdf',
    ]) expect(existsSync(resolve(ROOT, 'public/docs', f)), f).toBe(true);
    for (const src of [
      'src/lib/email.ts', 'src/pages/CampaignForm.tsx',
      'supabase/functions/campaign-submit-lead/templates.ts', 'supabase/functions/campaign-submit-lead/index.ts',
    ]) {
      expect(read(src), src).not.toMatch(/Quick%20Guide_|Quick Guide_How|HowToStart\(JP\)/);
    }
  });

  it('언어 선택 규칙: ko·ja 는 해당 언어, 그 밖은 영어', () => {
    expect(guideLang('ko')).toBe('ko');
    expect(guideLang('ja')).toBe('ja');
    for (const l of ['en', 'tr', 'es', 'mn', undefined, null, '']) expect(guideLang(l as string)).toBe('en');
  });
});

describe('fetchGuideAttachments', () => {
  it('목록 순서대로 파일명·base64 를 돌려준다', async () => {
    installFetch();
    const att = await fetchGuideAttachments('ko', '', 'test');
    expect(att!.map(a => a.filename)).toEqual(QUICK_GUIDE_FILES.ko.map(f => f.file));
    const first = readFileSync(resolve(ROOT, 'public/docs/quick-guide/ko', QUICK_GUIDE_FILES.ko[0].file));
    expect(att![0].content).toBe(first.toString('base64'));
  });

  it('한 개라도 404 면 첨부를 아예 붙이지 않는다 (본문 목록과 어긋나지 않게)', async () => {
    installFetch({ missing: 'Seamspace_QuickGuide_EN_05_Wall.pdf' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await fetchGuideAttachments('en', '', 'test')).toBeUndefined();
  });

  it('없는 경로가 index.html(200)로 돌아와도 PDF 가 아니면 거절한다', async () => {
    installFetch({ missing: 'Seamspace_QuickGuide_EN_05_Wall.pdf', spaFallback: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await fetchGuideAttachments('en', '', 'test')).toBeUndefined();
  });

  it('서버용 기본 주소를 앞에 붙인다', () => {
    expect(guideFileUrl('ja', 'Seamspace_QuickGuide_JA_01_How_To_Start.pdf', SERVER_BASE))
      .toBe(`${SERVER_BASE}/docs/quick-guide/ja/Seamspace_QuickGuide_JA_01_How_To_Start.pdf`);
  });
});

describe('② 브라우저 email.ts 실행 결과 == 서버 templates.ts + quick-guide.ts 결과', () => {
  const cases: Array<['en' | 'ja', typeof sendTrialLicenseEmailEN, typeof buildTrialEmailEN]> = [
    ['en', sendTrialLicenseEmailEN, buildTrialEmailEN],
    ['ja', sendTrialLicenseEmailJP, buildTrialEmailJP],
  ];
  for (const [lang, browserSend, serverBuild] of cases) {
    for (const resend of [false, true]) {
      it(`${lang} ${resend ? '재발송' : '신규'}: 제목·HTML·텍스트·참조·첨부가 같다`, async () => {
        const sent = installFetch();
        await browserSend({ ...TRIAL, resend });
        const b = sent[0].body as {
          subject: string; html: string; text: string; reply_to: string; cc?: unknown;
          attachments: Array<{ filename: string; content: string }>;
        };

        const built = serverBuild({ ...TRIAL, resend });
        expect(b.subject).toBe(built.subject);
        expect(norm(b.html)).toBe(norm(built.html));
        expect(b.text).toBe(built.text);
        expect(b.reply_to).toBe(built.reply_to);
        // 브라우저 sendEmail 은 cc 기본값(sales@)을 채워 넣고 서버는 send-email 이 채운다 — 규칙은 trialCc 로 같다
        expect(built.cc).toBeUndefined();
        expect(built.guideLang).toBe(lang);

        // 서버 쪽 첨부(운영 사이트 주소에서 받는다고 가정)와 같은 파일명·순서·내용
        const serverAtt = await fetchGuideAttachments(built.guideLang, SERVER_BASE, 'test');
        expect(b.attachments.map(a => a.filename)).toEqual(QUICK_GUIDE_FILES[lang].map(f => f.file));
        expect(b.attachments).toEqual(serverAtt);
      });
    }
  }

  it('서버의 ko 로케일은 JP 템플릿이므로 일본어 목록을 첨부한다 (브라우저 규칙과 동일)', () => {
    expect(buildTrialEmail('ko', TRIAL).guideLang).toBe('ja');
    expect(buildTrialEmail('ja', TRIAL).guideLang).toBe('ja');
    expect(buildTrialEmail('en', TRIAL).guideLang).toBe('en');
  });

  it('본문에 첨부 목록 전체와 튜토리얼 링크가 HTML·텍스트 모두에 있다', () => {
    for (const [lang, build] of [['en', buildTrialEmailEN], ['ja', buildTrialEmailJP]] as const) {
      const built = build(TRIAL);
      for (const f of QUICK_GUIDE_FILES[lang]) {
        expect(built.html, f.label).toContain(f.label);
        expect(built.text, f.label).toContain(f.label);
      }
      expect(built.html).toContain(`href="${TUTORIAL_URL[lang]}"`);
      expect(built.text).toContain(TUTORIAL_URL[lang]);
    }
    expect(TUTORIAL_URL.en).toBe('https://www.seamspace.site/resource/tutorial');
    expect(TUTORIAL_URL.ja).toBe('https://www.seamspace.site/ja/resource/tutorial');
    expect(TUTORIAL_URL.ko).toBe('https://www.seamspace.site/ko/resource/tutorial');
  });

  it('브라우저·서버 모두 같은 헬퍼로 메일을 만든다 (소스 구조)', () => {
    const email = read('src/lib/email.ts');
    const tpl = read('supabase/functions/campaign-submit-lead/templates.ts');
    expect(email).toContain("fetchGuideAttachments('ja'");
    expect(email).toContain("fetchGuideAttachments('en'");
    expect(email).toContain('fetchGuideAttachments(gl');
    for (const src of [email, tpl]) {
      expect(src).toContain("guideBlockHtml('ja')");
      expect(src).toContain("guideBlockHtml('en')");
      expect(src).toContain("guideBlockText('ja')");
      expect(src).toContain("guideBlockText('en')");
    }
    // 서버 발송부가 첨부를 실제로 싣는다
    const idx = read('supabase/functions/campaign-submit-lead/index.ts');
    expect(idx).toContain('fetchGuideAttachments(built.guideLang');
    expect(idx).toContain('body.attachments = attachments');
  });
});

describe('④ 구매 이용권 메일 (sendPurchaseLicenseEmail)', () => {
  const OLD_FLOW = /Start Group Management|グループ管理を始める|그룹 관리 시작/;
  const P = { to: 'buyer@example.com', contactName: 'Pwint', couponCode: 'LIC-ABCD', durationMonths: 12, userLimit: 30 };

  for (const [locale, lang] of [['ko', 'ko'], ['ja', 'ja'], ['en', 'en'], ['tr', 'en'], [undefined, 'en']] as const) {
    it(`locale=${locale ?? '(없음)'} → ${lang} 목록 ${QUICK_GUIDE_FILES[lang].length}개 첨부, 본문에 목록·튜토리얼 링크`, async () => {
      const sent = installFetch();
      await sendPurchaseLicenseEmail({ ...P, locale });
      const b = sent[0].body as { html: string; text: string; attachments: Array<{ filename: string }> };
      expect(b.attachments.map(a => a.filename)).toEqual(QUICK_GUIDE_FILES[lang].map(f => f.file));
      for (const f of QUICK_GUIDE_FILES[lang]) {
        expect(b.html).toContain(f.label);
        expect(b.text).toContain(f.label);
      }
      expect(b.html).toContain(`href="${TUTORIAL_URL[lang]}"`);
      expect(b.text).toContain(TUTORIAL_URL[lang]);
      expect(b.html).not.toMatch(OLD_FLOW);
      expect(b.text).not.toMatch(OLD_FLOW);
    });
  }

  it('첨부를 못 받아도 메일은 나간다 (첨부만 빠진다)', async () => {
    const sent = installFetch({ missing: 'Seamspace_QuickGuide_KO_03_Shared_Story.pdf' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendPurchaseLicenseEmail({ ...P, locale: 'ko' });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.attachments).toBeUndefined();
  });

  it('체험권·구매 메일 본문 어디에도 옛 흐름 문구가 없다', () => {
    for (const lang of LANGS) {
      expect(guideBlockHtml(lang)).not.toMatch(OLD_FLOW);
      expect(guideBlockText(lang).join('\n')).not.toMatch(OLD_FLOW);
    }
    for (const built of [buildTrialEmailEN(TRIAL), buildTrialEmailJP(TRIAL)]) {
      expect(built.html).not.toMatch(OLD_FLOW);
      expect(built.text).not.toMatch(OLD_FLOW);
    }
    expect(read('src/lib/email.ts')).not.toMatch(OLD_FLOW);
    expect(read('src/pages/CampaignForm.tsx')).not.toMatch(OLD_FLOW);
  });
});

describe('CampaignForm 완료 화면', () => {
  it('언어별 쪽별 PDF 링크와 튜토리얼 링크를 같은 헬퍼에서 만든다', () => {
    const src = read('src/pages/CampaignForm.tsx');
    expect(src).toContain("from '@/lib/quickGuide'");
    expect(src).toContain('QUICK_GUIDE_FILES[guideLangKey]');
    expect(src).toContain('guideFileUrl(guideLangKey, f.file)');
    expect(src).toContain('TUTORIAL_URL[guideLangKey]');
    expect(src).toContain("isEN ? 'en' : isJP ? 'ja' : 'ko'");
  });
});
