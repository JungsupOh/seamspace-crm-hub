// Supabase Edge Function: order-lookup-quote  (공개, HARD-B2b)
//
// 공개 /order 의 견적 조회와 /order/pay 의 견적 읽기를 대신한다.
//
// 원본에서 고치는 것
//   견적 조회 패널은 `deal_quotes?quote_number=eq.…&select=*` 로 **행을 먼저 받아 온 뒤**
//   브라우저에서 이메일·전화를 비교했다. 즉 번호만 알면 30개 열(결제키·입금일·주문상태·
//   구매자 정보까지)이 그대로 내려갔다. 이제 **서버가 먼저 대조**하고, 통과했을 때만
//   화면이 쓰는 열을 돌려준다.
//
// 결제 승인(confirm-payment)은 건드리지 않는다.

import { CORS, DB, SUPABASE_URL, json, pick, q } from '../_shared/public-fn.ts';
import {
  DEAL_CONTACT_COLS, QUOTE_COLS_PAY, QUOTE_COLS_VERIFY, matchVerdict, validateInput,
} from './logic.ts';
import { shouldEnforce, verifyPayToken } from '../_shared/quote-token.ts';

// HARD-B2c — 결제 링크 서명 토큰. 키가 없으면 경고 모드로만 돈다(shouldEnforce 참고).
const LINK_SECRET  = Deno.env.get('QUOTE_LINK_SECRET') ?? '';
const LINK_ENFORCE = Deno.env.get('QUOTE_LINK_ENFORCE') ?? undefined;

/** 대조에 필요한 열까지 포함해 읽는다(밖으로 나가는 것은 pick 이 다시 좁힌다). */
const READ_COLS = [...new Set([...QUOTE_COLS_VERIFY, ...QUOTE_COLS_PAY,
  'buyer_email', 'buyer_phone_normalized'])].join(',');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const v = validateInput(await req.json().catch(() => null));
    if (!v.ok) return json({ error: v.error }, v.status);

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/deal_quotes?quote_number=eq.${q(v.quoteNumber)}&select=${READ_COLS}&limit=1`,
      { headers: DB },
    );
    if (!r.ok) return json({ error: '조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
    const rows = await r.json();
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] as Record<string, unknown> : null;

    if (v.mode === 'verify') {
      const m = matchVerdict(row, v.email, v.phone);
      // 없을 때와 안 맞을 때의 문구는 원본과 같다(원본도 둘을 구분해 보여 줬다).
      if (!m.ok) return json({ error: m.error }, 404);
      return json({ quote: pick(row!, QUOTE_COLS_VERIFY) });
    }

    // ── pay 모드 — HARD-B2c 서명 토큰 ──
    //
    // 경고 모드(기본): 토큰이 없거나 틀려도 **지금처럼 열어 준다**. 이미 나간 메일의
    //   옛 링크를 끊지 않기 위해서다. 대신 무슨 일이 있었는지 로그로 센다.
    // 강제 모드(QUOTE_LINK_ENFORCE=1 + 키 설정): 거절한다.
    //
    // ⚠️ 거절 문구는 "없음"과 같게 둔다 — 번호가 맞는지 틀렸는지 알려 주지 않는다.
    const check = await verifyPayToken(v.quoteNumber, v.token, LINK_SECRET, Math.floor(Date.now() / 1000));
    if (!check.valid) {
      // 견적번호는 개인정보가 아니지만 로그에도 남기지 않는다 — 사유만 센다.
      console.warn(`[order-lookup-quote] pay 토큰 ${check.reason}`);
      if (shouldEnforce(LINK_SECRET, LINK_ENFORCE)) {
        return json({ quote: null });
      }
    }

    if (!row) return json({ quote: null });
    const quote = pick(row, QUOTE_COLS_PAY) as Record<string, unknown>;

    const needsFill = !quote.contact_email || !quote.buyer_name || !quote.contact_phone;
    if (needsFill && row.deal_id) {
      const dr = await fetch(
        `${SUPABASE_URL}/rest/v1/deals?id=eq.${q(String(row.deal_id))}` +
          `&select=${[...DEAL_CONTACT_COLS].join(',')}&limit=1`,
        { headers: DB },
      );
      const drows = dr.ok ? await dr.json() : [];
      if (Array.isArray(drows) && drows[0]) {
        quote.deal_contact = pick(drows[0] as Record<string, unknown>, DEAL_CONTACT_COLS);
      }
    }
    return json({ quote });
  } catch (e) {
    console.error('[order-lookup-quote]', e);
    return json({ error: '조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
  }
});
