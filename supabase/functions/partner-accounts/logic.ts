// 파트너 계정 초대·비활성화의 **순수 부분** (LEAD-S7-5)
//
// 판정과 문구만 여기 둔다 — vitest 로 돌려 보려고.
//
// ⚠️ 왜 `admin-auth` 를 늘리지 않고 새 함수를 만들었나
//   `admin-auth` 는 맨 위에서 `callerVerdict(role)` 로 **admin·sub_admin 만** 통과시킨다.
//   파트너 관리자를 들여보내려면 **그 한 줄을 느슨하게** 해야 하는데, 그 줄은 그 함수에서
//   가장 위험한 자리다(`createUser` 가 아무 역할이나 줄 수 있다). 요구사항도
//   "기존 admin-auth 의 기존 동작 변경 금지(추가만)"라고 했다.
//   문을 하나 더 내는 대신 **문이 작은 집을 따로 짓는다**: 이 함수는 애초에
//   `partner_member`·`partner_viewer` 말고는 줄 수 없다.

export const PARTNER_ASSIGNABLE = ['partner_member', 'partner_viewer'] as const;
export type PartnerAssignable = (typeof PARTNER_ASSIGNABLE)[number];

export const PARTNER_ROLES = ['partner_admin', 'partner_member', 'partner_viewer'] as const;

export const ACTIONS = ['invite', 'deactivate', 'reactivate', 'changeRole'] as const;
export type AccountAction = (typeof ACTIONS)[number];

export function toAction(v: unknown): AccountAction | null {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v)
    ? (v as AccountAction) : null;
}

export type Caller = { role: string; partnerId: string | null; id: string };

export type Denial =
  | 'NOT_ALLOWED' | 'BAD_ACTION' | 'BAD_EMAIL' | 'BAD_ROLE'
  | 'TARGET_REQUIRED' | 'TARGET_OTHER_PARTNER' | 'TARGET_NOT_PARTNER'
  | 'SELF_DEACTIVATE' | 'LAST_ADMIN' | 'PARTNER_REQUIRED' | 'ALREADY';

/** 이 함수를 쓸 수 있는 사람. **파트너 관리자와 우리뿐**이다. */
export function canUseAccounts(role: unknown): boolean {
  return role === 'partner_admin' || role === 'admin' || role === 'sub_admin';
}

export function isOurAdmin(role: unknown): boolean {
  return role === 'admin' || role === 'sub_admin';
}

/**
 * **어느 파트너에 대고 일하는가.**
 *
 * 파트너 관리자면 **자기 회사뿐**이다 — 본문의 partnerId 는 **쳐다보지 않는다**.
 * 우리(admin·sub_admin)만 본문으로 고를 수 있다.
 */
export function resolvePartnerId(caller: Caller, bodyPartnerId: unknown): string | null {
  if (isOurAdmin(caller.role)) {
    return typeof bodyPartnerId === 'string' && bodyPartnerId ? bodyPartnerId : null;
  }
  return caller.partnerId;   // 파트너 관리자 — 본문을 무시한다
}

