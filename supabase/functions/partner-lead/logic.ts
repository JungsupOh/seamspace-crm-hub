// 파트너 직접 리드 등록 — 순수 로직 (LEAD-S7-7a)
//
// 이 파일이 지키는 것은 하나다: **우리 내부 칸이 파트너에게 나가지 않는다.**
//
// 그래서 **허용 목록(allow-list)** 으로 쓴다. 막을 칸을 세는 방식(deny-list)은
// `campaign_leads` 에 칸이 하나 늘 때마다 조용히 새는 구조다 — 지금도 46칸이고
// 그중 파트너가 봐도 되는 것은 10칸뿐이다. **모르는 칸은 안 나간다**가 기본이다.

// ───────────────────────── 허용 칸 ─────────────────────────

/**
 * 파트너에게 **돌려줘도 되는** 칸. 전부 파트너가 **직접 넣은 값**이거나
 * 귀속·보호 기간을 보여 주는 데 꼭 필요한 값이다.
 *
 * ⚠️ 여기에 칸을 더하려면 "파트너가 이걸 알아도 되나" 가 아니라
 *    **"파트너가 이걸 몰라도 일할 수 있나"** 를 물어라. 몰라도 되면 넣지 않는다.
 */
export const LEAD_PUBLIC_FIELDS = [
  'id',
  'school_name',
  'school_kind',
  'position',
  'name',
  'email',
  'phone',
  'country',
  'contact_owner',
  'partner_claimed_at',
  'last_contact_at',
  'created_at',
] as const;

export type LeadPublicField = (typeof LEAD_PUBLIC_FIELDS)[number];

/**
 * **절대 나가면 안 되는 칸.** 허용 목록이 이미 막지만, 두 겹으로 둔다 —
 * 누가 허용 목록에 실수로 넣어도 시험이 잡는다.
 */
export const LEAD_FORBIDDEN_FIELDS = [
  'notes', 'segment', 'segment_detail', 'probability', 'owner',
  'close_reason', 'next_action', 'next_action_due', 'followup_stage',
  'email_quality', 'email_status', 'is_existing_customer', 'converted_contact_id',
  'import_batch_id', 'custom_fields', 'unsubscribe_token', 'unsubscribed_at',
  'archived_at', 'campaign_id', 'market', 'lead_tags', 'source', 'source_etc',
  'source_type', 'sent_at', 'marketing_consent', 'consent_by', 'consent_at',
  'partner_id', 'ls_group_id', 'ls_payment_group_id', 'ls_role', 'ls_member_index',
  'school_code', 'phone_normalized', 'email_normalized', 'status', 'lead_type',
] as const;

/** PostgREST `select=` 에 넣을 문자열. 함수가 **이것만** 고른다. */
export function selectClause(): string {
  return LEAD_PUBLIC_FIELDS.join(',');
}

/**
 * 행에서 허용 칸만 남긴다. DB 가 더 준다 해도 여기서 떨어진다.
 * (`select=` 와 이중으로 거는 이유: 한쪽을 고치면 다른 쪽 시험이 잡는다.)
 */
export function pickPublic(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LEAD_PUBLIC_FIELDS) {
    if (k in row) out[k] = row[k];
  }
  return out;
}

// ───────────────────────── 역할 ─────────────────────────

export const PARTNER_ROLES = ['partner_admin', 'partner_member', 'partner_viewer'] as const;

export interface Caller {
  id: string;
  role: string;
  partnerId: string | null;
}

/** 파트너 리드 기능을 쓸 수 있는가. */
export function canUseLeads(role: string): boolean {
  return (PARTNER_ROLES as readonly string[]).includes(role)
    || role === 'admin' || role === 'sub_admin';
}

/** 등록할 수 있는가 — **보는 사람(viewer)은 못 넣는다.** */
export function canCreateLead(role: string): boolean {
  return role === 'partner_admin' || role === 'partner_member'
    || role === 'admin' || role === 'sub_admin';
}

/**
 * 상세를 볼 수 있는가 — **`partner_viewer` 는 목록·건수만**(Q5).
 * 목록에서도 상세 칸은 빼야 한다. `listFieldsFor()` 가 그 일을 한다.
 */
export function canSeeDetail(role: string): boolean {
  return role !== 'partner_viewer';
}

