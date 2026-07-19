// ── Supabase Edge Function을 통한 이메일 발송 ──────
// Resend API는 브라우저에서 직접 호출 불가 (CORS 제한)
// supabase/functions/send-email/index.ts 를 배포해야 함

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const APP_URL = window.location.origin;

// 시스템 정책: 모든 이메일 발송에 영업팀 cc (호출자가 명시적으로 null 주면 제외)
const DEFAULT_CC = 'sales@tebahsoft.com';

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  options?: {
    text?: string;             // plain text 대체본 (스팸 회피)
    reply_to?: string;
    cc?: string | string[] | null;
    attachments?: Array<{ filename: string; content: string }>;
  }
): Promise<void> {
  const cc = options?.cc === undefined ? DEFAULT_CC : options.cc;
  const body: Record<string, unknown> = { to, subject, html };
  if (options?.text) body.text = options.text;
  if (options?.reply_to) body.reply_to = options.reply_to;
  if (options?.attachments) body.attachments = options.attachments;
  if (cc) body.cc = cc;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `이메일 발송 실패 (${res.status})`);
  }
}

// ── 공통 레이아웃 ───────────────────────────────────
function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Seamspace CRM</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">

        <!-- 헤더 -->
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
        <!-- 구분선 -->
        <tr>
          <td style="background:#6366f1;height:4px;font-size:0;line-height:0;">&nbsp;</td>
        </tr>

        <!-- 본문 -->
        <tr>
          <td style="padding:36px 40px 32px;">
            ${content}
          </td>
        </tr>

        <!-- 푸터 -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #e4e4e7;background:#fafafa;">
            <p style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.6;">
              이 이메일은 Seamspace CRM 시스템에서 자동 발송되었습니다.<br/>
              문의: <a href="mailto:sales@tebahsoft.com" style="color:#6366f1;text-decoration:none;">sales@tebahsoft.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── 코드 박스 컴포넌트 ──────────────────────────────
function codeBox(code: string): string {
  return `<div style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:14px 20px;margin:16px 0;text-align:center;">
    <span style="font-family:'Courier New',Courier,monospace;font-size:22px;font-weight:700;letter-spacing:3px;color:#18181b;">${code}</span>
  </div>`;
}

// ── 버튼 컴포넌트 ──────────────────────────────────
function button(text: string, url: string): string {
  return `<p style="margin:24px 0 0;text-align:center;">
    <a href="${url}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;">${text}</a>
  </p>`;
}

// ── 초대 이메일 ────────────────────────────────────
export async function sendInviteEmail(params: {
  to: string;
  name: string;
  inviteCode: string;
  role: string;
  invitedBy: string;
}): Promise<void> {
  const roleLabel: Record<string, string> = {
    admin: '관리자', sub_admin: '서브관리자', guest: '게스트',
  };

  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">초대장이 도착했습니다 👋</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#71717a;line-height:1.7;">
      <strong style="color:#18181b;">${params.invitedBy}</strong>님이 <strong style="color:#18181b;">Seamspace CRM</strong>에 초대했습니다.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
          <span style="font-size:12px;color:#a1a1aa;display:block;margin-bottom:2px;">이름</span>
          <span style="font-size:14px;color:#18181b;">${params.name || '—'}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;">
          <span style="font-size:12px;color:#a1a1aa;display:block;margin-bottom:2px;">이메일</span>
          <span style="font-size:14px;color:#18181b;">${params.to}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;">
          <span style="font-size:12px;color:#a1a1aa;display:block;margin-bottom:2px;">역할</span>
          <span style="font-size:14px;color:#18181b;">${roleLabel[params.role] || params.role}</span>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 4px;font-size:13px;color:#71717a;">초기 비밀번호</p>
    ${codeBox(params.inviteCode)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">첫 로그인 후 즉시 비밀번호를 변경해 주세요.</p>

    ${button('CRM 로그인하기', `${APP_URL}/login`)}
  `);

  await sendEmail(params.to, '[Seamspace CRM] 초대장이 도착했습니다', html);
}

// ── 비밀번호 초기화 이메일 ──────────────────────────
export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  tempPassword: string;
  resetBy: string;
}): Promise<void> {
  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">비밀번호가 초기화되었습니다 🔑</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#71717a;line-height:1.7;">
      <strong style="color:#18181b;">${params.resetBy}</strong>님이 회원님의 비밀번호를 초기화했습니다.<br/>
      아래 임시 비밀번호로 로그인 후 즉시 변경해 주세요.
    </p>

    <p style="margin:0 0 4px;font-size:13px;color:#71717a;">임시 비밀번호</p>
    ${codeBox(params.tempPassword)}
    <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">보안을 위해 로그인 즉시 새 비밀번호로 변경해 주세요.</p>

    ${button('CRM 로그인하기', `${APP_URL}/login`)}

    <p style="margin:20px 0 0;font-size:12px;color:#a1a1aa;">
      본인이 요청하지 않은 경우 관리자에게 즉시 문의해 주세요.
    </p>
  `);

  await sendEmail(params.to, '[Seamspace CRM] 임시 비밀번호 안내', html);
}

