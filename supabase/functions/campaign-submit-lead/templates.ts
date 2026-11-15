// 체험권 안내 메일 템플릿 — src/lib/email.ts 의 **복사본**.
//
// 왜 복사인가: 공용 모듈로 빼면 Vite(`@/` 별칭)와 Deno(상대경로 + `.ts`)의 해석 방식이
// 달라 양쪽에서 같은 파일을 import 하기 어렵다. 021-4 §3-5 에서 '복사' 를 택했다.
//
// **두 벌이 어긋나는 것이 유일한 위험**이라, 그걸 테스트로 막는다:
//   src/test/campaign-submit-lead.test.ts 가 이 파일과 src/lib/email.ts 의
//   템플릿 리터럴 원문을 **글자 단위로 대조**한다. 한쪽만 고치면 테스트가 깨진다.
//   그래서 아래 리터럴은 **공백 한 칸까지 원본 그대로** 둔다. 보기 좋게 고치지 말 것.
//
// 이 파일은 순수 문자열 조립만 한다 — Deno API 도 네트워크도 쓰지 않는다.
// 덕분에 vitest(Node)에서도 그대로 import 해서 검증할 수 있다.

import { guideBlockHtml, guideBlockText, type GuideLang } from './quick-guide.ts';

export const DEFAULT_CC = 'sales@tebahsoft.com';

export interface TrialEmailParams {
  to: string;
  contactName: string;
  orgName?: string;
  campaignName: string;
  couponCode: string;
  durationDays: number;
  userLimit: number;
  serviceExpireAt?: string;
  cc?: string;
  resend?: boolean;
  ccSales?: boolean;
}

export interface BuiltEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to: string;
  cc: string | string[] | null | undefined;
  /** 첨부할 퀵가이드 언어 — 템플릿 언어와 같다 (ko 로케일은 JP 템플릿이므로 ja). */
  guideLang: GuideLang;
}

// ── src/lib/email.ts:18-23 복사 ──
export function trialCc(ccSales: boolean | undefined, extra: string | undefined): string | string[] | null | undefined {
  const withSales = ccSales !== false;        // 설정이 없던 캠페인은 기존대로 참조
  const more = extra?.trim();
  if (withSales) return more ? [DEFAULT_CC, more] : undefined;
  return more ? [more] : null;
}

// ── src/lib/email.ts:114-118 복사 ──
export function codeBox(code: string): string {
  return `<div style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:14px 20px;margin:16px 0;text-align:center;">
    <span style="font-family:'Courier New',Courier,monospace;font-size:22px;font-weight:700;letter-spacing:3px;color:#18181b;">${code}</span>
  </div>`;
}

