// Supabase Edge Function: partner-lead (LEAD-S7-7a)
//
// 파트너가 직접 넣는 리드. **파트너는 `campaign_leads` 를 직접 읽지 못한다** —
// 정책은 지금도 admin 전용 하나뿐이고 바꾸지 않았다. 모든 길이 이 함수를 지난다.
//
// 이 함수가 하는 일은 결국 **칸을 고르는 일**이다.
//   `campaign_leads` 는 46칸이고 그중 파트너가 봐도 되는 것은 12칸뿐이다.
//   그래서 **허용 목록**으로만 고르고(`selectClause()`), 받은 행을 한 번 더
//   거른다(`pickForRole()`). 두 겹인 이유는 한쪽을 고치면 다른 쪽 시험이
//   잡게 하려는 것이다.
//
// 등록은 **막지 않는다**(설계 3-3). 중복이면 상대를 밝히지 않는 안내를 주고,
// 우리에게 텔레그램으로 알린다(개인정보 없이 건수만).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegram } from '../_shared/telegram.ts';
import {
  alertText, canCreateLead, canRecordContact, canSeeDetail, canUseLeads,
  contactUpdate, denialMessage,
  duplicateMessage, findDuplicates, overRateLimit, pickForRole, pickLocale,
  protectionDaysLeft, resolvePartnerId, selectClause, toLeadRow, validateLead,
  type Caller,
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
    const { data: { user: authUser }, error: authErr } = await anon.auth.getUser(jwt);
    if (authErr || !authUser) return json({ error: 'Invalid or expired token' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 2) 호출자 프로필 — **여기서 partner_id 를 정한다** ──
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id, role, partner_id, status')
      .eq('id', authUser.id)
      .maybeSingle();

    const caller: Caller = {
      id: authUser.id,
      role: (profile?.role as string) ?? '',
      partnerId: (profile?.partner_id as string | null) ?? null,
    };

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';

    // 파트너의 언어로 답한다
    let locale = 'en';
    let partnerName = '';
    let partnerCountry: string | null = null;
    if (caller.partnerId) {
      const { data: p } = await admin
        .from('partners').select('locale, name, country')
        .eq('id', caller.partnerId).maybeSingle();
      locale = pickLocale(p?.locale);
      partnerName = (p?.name as string) ?? '';
      partnerCountry = (p?.country as string | null) ?? null;
    }

    const deny = (code: string, status = 403) =>
      json({ error: code, message: denialMessage(code, locale) }, status);

    if (profile?.status === 'inactive') return deny('NOT_ALLOWED');
    if (!canUseLeads(caller.role)) return deny('NOT_ALLOWED');

    const partnerId = resolvePartnerId(caller, body.partnerId);
    if (!partnerId) return deny('PARTNER_REQUIRED');

    // ── 3) 내 리드 목록 ──
    if (action === 'list') {
      const { data, error } = await admin
        .from('campaign_leads')
        .select(selectClause())          // **허용 칸만**
        .eq('partner_id', partnerId)
        .order('partner_claimed_at', { ascending: false })
        .limit(200);
      if (error) return json({ error: 'LIST_FAILED' }, 500);

      const now = new Date();
      const rows = (data ?? []).map(r => {
        const picked = pickForRole(r as unknown as Record<string, unknown>, caller.role);
        return {
          ...picked,
          // 보호 기간은 **저장하지 않고 계산해서** 준다
          protection_days_left: protectionDaysLeft(
            (r as unknown as Record<string, unknown>).partner_claimed_at,
            (r as unknown as Record<string, unknown>).last_contact_at, now),
        };
      });
      return json({ ok: true, leads: rows, count: rows.length });
    }

    // ── 4) 상세 — **보기 전용 계정은 거절** ──
    if (action === 'detail') {
      if (!canSeeDetail(caller.role)) return deny('VIEWER_NO_DETAIL');
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return deny('NOT_FOUND', 404);

      const { data } = await admin
        .from('campaign_leads')
        .select(selectClause())
        .eq('id', id)
        .eq('partner_id', partnerId)     // **남의 리드는 애초에 안 나온다**
        .maybeSingle();
      // 없는 것과 **같은 답** — 떠보기를 막는다
      if (!data) return deny('NOT_FOUND', 404);

      const row = data as unknown as Record<string, unknown>;
      return json({
        ok: true,
        lead: {
          ...pickForRole(row, caller.role),
          protection_days_left: protectionDaysLeft(
            row.partner_claimed_at, row.last_contact_at, new Date()),
        },
      });
    }

    // ── 5) 접촉 기록 (fix1) ──
    if (action === 'contact') {
      if (!canRecordContact(caller.role)) return deny('NOT_ALLOWED');
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) return deny('NOT_FOUND', 404);

      // 분당 횟수 제한 — 기록도 쓰기다
      const since60 = new Date(Date.now() - 60_000).toISOString();
      const { count: recentC } = await admin
        .from('campaign_leads')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .gte('last_contact_at', since60);
      if (overRateLimit(recentC ?? 0)) return deny('RATE_LIMIT', 429);

      // **자기 파트너가 등록한 리드만.** 남의 리드도 우리 리드도 없는 것과 같은 답.
      const nowIso = new Date().toISOString();
      const { data: updated, error: upErr } = await admin
        .from('campaign_leads')
        .update(contactUpdate(nowIso))   // **갱신하는 칸은 last_contact_at 하나뿐**
        .eq('id', id)
        .eq('partner_id', partnerId)
        .select(selectClause())
        .maybeSingle();
      if (upErr) {
        console.error('[partner-lead] contact failed', upErr.code);
        return json({ error: 'CONTACT_FAILED' }, 500);
      }
      if (!updated) return deny('NOT_FOUND', 404);

      const row = updated as unknown as Record<string, unknown>;
      return json({
        ok: true,
        message: denialMessage('CONTACT_RECORDED', locale),
        lead: pickForRole(row, caller.role),
        protection_days_left: protectionDaysLeft(
          row.partner_claimed_at, row.last_contact_at, new Date()),
      });
    }

    // ── 6) 등록 ──
    if (action === 'create') {
      if (!canCreateLead(caller.role)) return deny('NOT_ALLOWED');

      const v = validateLead(body);
      if (!v.ok || !v.value) {
        return json({ error: v.error, field: v.field,
                      message: denialMessage(v.error ?? '', locale) }, 400);
      }

      // 분당 횟수 제한
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count: recent } = await admin
        .from('campaign_leads')
        .select('id', { count: 'exact', head: true })
        .eq('partner_id', partnerId)
        .gte('partner_claimed_at', since);
      if (overRateLimit(recent ?? 0)) return deny('RATE_LIMIT', 429);

      // 중복을 **먼저 본다**(막지는 않는다)
      const emailNorm = v.value.email;   // validateLead 가 이미 소문자로 맞췄다
      const { data: existing } = await admin
        .from('campaign_leads')
        .select('id, email_normalized, school_name, partner_id, partner_claimed_at, last_contact_at')
        .or(`email_normalized.eq.${emailNorm},school_name.ilike.${v.value.schoolName}`)
        .limit(50);

      const now = new Date();
      const verdict = findDuplicates(
        { email: v.value.email, schoolName: v.value.schoolName },
        (existing ?? []) as never, partnerId, now);

      const { data: inserted, error: insErr } = await admin
        .from('campaign_leads')
        .insert(toLeadRow(v.value, caller, partnerId, now.toISOString()))
        .select(selectClause())
        .single();
      if (insErr) {
        console.error('[partner-lead] insert failed', insErr.code);
        return json({ error: 'CREATE_FAILED' }, 500);
      }

      // 겹쳤으면 우리에게 알린다 — **개인정보 없이 건수만**
      if (verdict.hits.length > 0) {
        await sendTelegram(alertText({
          partnerName,
          country: partnerCountry,
          hits: verdict.hits,
        })).catch(() => { /* 알림 실패가 등록을 막지 않는다 */ });
      }

      return json({
        ok: true,
        lead: pickForRole(inserted as unknown as Record<string, unknown>, caller.role),
        // **상대를 식별할 수 있는 것은 아무것도 담지 않는다**
        notice: verdict.notice,
        message: duplicateMessage(verdict.notice, locale),
      });
    }

    return json({ error: 'BAD_ACTION' }, 400);
  } catch (e) {
    console.error('[partner-lead] unexpected', (e as Error).message);
    return json({ error: 'Internal error' }, 500);
  }
});
