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

// ════════════════════════════════════════════════════
// 021-6e — sub_admin 권한 제한
// ════════════════════════════════════════════════════
//
// James 결정(2026-11-15): **admin·sub_admin 역할을 주거나 바꾸는 일은 admin 만.**
// sub_admin 은 파트너 계정 생성·수정 등 일반 업무는 그대로 할 수 있어야 한다.
// 근거: 021-6d C-3 (sub_admin 이 admin 계정을 만들거나 자기를 admin 으로 올릴 수 있었다)

/** 관리자급 역할 — 이 역할을 **주거나, 가진 계정을 건드리는** 일은 admin 전용이다. */
export const ADMIN_LEVEL_ROLES = ['admin', 'sub_admin'] as const;

export function isAdminLevel(role: string | null | undefined): boolean {
  return (ADMIN_LEVEL_ROLES as readonly string[]).includes((role ?? '').trim());
}

export type PermVerdict =
  | { ok: true }
  | { ok: false; status: 403; error: string };

const DENY_ASSIGN: PermVerdict = {
  ok: false, status: 403,
  error: '관리자(admin) 역할만 admin·sub_admin 권한을 부여할 수 있습니다',
};
const DENY_TARGET: PermVerdict = {
  ok: false, status: 403,
  error: '관리자(admin) 역할만 admin·sub_admin 계정을 변경할 수 있습니다',
};
const DENY_SELF: PermVerdict = {
  ok: false, status: 403,
  error: '자기 자신의 역할은 변경할 수 없습니다',
};
const DENY_UNKNOWN: PermVerdict = {
  ok: false, status: 403,
  error: '대상 계정의 현재 역할을 확인할 수 없어 거절했습니다',
};

/**
 * (A-1) createUser — 부여하려는 역할을 줄 수 있는가.
 * `partner_*`·`guest` 는 sub_admin 도 줄 수 있고, 관리자급은 admin 만.
 */
export function canAssignRole(callerRole: string, targetRole: string): PermVerdict {
  if (isAdminLevel(targetRole) && callerRole !== 'admin') return DENY_ASSIGN;
  return { ok: true };
}

/**
 * 대상 계정의 현재 역할 조회 결과.
 * - `{ found: true, role }`  정상
 * - `{ found: false }`       프로필 행 없음
 * - `{ error: true }`        조회 실패 (A-4: 거절)
 */
export type TargetLookup =
  | { error: true }
  | { found: false }
  | { found: true; role: string };

/**
 * (A-3) updateUser · deleteUser — 이 대상에 손댈 수 있는가.
 *
 * sub_admin 이 admin 계정의 비밀번호를 바꾸거나 삭제할 수 있으면 **계정 탈취 경로**다.
 * 그래서 대상이 관리자급이면 admin 만 허용한다.
 *
 * 프로필 행이 없는 대상(`found:false`)은 **admin 만** 진행할 수 있다 —
 * sub_admin 입장에서는 "관리자급이 아님" 을 확인할 수 없기 때문이다(fail-closed).
 * 조회 자체가 실패하면 누구든 거절한다.
 */
export function canActOnTarget(callerRole: string, target: TargetLookup): PermVerdict {
  if ('error' in target) return DENY_UNKNOWN;
  if (callerRole === 'admin') return { ok: true };
  if (!target.found) return DENY_UNKNOWN;
  if (isAdminLevel(target.role)) return DENY_TARGET;
  return { ok: true };
}

// ── (A-2) updateProfile 허용 필드 ──
//
// 목록 근거 — **실제 호출부가 보내는 필드만** (021-6e A-2):
//   src/pages/Partners.tsx:482-488  role · partner_id · name · status · is_first_login
//   src/pages/Partners.tsx:516      role
//   (Users.tsx 는 updateProfile 을 쓰지 않는다 — 브라우저에서 직접 upsert. 021-6e C 참고)
export const PROFILE_UPDATE_FIELDS = [
  'role', 'partner_id', 'name', 'status', 'is_first_login',
] as const;

// user_profiles.status CHECK 제약 (009-10)
const STATUS_VALUES = ['invite_failed', 'invited', 'active', 'inactive'];
const UUID_RE2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UpdatesVerdict =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400; error: string };

/** 허용 필드만 남기고 값도 검사한다. 모르는 필드가 오면 **거절**(조용히 버리지 않는다). */
export function validateProfileUpdates(updates: unknown): UpdatesVerdict {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return { ok: false, status: 400, error: 'updates 가 올바르지 않습니다' };
  }
  const body = updates as Record<string, unknown>;

  const unknown = Object.keys(body).filter(
    k => !(PROFILE_UPDATE_FIELDS as readonly string[]).includes(k),
  );
  if (unknown.length > 0) {
    return { ok: false, status: 400, error: `허용되지 않은 필드: ${unknown.join(', ')}` };
  }
  if (Object.keys(body).length === 0) {
    return { ok: false, status: 400, error: '변경할 내용이 없습니다' };
  }

  const out: Record<string, unknown> = {};

  if ('role' in body) {
    const rv = validateAssignRole(body.role);
    if (!rv.ok) return { ok: false, status: 400, error: rv.error };
    if (body.role === undefined || body.role === null || body.role === '') {
      return { ok: false, status: 400, error: 'role 값이 비어 있습니다' };
    }
    out.role = rv.role;
  }
  if ('partner_id' in body) {
    const v = body.partner_id;
    if (v === null) out.partner_id = null;                       // 연결 해제는 허용
    else if (typeof v === 'string' && UUID_RE2.test(v.trim())) out.partner_id = v.trim();
    else return { ok: false, status: 400, error: 'partner_id 형식이 올바르지 않습니다' };
  }
  if ('name' in body) {
    const v = body.name;
    if (v === null) out.name = null;
    else if (typeof v === 'string') out.name = v.trim().slice(0, 100);
    else return { ok: false, status: 400, error: 'name 형식이 올바르지 않습니다' };
  }
  if ('status' in body) {
    const v = body.status;
    if (typeof v !== 'string' || !STATUS_VALUES.includes(v)) {
      return { ok: false, status: 400, error: `허용되지 않은 status: ${String(v)}` };
    }
    out.status = v;
  }
  if ('is_first_login' in body) {
    if (typeof body.is_first_login !== 'boolean') {
      return { ok: false, status: 400, error: 'is_first_login 형식이 올바르지 않습니다' };
    }
    out.is_first_login = body.is_first_login;
  }

  return { ok: true, value: out };
}

/**
 * (A-2) updateProfile 권한 판정.
 *
 * 규칙
 *   1) 대상이 관리자급이면 admin 만 (= canActOnTarget)
 *   2) role 을 관리자급으로 바꾸려면 admin 만
 *   3) sub_admin 은 **자기 자신의 role 을 바꿀 수 없다** (승격·강등 모두)
 */
export function profileUpdateVerdict(params: {
  callerRole: string;
  callerId: string;
  targetId: string;
  target: TargetLookup;
  updates: Record<string, unknown>;
}): PermVerdict {
  const { callerRole, callerId, targetId, target, updates } = params;

  const onTarget = canActOnTarget(callerRole, target);
  if (!onTarget.ok) return onTarget;

  if ('role' in updates) {
    if (callerRole !== 'admin' && callerId === targetId) return DENY_SELF;
    const assign = canAssignRole(callerRole, String(updates.role));
    if (!assign.ok) return assign;
  }
  return { ok: true };
}
