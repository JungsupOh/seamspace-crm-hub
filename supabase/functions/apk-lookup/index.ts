// Supabase Edge Function: apk-lookup  (공개, HARD-B2b)
//
// 공개 /apk/info 와 /apk/unsubscribe 가 apk_subscribers·apk_downloads 를
// 공개 키로 직접 읽고 쓰던 것을 대신한다.
//
// 원본에서 가장 위험했던 것: /apk/info 가 `select=*` 로 구독자 행을 통째로 받았다.
// 거기에는 **unsubscribe_token** 이 들어 있다 — 그 값이면 남의 구독을 해지할 수 있다.
// 이제 서버가 읽고 화면이 쓰는 5개 열만 돌려준다(토큰은 절대 나가지 않는다).

import { CORS, DB, SUPABASE_URL, json, pickAll, q } from '../_shared/public-fn.ts';
import {
  DOWNLOAD_COLS, MAX_DOWNLOADS, SUBSCRIBER_COLS, unsubscribeVerdict, validateInput,
} from './logic.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const v = validateInput(await req.json().catch(() => null));
    if (!v.ok) return json({ error: v.error }, v.status);

    // ── 구독 정보 + 내려받기 이력 ──
    if (v.action === 'info') {
      const subRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apk_subscribers?email=eq.${q(v.email)}` +
          `&select=${[...SUBSCRIBER_COLS].join(',')}&limit=1`,
        { headers: DB },
      );
      const subs = subRes.ok ? await subRes.json() : [];
      const subscriber = Array.isArray(subs) && subs.length > 0
        ? pickAll(subs, SUBSCRIBER_COLS, 1)[0]
        : null;

      const dlRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apk_downloads?email=eq.${q(v.email)}` +
          `&order=downloaded_at.desc&limit=${MAX_DOWNLOADS}&select=${[...DOWNLOAD_COLS].join(',')}`,
        { headers: DB },
      );
      const downloads = dlRes.ok ? pickAll(await dlRes.json(), DOWNLOAD_COLS, MAX_DOWNLOADS) : [];

      return json({ subscriber, downloads });
    }

    // ── 해지 ──
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_subscribers?unsubscribe_token=eq.${q(v.token)}&select=id,email,status&limit=1`,
      { headers: DB },
    );
    if (!findRes.ok) return json({ error: '토큰 조회 실패' }, 502);
    const rows = await findRes.json();

    const early = unsubscribeVerdict(rows);
    if (early) {
      if (early.state === 'notfound') return json({ state: early.state, message: early.message }, 404);
      return json({ state: early.state, email: early.email, message: early.message });
    }

    const sub = rows[0] as { id: string; email: string };
    const upRes = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers?id=eq.${q(String(sub.id))}`, {
      method: 'PATCH',
      headers: { ...DB, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'unsubscribed' }),
    });
    if (!upRes.ok) return json({ error: '업데이트 실패' }, 502);

    return json({ state: 'done', email: sub.email, message: '구독이 취소되었습니다. 더 이상 메일을 받지 않습니다.' });
  } catch (e) {
    console.error('[apk-lookup]', e);
    return json({ error: '처리 중 오류가 발생했습니다.' }, 500);
  }
});
