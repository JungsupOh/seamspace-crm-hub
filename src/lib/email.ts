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
    `[심스페이스] 결제 완료 영수증 — ${params.orderName}`,
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
}): Promise<void> {
  const expireLine = params.serviceExpireAt
    ? `${params.serviceExpireAt} まで有効`
    : `発行日から ${params.durationDays} 日間有効`;

  const html = layoutJP(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#18181b;">${params.contactName} 様、ありがとうございました</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
      Seamspace (mDiary) にご関心をお寄せいただき、誠にありがとうございます。<br/>
      ${params.campaignName} のご登録ありがとうございました。下記のトライアルコードを発行いたしました。
    </p>

    <p style="margin:0 0 4px;font-size:13px;color:#71717a;">トライアルコード</p>
    ${codeBox(params.couponCode)}
    <p style="margin:0 0 20px;font-size:12px;color:#a1a1aa;text-align:center;">
      ${expireLine} ・ 最大 ${params.userLimit} ユーザーまでご利用可能
    </p>

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">ご利用方法</p>
    <p style="margin:0 0 4px;font-size:13px;color:#334155;line-height:1.7;">1. <a href="https://m.seamspace.co.kr" style="color:#6366f1;">https://m.seamspace.co.kr</a> にアクセス</p>
    <p style="margin:0 0 4px;font-size:13px;color:#334155;line-height:1.7;">2. 言語設定で「日本語」を選択</p>
    <p style="margin:0 0 4px;font-size:13px;color:#334155;line-height:1.7;">3. 学校/組織アカウント登録時に上記コードを入力</p>
    <p style="margin:0 0 24px;font-size:13px;color:#334155;line-height:1.7;">4. すぐに mDiary をご利用いただけます</p>

    <p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">デモミーティングをご希望の場合</p>
    <p style="margin:0 0 24px;font-size:13px;color:#334155;line-height:1.7;">
      オンラインで mDiary の活用方法をご案内いたします。<strong>このメールにそのままご返信ください</strong> — 担当者よりご連絡差し上げます。
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
    `Seamspace (mDiary) にご関心をお寄せいただき、誠にありがとうございます。`,
    `${params.campaignName} のご登録ありがとうございました。`,
    ``,
    `トライアルコード: ${params.couponCode}`,
    `${expireLine} ・ 最大 ${params.userLimit} ユーザーまでご利用可能`,
    ``,
    `ご利用方法:`,
    `1. https://m.seamspace.co.kr にアクセス`,
    `2. 言語設定で「日本語」を選択`,
    `3. 学校/組織アカウント登録時に上記コードを入力`,
    `4. すぐに mDiary をご利用いただけます`,
    ``,
    `デモミーティングをご希望の場合は、このメールにそのままご返信ください。`,
    ``,
    `お問い合わせ: contact@tebahsoft.com`,
    `テバソフト株式会社`,
  ].join('\n');

  await sendEmail(
    params.to,
    // 풀폭 괄호/이모지 제거 — Gmail 스팸 필터 회피
    `Seamspace ${params.campaignName} トライアルコードのご案内${params.orgName ? ` - ${params.orgName}` : ''}`,
    html,
    {
      text,
      reply_to: 'contact@tebahsoft.com',
      // cc는 default(sales@tebahsoft.com) 그대로 — 본사 가시성
    },
  );
}
