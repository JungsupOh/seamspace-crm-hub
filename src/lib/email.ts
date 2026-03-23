// ── Supabase Edge Function을 통한 이메일 발송 ──────
// Resend API는 브라우저에서 직접 호출 불가 (CORS 제한)
// supabase/functions/send-email/index.ts 를 배포해야 함

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const APP_URL = window.location.origin;

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ to, subject, html }),
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
              문의: <a href="mailto:admin@seamspace.co.kr" style="color:#6366f1;text-decoration:none;">admin@seamspace.co.kr</a>
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