// ── 견적서 발송 이메일 ──────────────────────────────
export async function sendQuoteEmail(params: {
  to: string;
  orgName: string;
  contactName: string;
  quoteNumber: string;
  paymentUrl?: string;     // 견적 번호 기반 개별 결제 링크 (없으면 /order 기본)
  attachmentBase64?: string;
  attachmentFileName?: string;
  attachments?: Array<{ base64: string; fileName: string }>;
}): Promise<void> {
  const payHref = params.paymentUrl || `${APP_URL}/order`;
  const html = layout(`
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      안녕하세요. ${params.contactName} 선생님,<br/>
      심스페이스에 관심을 가져 주셔서 감사드립니다.
    </p>

    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      요청하신 견적서를 첨부와 같이 보내 드리오니, 긍정적으로 검토 부탁드립니다.<br/>
      사용 기간과 인원수(또는 학급수)에 따라 견적금액이 변동되오니, 문의사항이 있으시면 언제든 문의 부탁드립니다.
    </p>

    <p style="margin:0 0 8px;font-size:14px;color:#18181b;line-height:1.8;">
      아울러, 저희 심스페이스(AI 마음일기)에 대한 정보를 모아둔 매뉴얼 사이트를 공유해 드리오니 참고 부탁드립니다.
    </p>

    <p style="margin:0 0 24px;text-align:center;">
      <a href="https://m.site.naver.com/1EfiC" style="display:inline-block;background:#03C75A;color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">매뉴얼 사이트</a>
      &nbsp;&nbsp;
      <a href="${payHref}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">결제하러 가기</a>
      &nbsp;&nbsp;
      <a href="http://pf.kakao.com/_FvrSG" style="display:inline-block;background:#FEE500;color:#3C1E1E;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;">카카오채널 문의</a>
    </p>

    ${params.paymentUrl ? `
    <p style="margin:0 0 16px;font-size:12px;color:#71717a;background:#f8fafc;border-left:3px solid #6366f1;padding:10px 14px;">
      🔒 결제 페이지 진입 시 <strong style="color:#18181b;">본 이메일 주소(${params.to})</strong>를 입력해 주세요. 다른 분이 견적서 번호만으로 결제 정보를 조회할 수 없도록 보호됩니다.
    </p>` : ''}

    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      기타 궁금하신 사항은 언제든지 연락주시면, 상세히 안내해 드리겠습니다.
    </p>

    <p style="margin:0;font-size:14px;color:#18181b;line-height:1.8;">
      감사합니다.<br/>
      테바소프트 담당자 드림.
    </p>
  `);

  await sendEmail(
    params.to,
    `(테바소프트) 심스페이스(seamspace)_견적서 송부드립니다._ ${params.orgName}`,
    html,
    {
      reply_to: 'sales@tebahsoft.com',
      attachments: params.attachments
        ? params.attachments.map(a => ({ filename: a.fileName, content: a.base64 }))
        : [{ filename: params.attachmentFileName!, content: params.attachmentBase64! }],
    }
  );
}

