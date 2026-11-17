// Supabase Edge Function: partner-accounts (LEAD-S7-5)
//
// 파트너 관리자가 **자기 회사 직원**을 초대·비활성화·재활성화하고 역할을 바꾼다.
//
// `admin-auth` 를 늘리지 않은 이유는 `logic.ts` 머리에 적었다 —
// 그 함수의 "admin·sub_admin 만" 이라는 한 줄이 가장 위험한 자리이고,
// 요구사항도 기존 동작을 바꾸지 말라고 했다.
//
// 지키는 것
//   · `partner_id` 는 **호출자 프로필에서 서버가 정한다**(파트너 관리자는 본문 무시).
//   · 대상이 **같은 파트너**인지 서버가 확인한다. 아니면 있는지 없는지도 알려 주지 않는다.
//   · 파트너 관리자가 줄 수 있는 역할은 `partner_member`·`partner_viewer` **뿐**.
//   · 자기 자신·마지막 `partner_admin` 은 비활성화하지 못한다.
//   · **임시 비밀번호를 응답·로그에 담지 않는다.**
//   · 모든 사건을 `partner_audit_log` 에 남긴다(이메일은 마스킹).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  type AccountAction, type Caller, type Denial,
  alreadyInState, auditEntry, canActOnTarget, canUseAccounts, denialMessage,
  isOurAdmin, pickLocale, resolvePartnerId, toAction, validateEmail, validateRole,
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

/** 임시 비밀번호. **응답에도 로그에도 넣지 않는다** — 재설정 메일로만 들어간다. */
function tempPassword(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(36)).join('').slice(0, 24) + 'Aa1!';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization header' }, 401);
    const jwt = authHeader.replace('Bearer ', '');

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user: me }, error: authErr } = await anon.auth.getUser(jwt);
    if (authErr || !me) return json({ error: 'Invalid or expired token' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile } = await admin
      .from('user_profiles').select('role, partner_id').eq('id', me.id).single();

    const caller: Caller = {
      role: String(profile?.role ?? ''),
      partnerId: (profile?.partner_id as string | null) ?? null,
      id: me.id,
    };

    if (!canUseAccounts(caller.role)) {
      return json({ error: denialMessage('NOT_ALLOWED', 'en'), code: 'NOT_ALLOWED' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action: AccountAction | null = toAction(body.action);

    // 파트너 언어로 답한다
    const partnerId = resolvePartnerId(caller, body.partnerId);
    let locale = 'en';
    if (partnerId) {
      const { data: p } = await admin
        .from('partners').select('locale').eq('id', partnerId).maybeSingle();
      locale = String(p?.locale ?? 'en');
    }
    const L = pickLocale(locale);
    const deny = (code: Denial, status: number) =>
      json({ error: denialMessage(code, L), code }, status);

    if (!action) return deny('BAD_ACTION', 400);
    if (!partnerId) return deny('PARTNER_REQUIRED', 400);

    // 같은 파트너의 활성 관리자 수 — 마지막 한 명을 지키려고 센다.
    const { count: adminCount } = await admin
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partnerId)
      .eq('role', 'partner_admin')
      .neq('status', 'inactive');

    // ── 초대 ──
    if (action === 'invite') {
      const ev = validateEmail(body.email);
      if (!ev.ok) return deny(ev.error, 400);
      const rv = validateRole(caller, body.role);
      if (!rv.ok) return deny(rv.error, 400);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: ev.email,
        password: tempPassword(),      // 응답에 담지 않는다
        email_confirm: true,
        user_metadata: { name: typeof body.name === 'string' ? body.name.slice(0, 80) : '' },
      });
      if (cErr || !created.user) {
        // 이메일이 이미 있으면 여기로 온다. **왜인지 자세히 알려 주지 않는다**
        // (계정이 있는지 없는지를 떠보는 통로가 된다).
        console.warn('[partner-accounts] 초대 실패');
        await admin.from('partner_audit_log').insert(auditEntry({
          caller, partnerId, action: 'invite_failed', email: ev.email, role: rv.role,
        }));
        return json({ error: denialMessage('BAD_EMAIL', L), code: 'INVITE_FAILED' }, 400);
      }

      const newId = created.user.id;
      const { error: pErr } = await admin.from('user_profiles').update({
        role: rv.role, partner_id: partnerId, status: 'invited',
        name: typeof body.name === 'string' ? body.name.slice(0, 80) : null,
        created_by: caller.id,
      }).eq('id', newId);

      if (pErr) {
        // 계정은 생겼지만 역할이 없다 = guest. 권한이 없으므로 위험하지 않다(fail-closed).
        console.error('[partner-accounts] 프로필 부여 실패');
        return json({ error: 'Account created but the role could not be set. Please contact us.' }, 500);
      }

      await admin.from('partner_audit_log').insert(auditEntry({
        caller, partnerId, action: 'invite', targetUserId: newId,
        email: ev.email, role: rv.role,
      }));

      // ⚠️ 비밀번호를 돌려주지 않는다. 사용자는 **비밀번호 재설정**으로 들어온다.
      return json({ ok: true, user_id: newId, role: rv.role });
    }

    // ── 그 밖(비활성화·재활성화·역할 변경)은 대상이 필요하다 ──
    const targetId = typeof body.userId === 'string' && body.userId ? body.userId : null;
    if (!targetId) return deny('TARGET_REQUIRED', 400);

    const { data: target } = await admin
      .from('user_profiles')
      .select('id, role, partner_id, status')
      .eq('id', targetId)
      .maybeSingle();

    const verdict = canActOnTarget(caller, partnerId, target ?? null, action, adminCount ?? 0);
    if (!verdict.ok) {
      return deny(verdict.error, verdict.error === 'TARGET_OTHER_PARTNER' ? 404 : 400);
    }
    const t = target!;

    if (action === 'changeRole') {
      const rv = validateRole(caller, body.role);
      if (!rv.ok) return deny(rv.error, 400);
      if (rv.role === t.role) return deny('ALREADY', 400);

      const { error } = await admin.from('user_profiles')
        .update({ role: rv.role }).eq('id', targetId).eq('partner_id', partnerId);
      if (error) return json({ error: 'Could not change the role.' }, 500);

      await admin.from('partner_audit_log').insert(auditEntry({
        caller, partnerId, action: 'role_change', targetUserId: targetId,
        role: rv.role, from: t.role,
      }));
      return json({ ok: true, role: rv.role });
    }

    if (alreadyInState(t, action)) return deny('ALREADY', 400);

    const nextStatus = action === 'deactivate' ? 'inactive' : 'active';
    const { error } = await admin.from('user_profiles')
      .update({ status: nextStatus }).eq('id', targetId).eq('partner_id', partnerId);
    if (error) return json({ error: 'Could not change the account status.' }, 500);

    await admin.from('partner_audit_log').insert(auditEntry({
      caller, partnerId, action, targetUserId: targetId, from: t.status,
    }));
    return json({ ok: true, status: nextStatus });
  } catch (e) {
    console.error('[partner-accounts]', e);
    return json({ error: String(e) }, 500);
  }
});
