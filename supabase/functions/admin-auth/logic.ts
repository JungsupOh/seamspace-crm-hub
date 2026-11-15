// admin-auth 의 순수 로직 — 호출자 역할 판정 / 부여 가능 역할 검증 / 프로필 UPDATE 구성.
//
// I/O 가 없다. 덕분에 "프로필 없는 계정이 user_metadata 로 관리자가 될 수 있는가" 같은
// 판정을 운영 DB 없이 vitest 로 증명할 수 있다 (021-6b 와 같은 방식).

// ── 1) 호출자 역할 판정 (021-6b 와 같은 규칙) ──

/**
 * 호출자의 역할 — **`user_profiles.role` 만 믿는다.**
 *
 * ⚠️ 바뀐 점: 이전 admin-auth:52 는 `profile?.role ?? caller.user_metadata?.role` 이었다.
 * `user_metadata` 는 로그인한 사용자가 `supabase.auth.updateUser()` 로 스스로 고칠 수
 * 있는 값이라, 프로필 행이 없는 계정이 거기에 role='admin' 을 적으면 통과했다.
 * admin-auth 는 **계정을 만들고 역할을 주는 함수**라 이 경로가 가장 위험하다.
 *
 * 프로필이 없거나 조회에 실패하면 빈 문자열 → 아래 callerVerdict 가 403 으로 막는다.
 */
export function resolveCallerRole(
  profile: { role?: string | null } | null | undefined,
  _userMetadata?: Record<string, unknown> | null,
): string {
  // 두 번째 인자는 의도적으로 쓰지 않는다 (원본과 대조하기 쉽도록 자리만 남김).
  return profile?.role ?? '';
}

export const ADMIN_ROLES = ['admin', 'sub_admin'] as const;

export type CallerVerdict =
  | { ok: true; role: string }
  | { ok: false; status: 403; error: string };

/** admin-auth:53 과 같은 조건 — admin / sub_admin 만. */
export function callerVerdict(role: string | null | undefined): CallerVerdict {
  const r = (role ?? '').trim();
  if (r !== 'admin' && r !== 'sub_admin') {
    return { ok: false, status: 403, error: 'Admin access required' };
  }
  return { ok: true, role: r };
}

// ── 2) 부여 가능한 역할 ──
//
// 목록 근거 — **실제 호출부에서 쓰는 값만** 모았다 (021-6d C-1):
//   src/pages/Users.tsx:576-578     <SelectItem value="admin|sub_admin|guest">
//   src/pages/Partners.tsx:444      partnerRole: 'partner_admin'|'partner_member'|'partner_viewer'
// 공교롭게 user_profiles 의 CHECK 제약 6값과 정확히 같다
//   (supabase/add_user_roles.sql:16). DB 가 거르지 못하는 오타만 추가로 막는 셈이다.

export const ASSIGNABLE_ROLES = [
  'admin', 'sub_admin', 'guest',
  'partner_admin', 'partner_member', 'partner_viewer',
] as const;

export type AssignableRole = typeof ASSIGNABLE_ROLES[number];

export type RoleAssignVerdict =
  | { ok: true; role: AssignableRole }
  | { ok: false; status: 400; error: string };

/**
 * 생성할 계정에 줄 역할을 검증한다.
 *
 * ⚠️ **"누가 어떤 역할을 줄 수 있는가" 는 제한하지 않는다.** 지금 동작이 그렇기 때문이다
 * (admin-auth:53 은 호출자가 admin·sub_admin 이면 그 뒤를 막지 않는다).
 * 즉 sub_admin 이 admin 계정을 만들 수 있다. 021-6d C-3 에 사실로 적었고,
 * 바꿀지는 James 판단 사항이라 이번 단위에서 **동작을 바꾸지 않았다.**
 */
export function validateAssignRole(role: unknown): RoleAssignVerdict {
  if (role === undefined || role === null || role === '') {
    // 역할을 안 주면 트리거가 넣은 'guest' 로 남는다 — 거절하지 않는다.
    return { ok: true, role: 'guest' };
  }
  if (typeof role !== 'string') {
    return { ok: false, status: 400, error: 'role 형식이 올바르지 않습니다' };
  }
  const r = role.trim();
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(r)) {
    return { ok: false, status: 400, error: `허용되지 않은 role: ${r}` };
  }
  return { ok: true, role: r as AssignableRole };
}

// ── 3) 생성 직후 프로필 UPDATE 본문 ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * createUser 직후 user_profiles 에 적용할 값.
 *
 * 트리거는 이제 role='guest' / partner_id=NULL 로만 행을 만든다(마이그레이션
 * 20261115000000). 실제 권한은 **여기서** 정해진다 — 호출자가 admin·sub_admin 임을
 * 이미 확인한 뒤다.
 *
 * `name` 은 비어 있으면 넣지 않는다(트리거가 넣은 값을 지우지 않도록).
 */
export function buildProfileUpdate(params: {
  role: AssignableRole;
  partnerId?: unknown;
  name?: unknown;
}): Record<string, unknown> {
  const out: Record<string, unknown> = { role: params.role };

  const pid = typeof params.partnerId === 'string' ? params.partnerId.trim() : '';
  if (pid && UUID_RE.test(pid)) out.partner_id = pid;

  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (name) out.name = name;

  return out;
}