// ── src/lib/email.ts:373-410 복사 ──
export function layoutJP(content: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Seamspace</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Kaku Gothic ProN','Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#0f172a;padding:24px 40px;text-align:center;">
            <img
              src="https://awosikecivzhwisqzlds.supabase.co/storage/v1/object/public/assets/logo.png"
              alt="Seamspace"
              width="200"
              style="display:inline-block;height:auto;max-width:200px;"
            />
          </td>
        </tr>
        <tr><td style="background:#6366f1;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:36px 40px 32px;">${content}</td></tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #e4e4e7;background:#fafafa;">
            <p style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.6;">
              このメールは Seamspace CRM システムから自動送信されています。<br/>
              お問い合わせ: <a href="mailto:contact@tebahsoft.com" style="color:#6366f1;text-decoration:none;">contact@tebahsoft.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── src/lib/email.ts:541-578 복사 ──
export function layoutEN(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Seamspace</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#0f172a;padding:24px 40px;text-align:center;">
            <img
              src="https://awosikecivzhwisqzlds.supabase.co/storage/v1/object/public/assets/logo.png"
              alt="Seamspace"
              width="200"
              style="display:inline-block;height:auto;max-width:200px;"
            />
          </td>
        </tr>
        <tr><td style="background:#6366f1;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:36px 40px 32px;">${content}</td></tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #e4e4e7;background:#fafafa;">
            <p style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.6;">
              This email was sent automatically by the Seamspace CRM system.<br/>
              Contact: <a href="mailto:contact@tebahsoft.com" style="color:#6366f1;text-decoration:none;">contact@tebahsoft.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── src/lib/email.ts:415-538 (sendTrialLicenseEmailJP) 의 본문 조립 부분 복사 ──
// 원본은 발송까지 하는 async 함수라, 조립 결과만 돌려주도록 끝부분만 바꿨다.
export function buildTrialEmailJP(params: TrialEmailParams): BuiltEmail {
  // 有効期間は発行日ではなく「コード登録（有効化）」時点から N か月 — 固定の満了日表記は避ける
  const months = Math.max(1, Math.round(params.durationDays / 30));

  const html = layoutJP(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">${
      params.resend
        ? `${params.contactName} 様、トライアルコードを再送いたします`
        : `${params.contactName} 様、ありがとうございました`
    }</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">${
      params.resend
        ? `すでに発行済みのトライアルコードがございます。<br/>
           お手元で見つからない場合に備えて、下記に改めてお送りいたします。`
        : `seamspace にご関心をお寄せいただき、誠にありがとうございます。<br/>
           ${params.campaignName} のご登録ありがとうございました。下記のトライアルコードを発行いたしました。`
    }</p>

    <p style="margin:0 0 4px;font-size:13px;color:#71717a;">トライアルコード</p>
    ${codeBox(params.couponCode)}
    <p style="margin:0 0 8px;font-size:12px;color:#a1a1aa;text-align:center;">
      最大 ${params.userLimit} ユーザーまでご利用可能
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#0f172a;text-align:center;background:#eef2ff;border-radius:6px;padding:8px 12px;">
      ⏱ <strong>${months}か月</strong>の無料トライアルは<strong>コードを登録した時点</strong>から開始します（本メール受信日からではありません）。
    </p>

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">ご利用方法</p>
    <p style="margin:0 0 16px;font-size:13px;color:#334155;line-height:1.7;">
      ご利用開始の手順は、添付の <strong>Quick Guide (PDF)</strong> をご参照ください。<br/>
      アカウント登録 → トライアルコード入力までの流れを画面付きでご案内しております。
    </p>
    ${guideBlockHtml('ja')}

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">デモミーティングをご希望の場合</p>
    <p style="margin:0 0 24px;font-size:13px;color:#334155;line-height:1.7;">
      オンラインで seamspace の活用方法をご案内いたします。<strong>このメールにそのままご返信ください</strong> — 担当者よりご連絡差し上げます。
    </p>

    <p style="margin:0 0 4px;font-size:14px;color:#18181b;line-height:1.8;">ご不明な点がございましたら、お気軽にお問い合わせください。</p>
    <p style="margin:0 0 20px;font-size:13px;color:#64748b;line-height:1.8;">
      お問い合わせ先: <a href="mailto:contact@tebahsoft.com" style="color:#6366f1;text-decoration:none;">contact@tebahsoft.com</a>
    </p>

    <p style="margin:0;font-size:14px;color:#18181b;line-height:1.8;">
      何卒よろしくお願い申し上げます。<br/>
      テバソフト株式会社
    </p>
  `);

  // plain text 대체본 — Gmail/Outlook 스팸 점수 크게 감소
  const text = [
    params.resend
      ? `${params.contactName} 様、トライアルコードを再送いたします。`
      : `${params.contactName} 様、ありがとうございました。`,
    ``,
    ...(params.resend
      ? [`すでに発行済みのトライアルコードがございます。`,
         `お手元で見つからない場合に備えて、下記に改めてお送りいたします。`]
      : [`seamspace にご関心をお寄せいただき、誠にありがとうございます。`,
         `${params.campaignName} のご登録ありがとうございました。`]),
    ``,
    `トライアルコード: ${params.couponCode}`,
    `最大 ${params.userLimit} ユーザーまでご利用可能`,
    `${months}か月の無料トライアルはコードを登録した時点から開始します（本メール受信日からではありません）。`,
    ``,
    `ご利用開始の手順は、添付の Quick Guide (PDF) をご参照ください。`,
    `アカウント登録 → トライアルコード入力までの流れを画面付きでご案内しております。`,
    ``,
    ...guideBlockText('ja'),
    ``,
    `デモミーティングをご希望の場合は、このメールにそのままご返信ください。`,
    ``,
    `お問い合わせ: contact@tebahsoft.com`,
    `テバソフト株式会社`,
  ].join('\n');

  return {
    to: params.to,
    // 풀폭 괄호/이모지 제거 — Gmail 스팸 필터 회피
    subject: `Seamspace ${params.campaignName} トライアルコード${params.resend ? '再送' : ''}のご案内${params.orgName ? ` - ${params.orgName}` : ''}`,
    html,
    text,
    reply_to: 'contact@tebahsoft.com',
    // cc: 캠페인 설정에 따라 sales@ 를 붙이거나 뺀다 (trialCc 주석 참고)
    cc: trialCc(params.ccSales, params.cc),
    guideLang: 'ja',
  };
}

// ── src/lib/email.ts:583-707 (sendTrialLicenseEmailEN) 의 본문 조립 부분 복사 ──
export function buildTrialEmailEN(params: TrialEmailParams): BuiltEmail {
  // 유효기간은 발급일이 아니라 '코드 등록(활성화)' 시점부터 N개월 — 고정 만료일 표기 금지
  const months = Math.max(1, Math.round(params.durationDays / 30));

  const html = layoutEN(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">${
      params.resend
        ? `Here it is again, ${params.contactName}!`
        : `Thank you, ${params.contactName}!`
    }</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">${
      params.resend
        ? `Good news — you already have a trial code.<br/>
           We've sent it again below, so you can pick up right where you left off.`
        : `Thank you for your interest in seamspace.<br/>
           We appreciate your registration for ${params.campaignName}. Your trial code is ready below.`
    }</p>

    <p style="margin:0 0 4px;font-size:13px;color:#71717a;">Trial code</p>
    ${codeBox(params.couponCode)}
    <p style="margin:0 0 8px;font-size:12px;color:#a1a1aa;text-align:center;">
      Up to ${params.userLimit} users
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#0f172a;text-align:center;background:#eef2ff;border-radius:6px;padding:8px 12px;">
      ⏱ Your <strong>${months}-month</strong> free trial starts <strong>when you register the code</strong> — not from the day you receive this email.
    </p>

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">How to get started</p>
    <p style="margin:0 0 16px;font-size:13px;color:#334155;line-height:1.7;">
      Please refer to the attached <strong>Quick Guide (PDF)</strong> to get started.<br/>
      It walks you through account sign-up and entering your trial code, step by step with screenshots.
    </p>
    ${guideBlockHtml('en')}

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">Would you like a demo meeting?</p>
    <p style="margin:0 0 24px;font-size:13px;color:#334155;line-height:1.7;">
      We'd be happy to walk you through seamspace online. <strong>Simply reply to this email</strong> and our team will get in touch.
    </p>

    <p style="margin:0 0 4px;font-size:14px;color:#18181b;line-height:1.8;">If you have any questions, please don't hesitate to reach out.</p>
    <p style="margin:0 0 20px;font-size:13px;color:#64748b;line-height:1.8;">
      Contact: <a href="mailto:contact@tebahsoft.com" style="color:#6366f1;text-decoration:none;">contact@tebahsoft.com</a>
    </p>

    <p style="margin:0;font-size:14px;color:#18181b;line-height:1.8;">
      Best regards,<br/>
      Tebahsoft Inc.
    </p>
  `);

  // plain text 대체본 — Gmail/Outlook 스팸 점수 크게 감소
  const text = [
    params.resend
      ? `Here it is again, ${params.contactName}!`
      : `Thank you, ${params.contactName}!`,
    ``,
    ...(params.resend
      ? [`Good news — you already have a trial code.`,
         `We've sent it again below, so you can pick up right where you left off.`]
      : [`Thank you for your interest in seamspace.`,
         `We appreciate your registration for ${params.campaignName}.`]),
    ``,
    `Trial code: ${params.couponCode}`,
    `Up to ${params.userLimit} users`,
    `Your ${months}-month free trial starts when you register the code (not from the day you receive this email).`,
    ``,
    `Please refer to the attached Quick Guide (PDF) to get started.`,
    `It walks you through account sign-up and entering your trial code, step by step with screenshots.`,
    ``,
    ...guideBlockText('en'),
    ``,
    `Would you like a demo meeting? Simply reply to this email and our team will get in touch.`,
    ``,
    `Contact: contact@tebahsoft.com`,
    `Tebahsoft Inc.`,
  ].join('\n');

  // 제목: 폼 제목에 이미 'Seamspace'가 있으면 접두어 생략 (중복 'Seamspace Seamspace' 방지)
  const brandPrefix = /seamspace/i.test(params.campaignName) ? '' : 'Seamspace ';

  return {
    to: params.to,
    subject: `${params.resend ? 'Your trial code (again) — ' : ''}${brandPrefix}${params.campaignName} Trial Code${params.orgName ? ` - ${params.orgName}` : ''}`,
    html,
    text,
    reply_to: 'contact@tebahsoft.com',
    // cc: 캠페인 설정에 따라 sales@ 를 붙이거나 뺀다 (trialCc 주석 참고)
    cc: trialCc(params.ccSales, params.cc),
    guideLang: 'en',
  };
}

/** 언어별 템플릿 선택 — campaign-trial-license.ts:126 과 같은 규칙('en'만 영어). */
export function buildTrialEmail(locale: string | undefined, params: TrialEmailParams): BuiltEmail {
  return locale === 'en' ? buildTrialEmailEN(params) : buildTrialEmailJP(params);
}