// ── 결제 완료 영수증 이메일 ──────────────────────────
export async function sendPaymentReceiptEmail(params: {
  to: string;
  customerName: string;
  orderName: string;
  amount: number;
  paidAt?: string;        // ISO datetime
  receiptUrl?: string;    // Toss 매출전표 URL
  orderId?: string;       // 주문번호 (= quote_number 등)
  method?: string;        // 결제 수단 ('카드' 등)
}): Promise<void> {
  const fmtAmount = params.amount.toLocaleString('ko-KR');
  const paidAtStr = params.paidAt
    ? new Date(params.paidAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
    : new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

  const html = layout(`
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b;">결제가 완료되었습니다 💳</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      ${params.customerName} 선생님,<br/>
      심스페이스 결제가 정상 처리되었습니다. 아래에서 결제 내역을 확인하세요.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px;">
      <tr><td style="padding:6px 0;font-size:13px;color:#64748b;">상품</td>
          <td style="padding:6px 0;font-size:13px;color:#18181b;font-weight:600;text-align:right;">${params.orderName}</td></tr>
      ${params.orderId ? `<tr><td style="padding:6px 0;font-size:13px;color:#64748b;">주문번호</td>
          <td style="padding:6px 0;font-size:12px;color:#18181b;font-family:monospace;text-align:right;">${params.orderId}</td></tr>` : ''}
      ${params.method ? `<tr><td style="padding:6px 0;font-size:13px;color:#64748b;">결제수단</td>
          <td style="padding:6px 0;font-size:13px;color:#18181b;text-align:right;">${params.method}</td></tr>` : ''}
      <tr><td style="padding:6px 0;font-size:13px;color:#64748b;">결제일시</td>
          <td style="padding:6px 0;font-size:13px;color:#18181b;text-align:right;">${paidAtStr}</td></tr>
      <tr><td style="padding:8px 0 0;font-size:13px;color:#64748b;border-top:1px solid #e4e4e7;">결제 금액</td>
          <td style="padding:8px 0 0;font-size:16px;color:#0f172a;font-weight:700;text-align:right;border-top:1px solid #e4e4e7;">${fmtAmount}원</td></tr>
    </table>

    ${params.receiptUrl ? `
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${params.receiptUrl}" target="_blank" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">매출전표(영수증) 보기</a>
    </p>` : ''}

    <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.7;">
      문의: <a href="mailto:sales@tebahsoft.com" style="color:#6366f1;text-decoration:none;">sales@tebahsoft.com</a>
    </p>
    <p style="margin:0;font-size:14px;color:#18181b;line-height:1.8;">
      감사합니다.<br/>테바소프트 담당자 드림.
    </p>
  `);

  await sendEmail(
    params.to,
    `심스페이스 - 결제 완료 영수증 — ${params.orderName}`,
    html,
    { reply_to: 'sales@tebahsoft.com' },
  );
}

// ── 일본어 레이아웃 (해외 캠페인 전용) ────────────────
function layoutJP(content: string): string {
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

// ── 일본어 트라이얼 안내 메일 (해외 캠페인) ───────────
// EDIX Japan 등 해외 전시회/캠페인 리드에게 발송하는 30일 무료 체험 코드 안내.
// replyTo는 contact@tebahsoft.com (해외 문의 채널), cc는 기본 sales@tebahsoft.com (가시성).
export async function sendTrialLicenseEmailJP(params: {
  to: string;
  contactName: string;
  orgName?: string;
  campaignName: string;
  couponCode: string;
  durationDays: number;
  userLimit: number;
  serviceExpireAt?: string;  // YYYY-MM-DD
  cc?: string;               // 추가 cc (sales@ 기본 cc에 더해짐)
}): Promise<void> {
  // 有効期間は発行日ではなく「コード登録（有効化）」時点から N か月 — 固定の満了日表記は避ける
  const months = Math.max(1, Math.round(params.durationDays / 30));

  const html = layoutJP(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">${params.contactName} 様、ありがとうございました</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      seamspace にご関心をお寄せいただき、誠にありがとうございます。<br/>
      ${params.campaignName} のご登録ありがとうございました。下記のトライアルコードを発行いたしました。
    </p>

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
    `${params.contactName} 様、ありがとうございました。`,
    ``,
    `seamspace にご関心をお寄せいただき、誠にありがとうございます。`,
    `${params.campaignName} のご登録ありがとうございました。`,
    ``,
    `トライアルコード: ${params.couponCode}`,
    `最大 ${params.userLimit} ユーザーまでご利用可能`,
    `${months}か月の無料トライアルはコードを登録した時点から開始します（本メール受信日からではありません）。`,
    ``,
    `ご利用開始の手順は、添付の Quick Guide (PDF) をご参照ください。`,
    `アカウント登録 → トライアルコード入力までの流れを画面付きでご案内しております。`,
    ``,
    `デモミーティングをご希望の場合は、このメールにそのままご返信ください。`,
    ``,
    `お問い合わせ: contact@tebahsoft.com`,
    `テバソフト株式会社`,
  ].join('\n');

  // Quick Guide PDF 첨부 (public/docs/Quick Guide_HowToStart(JP).pdf)
  // public 자산은 fetch로 base64로 읽어서 첨부.
  let attachments: Array<{ filename: string; content: string }> | undefined;
  try {
    const r = await fetch('/docs/Quick%20Guide_HowToStart(JP).pdf');
    if (r.ok) {
      const blob = await r.blob();
      const buf = await blob.arrayBuffer();
      // base64 인코딩
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(binary);
      attachments = [{ filename: 'seamspace_QuickGuide_JP.pdf', content: base64 }];
    } else {
      console.warn('[sendTrialLicenseEmailJP] Quick Guide PDF 로드 실패', r.status);
    }
  } catch (e) {
    console.warn('[sendTrialLicenseEmailJP] Quick Guide PDF 첨부 실패 (메일은 진행)', e);
  }

  await sendEmail(
    params.to,
    // 풀폭 괄호/이모지 제거 — Gmail 스팸 필터 회피
    `Seamspace ${params.campaignName} トライアルコードのご案内${params.orgName ? ` - ${params.orgName}` : ''}`,
    html,
    {
      text,
      reply_to: 'contact@tebahsoft.com',
      attachments,
      // cc: 기본 sales@ + 캠페인 추가 cc(있을 때). 없으면 default(sales@) 유지
      cc: params.cc?.trim() ? [DEFAULT_CC, params.cc.trim()] : undefined,
    },
  );
}

// ── 영어 레이아웃 (해외 캠페인 전용) ────────────────────
function layoutEN(content: string): string {
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

// ── 영어 트라이얼 안내 메일 (해외 캠페인) ───────────────
// 영어권 전시회/캠페인 리드에게 발송하는 무료 체험 코드 안내.
// replyTo는 contact@tebahsoft.com (해외 문의 채널), cc는 기본 sales@tebahsoft.com (가시성).
export async function sendTrialLicenseEmailEN(params: {
  to: string;
  contactName: string;
  orgName?: string;
  campaignName: string;
  couponCode: string;
  durationDays: number;
  userLimit: number;
  serviceExpireAt?: string;  // YYYY-MM-DD
  cc?: string;               // 추가 cc (sales@ 기본 cc에 더해짐)
}): Promise<void> {
  // 유효기간은 발급일이 아니라 '코드 등록(활성화)' 시점부터 N개월 — 고정 만료일 표기 금지
  const months = Math.max(1, Math.round(params.durationDays / 30));

  const html = layoutEN(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">Thank you, ${params.contactName}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      Thank you for your interest in seamspace.<br/>
      We appreciate your registration for ${params.campaignName}. Your trial code is ready below.
    </p>

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
    `Thank you, ${params.contactName}!`,
    ``,
    `Thank you for your interest in seamspace.`,
    `We appreciate your registration for ${params.campaignName}.`,
    ``,
    `Trial code: ${params.couponCode}`,
    `Up to ${params.userLimit} users`,
    `Your ${months}-month free trial starts when you register the code (not from the day you receive this email).`,
    ``,
    `Please refer to the attached Quick Guide (PDF) to get started.`,
    `It walks you through account sign-up and entering your trial code, step by step with screenshots.`,
    ``,
    `Would you like a demo meeting? Simply reply to this email and our team will get in touch.`,
    ``,
    `Contact: contact@tebahsoft.com`,
    `Tebahsoft Inc.`,
  ].join('\n');

  // Quick Guide PDF 첨부 (public/docs/Quick Guide_How To Start (En).pdf)
  let attachments: Array<{ filename: string; content: string }> | undefined;
  try {
    const r = await fetch('/docs/Quick%20Guide_How%20To%20Start%20(En).pdf');
    if (r.ok) {
      const blob = await r.blob();
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(binary);
      attachments = [{ filename: 'seamspace_QuickGuide_EN.pdf', content: base64 }];
    } else {
      console.warn('[sendTrialLicenseEmailEN] Quick Guide PDF 로드 실패', r.status);
    }
  } catch (e) {
    console.warn('[sendTrialLicenseEmailEN] Quick Guide PDF 첨부 실패 (메일은 진행)', e);
  }

  // 제목: 폼 제목에 이미 'Seamspace'가 있으면 접두어 생략 (중복 'Seamspace Seamspace' 방지)
  const brandPrefix = /seamspace/i.test(params.campaignName) ? '' : 'Seamspace ';
  await sendEmail(
    params.to,
    `${brandPrefix}${params.campaignName} Trial Code${params.orgName ? ` - ${params.orgName}` : ''}`,
    html,
    {
      text,
      reply_to: 'contact@tebahsoft.com',
      attachments,
      // cc: 기본 sales@ + 캠페인 추가 cc(있을 때). 없으면 default(sales@) 유지
      cc: params.cc?.trim() ? [DEFAULT_CC, params.cc.trim()] : undefined,
    },
  );
}

// ── 해외 파트너 유료 이용권 발급 이메일 (영어) ──────────
// 파트너가 유료 판매한 이용권 코드 안내. trial/free 문구 없음(유료 카피).
export async function sendPurchaseLicenseEmailEN(params: {
  to: string;
  contactName: string;
  orgName?: string;
  couponCode: string;
  durationMonths: number;
  userLimit: number;
  partnerName?: string;      // 발송 파트너명 (표기용)
  cc?: string | null;        // 추가 cc (기본 sales@에 더해짐), null이면 cc 없음
}): Promise<void> {
  const months = Math.max(1, Math.round(params.durationMonths));

  const html = layoutEN(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">Thank you, ${params.contactName}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      Thank you for your purchase of seamspace.<br/>
      Your license code is ready below.
    </p>

    <p style="margin:0 0 4px;font-size:13px;color:#71717a;">License code</p>
    ${codeBox(params.couponCode)}
    <p style="margin:0 0 8px;font-size:12px;color:#a1a1aa;text-align:center;">
      Up to ${params.userLimit} users
    </p>
    <p style="margin:0 0 20px;font-size:12px;color:#0f172a;text-align:center;background:#eef2ff;border-radius:6px;padding:8px 12px;">
      ⏱ Your <strong>${months}-month</strong> license period starts <strong>when you register the code</strong> — not from the day you receive this email.
    </p>

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">How to get started</p>
    <p style="margin:0 0 16px;font-size:13px;color:#334155;line-height:1.7;">
      Please refer to the attached <strong>Quick Guide (PDF)</strong> to get started.<br/>
      It walks you through account sign-up and entering your license code, step by step with screenshots.
    </p>

    <p style="margin:0 0 4px;font-size:14px;color:#18181b;line-height:1.8;">If you have any questions, please don't hesitate to reach out.</p>
    <p style="margin:0 0 20px;font-size:13px;color:#64748b;line-height:1.8;">
      Contact: <a href="mailto:contact@tebahsoft.com" style="color:#6366f1;text-decoration:none;">contact@tebahsoft.com</a>
    </p>

    <p style="margin:0;font-size:14px;color:#18181b;line-height:1.8;">
      Best regards,<br/>
      ${params.partnerName ? `${params.partnerName} · ` : ''}Tebahsoft Inc.
    </p>
  `);

  const text = [
    `Thank you, ${params.contactName}!`,
    ``,
    `Thank you for your purchase of seamspace. Your license code is ready below.`,
    ``,
    `License code: ${params.couponCode}`,
    `Up to ${params.userLimit} users`,
    `Your ${months}-month license period starts when you register the code (not from the day you receive this email).`,
    ``,
    `Please refer to the attached Quick Guide (PDF) to get started.`,
    ``,
    `Contact: contact@tebahsoft.com`,
    `${params.partnerName ? params.partnerName + ' · ' : ''}Tebahsoft Inc.`,
  ].join('\n');

  // Quick Guide PDF 첨부 (public/docs/Quick Guide_How To Start (En).pdf)
  let attachments: Array<{ filename: string; content: string }> | undefined;
  try {
    const r = await fetch('/docs/Quick%20Guide_How%20To%20Start%20(En).pdf');
    if (r.ok) {
      const blob = await r.blob();
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      attachments = [{ filename: 'seamspace_QuickGuide_EN.pdf', content: btoa(binary) }];
    }
  } catch (e) {
    console.warn('[sendPurchaseLicenseEmailEN] Quick Guide PDF 첨부 실패 (메일은 진행)', e);
  }

  await sendEmail(
    params.to,
    `Seamspace License Code${params.orgName ? ` - ${params.orgName}` : ''}`,
    html,
    {
      text,
      reply_to: 'contact@tebahsoft.com',
      attachments,
      cc: params.cc === null ? null : (params.cc?.trim() ? [DEFAULT_CC, params.cc.trim()] : undefined),
    },
  );
}

// ── APK 배포 안내 이메일 (심스페이스 Android 앱) ────────
// 사용자 노출은 '심스페이스'만 사용 (mDiary 표기 금지)
// 문의처는 info@tebahsoft.com (APK 배포 전용 채널)
export async function sendApkEmail(params: {
  to: string;
  contactName: string;
  schoolName: string;
  versionName: string;
  versionCode: number;
  changelog?: string;
  minAndroid?: string;
  fileSize?: number;
  sha256?: string;
  downloadUrl: string;          // /apk/download/{versionId} (절대 URL)
  unsubscribeUrl: string;       // /apk/unsubscribe?token=... (절대 URL)
}): Promise<void> {
  const sizeMB = params.fileSize ? `${(params.fileSize / 1024 / 1024).toFixed(1)} MB` : '';
  // changelog markdown → 매우 단순 변환 (한 줄당 <li>)
  const changelogHtml = (params.changelog || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<li>${l.replace(/^[-*]\s*/, '')}</li>`)
    .join('');

  const html = layout(`
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b;">심스페이스 Android 앱 업데이트 📱</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#18181b;line-height:1.8;">
      안녕하세요 ${params.schoolName} ${params.contactName} 선생님,<br/>
      심스페이스 Android 앱 새 버전이 배포되었습니다. (MDM 환경용 sideload 패키지)
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px;">
      <tr><td style="padding:4px 0;font-size:13px;color:#64748b;width:90px;">버전</td>
          <td style="padding:4px 0;font-size:13px;color:#18181b;font-weight:600;">v${params.versionName} (빌드 ${params.versionCode})</td></tr>
      ${params.minAndroid ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">최소 Android</td>
          <td style="padding:4px 0;font-size:13px;color:#18181b;">${params.minAndroid}</td></tr>` : ''}
      ${sizeMB ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">파일 크기</td>
          <td style="padding:4px 0;font-size:13px;color:#18181b;">${sizeMB}</td></tr>` : ''}
      ${params.sha256 ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;vertical-align:top;">SHA256</td>
          <td style="padding:4px 0;font-size:11px;color:#71717a;font-family:monospace;word-break:break-all;">${params.sha256}</td></tr>` : ''}
    </table>

    ${changelogHtml ? `
    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">변경 사항</p>
    <ul style="margin:0 0 20px;padding-left:20px;font-size:13px;color:#334155;line-height:1.7;">
      ${changelogHtml}
    </ul>` : ''}

    <p style="margin:0 0 24px;text-align:center;">
      <a href="${params.downloadUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">다운로드 페이지로 이동</a>
    </p>

    <p style="margin:0 0 16px;font-size:12px;color:#64748b;background:#f8fafc;border-left:3px solid #6366f1;padding:10px 14px;line-height:1.7;">
      ※ 다운로드 페이지에서 본 메일 수신 이메일(<strong>${params.to}</strong>)을 입력해 주세요.<br/>
      ※ 동일 이메일당 최대 2회까지 다운로드 가능합니다.
    </p>

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">설치 안내</p>
    <ol style="margin:0 0 24px;padding-left:20px;font-size:13px;color:#334155;line-height:1.7;">
      <li>다운로드한 APK 파일 실행</li>
      <li>"출처를 알 수 없는 앱 설치" 권한 허용 (안드로이드 설정)</li>
      <li>설치 완료 후 학교 코드 입력</li>
    </ol>

    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;text-align:center;line-height:1.7;">
      더 이상 받지 않으려면 <a href="${params.unsubscribeUrl}" style="color:#6366f1;">구독 취소</a><br/>
      문의: <a href="mailto:info@tebahsoft.com" style="color:#6366f1;">info@tebahsoft.com</a>
    </p>
  `);

  const text = [
    `심스페이스 Android 앱 업데이트 안내`,
    ``,
    `안녕하세요 ${params.schoolName} ${params.contactName} 선생님,`,
    `심스페이스 Android 앱 새 버전이 배포되었습니다. (MDM 환경용 sideload 패키지)`,
    ``,
    `버전: v${params.versionName} (빌드 ${params.versionCode})`,
    params.minAndroid ? `최소 Android: ${params.minAndroid}` : '',
    sizeMB ? `파일 크기: ${sizeMB}` : '',
    params.sha256 ? `SHA256: ${params.sha256}` : '',
    ``,
    params.changelog ? `변경 사항:\n${params.changelog}` : '',
    ``,
    `다운로드: ${params.downloadUrl}`,
    `※ 다운로드 페이지에서 본 메일 수신 이메일(${params.to})을 입력해 주세요. 동일 이메일당 최대 2회 다운로드 가능합니다.`,
    ``,
    `설치 안내:`,
    `1. 다운로드한 APK 파일 실행`,
    `2. "출처를 알 수 없는 앱 설치" 권한 허용`,
    `3. 설치 완료 후 학교 코드 입력`,
    ``,
    `구독 취소: ${params.unsubscribeUrl}`,
    `문의: info@tebahsoft.com`,
  ].filter(Boolean).join('\n');

  await sendEmail(
    params.to,
    `심스페이스 - Android 앱 v${params.versionName} 업데이트 안내`,
    html,
    {
      text,
      reply_to: 'info@tebahsoft.com',
      // cc=sales@ default 그대로 (본사 가시성)
    },
  );
}
