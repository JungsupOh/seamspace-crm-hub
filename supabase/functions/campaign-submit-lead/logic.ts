// campaign-submit-lead 의 순수 로직 — 입력 검증 / 전화번호 정규화 / 중복 판정 / 발송 상한.
//
// I/O 가 전혀 없다. 그래서 vitest(Node)에서 그대로 import 해 검증할 수 있고,
// 운영 DB 를 건드리지 않고도 "전환 전후 같은 결과"를 증명할 수 있다.
// 네트워크를 타는 부분은 index.ts 에만 둔다.

// ── src/lib/phone.ts:7-29 복사 ──
// 같은 사람이 양쪽에서 다른 키로 갈리면 중복 판정이 통째로 깨진다.
// src/lib/phone.test.ts(7 tests)가 원본을 지키고, 이 사본은 드리프트 테스트가 지킨다.
export type PhoneCountry = 'kr' | 'jp' | 'intl';

export function normalizePhone(raw: string, country: PhoneCountry = 'kr'): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';

  // intl: 국가 특정 가공 없이 숫자만 보존 (영어권 해외 캠페인 — 국가 불특정)
  if (country === 'intl') return digits;

  if (country === 'jp') {
    if (digits.startsWith('81') && digits.length >= 11) {
      return '0' + digits.slice(2);
    }
    return digits;
  }

  // kr: 숫자만. 국가번호 82는 제거하고 국내 표기(0…)로 되돌린다
  if (digits.startsWith('82') && digits.length >= 11) return '0' + digits.slice(2);
  return digits;
}

/** CampaignForm.tsx:232 와 같은 규칙 — 언어로 국가를 고른다. */
export function phoneCountryFor(locale: string | undefined): PhoneCountry {
  return locale === 'en' ? 'intl' : locale === 'ja' ? 'jp' : 'kr';
}

// 참고: CampaignForm.tsx:284 가 upsertLeadContact 에 넘기는 `country` 옵션도 같은 값이다.
// 다만 그 값은 **contacts.country 컬럼이 아니라 전화번호 정규화 국가**로만 쓰인다
// (luckySeven.ts:222-223). 그래서 별도 함수를 두지 않고 phoneCountryFor 를 그대로 쓴다.

// ── 입력 검증 ───────────────────────────────────────
// 브라우저(CampaignForm.tsx:197-200)에도 같은 검사가 있지만, 브라우저 검사는
// 우회된다는 전제로 **서버에서 다시 한다**. 서버가 거부하면 그게 최종이다.

export interface SubmitInput {
  campaignId?: unknown;
  submissionId?: unknown;
  locale?: unknown;
  lead?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    schoolName?: unknown;
    schoolKind?: unknown;
    position?: unknown;
    source?: unknown;
    sourceEtc?: unknown;
    marketingConsent?: unknown;
    customFields?: unknown;
  };
}

export interface CleanLead {
  campaignId: string;
  submissionId: string;
  locale: 'ko' | 'ja' | 'en';
  name: string;
  phone: string;
  phoneNormalized: string;
  email: string;
  schoolName: string | null;
  schoolKind: string | null;
  position: string | null;
  source: string | null;
  sourceEtc: string | null;
  marketingConsent: boolean;
  customFields: Record<string, string> | null;
}

export type ValidationResult =
  | { ok: true; value: CleanLead }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;   // CampaignForm.tsx:199 와 동일
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_TEXT = 200;
const MAX_CUSTOM_FIELDS = 20;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function nullable(v: unknown, max = MAX_TEXT): string | null {
  const s = str(v);
  if (!s) return null;
  return s.slice(0, max);
}

