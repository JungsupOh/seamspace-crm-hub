// Supabase Edge Function: partner-request (LEAD-S7-4)
//
// 파트너가 우리에게 보내는 요청을 **서버에서** 만든다.
//   · 추가 구매 요청 (잔량이 모자랄 때)
//   · 이용권 사용 불가 처리 요청 (실제 무효화가 아니다 — 쿠폰 차단 API 가 없다)
//
// 왜 포털이 직접 INSERT 하지 않고 함수를 두는가
//   ① **본문의 partner_id 를 믿지 않으려고.** 호출자 프로필에서 서버가 정한다.
//   ② 중복·폭주를 한 곳에서 막으려고(열린 요청이 있으면 새로 만들지 않는다).
//   ③ 텔레그램 알림을 서버에서 보내려고(토큰이 화면에 없어야 한다).
//
// RLS 는 그대로 두 번째 그물이다 — 정책의 with check 도 partner_id·requested_by·
// status 를 강제한다(이 함수가 service_role 이라 정책을 지나가더라도, 포털이 직접
// 넣는 경로가 생기면 거기서 막힌다).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegram } from '../_shared/telegram.ts';
import {
  RATE_LIMIT_PER_MINUTE, canRequest, errorMessage, okMessage, parseRequest,
  pickLocale, telegramText, type RequestError,
} from './logic.ts';

const CORS = {
  'Access-Control-Allow-Origin':  'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    // ── 1) 로그인 확인 ──
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization header' }, 401);
    const jwt = authHeader.replace('Bearer ', '');

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user: caller }, error: authErr } = await anon.auth.getUser(jwt);
    if (authErr || !caller) return json({ error: 'Invalid or expired token' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 2) 호출자 프로필 — **여기서 partner_id 를 정한다** ──
    const { data: profile } = await admin
      .from('user_profiles')
      .select('role, partner_id')
      .eq('id', caller.id)
      .single();

    const role: string = profile?.role ?? '';
    if (!canRequest(role)) {
      return json({ error: errorMessage('NOT_ALLOWED', 'en'), code: 'NOT_ALLOWED' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const parsed = parseRequest(body);
    if (!parsed.ok) {
      return json({ error: errorMessage(parsed.error, 'en'), code: parsed.error }, 400);
    }
    const r = parsed.value;

    // ⚠️ 본문의 partnerId 를 **쓰지 않는다.** 파트너는 자기 것, admin 은 대상에서 가져온다.
    let partnerId: string | null = profile?.partner_id ?? null;

    // ── 3) 대상이 **그 파트너의 것인지** 확인 ──
    let partnerName = '(이름 없음)';
    let locale = 'en';

    if (r.kind === 'purchase') {
      const { data: contract } = await admin
        .from('partner_contracts')
        .select('id, partner_id, status, voided_at')
        .eq('id', r.contractId!)
        .maybeSingle();
      if (!contract) return json({ error: errorMessage('NOT_YOURS', 'en'), code: 'NOT_YOURS' }, 404);
      if (partnerId && contract.partner_id !== partnerId) {
        // 남의 계약에 요청을 붙이려는 시도 — 있는지 없는지도 알려 주지 않는다.
        return json({ error: errorMessage('NOT_YOURS', 'en'), code: 'NOT_YOURS' }, 404);
      }
      partnerId = partnerId ?? contract.partner_id;
    } else {
      const { data: lic } = await admin
        .from('partner_licenses')
        .select('id, partner_id')
        .eq('id', r.licenseId!)
        .maybeSingle();
      if (!lic) return json({ error: errorMessage('NOT_YOURS', 'en'), code: 'NOT_YOURS' }, 404);
      if (partnerId && lic.partner_id !== partnerId) {
        return json({ error: errorMessage('NOT_YOURS', 'en'), code: 'NOT_YOURS' }, 404);
      }
      partnerId = partnerId ?? lic.partner_id;
    }

    if (!partnerId) return json({ error: errorMessage('NOT_YOURS', 'en'), code: 'NOT_YOURS' }, 400);

    const { data: partner } = await admin
      .from('partners').select('name, locale').eq('id', partnerId).maybeSingle();
    partnerName = partner?.name ?? partnerName;
    locale = String(partner?.locale ?? 'en');
    const L = pickLocale(locale);

    const fail = (code: RequestError, status: number) =>
      json({ error: errorMessage(code, L), code }, status);

    // ── 4) 폭주 막기 — 지난 1분에 이 계정이 보낸 요청 수 ──
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count: recent } = await admin
      .from('partner_requests')
      .select('id', { count: 'exact', head: true })
      .eq('requested_by', caller.id)
      .gte('requested_at', since);
    if ((recent ?? 0) >= RATE_LIMIT_PER_MINUTE) return fail('TOO_MANY', 429);

    // ── 5) 이미 열린 요청이 있으면 **새로 만들지 않는다** ──
    //    DB 에도 부분 유니크 인덱스가 있어 동시 요청까지 막힌다(두 겹).
    const dupQ = admin.from('partner_requests')
      .select('id', { count: 'exact', head: true })
      .eq('kind', r.kind).eq('status', 'open');
    const { count: open } = r.kind === 'purchase'
      ? await dupQ.eq('contract_id', r.contractId!)
      : await dupQ.eq('license_id', r.licenseId!);
    if ((open ?? 0) > 0) return fail('ALREADY_OPEN', 409);

    // ── 6) 넣는다 ──
    const { data: row, error: insErr } = await admin
      .from('partner_requests')
      .insert({
        kind: r.kind,
        partner_id: partnerId,
        contract_id: r.contractId,
        license_id: r.licenseId,
        seat_months: r.seatMonths,
        reason: r.reason,
        status: 'open',
        requested_by: caller.id,
      })
      .select('id')
      .single();

    if (insErr) {
      // 유니크 인덱스에 걸렸다면 그 사이 누가 먼저 보낸 것이다.
      if ((insErr.code ?? '') === '23505') return fail('ALREADY_OPEN', 409);
      console.error('[partner-request] 저장 실패', insErr.message);
      return json({ error: 'Failed to save the request.' }, 500);
    }

    // ── 7) 우리에게 알린다 — **개인정보 없이** ──
    await sendTelegram(telegramText({
      kind: r.kind,
      partnerName,
      targetId: (r.contractId ?? r.licenseId)!,
      seatMonths: r.seatMonths,
      reason: r.reason,
    }));

    return json({ ok: true, request_id: row?.id ?? null, message: okMessage(r.kind, L) });
  } catch (e) {
    console.error('[partner-request]', e);
    return json({ error: String(e) }, 500);
  }
});