/** 줄 수 있는 역할. 파트너 관리자는 **member·viewer 만**(admin 부여는 우리만). */
export function validateRole(caller: Caller, role: unknown): { ok: true; role: string }
  | { ok: false; error: Denial } {
  if (typeof role !== 'string' || role === '') return { ok: false, error: 'BAD_ROLE' };
  if (isOurAdmin(caller.role)) {
    return (PARTNER_ROLES as readonly string[]).includes(role)
      ? { ok: true, role } : { ok: false, error: 'BAD_ROLE' };
  }
  return (PARTNER_ASSIGNABLE as readonly string[]).includes(role)
    ? { ok: true, role } : { ok: false, error: 'BAD_ROLE' };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(v: unknown): { ok: true; email: string } | { ok: false; error: Denial } {
  if (typeof v !== 'string') return { ok: false, error: 'BAD_EMAIL' };
  const e = v.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? { ok: true, email: e } : { ok: false, error: 'BAD_EMAIL' };
}

export interface TargetProfile {
  id: string;
  role: string | null;
  partner_id: string | null;
  status: string | null;
}

/**
 * 대상에게 손댈 수 있는가.
 *
 * · **같은 파트너**여야 한다(파트너 관리자). 아니면 있는지 없는지도 알려 주지 않는다.
 * · 파트너 계정이 아닌 사람(우리 직원)은 **건드릴 수 없다** — 역할을 빼앗길 수 있다.
 * · 자기 자신은 비활성화하지 못한다(문을 잠그고 열쇠를 안에 두는 셈).
 * · **마지막 `partner_admin`** 도 비활성화하지 못한다(아무도 못 들어간다).
 */
export function canActOnTarget(
  caller: Caller, partnerId: string, target: TargetProfile | null,
  action: AccountAction, adminCount: number,
): { ok: true } | { ok: false; error: Denial } {
  if (!target) return { ok: false, error: 'TARGET_OTHER_PARTNER' };
  if (target.partner_id !== partnerId) return { ok: false, error: 'TARGET_OTHER_PARTNER' };
  if (!(PARTNER_ROLES as readonly string[]).includes(target.role ?? '')) {
    return { ok: false, error: 'TARGET_NOT_PARTNER' };
  }
  if (action === 'deactivate') {
    if (target.id === caller.id) return { ok: false, error: 'SELF_DEACTIVATE' };
    if (target.role === 'partner_admin' && adminCount <= 1) {
      return { ok: false, error: 'LAST_ADMIN' };
    }
  }
  if (action === 'changeRole') {
    // 마지막 관리자를 일반으로 내리는 것도 같은 사고다.
    if (target.role === 'partner_admin' && adminCount <= 1) {
      return { ok: false, error: 'LAST_ADMIN' };
    }
    // 파트너 관리자는 다른 **관리자**의 역할을 바꿀 수 없다(우리만).
    if (!isOurAdmin(caller.role) && target.role === 'partner_admin') {
      return { ok: false, error: 'NOT_ALLOWED' };
    }
  }
  return { ok: true };
}

/** 이미 그 상태면 아무 일도 하지 않는다(기록을 어지럽히지 않는다). */
export function alreadyInState(target: TargetProfile, action: AccountAction): boolean {
  if (action === 'deactivate') return target.status === 'inactive';
  if (action === 'reactivate') return target.status === 'active';
  return false;
}

// ───────────────────────── 기록 ─────────────────────────

/**
 * 기록에 남길 이메일 — **마스킹한다.**
 * `kim.lee@school.edu.sg` → `ki***@sc***.sg`
 * 누구인지 알아볼 정도면 충분하고, 기록은 오래 남는다.
 */
export function maskEmail(v: unknown): string {
  if (typeof v !== 'string' || !v.includes('@')) return '***';
  const [local, domain] = v.split('@');
  const head = local.slice(0, 2) || '*';
  const parts = domain.split('.');
  const dHead = (parts[0] ?? '').slice(0, 2) || '*';
  const tail = parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  return `${head}***@${dHead}***${tail}`;
}

export interface AuditEntry {
  partner_id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_user_id: string | null;
  meta: Record<string, unknown>;
}

export function auditEntry(args: {
  caller: Caller; partnerId: string; action: string;
  targetUserId?: string | null; email?: unknown; role?: string | null; from?: string | null;
}): AuditEntry {
  const meta: Record<string, unknown> = {};
  if (args.email !== undefined) meta.email = maskEmail(args.email);
  if (args.role) meta.role = args.role;
  if (args.from) meta.from = args.from;
  return {
    partner_id: args.partnerId,
    actor_id: args.caller.id,
    actor_role: args.caller.role,
    action: args.action,
    target_user_id: args.targetUserId ?? null,
    meta,
  };
}

// ───────────────────────── 문구 ─────────────────────────

export type Locale = 'en' | 'ko' | 'ja';

export function pickLocale(v: unknown): Locale {
  if (typeof v !== 'string') return 'en';
  const s = v.toLowerCase();
  if (s.startsWith('ko')) return 'ko';
  if (s.startsWith('ja')) return 'ja';
  return 'en';
}

const MSG: Record<Denial, Record<Locale, string>> = {
  NOT_ALLOWED: {
    ko: '계정을 관리할 권한이 없습니다.',
    ja: 'アカウントを管理する権限がありません。',
    en: 'You do not have permission to manage accounts.',
  },
  BAD_ACTION: { ko: '알 수 없는 요청입니다.', ja: '不明なリクエストです。', en: 'Unknown request.' },
  BAD_EMAIL: {
    ko: '이메일 주소를 확인해 주세요.',
    ja: 'メールアドレスをご確認ください。',
    en: 'Please check the email address.',
  },
  BAD_ROLE: {
    ko: '줄 수 있는 역할은 운영자와 게스트뿐입니다.',
    ja: '付与できる役割は運営者とゲストのみです。',
    en: 'You can only grant the Member or Guest role.',
  },
  TARGET_REQUIRED: { ko: '대상 계정이 필요합니다.', ja: '対象アカウントが必要です。', en: 'A target account is required.' },
  TARGET_OTHER_PARTNER: {
    ko: '그 계정을 찾을 수 없습니다.',
    ja: 'そのアカウントは見つかりません。',
    en: 'That account was not found.',
  },
  TARGET_NOT_PARTNER: {
    ko: '파트너 계정이 아닙니다.',
    ja: 'パートナーアカウントではありません。',
    en: 'That is not a partner account.',
  },
  SELF_DEACTIVATE: {
    ko: '자기 계정은 비활성화할 수 없습니다.',
    ja: '自分のアカウントは無効化できません。',
    en: 'You cannot deactivate your own account.',
  },
  LAST_ADMIN: {
    ko: '마지막 관리자 계정은 비활성화하거나 역할을 바꿀 수 없습니다.',
    ja: '最後の管理者アカウントは無効化や役割変更ができません。',
    en: 'You cannot deactivate or change the role of the last administrator account.',
  },
  PARTNER_REQUIRED: {
    ko: '어느 파트너의 계정인지 알 수 없습니다.',
    ja: 'どのパートナーのアカウントか不明です。',
    en: 'We could not tell which partner this account belongs to.',
  },
  ALREADY: { ko: '이미 그 상태입니다.', ja: 'すでにその状態です。', en: 'It is already in that state.' },
};

export function denialMessage(code: Denial, locale: Locale): string {
  return MSG[code][locale] ?? MSG[code].en;
}