export function validate(input: SubmitInput): ValidationResult {
  const campaignId = str(input?.campaignId);
  if (!UUID_RE.test(campaignId)) return { ok: false, error: '캠페인을 확인할 수 없습니다.' };

  // 멱등 키 — 브라우저가 신청 1건당 1개를 만들어 보낸다.
  const submissionId = str(input?.submissionId);
  if (!UUID_RE.test(submissionId)) return { ok: false, error: '요청 식별자가 올바르지 않습니다.' };

  const rawLocale = str(input?.locale);
  const locale: 'ko' | 'ja' | 'en' =
    rawLocale === 'ja' ? 'ja' : rawLocale === 'en' ? 'en' : 'ko';

  const lead = input?.lead ?? {};

  const name = str(lead.name);
  if (!name) return { ok: false, error: '성함을 입력해주세요.' };
  if (name.length > MAX_NAME) return { ok: false, error: '성함이 너무 깁니다.' };

  const phone = str(lead.phone);
  if (!phone) return { ok: false, error: '연락처를 입력해주세요.' };

  const email = str(lead.email);
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: '이메일을 정확히 입력해주세요.' };
  if (email.length > MAX_EMAIL) return { ok: false, error: '이메일이 너무 깁니다.' };

  // 커스텀 항목은 개수·길이를 제한한다 — 공개 폼이라 임의 크기가 들어올 수 있다.
  let customFields: Record<string, string> | null = null;
  const rawCustom = lead.customFields;
  if (rawCustom && typeof rawCustom === 'object' && !Array.isArray(rawCustom)) {
    const entries = Object.entries(rawCustom as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .slice(0, MAX_CUSTOM_FIELDS)
      .map(([k, v]) => [k.slice(0, 50), String(v).trim().slice(0, MAX_TEXT)] as [string, string]);
    if (entries.length > 0) customFields = Object.fromEntries(entries);
  }

  return {
    ok: true,
    value: {
      campaignId,
      submissionId,
      locale,
      name: name.slice(0, MAX_NAME),
      phone: phone.slice(0, MAX_TEXT),
      phoneNormalized: normalizePhone(phone, phoneCountryFor(locale)),
      email,
      schoolName: nullable(lead.schoolName),
      schoolKind: nullable(lead.schoolKind),
      position: nullable(lead.position),
      source: nullable(lead.source),
      sourceEtc: nullable(lead.sourceEtc),
      marketingConsent: lead.marketingConsent === true,
      customFields,
    },
  };
}

// ── 기존 체험권 판정 ─────────────────────────────────
// campaign-trial-license.ts:141-220 의 분기를 그대로 옮긴 **순수 함수**.
// 원본은 조회와 판정이 한 덩어리라 테스트가 불가능했다. 판정만 떼어 둔다.

export type IssueOutcome = 'new' | 'resent' | 'blocked_used' | 'blocked_expired';

export interface PriorTrial {
  coupon_code: string;
  status: string;
  created_at: string;
  campaign_name: string;
}

export type PriorDecision =
  | { action: 'new' }
  | { action: 'resend'; code: string; outcome: 'resent'; leadStatus: '체험재발송' }
  | { action: 'block'; code: string; outcome: 'blocked_used' | 'blocked_expired'; leadStatus: '체험중복' };

export function decideFromPrior(prior: PriorTrial | null): PriorDecision {
  if (!prior) return { action: 'new' };
  // 사용중/만료 → 차단 (campaign-trial-license.ts:141-142)
  if (prior.status === '사용중' || prior.status === '만료') {
    return {
      action: 'block',
      code: prior.coupon_code,
      outcome: prior.status === '만료' ? 'blocked_expired' : 'blocked_used',
      leadStatus: '체험중복',
    };
  }
  // 미사용(대기) → 기존 코드 재발송 (campaign-trial-license.ts:165)
  if (prior.status === '대기') {
    return { action: 'resend', code: prior.coupon_code, outcome: 'resent', leadStatus: '체험재발송' };
  }
  // 그 외 상태는 원본과 같이 신규 발급으로 떨어진다
  return { action: 'new' };
}

/** 기존 고객 판별 — CampaignForm.tsx:187-189 과 동일한 규칙. */
export function isExistingCustomer(
  contacts: Array<{ contact_type?: string }>,
  licenses: Array<unknown>,
): boolean {
  const isPurchased = Array.isArray(contacts) && contacts.some(c => c.contact_type === '구매고객');
  const hasTrialHistory = Array.isArray(licenses) && licenses.length > 0;
  return isPurchased || hasTrialHistory;
}

// ── 발송 상한 ───────────────────────────────────────
// 공개 폼이라 누구나 호출할 수 있다. 수신자를 서버가 DB 에서 정하므로 임의 주소로는
// 못 보내지만, **같은 사람에게 반복 발송**시키는 건 막아야 한다(021-4 §3-4).

export const MAX_SUBMISSIONS_PER_DAY = 5;

export function exceedsSendCap(recentCount: number, cap = MAX_SUBMISSIONS_PER_DAY): boolean {
  return recentCount >= cap;
}

// ── 쿠폰 설명 ───────────────────────────────────────
/** campaign-trial-license.ts:131 과 글자 단위로 같아야 한다 (쿠폰 관리 화면 표기). */
export function couponDescription(campaignName: string, schoolName: string | null | undefined, leadName: string): string {
  return `${campaignName} ${schoolName ?? ''} ${leadName} 체험이용권`.trim();
}

