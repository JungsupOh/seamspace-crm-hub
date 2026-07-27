// Supabase Edge Function: partner-revoke-license
// 파트너가 발급한 이용권을 회수한다. mDiary 자격증명이 필요하므로 서버에서 처리.
//
// action='revoke' (미사용 쿠폰 회수):
//   mDiary coupon_revoke 호출.
//   - 200 → 원장 status='revoked', 결과 revoked
//   - 409 (사용 중) → 상태 불변, 결과 in_use + 그룹명 반환 (클라이언트가 그룹 만료로 에스컬레이션)
//   - 404 → not_found
// action='expire' (사용 중 → 그룹 만료):
//   mDiary group_set_expire(groupId, expireDate) 호출 → 원장 status='expired'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const MDIARY_BASE      = 'https://diaryapi.seamspace.me';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function mdiaryLogin(): Promise<string> {
  const r = await fetch(`${MDIARY_BASE}/mDiary_app/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: Deno.env.get('MDIARY_USERNAME')!,
      password: Deno.env.get('MDIARY_PASSWORD')!,
    }).toString(),
    redirect: 'manual',
  });
  const m = (r.headers.get('set-cookie') ?? '').match(/ss_access_token=([^;]+)/);
  if (!m) throw new Error(`mDiary 로그인 실패 (${r.status})`);
  return m[1];
}

async function mdiaryCall(path: string, token: string, params: Record<string, string>) {
  const r = await fetch(`${MDIARY_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` },
    body: new URLSearchParams(params).toString(),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    // ── JWT 검증 + 권한 (partner_admin 또는 admin/sub_admin) ──
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization header' }, 401);
    const jwt = authHeader.replace('Bearer ', '');

    const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: { user: caller }, error: authErr } = await anon.auth.getUser(jwt);
    if (authErr || !caller) return json({ error: 'Invalid or expired token' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile } = await admin.from('user_profiles').select('role, partner_id').eq('id', caller.id).single();
    const role: string = profile?.role ?? '';
    const isPartner = role.startsWith('partner_');
    if (!isPartner && role !== 'admin' && role !== 'sub_admin') return json({ error: 'Not allowed' }, 403);
    if (isPartner && role !== 'partner_admin') return json({ error: '이용권 회수 권한이 없습니다 (관리자 역할 필요)' }, 403);

    const body = await req.json();
    const { licenseId, action } = body as { licenseId?: string; action?: string };
    if (!licenseId) return json({ error: 'licenseId가 필요합니다' }, 400);

    // 원장 조회 + 소유 검증 (파트너는 자기 파트너 것만)
    const { data: lic } = await admin
      .from('partner_licenses')
      .select('id, partner_id, coupon_code, org_name, contact_name')
      .eq('id', licenseId).single();
    if (!lic) return json({ error: '이용권을 찾을 수 없습니다' }, 404);
    if (isPartner && lic.partner_id !== profile?.partner_id) return json({ error: 'Not allowed' }, 403);

    const token = await mdiaryLogin();

    if (action === 'expire') {
      // 사용 중 그룹 만료
      const { groupId, expireDate, reason } = body as { groupId?: string; expireDate?: string; reason?: string };
      if (!groupId || !expireDate) return json({ error: 'groupId와 expireDate가 필요합니다' }, 400);
      const { status, data } = await mdiaryCall('/mDiary_app/group_set_expire/', token, {
        group_id: String(groupId), service_expire_at: expireDate, reason: reason ?? 'CRM 회수 — 그룹 만료',
      });
      if (status !== 200 || !data.success) {
        return json({ error: `그룹 만료 실패: ${data.error ?? status}`, detail: data }, 502);
      }
      await admin.from('partner_licenses').update({
        status: 'expired',
        revoked_at: new Date().toISOString(),
        revoked_by: caller.id,
        revoke_reason: `그룹 만료(${data.group_name ?? groupId})${reason ? ' · ' + reason : ''}`,
      }).eq('id', licenseId);
      return json({ result: 'expired', group_name: data.group_name, service_expire_at: data.service_expire_at });
    }

    // action='revoke' (기본): 미사용 쿠폰 회수
    const { reason } = body as { reason?: string };
    const { status, data } = await mdiaryCall('/mDiary_app/coupon_revoke/', token, {
      coupon_code: lic.coupon_code, reason: reason ?? 'CRM 회수',
    });

    if (status === 200 && data.success) {
      await admin.from('partner_licenses').update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_by: caller.id,
        revoke_reason: reason ?? null,
      }).eq('id', licenseId);
      return json({ result: 'revoked' });
    }
    if (status === 409) {
      // 사용 중 — 회수하려면 그룹을 만료시켜야 함. 그룹명 반환.
      return json({ result: 'in_use', used_group: data.used_group ?? null });
    }
    if (status === 404) return json({ result: 'not_found' });
    return json({ error: `쿠폰 회수 실패: ${data.error ?? status}`, detail: data }, 502);
  } catch (e) {
    console.error('[partner-revoke-license]', e);
    return json({ error: String(e) }, 500);
  }
});
