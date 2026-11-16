// Supabase Edge Function: campaign-public-detail  (공개, HARD-B2b)
//
// 공개 폼 /c/:slug 가 `campaigns?slug=eq.…&select=*` 로 캠페인을 통째로 읽던 것을 대신한다.
//
// 왜 정책이 아니라 함수인가
//   RLS 는 **행**을 가리지 열을 가리지 못한다. "활성 캠페인만 공개 SELECT" 정책을 둬도
//   그 행의 **모든 열**(budget·actual_cost·coupon_settings·trial_license_settings)이 내려간다.
//   열을 제한하려면 컬럼 GRANT 를 써야 하는데 그건 테이블 GRANT 회수를 전제로 하고,
//   GRANT 회수는 정책 닫기의 **마지막 단계**다(021-8D §B-1 9번).
//   그래서 지금은 함수로 열을 좁히는 쪽이 안전하고 되돌리기도 쉽다.
//
// 응답 모양은 원본 화면이 기대하는 그대로다 — 찾으면 { campaign }, 없으면 { campaign: null }.

import { CORS, DB, SUPABASE_URL, json, pickAll, q } from '../_shared/public-fn.ts';
import { CAMPAIGN_COLS, validateInput } from './logic.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const v = validateInput(await req.json().catch(() => null));
    // 입력이 이상해도 화면은 "캠페인을 찾을 수 없습니다"를 보여 주면 된다.
    if (!v.ok) return json({ campaign: null });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/campaigns?slug=eq.${q(v.slug)}&select=${[...CAMPAIGN_COLS].join(',')}&limit=1`,
      { headers: DB },
    );
    if (!r.ok) return json({ error: '캠페인을 불러오지 못했습니다.' }, 502);
    const rows = await r.json();
    const list = pickAll(rows, CAMPAIGN_COLS, 1);

    return json({ campaign: list[0] ?? null });
  } catch (e) {
    console.error('[campaign-public-detail]', e);
    return json({ error: '캠페인을 불러오지 못했습니다.' }, 500);
  }
});
