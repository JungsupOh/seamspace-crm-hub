// admin-issue-coupon 의 순수 로직 — 인증 판정 / 역할 판정 / 입력 검증.
//
// I/O 가 없다. partner-issue-license 는 이 판정들이 핸들러 안에 섞여 있어
// "JWT 없으면 401, 파트너면 403" 을 테스트로 증명할 수 없었다. 여기서는 떼어 둔다.
// 덕분에 운영 DB 도 실제 함수 호출도 없이 vitest 로 검증할 수 있다.

// ── 1) JWT 헤더 판정 (partner-issue-license:34-36 와 같은 규칙) ──

export type AuthVerdict =
  | { ok: true; jwt: string }
  | { ok: false; status: 401; error: string };

export function authVerdict(authHeader: string | null | undefined): AuthVerdict {
  const header = authHeader ?? '';
  if (!header.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing authorization header' };
  }
  const jwt = header.replace('Bearer ', '');
  // 원본은 빈 토큰을 그대로 getUser 에 넘겨 401 을 받는다. 여기서 먼저 걸러도 결과는 같다.
  if (!jwt.trim()) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
  return { ok: true, jwt };
}

// ── 2) 역할 판정 ──
// partner-issue-license 는 파트너도 통과시키지만(partner_admin 한정),
// **이 함수는 국내 관리자 전용**이라 파트너 역할을 전부 거절한다.

export const ALLOWED_ROLES = ['admin', 'sub_admin'] as const;

export type RoleVerdict =
  | { ok: true; role: string }
  | { ok: false; status: 403; error: string };

/**
 * 호출자의 역할을 정한다 — **`user_profiles.role` 만 믿는다.**
 *
 * ⚠️ 원본(partner-issue-license:55, admin-auth:52)은 프로필이 없으면
 * `caller.user_metadata?.role` 로 떨어진다. 그런데 **user_metadata 는 로그인한
 * 사용자가 스스로 고칠 수 있는 값**이다. 프로필 행이 없는 계정이 자기 메타데이터에
 * `role: 'admin'` 을 적어 넣으면 그 폴백을 타고 관리자로 통과한다.
 * 쿠폰을 만드는 관문에서 그 경로를 열어 둘 수 없어 **이 함수에서는 폴백을 뺐다.**
 *
 * 프로필이 없거나 조회에 실패하면 빈 문자열 → roleVerdict 가 403 으로 막는다
 * (fail-closed: 모르면 거절).
 */
export function resolveRole(
  profile: { role?: string | null } | null | undefined,
  _userMetadata?: Record<string, unknown> | null,
): string {
  // 두 번째 인자는 **의도적으로 쓰지 않는다.** 호출부가 실수로 넘기더라도
  // 역할 판정에 반영되지 않게 자리만 남겨 둔다(원본과 대조하기 쉽도록).
  return profile?.role ?? '';
}

export function roleVerdict(role: string | null | undefined): RoleVerdict {
  const r = (role ?? '').trim();
  if (r.startsWith('partner_')) {
    return { ok: false, status: 403, error: '관리자만 쿠폰을 발급할 수 있습니다' };
  }
  if (r !== 'admin' && r !== 'sub_admin') {
    return { ok: false, status: 403, error: 'Not allowed' };
  }
  return { ok: true, role: r };
}

// ── 3) 입력 검증 ──
// 브라우저 apiCreateCoupon(src/lib/coupons.ts:8-17)이 보내는 필드는 정확히 3개다:
//   { description, duration, user_limit }   — 전부 문자열
// **원본에는 값 상한이 없다.** duration·user_limit 에 임의 숫자를 넣어도 막지 않는다.
// 지시대로 없는 상한을 새로 만들지 않는다 — 동작이 달라지면 전환이 '같은 결과' 가 아니다.

export const ALLOWED_FIELDS = ['description', 'duration', 'user_limit'] as const;

export interface CleanCouponInput {
  description: string;
  duration: string;
  user_limit: string;
}

export type InputVerdict =
  | { ok: true; value: CleanCouponInput }
  | { ok: false; status: 400; error: string };

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  // 원본은 호출부에서 String() 으로 만들어 보낸다(예: String(duration)).
  // 숫자가 그대로 와도 같은 결과가 되도록 받아 준다.
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * 화이트리스트 검증. 모르는 필드가 섞여 오면 **거절**한다(조용히 버리지 않는다) —
 * 공개 키로 임의 필드를 밀어 넣어 create-coupon 쪽 동작을 흔드는 걸 막는다.
 */
export function validate(raw: unknown): InputVerdict {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청 본문이 올바르지 않습니다' };
  }
  const body = raw as Record<string, unknown>;

  const unknownKeys = Object.keys(body).filter(
    k => !(ALLOWED_FIELDS as readonly string[]).includes(k),
  );
  if (unknownKeys.length > 0) {
    return { ok: false, status: 400, error: `허용되지 않은 필드: ${unknownKeys.join(', ')}` };
  }

  const description = asString(body.description);
  const duration = asString(body.duration);
  const user_limit = asString(body.user_limit);

  if (description === null) return { ok: false, status: 400, error: 'description 이 필요합니다' };
  if (duration === null || !duration.trim()) return { ok: false, status: 400, error: 'duration 이 필요합니다' };
  if (user_limit === null || !user_limit.trim()) return { ok: false, status: 400, error: 'user_limit 이 필요합니다' };

  // ⚠️ 값 상한 검사 없음 — 원본에 없다(위 주석 참고).
  return { ok: true, value: { description, duration, user_limit } };
}
