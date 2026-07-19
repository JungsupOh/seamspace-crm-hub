import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Telegram 알림
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

// Resend webhook 이벤트 타입별 이모지/라벨
const EVENT_LABELS: Record<string, { emoji: string; label: string; alert: boolean }> = {
  'email.bounced':     { emoji: '🚫', label: '바운스 (수신 불가)', alert: true },
  'email.complained':  { emoji: '⚠️', label: '스팸 신고', alert: true },
  'email.delivery_delayed': { emoji: '⏳', label: '전달 지연', alert: true },
  'email.delivered':   { emoji: '✅', label: '전달 완료', alert: false },
  'email.opened':      { emoji: '👀', label: '열람', alert: false },
  'email.clicked':     { emoji: '🔗', label: '링크 클릭', alert: false },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const eventType: string = body.type ?? '';
    const data = body.data ?? {};

    const config = EVENT_LABELS[eventType];
    if (!config) {
      // 알 수 없는 이벤트 → 무시
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 알림이 필요한 이벤트만 텔레그램 발송 (바운스, 스팸, 지연)
    if (config.alert) {
      const to = Array.isArray(data.to) ? data.to.join(', ') : (data.to ?? '');
      const subject = data.subject ?? '';
      const reason = data.bounce?.message
        ?? data.complaint?.complaint_type
        ?? data.delivery_delayed?.delayed_reason
        ?? '';

      await sendTelegram(
        `${config.emoji} <b>이메일 ${config.label}</b>\n\n` +
        `📧 수신: ${to}\n` +
        `📋 제목: ${subject}\n` +
        (reason ? `💬 사유: ${reason}\n` : '') +
        `🕐 시각: ${data.created_at ?? new Date().toISOString()}`
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Webhook 처리 오류:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