// ── 만기일 ──────────────────────────────────────────
/** campaign-trial-license.ts:64-68 복사. 테스트 가능하도록 기준 시각을 인자로 받는다. */
export function expiresAtFromDuration(months: number, now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ── contacts 등록 (A) ────────────────────────────────
// src/lib/luckySeven.ts:218-281 upsertLeadContact 와 **같은 동작**.
// 원본은 조회·분기·쓰기가 한 덩어리라 테스트가 불가능했다. 판단 부분만 떼어 둔다.
// 호출부(CampaignForm.tsx:273-291)는 try/catch 로 감싸 **실패해도 접수는 성공**이다.

/** CampaignForm.tsx:274-275 와 같은 문자열. */
export function activityNoteFor(todayISO: string, campaignName: string): string {
  return `[${todayISO}] 캠페인 신청 — ${campaignName}`;
}

export interface ContactMember {
  name: string;
  phone: string;
  email: string;
  orgName: string;
}

export interface ExistingContact {
  id: string;
  name?: string | null;
  email?: string | null;
  org_name?: string | null;
  contact_type?: string | null;
  notes?: string | null;
}

/**
 * 기존 contact 에 적용할 PATCH 본문. (luckySeven.ts:233-245)
 * 빈 칸만 채우고, 활동이력은 **중복이 아닐 때만** 맨 앞에 붙인다.
 */
export function buildContactPatch(
  existing: ExistingContact,
  member: ContactMember,
  activityNote?: string,
): { patch: Record<string, unknown>; activityAppended: boolean } {
  const patch: Record<string, unknown> = {};
  if (!existing.name && member.name) patch.name = member.name;
  if (!existing.email && member.email) patch.email = member.email;
  if (!existing.org_name && member.orgName) patch.org_name = member.orgName;

  let activityAppended = false;
  if (activityNote && activityNote.trim()) {
    const prevNotes = (existing.notes ?? '').toString();
    // 같은 라인 중복 방지 (오늘 같은 캠페인 재신청 등)
    if (!prevNotes.includes(activityNote.trim())) {
      patch.notes = [activityNote.trim(), prevNotes].filter(Boolean).join('\n');
      activityAppended = true;
    }
  }
  return { patch, activityAppended };
}

/** 신규 contact INSERT 본문. (luckySeven.ts:260-275) */
export function buildContactInsert(
  member: ContactMember,
  phoneNormalized: string,
  options: { leadSource?: string; contactType?: string; leadStage?: string; activityNote?: string } = {},
): Record<string, unknown> {
  return {
    name: member.name,
    phone: member.phone,
    phone_normalized: phoneNormalized,
    email: member.email,
    org_name: member.orgName,
    contact_type: options.contactType ?? '리드',
    lead_source: options.leadSource ?? '럭키세븐 5월',
    // 스테이지는 넘어온 경우에만 기록한다 (원본 주석 참고)
    ...(options.leadStage ? { lead_stage: options.leadStage } : {}),
    // 신규 contact도 첫 활동이력으로 기록 (있을 때만)
    ...(options.activityNote && options.activityNote.trim()
      ? { notes: options.activityNote.trim() }
      : {}),
  };
}

// ── 텔레그램 알림 (B) ────────────────────────────────
// src/lib/telegram.ts:101-120 notifyCampaignLead 와 **글자 단위로 같은** 메시지.

/** CampaignForm.tsx:300 의 경로 표기 규칙. */
export function telegramSourceLabel(
  source: string | null | undefined,
  sourceEtc: string | null | undefined,
): string | undefined {
  if (source === '기타') return `기타 — ${sourceEtc ?? ''}`;
  return source ?? undefined;
}

export function buildCampaignLeadTelegram(params: {
  campaignName: string;
  schoolName?: string;
  name: string;
  phone: string;
  position?: string;
  source?: string;
  isExistingCustomer?: boolean;
}): string {
  const { campaignName, schoolName, name, phone, position, source, isExistingCustomer } = params;
  const existingTag = isExistingCustomer ? `\n⚠️ 기존 고객` : '';
  const positionStr = position ? `\n💼 ${position}` : '';
  const sourceStr = source ? `\n📍 경로: ${source}` : '';
  return (
    `🎯 <b>캠페인 리드 유입</b>\n\n` +
    `📋 ${campaignName}\n` +
    `🏫 ${schoolName || '(미입력)'}\n` +
    `👤 ${name} / ${phone}${positionStr}${sourceStr}${existingTag}`
  );
}