/**
 * 역할에 따라 **목록에서도** 칸을 줄인다.
 * viewer 는 "몇 건이 어느 기관에 있는지"까지만 — 사람 이름·연락처는 안 된다.
 */
export function listFieldsFor(role: string): readonly LeadPublicField[] {
  if (role === 'partner_viewer') {
    return ['id', 'school_name', 'country', 'partner_claimed_at', 'last_contact_at'];
  }
  return LEAD_PUBLIC_FIELDS;
}

export function pickForRole(row: Record<string, unknown>, role: string): Record<string, unknown> {
  const allowed = listFieldsFor(role);
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in row) out[k] = row[k];
  return out;
}

/** 본문의 partner_id 는 **믿지 않는다**(파트너는 자기 것뿐). */
export function resolvePartnerId(caller: Caller, bodyPartnerId: unknown): string | null {
  if (caller.role === 'admin' || caller.role === 'sub_admin') {
    return typeof bodyPartnerId === 'string' && bodyPartnerId ? bodyPartnerId : null;
  }
  return caller.partnerId;
}

// ───────────────────────── 보호 기간 ─────────────────────────

/** 설계 3-3: 90일. S7-1 과 같은 값을 쓴다. */
export const PROTECTION_DAYS = 90;

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 보호 기간의 **시작점**: 접촉이 있으면 마지막 접촉일, 없으면 등록일.
 * "일하고 있으면 지킨다"(설계 3-3).
 */
export function protectionAnchor(
  claimedAt: unknown, lastContactAt: unknown,
): Date | null {
  const c = toDate(claimedAt);
  const l = toDate(lastContactAt);
  if (!c && !l) return null;
  if (!c) return l;
  if (!l) return c;
  return l > c ? l : c;
}

/** 보호가 끝나는 시각. */
export function protectionEndsAt(
  claimedAt: unknown, lastContactAt: unknown,
): Date | null {
  const a = protectionAnchor(claimedAt, lastContactAt);
  if (!a) return null;
  return new Date(a.getTime() + PROTECTION_DAYS * 24 * 60 * 60 * 1000);
}

/** 지금 보호 중인가. **저장하지 않고 계산한다.** */
export function isProtected(
  claimedAt: unknown, lastContactAt: unknown, now: Date,
): boolean {
  const end = protectionEndsAt(claimedAt, lastContactAt);
  return end !== null && end > now;
}

