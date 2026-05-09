import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'noreply@seamspace.site';

// 발송 실패 시 텔레그램 알림
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '8680036281:AAG465JPrhfYBuYCpDyuNkfUr0UgaOutn2c';
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '-1003754735570';
async function notifyFailure(to: string, subject: string, error: string) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: `🚨 <b>이메일 발송 실패</b>\n\n📧 수신: ${to}\n📋 제목: ${subject}\n💬 오류: ${error}`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch { /* 알림 실패 무시 */ }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, subject, html, text, reply_to, cc, attachments } = await req.json();

    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: '필수 파라미터 누락' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: Record<string, unknown> = {
      from: `seamspace <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    };
    if (text) body.text = text;  // plain text 대체본 — 스팸 점수 큰 폭 감소
    if (reply_to) body.reply_to = reply_to;
    // cc 정책: 호출자가 명시한 cc가 있으면 사용, 없으면 RESEND_DEFAULT_CC 환경변수 fallback (호출자가 빈 문자열/null로 명시 차단 가능)
    if (cc !== null && cc !== '') {
      const finalCc = cc ?? Deno.env.get('RESEND_DEFAULT_CC') ?? '';
      if (finalCc) body.cc = finalCc;
    }
    if (Array.isArray(attachments) && attachments.length > 0) body.attachments = attachments;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data.message ?? '이메일 발송 실패';
      await notifyFailure(to, subject, errMsg);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
