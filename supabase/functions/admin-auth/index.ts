import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  resolveCallerRole, callerVerdict, validateAssignRole, buildProfileUpdate,
  canAssignRole, canActOnTarget, validateProfileUpdates, profileUpdateVerdict,
  type TargetLookup,
} from './logic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- Verify caller JWT and admin role ---
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing authorization header' }, 401);
    }

    const jwt = authHeader.replace('Bearer ', '');
    const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser(jwt);
    if (authErr || !caller) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    // Check admin role from user_profiles
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (profileErr) {
      // 조회 실패·행 없음 — fail-closed. 틈을 만들지 않는다.
      console.warn(`[admin-auth] user_profiles 조회 실패 user=${caller.id}`);
    }

    /**
     * 대상 계정의 **현재** 역할을 서버가 직접 읽는다 (021-6e A-4).
     * 요청 본문이 알려 주는 역할은 믿지 않는다.
     * adminClient 가 이미 타입을 갖고 있으므로 클로저로 둔다.
     */
    const lookupTargetRole = async (userId: string): Promise<TargetLookup> => {
      const { data, error } = await adminClient
        .from('user_profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      if (error) return { error: true };
      if (!data) return { found: false };
      return { found: true, role: (data as { role?: string }).role ?? '' };
    };

    // ⚠️ user_metadata 로 폴백하지 않는다 — 사용자가 스스로 고칠 수 있는 값이라
    //    프로필 없는 계정이 role=admin 을 적어 넣고 통과할 수 있다 (021-6d C-2).
    const callerRole = resolveCallerRole(profile, caller.user_metadata);
    const cv = callerVerdict(callerRole);
    if (!cv.ok) return jsonResponse({ error: cv.error }, cv.status);

    // --- Parse action ---
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'listUsers': {
        const { data, error } = await adminClient.auth.admin.listUsers();
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ users: data.users });
      }

      case 'createUser': {
        const { email, password, user_metadata } = body;
        if (!email || !password) {
          return jsonResponse({ error: 'email and password are required' }, 400);
        }

        // 부여할 역할을 **먼저** 검증한다 — 계정을 만든 뒤에 거절하면 찌꺼기가 남는다.
        const meta = (user_metadata ?? {}) as Record<string, unknown>;
        const rv = validateAssignRole(meta.role);
        if (!rv.ok) return jsonResponse({ error: rv.error }, rv.status);

        // 021-6e A-1: admin·sub_admin 역할 부여는 admin 만.
        // partner_* · guest 는 sub_admin 도 그대로 줄 수 있다.
        const assign = canAssignRole(cv.role, rv.role);
        if (!assign.ok) return jsonResponse({ error: assign.error }, assign.status);

        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: meta,
        });
        if (error) return jsonResponse({ error: error.message }, 400);

        // ── 역할 부여 ──
        // 트리거(마이그레이션 20261115000000)는 이제 role='guest' 로만 행을 만든다.
        // 실제 권한은 여기서 준다 — 호출자가 admin·sub_admin 임을 이미 확인한 뒤다.
        const newUserId = data.user?.id;
        if (newUserId) {
          const { error: profErr } = await adminClient
            .from('user_profiles')
            .update(buildProfileUpdate({
              role: rv.role,
              partnerId: meta.partner_id,
              name: meta.name,
            }))
            .eq('id', newUserId);

          if (profErr) {
            // 계정은 만들어졌지만 역할이 들어가지 않았다 = 'guest' 로 남아 있다.
            // guest 는 아무 권한이 없으므로 **위험하지는 않다**(fail-closed).
            // 계정을 지우지 않는 이유는 021-6d C-4 참고 — 호출부가 재시도로
            // 수습할 수 있고, 삭제는 그 자체로 실패할 수 있는 파괴적 동작이다.
            console.error(`[admin-auth] 프로필 역할 부여 실패 user=${newUserId}`, profErr);
            return jsonResponse({
              error: '계정은 생성됐지만 역할 부여에 실패했습니다. ' +
                     '해당 계정은 권한 없음(guest) 상태입니다. 사용자 화면에서 역할을 지정하거나 삭제해 주세요.',
              user: data.user,
              roleAssigned: false,
            }, 500);
          }
        }

        return jsonResponse({ user: data.user, roleAssigned: true });
      }

      case 'deleteUser': {
        const { userId } = body;
        if (!userId) return jsonResponse({ error: 'userId is required' }, 400);

        // 021-6e A-3: 관리자급 계정 삭제는 admin 만 (계정 탈취·서비스 거부 방지)
        const del = canActOnTarget(cv.role, await lookupTargetRole(userId));
        if (!del.ok) return jsonResponse({ error: del.error }, del.status);

        const { error } = await adminClient.auth.admin.deleteUser(userId);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ success: true });
      }

      case 'updateUser': {
        const { userId, password } = body;
        if (!userId) return jsonResponse({ error: 'userId is required' }, 400);

        // 021-6e A-3: 관리자급 계정의 비밀번호 변경은 admin 만.
        // 그대로 두면 sub_admin 이 admin 비밀번호를 바꿔 계정을 가져갈 수 있다.
        const upd = canActOnTarget(cv.role, await lookupTargetRole(userId));
        if (!upd.ok) return jsonResponse({ error: upd.error }, upd.status);

        const updates: Record<string, unknown> = {};
        if (password) updates.password = password;
        const { data, error } = await adminClient.auth.admin.updateUserById(userId, updates);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ user: data.user });
      }

      case 'updateProfile': {
        const { userId, updates } = body;
        if (!userId || !updates) {
          return jsonResponse({ error: 'userId and updates are required' }, 400);
        }

        // 021-6e A-2: 지금까지는 updates 를 검증 없이 그대로 적용했다.
        // 허용 필드·허용 값으로 제한한다.
        const uv = validateProfileUpdates(updates);
        if (!uv.ok) return jsonResponse({ error: uv.error }, uv.status);

        // 대상의 현재 역할은 서버가 읽는다 (A-4)
        const pv = profileUpdateVerdict({
          callerRole: cv.role,
          callerId: caller.id,
          targetId: String(userId),
          target: await lookupTargetRole(String(userId)),
          updates: uv.value,
        });
        if (!pv.ok) return jsonResponse({ error: pv.error }, pv.status);

        const { error } = await adminClient
          .from('user_profiles')
          .update(uv.value)
          .eq('id', userId);
        if (error) return jsonResponse({ error: error.message }, 400);
        return jsonResponse({ success: true });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