/** 며칠 남았나(지났으면 0). 화면이 쓴다. */
export function protectionDaysLeft(
  claimedAt: unknown, lastContactAt: unknown, now: Date,
): number {
  const end = protectionEndsAt(claimedAt, lastContactAt);
  if (!end) return 0;
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// ───────────────────────── 중복 판정 ─────────────────────────

/** 이메일 정규화 — 기존 `email_normalized` 와 같은 규칙(소문자·공백 제거). */
export function normalizeEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * 기관명 비교용으로 다듬는다. 대소문자·구두점·흔한 수식어를 지우고
 * **줄임말을 펴서** 맞춘다(`Int` ↔ `International`).
 *
 * ⚠️ 완벽할 수 없다 — **놓치는 쪽이 아니라 더 잡는 쪽**으로 기울였다.
 *    잘못 잡으면 "확인해 보겠다"는 안내가 한 번 더 뜰 뿐이고,
 *    놓치면 **같은 매출에 두 번 지급한다.**
 */
const ABBREV: Record<string, string> = {
  intl: 'international', int: 'international', univ: 'university',
  sch: 'school', acad: 'academy', elem: 'elementary', sec: 'secondary',
  hs: 'high', jr: 'junior', sr: 'senior', st: 'saint',
};

/** 비교에서 빼는 말 — 어느 기관 이름에나 붙는 것들. */
const ORG_STOPWORDS = new Set([
  'the', 'of', 'and', 'school', 'schools', 'academy', 'college', 'institute',
  'international', 'private', 'public', 'ltd', 'inc', 'pte', 'sdn', 'bhd',
  'co', 'corp', 'group', 'education', 'educational',
]);

/** 비교에 쓰는 **낱말 묶음**. */
export function orgTokens(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  const words = v.toLowerCase()
    .replace(/[.,'"()\-_/&]/g, ' ')
    .split(/\s+/)
    .map(w => ABBREV[w] ?? w)
    .filter(w => w && !ORG_STOPWORDS.has(w));
  return [...new Set(words)];
}

/** 사람이 읽을 수 있는 다듬은 이름(시험·기록용). */
export function normalizeOrg(v: unknown): string {
  return orgTokens(v).join(' ');
}

/**
 * 두 기관 이름이 **같은 곳일 수 있나**.
 *
 * 글자를 똑같이 맞추지 않는다 — `Hanoi Int School` 과
 * `The Hanoi International School` 은 같은 곳인데 글자는 다르다.
 * **짧은 쪽이 긴 쪽에 통째로 들어 있으면** 같은 곳으로 본다.
 * 넓게 잡는 쪽이고, 그게 의도다(놓치면 두 번 지급한다).
 */
export function orgLooksSame(a: unknown, b: unknown): boolean {
  const ta = orgTokens(a), tb = orgTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  // 낱말 하나뿐이고 그게 너무 짧으면 보지 않는다(오탐 폭주 방지)
  const joined = (ta.length <= tb.length ? ta : tb).join('');
  if (joined.length < 3) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const big = new Set(large);
  return small.every(w => big.has(w));
}

export interface ExistingLead {
  id: string;
  email_normalized?: unknown;
  school_name?: unknown;
  partner_id?: unknown;
  partner_claimed_at?: unknown;
  last_contact_at?: unknown;
}

export type DuplicateReason = 'email' | 'org';

export interface DuplicateHit {
  id: string;
  reason: DuplicateReason;
  /** 우리(내부) 리드인가 — 설계 3-3: 우리가 우선 */
  ours: boolean;
  /** 같은 파트너가 전에 넣은 것인가 */
  sameParter: boolean;
  protectedNow: boolean;
}

export interface DuplicateVerdict {
  /** 등록을 막는가 — **언제나 false.** 막으면 왜 막혔는지 알려 줄 수 없다(설계 3-3). */
  blocked: false;
  hits: DuplicateHit[];
  /** 파트너에게 보여 줄 말. **상대가 누구인지 절대 담지 않는다.** */
  notice: 'none' | 'own' | 'other';
}

/**
 * 중복을 찾는다.
 *
 * ⚠️ 돌려주는 `hits` 는 **우리 쪽에서만** 쓴다(텔레그램 알림·운영 화면).
 *    파트너에게 가는 것은 `notice` 한 글자뿐이다.
 */
export function findDuplicates(
  input: { email?: unknown; schoolName?: unknown },
  existing: readonly ExistingLead[],
  myPartnerId: string | null,
  now: Date,
): DuplicateVerdict {
  const email = normalizeEmail(input.email);
  const org = normalizeOrg(input.schoolName);
  const hits: DuplicateHit[] = [];

  for (const row of existing) {
    let reason: DuplicateReason | null = null;
    if (email && normalizeEmail(row.email_normalized) === email) reason = 'email';
    else if (org && orgLooksSame(input.schoolName, row.school_name)) reason = 'org';
    if (!reason) continue;

    const pid = typeof row.partner_id === 'string' ? row.partner_id : null;
    hits.push({
      id: row.id,
      reason,
      ours: pid === null,
      sameParter: pid !== null && pid === myPartnerId,
      protectedNow: isProtected(row.partner_claimed_at, row.last_contact_at, now),
    });
  }

  let notice: DuplicateVerdict['notice'] = 'none';
  if (hits.length > 0) {
    // 내 것만 겹치면 "이미 넣으셨다", 남의 것(또는 우리 것)이 섞이면 "확인하겠다"
    notice = hits.every(h => h.sameParter) ? 'own' : 'other';
  }
  return { blocked: false, hits, notice };
}

/** 파트너에게 보여 줄 문구. **상대를 식별할 수 있는 말이 없다.** */
export function duplicateMessage(
  notice: DuplicateVerdict['notice'], locale: string,
): string {
  const L = (ko: string, ja: string, en: string) =>
    locale === 'ko' ? ko : locale === 'ja' ? ja : en;
  if (notice === 'own') {
    return L(
      '같은 연락처로 이미 등록하신 리드가 있습니다. 이번 등록도 함께 기록했습니다.',
      '同じ連絡先ですでに登録されたリードがあります。今回の登録も記録しました。',
      'You already registered a lead with the same contact. This one was recorded too.');
  }
  if (notice === 'other') {
    return L(
      '같은 기관·연락처로 이미 진행 중인 건이 있어, 저희가 확인한 뒤 알려 드리겠습니다. 등록은 정상 접수되었습니다.',
      '同じ機関・連絡先ですでに進行中の案件があります。確認のうえご連絡します。登録は受け付けました。',
      'There is already an ongoing lead for this organization or contact. We will check and get back to you. Your registration was accepted.');
  }
  return L('등록되었습니다.', '登録しました。', 'Registered.');
}

// ───────────────────────── 입력 검증 ─────────────────────────

export const LIMITS = {
  schoolName: 200, name: 100, email: 320, phone: 40, position: 100,
  country: 2, note: 500,
} as const;

export interface LeadInput {
  schoolName: string;
  schoolKind: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  position: string | null;
  country: string | null;
  contactOwner: 'end_user' | 'partner';
  consented: boolean;
}

export type ValidationError =
  | 'SCHOOL_REQUIRED' | 'EMAIL_REQUIRED' | 'BAD_EMAIL' | 'TOO_LONG'
  | 'BAD_CONTACT_OWNER' | 'CONSENT_REQUIRED' | 'BAD_COUNTRY';

export interface ValidationResult {
  ok: boolean;
  error?: ValidationError;
  field?: string;
  value?: LeadInput;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max: number): { v: string; tooLong: boolean } {
  const s = typeof v === 'string' ? v.trim() : '';
  return { v: s.slice(0, max), tooLong: s.length > max };
}

/** 입력을 다듬고 본다. **길면 자르지 않고 거절한다** — 조용히 자르면 틀린 값이 남는다. */
export function validateLead(body: Record<string, unknown>): ValidationResult {
  const school = str(body.schoolName, LIMITS.schoolName);
  if (school.tooLong) return { ok: false, error: 'TOO_LONG', field: 'schoolName' };
  if (!school.v) return { ok: false, error: 'SCHOOL_REQUIRED', field: 'schoolName' };

  const raw = str(body.email, LIMITS.email);
  if (raw.tooLong) return { ok: false, error: 'TOO_LONG', field: 'email' };
  if (!raw.v) return { ok: false, error: 'EMAIL_REQUIRED', field: 'email' };
  if (!EMAIL_RE.test(raw.v)) return { ok: false, error: 'BAD_EMAIL', field: 'email' };
  // **한 가지 모양으로 맞춰 둔다** — 대문자로 들어온 이메일이 중복 판정을 비껴가면
  // 같은 사람이 두 번 등록되고, 그게 곧 두 번 지급이다.
  const email = { v: raw.v.toLowerCase(), tooLong: false };

  for (const [k, max] of [['name', LIMITS.name], ['phone', LIMITS.phone],
                          ['position', LIMITS.position]] as const) {
    if (str(body[k], max).tooLong) return { ok: false, error: 'TOO_LONG', field: k };
  }

  const country = str(body.country, 8).v.toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) {
    return { ok: false, error: 'BAD_COUNTRY', field: 'country' };
  }

  const owner = body.contactOwner;
  if (owner !== 'end_user' && owner !== 'partner') {
    return { ok: false, error: 'BAD_CONTACT_OWNER', field: 'contactOwner' };
  }

  // **최종 사용자의 정보라면 동의 확인이 있어야 한다**(설계 3-4).
  const consented = body.consented === true;
  if (owner === 'end_user' && !consented) {
    return { ok: false, error: 'CONSENT_REQUIRED', field: 'consented' };
  }

  return {
    ok: true,
    value: {
      schoolName: school.v,
      schoolKind: str(body.schoolKind, 50).v || null,
      name: str(body.name, LIMITS.name).v || null,
      email: email.v,
      phone: str(body.phone, LIMITS.phone).v || null,
      position: str(body.position, LIMITS.position).v || null,
      country: country || null,
      contactOwner: owner,
      consented,
    },
  };
}

/** 저장할 행. 함수가 이대로 넣는다. */
export function toLeadRow(
  input: LeadInput, caller: Caller, partnerId: string, nowIso: string,
): Record<string, unknown> {
  return {
    school_name: input.schoolName,
    school_kind: input.schoolKind,
    name: input.name,
    email: input.email,
    email_normalized: normalizeEmail(input.email),
    phone: input.phone,
    position: input.position,
    country: input.country,
    source: 'partner',
    source_type: 'partner',
    lead_type: 'b2b',
    status: 'new',
    partner_id: partnerId,
    partner_claimed_at: nowIso,
    contact_owner: input.contactOwner,
    consent_by: input.contactOwner === 'end_user' ? caller.id : null,
    consent_at: input.contactOwner === 'end_user' ? nowIso : null,
    // **파트너 대행이면 마케팅 발송에서 뺀다**(설계 3-4) —
    // 파트너 자신의 연락처에 고객용 메일을 보내면 안 된다.
    marketing_consent: input.contactOwner === 'end_user',
  };
}

// ───────────────────────── 분당 횟수 제한 ─────────────────────────

export const RATE_LIMIT_PER_MINUTE = 10;

/** 최근 1분에 이 파트너가 몇 건 넣었나로 판단. */
export function overRateLimit(recentCount: number): boolean {
  return recentCount >= RATE_LIMIT_PER_MINUTE;
}

// ───────────────────────── 알림 ─────────────────────────

/**
 * 우리에게 가는 텔레그램 문구.
 * **개인정보를 담지 않는다** — 건수·파트너 이름·국가뿐(요구사항 2).
 */
export function alertText(args: {
  partnerName: string; country: string | null;
  hits: readonly DuplicateHit[];
}): string {
  const ours = args.hits.filter(h => h.ours).length;
  const others = args.hits.filter(h => !h.ours && !h.sameParter).length;
  const lines = [
    `[파트너 리드 중복] ${args.partnerName}${args.country ? ` (${args.country})` : ''}`,
    `겹친 건수: ${args.hits.length}`,
  ];
  if (ours > 0) lines.push(`그중 우리 리드: ${ours} — 우리가 우선입니다`);
  if (others > 0) lines.push(`다른 파트너 리드: ${others}`);
  const prot = args.hits.filter(h => h.protectedNow).length;
  if (prot > 0) lines.push(`보호 기간 안: ${prot}`);
  return lines.join('\n');
}

// ───────────────────────── 문구 ─────────────────────────

export function denialMessage(code: string, locale: string): string {
  const L = (ko: string, ja: string, en: string) =>
    locale === 'ko' ? ko : locale === 'ja' ? ja : en;
  switch (code) {
    case 'NOT_ALLOWED':
      return L('권한이 없습니다.', '権限がありません。', 'Not allowed.');
    case 'VIEWER_NO_DETAIL':
      return L('보기 전용 계정은 목록만 볼 수 있습니다.',
               '閲覧専用アカウントは一覧のみ表示できます。',
               'View-only accounts can see the list only.');
    case 'PARTNER_REQUIRED':
      return L('파트너 계정이 아닙니다.', 'パートナーアカウントではありません。',
               'Not a partner account.');
    case 'SCHOOL_REQUIRED':
      return L('기관 이름이 필요합니다.', '機関名が必要です。', 'Organization name is required.');
    case 'EMAIL_REQUIRED':
    case 'BAD_EMAIL':
      return L('이메일을 확인해 주세요.', 'メールアドレスをご確認ください。',
               'Please check the email address.');
    case 'BAD_COUNTRY':
      return L('국가 코드는 두 글자입니다.', '国コードは2文字です。',
               'Country code must be two letters.');
    case 'BAD_CONTACT_OWNER':
      return L('연락처 주체를 골라 주세요.', '連絡先の主体を選んでください。',
               'Please choose whose contact this is.');
    case 'CONSENT_REQUIRED':
      return L('최종 사용자의 정보는 동의 확인이 필요합니다.',
               'エンドユーザーの情報は同意の確認が必要です。',
               'Consent confirmation is required for an end user\'s details.');
    case 'TOO_LONG':
      return L('입력이 너무 깁니다.', '入力が長すぎます。', 'The input is too long.');
    case 'RATE_LIMIT':
      return L('잠시 후 다시 시도해 주세요.', 'しばらくしてから再度お試しください。',
               'Please try again in a moment.');
    case 'NOT_FOUND':
      // ⚠️ 남의 리드도 **없는 것과 같은 답**이다 — 떠보기를 막는다.
      return L('찾을 수 없습니다.', '見つかりません。', 'Not found.');
    default:
      return L('처리하지 못했습니다.', '処理できませんでした。', 'Could not process.');
  }
}

export function pickLocale(v: unknown): string {
  return v === 'ko' || v === 'ja' ? v : 'en';
}
