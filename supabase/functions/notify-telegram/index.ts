// Supabase Edge Function: notify-telegram
// 브라우저에서 오는 관리자 알림을 대신 전송한다.
//
// 목적: 봇 토큰을 프론트엔드 번들에서 제거하는 것.
// 기존에는 src/lib/telegram.ts에 토큰이 박혀 있어 누구나 번들에서 꺼내
// 봇 자체를 탈취할 수 있었다. 이제 토큰은 서버 시크릿에만 존재하고,
// 외부에서 할 수 있는 최대치는 "이 채널로 메시지를 보내는 것"뿐이다.
//
// verify_jwt=false인 이유: /order, /shop, 캠페인 폼 등 비로그인 공개 페이지에서도
// 결제·신청 알림을 보내야 하기 때문. 대신 아래로 남용 여파를 제한한다.
//  - 허용 Origin 목록 (브라우저 경유 호출 차단)
//  - 본문 길이 제한
// 남용이 실제로 발생하면 이 함수만 내리거나 교체하면 되고, 봇은 안전하다.

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';

const ALLOWED_ORIGINS = [
  'https://seamspace-crm-hub.vercel.app',
  'http://localhost:5173',
  'http://localhost:8080',
];

const MAX_LEN = 2000;

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  const CORS = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 브라우저에서 온 요청이라면 Origin이 허용 목록에 있어야 한다.
  // (Origin이 없는 서버-투-서버 호출은 엣지 함수끼리의 내부 호출이므로 통과)
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: 'Origin not allowed' }, 403);
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[notify-telegram] 시크릿 미설정 — 알림 생략');
    return json({ ok: false, skipped: 'missing secrets' });
  }

  try {
    const { text } = await req.json();
    if (typeof text !== 'string' || !text.trim()) {
      return json({ error: 'text is required' }, 400);
    }

    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: text.slice(0, MAX_LEN),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '(read failed)');
      console.warn(`[notify-telegram] 발송 실패 ${r.status}:`, detail);
      return json({ ok: false, status: r.status }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error('[notify-telegram]', e);
    return json({ error: String(e) }, 500);
  }
});
