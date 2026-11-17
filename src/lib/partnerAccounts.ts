// 파트너 계정 관리 — 포털·관리자 공용 (LEAD-S7-5)
//
// 읽기는 RLS 가 거른다(`user_profiles` 는 자기 것 또는 admin, `partner_audit_log` 는
// 파트너 관리자만 자기 회사 것). 쓰기는 **엣지 함수 하나**로만 간다 —
// `partner_id` 와 줄 수 있는 역할을 서버가 강제하기 때문이다.

import { authedFetch } from '@/lib/authedFetch';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const H: Record<string, string> = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export type PartnerRole = 'partner_admin' | 'partner_member' | 'partner_viewer';
export type AccountStatus = 'invite_failed' | 'invited' | 'active' | 'inactive';

export interface PartnerAccount {
  id: string;
  name: string | null;
  role: PartnerRole;
  status: AccountStatus | null;
  created_at: string | null;
}

export interface AuditRow {
  id: string;
  actor_role: string;
  action: string;
  target_user_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

async function ok(res: Response, what: string) {
  if (res.ok) return;
  const e = await res.json().catch(() => ({} as { message?: string }));
  throw new Error(e.message || `${what} (${res.status})`);
}

/**
 * 내 회사 계정 목록.
 *
 * ⚠️ **이메일을 가져오지 않는다.** 목록에는 표시 이름·역할·상태면 충분하고,
 *    이메일을 화면에 늘리지 않는 편이 낫다(설계 2-3 "개인정보 최소").
 */
export async function getPartnerAccounts(partnerId: string): Promise<PartnerAccount[]> {
  const res = await authedFetch(
    `${SUPABASE_URL}/rest/v1/user_profiles`
    + `?select=id,name,role,status,created_at`
    + `&partner_id=eq.${encodeURIComponent(partnerId)}&order=created_at.asc`,
    { headers: H },
  );
  await ok(res, '계정 조회 실패');
  return res.json();
}

export async function getPartnerAuditLog(partnerId: string, limit = 20): Promise<AuditRow[]> {
  const res = await authedFetch(
    `${SUPABASE_URL}/rest/v1/partner_audit_log`
    + `?select=id,actor_role,action,target_user_id,meta,created_at`
    + `&partner_id=eq.${encodeURIComponent(partnerId)}&order=created_at.desc&limit=${limit}`,
    { headers: H },
  );
  await ok(res, '기록 조회 실패');
  return res.json();
}

export interface AccountActionInput {
  action: 'invite' | 'deactivate' | 'reactivate' | 'changeRole';
  email?: string;
  name?: string;
  role?: PartnerRole;
  userId?: string;
  /** admin·sub_admin 만 쓴다. 파트너 관리자가 보내도 **서버가 무시한다.** */
  partnerId?: string;
}

/** 계정 작업. **엣지 함수로만** 간다 — 서버가 partner_id·역할을 강제한다. */
export async function callPartnerAccounts(
  input: AccountActionInput,
): Promise<{ ok: boolean; message?: string; code?: string; userId?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/partner-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return { ok: false, message: String(data.error ?? `Failed (${res.status})`),
             code: typeof data.code === 'string' ? data.code : undefined };
  }
  return { ok: true, userId: typeof data.user_id === 'string' ? data.user_id : undefined };
}

// ───────────────────────── 보여 주기(순수) ─────────────────────────

/** 활성 관리자 수 — 마지막 한 명이면 화면이 비활성화 버튼을 막는다. */
export function activeAdminCount(accounts: readonly PartnerAccount[]): number {
  return accounts.filter(a => a.role === 'partner_admin' && a.status !== 'inactive').length;
}

/** 이 줄의 비활성화 버튼을 막아야 하는가(서버도 막지만 미리 알려 준다). */
export function cannotDeactivate(
  target: PartnerAccount, myId: string, accounts: readonly PartnerAccount[],
): 'self' | 'last_admin' | null {
  if (target.id === myId) return 'self';
  if (target.role === 'partner_admin' && activeAdminCount(accounts) <= 1) return 'last_admin';
  return null;
}

/** 파트너 관리자가 바꿀 수 있는 역할. **관리자 부여는 우리만**이라 여기 없다. */
export const ROLE_OPTIONS: PartnerRole[] = ['partner_member', 'partner_viewer'];
