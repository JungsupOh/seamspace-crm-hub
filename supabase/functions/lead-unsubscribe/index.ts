// Supabase Edge Function: lead-unsubscribe  (공개, LEAD-S2)
//
// 해외 리드가 메일의 거부 링크를 눌렀을 때 처리한다.
// 공개 화면 `/unsubscribe/:token` 이 **버튼을 눌렀을 때만** 이 함수를 부른다 —
// GET 만으로 처리하면 메일 미리보기 로봇이 사람 대신 거부해 버린다.
//
// service_role 로 돈다. 공개 경로가 DB 를 직접 만지지 않는 규칙(HARD-B2b)을 따른다.
//
// ⚠️ 응답은 성공·실패·없는 토큰이 **모두 같다**(logic.ts 머리말 참고).

import { CORS, DB, SUPABASE_URL, json, q } from '../_shared/public-fn.ts';
import {
  GENERIC_ERROR, GENERIC_OK, unsubscribeActivity, unsubscribePatch, validateToken,
} from './logic.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const v = validateToken(await req.json().catch(() => null));
  // 토큰이 이상해도 **같은 응답**을 준다(열거 방지). DB 는 부르지 않는다.
  if (!v.ok) return json({ ...GENERIC_OK });

  try {
    const now = new Date().toISOString();

    // ① 토큰으로 리드를 찾는다. 돌려받는 것은 id 와 거부 여부뿐 —
    //    이름·이메일을 읽지 않는다(로그에도 남지 않게).
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/campaign_leads?unsubscribe_token=eq.${q(v.token)}` +
        `&select=id,unsubscribed_at&limit=1`,
      { headers: DB },
    );
    if (!r.ok) return json({ ...GENERIC_ERROR }, 502);
    const rows = await r.json();
    const lead = Array.isArray(rows) && rows.length > 0
      ? rows[0] as { id: string; unsubscribed_at?: string | null }
      : null;

    // 없는 토큰 — 같은 응답. 조용히 끝낸다.
    if (!lead) return json({ ...GENERIC_OK });

    // 이미 거부했으면 그대로 성공(멱등). 기록을 또 쌓지 않는다.
    if (lead.unsubscribed_at) return json({ ...GENERIC_OK });

    // ② 거부 처리
    const up = await fetch(
      `${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${q(lead.id)}`,
      {
        method: 'PATCH',
        headers: { ...DB, Prefer: 'return=minimal' },
        body: JSON.stringify(unsubscribePatch(now)),
      },
    );
    if (!up.ok) return json({ ...GENERIC_ERROR }, 502);

    // ③ 활동 기록. 실패해도 거부 자체는 이미 됐으므로 성공으로 답한다 —
    //    사람에게 "거부가 안 됐다"고 보이면 다시 누르게 되고, 그게 더 나쁘다.
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
        method: 'POST',
        headers: { ...DB, Prefer: 'return=minimal' },
        body: JSON.stringify(unsubscribeActivity(lead.id, now)),
      });
    } catch (e) {
      console.warn('[lead-unsubscribe] 활동 기록 실패 (거부는 처리됨)', e);
    }

    return json({ ...GENERIC_OK });
  } catch (e) {
    // 개인정보가 로그에 남지 않게 토큰도 적지 않는다.
    console.error('[lead-unsubscribe] 처리 중 오류');
    return json({ ...GENERIC_ERROR }, 500);
  }
});
