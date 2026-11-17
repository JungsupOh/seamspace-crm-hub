// 아웃리치 — 억제 규칙 · 수신 거부 문구 · 초안 상태 — LEAD-S2 (CRM-025)
//
// **CRM 은 메일을 보내지 않는다**(제시카 추천, James 결정 전까지).
// 초안 작성·사실 점검·승인·예약 상태까지 하고, 실제 발송은 James 계정으로
// 제시카가 한 뒤 "발송 완료"를 기록한다. 그래서 이 파일에는 메일 전송 코드가 없다.
//
// 이 파일은 **순수 함수만** 둔다. 특히 억제 규칙(누구에게 보내면 안 되는가)이
// 화면마다 다르게 계산되면 **거부한 사람에게 메일이 나간다** — 되돌릴 수 없다.

// ─────────────────────────── 수신 거부 ───────────────────────────

/**
 * 거부 링크의 기준 주소. **한 곳에만 둔다** —
 * 메일 본문에 들어간 뒤에는 고칠 수 없으므로 흩어지면 안 된다.
 */
export const UNSUBSCRIBE_BASE = 'https://seamspace-crm-hub.vercel.app/unsubscribe';

export function unsubscribeUrl(token: unknown, base = UNSUBSCRIBE_BASE): string | null {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  // uuid 모양만 받는다 — 아무 문자열이나 링크로 만들면 안 된다.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return null;
  return `${base}/${t}`;
}

export type MailLang = 'en' | 'ko';
export const MAIL_LANGS: readonly MailLang[] = ['en', 'ko'] as const;
export const MAIL_LANG_LABEL: Record<MailLang, string> = { en: '영어', ko: '한국어' };

/** 본문 끝에 붙는 수신 거부 문구. 요구사항의 문장을 그대로 쓴다. */
export function unsubscribeLine(token: unknown, lang: MailLang, base = UNSUBSCRIBE_BASE): string | null {
  const url = unsubscribeUrl(token, base);
  if (!url) return null;
  return lang === 'ko'
    ? `더 이상 메일을 받고 싶지 않으시면 여기에서 수신을 거부하실 수 있습니다: ${url}`
    : `If you would rather not hear from us, unsubscribe here: ${url}`;
}

/**
 * 본문 **끝**에 거부 문구를 붙인다 — LEAD-S4 (d).
 *
 * 전에는 "다시 넣기" 가 커서 위치에 넣어서, 커서가 없으면 **본문 맨 앞에 줄바꿈도 없이**
 * 들어갔다(제시카 확인). 거부 문구는 늘 맨 끝에 있어야 하므로 자리를 함수가 정한다.
 *
 * **이미 들어 있으면 넣지 않는다**(중복 방지).
 */
export function appendUnsubscribeLine(
  body: unknown, token: unknown, lang: MailLang, base = UNSUBSCRIBE_BASE,
): string {
  const text = typeof body === 'string' ? body : '';
  const line = unsubscribeLine(token, lang, base);
  if (!line) return text;
  if (hasUnsubscribeLine(text, token, base)) return text;   // 이미 있다
  const trimmed = text.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${line}` : line;
}

/** 본문에 거부 문구(또는 적어도 그 링크)가 들어 있는가. 지우면 경고한다. */
export function hasUnsubscribeLine(body: unknown, token: unknown, base = UNSUBSCRIBE_BASE): boolean {
  if (typeof body !== 'string') return false;
  const url = unsubscribeUrl(token, base);
  return !!url && body.includes(url);
}

/**
 * `List-Unsubscribe` 헤더 값 — **지금은 쓰지 않는다.**
 *
 * CRM 이 메일을 보내지 않으므로 헤더를 넣을 자리가 없다. 나중에 발송 API 를 쓰게 되면
 * 이 값을 그대로 쓴다. 지금 만들어 두는 이유는 주소 규칙이 한 곳에 모여 있어야
 * 그때 어긋나지 않기 때문이다(요구 S2-1).
 */
export function listUnsubscribeHeader(token: unknown, base = UNSUBSCRIBE_BASE): string | null {
  const url = unsubscribeUrl(token, base);
  return url ? `<${url}>` : null;
}

/** 원클릭 거부 헤더(RFC 8058)도 같이 둔다. 역시 지금은 쓰지 않는다. */
export const LIST_UNSUBSCRIBE_POST = 'List-Unsubscribe=One-Click';

// ─────────────────────────── 억제 규칙 ───────────────────────────

export interface SuppressionInput {
  email_normalized?: unknown;
  email_status?: unknown;
  email_quality?: unknown;
  unsubscribed_at?: unknown;
  marketing_consent?: unknown;
}

export type SuppressionReason =
  | 'unsubscribed' | 'no-email' | 'hold' | 'invalid' | 'bounced';

export const SUPPRESSION_LABEL: Record<SuppressionReason, string> = {
  unsubscribed: '수신 거부함',
  'no-email': '이메일 주소 없음',
  hold: '발송 보류 표시',
  invalid: '잘못된 주소',
  bounced: '반송된 주소',
};

export interface SuppressionResult {
  /** 보내면 **안 된다**. */
  blocked: boolean;
  reasons: SuppressionReason[];
  /** 막지는 않지만 알려 줄 것. */
  warnings: string[];
}

/**
 * 보내도 되는가 — 아웃리치와 CC 가 **같은 함수**를 쓴다(요구 S2-1).
 *
 * 막는 것: 수신 거부 · 주소 없음 · 발송 보류 · 잘못된 주소 · 반송.
 * 경고만: 이메일 신뢰도 ≤2.
 *
 * ⚠️ `marketing_consent=false` 는 **막는 조건이 아니다.** 가져온 리드는 전부 false 라
 *    막으면 아무에게도 보낼 수 없다. 콜드 아웃리치의 법적 근거는 나라마다 달라
 *    별도 검토 대상이다(결과 문서 §법적 안내).
 */
export function checkSuppression(l: SuppressionInput): SuppressionResult {
  const reasons: SuppressionReason[] = [];
  const warnings: string[] = [];

  if (l.unsubscribed_at) reasons.push('unsubscribed');

  const email = typeof l.email_normalized === 'string' ? l.email_normalized.trim() : '';
  if (!email) reasons.push('no-email');

  if (l.email_status === 'hold') reasons.push('hold');
  if (l.email_status === 'invalid') reasons.push('invalid');
  if (l.email_status === 'bounced') reasons.push('bounced');

  const q = l.email_quality === null || l.email_quality === undefined || l.email_quality === ''
    ? NaN
    : Number(l.email_quality);
  if (Number.isFinite(q) && q <= 2) {
    warnings.push(`이메일 신뢰도가 낮습니다 (${q}) — 주소를 한 번 더 확인하세요`);
  } else if (!Number.isFinite(q)) {
    warnings.push('이메일 신뢰도를 매긴 적이 없습니다 — 주소를 확인하세요');
  }

  if (l.marketing_consent === false || l.marketing_consent === undefined) {
    warnings.push('수신 동의 기록이 없습니다 — 콜드 아웃리치 근거를 확인하세요');
  }

  return { blocked: reasons.length > 0, reasons, warnings };
}

export function suppressionText(r: SuppressionResult): string {
  return r.reasons.map(x => SUPPRESSION_LABEL[x]).join(' · ');
}

/**
 * 미정 사실을 본문에 넣을 때 쓰는 문구 — LEAD-S4 (e).
 *
 * ⚠️ 전에는 한글 라벨을 괄호로 함께 넣어 **영어 메일에 한글이 섞였다**
 *    (`(구독 가격 (해외): we will confirm…)` — 제시카 확인).
 *    그래서 **언어에 맞는 문장만** 넣는다. 무엇에 대한 답인지는 사람이 문맥에 맞게 쓴다.
 */
export function pendingFactPhrase(lang: MailLang): string {
  return lang === 'ko'
    ? '확인 후 안내드리겠습니다.'
    : 'We will confirm and get back to you on this.';
}

// ─────────────────────── 문구 점검 (조언용) ───────────────────────

export interface RiskyPhrase {
  pattern: RegExp;
  label: string;
  why: string;
}

/**
 * 위험 표현 — **막지 않고 알려만 준다**(요구 S2-2 "조언용").
 *
 * 확정 사실과 무관하게, 이런 말은 약속으로 읽힌다. 확정된 사실을 썼더라도
 * 문장이 단정적이면 선을 넘는다(예: EdLink 는 "준비 중"까지만 말할 수 있다).
 */
// ⚠️ 한글에는 `\b`(단어 경계)를 쓰면 안 된다. JS 의 `\b` 는 `[A-Za-z0-9_]` 기준이라
//    한글 앞뒤에서는 경계가 생기지 않아 **패턴이 조용히 한 번도 걸리지 않는다**
//    (LEAD-S2 에서 테스트가 잡았다). 한글 패턴은 경계 없이 쓰거나 괄호로 묶는다.
export const RISKY_PHRASES: readonly RiskyPhrase[] = [
  { pattern: /\b(guarantee|guaranteed|guarantees)\b/i, label: 'guarantee',
    why: '보장은 약속이 됩니다. "expect"·"aim to" 처럼 적으세요.' },
  { pattern: /\bintegrates?\s+with\b/i, label: 'integrates with',
    why: '연동이 이미 된다는 뜻이 됩니다. EdLink 는 "준비 중"까지만 말할 수 있습니다.' },
  { pattern: /\b(USD|EUR|SGD|KRW)\s?\d|[$€£₩]\s?\d|\d+\s?(달러|원)|\d+\s?dollars?\b/i, label: '금액',
    why: '가격·금액은 확정된 사실만 쓸 수 있습니다. 구독 가격은 아직 미정입니다.' },
  { pattern: /\b(free\s+(trial|of\s+charge))\b|무료/i, label: '무료',
    why: '무료 제공 조건(기간·인원)이 정해지지 않았습니다.' },
  { pattern: /\b(certified|compliant|FERPA|COPPA|GDPR\s+compliant)\b/i, label: '인증·준수',
    why: '인증·규정 준수 주장은 근거가 필요합니다.' },
  { pattern: /\b(best|No\.?\s?1|number\s+one|leading)\b/i, label: '최고·1위',
    why: '비교 우위 주장은 근거가 필요합니다.' },
  { pattern: /\b(will\s+be\s+available|release\s+date|by\s+(Q[1-4]|\d{4}))\b/i, label: '시점 약속',
    why: '출시·연동 시점을 약속하면 안 됩니다.' },
  { pattern: /(정식|공식)\s?지원/, label: '정식 지원',
    why: '인도네시아어·말레이어는 **베타**입니다. "베타"를 함께 적으세요.' },
];

export interface PhraseHit { label: string; why: string; excerpt: string }

/**
 * 점검할 글 — **수신자에게 나갈 것만** (LEAD-S4 f).
 * 제목과 본문이다. 화면의 라벨·안내 문구는 섞지 않는다.
 */
export function outgoingText(subject: unknown, body: unknown): string {
  return `${String(subject ?? '')}\n${String(body ?? '')}`;
}

/** 본문·제목에서 위험 표현을 찾는다. 찾은 자리를 짧게 보여 준다. */
export function findRiskyPhrases(text: unknown): PhraseHit[] {
  if (typeof text !== 'string' || !text) return [];
  const hits: PhraseHit[] = [];
  for (const p of RISKY_PHRASES) {
    const m = text.match(p.pattern);
    if (!m) continue;
    const at = m.index ?? 0;
    hits.push({
      label: p.label,
      why: p.why,
      excerpt: text.slice(Math.max(0, at - 24), at + (m[0]?.length ?? 0) + 24).trim(),
    });
  }
  return hits;
}

// ─────────────────────── 초안 상태 흐름 ───────────────────────

export type DraftStatus = 'draft' | 'approved' | 'scheduled' | 'sent' | 'cancelled';

export const DRAFT_STATUSES: readonly DraftStatus[] = [
  'draft', 'approved', 'scheduled', 'sent', 'cancelled',
] as const;

export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  draft: '초안',
  approved: '승인됨',
  scheduled: '예약',
  sent: '발송됨',
  cancelled: '취소',
};

/** 어느 상태에서 어디로 갈 수 있는가. 되돌아가는 길은 없다(취소만). */
const NEXT: Record<DraftStatus, DraftStatus[]> = {
  draft: ['approved', 'cancelled'],
  approved: ['scheduled', 'sent', 'cancelled'],
  scheduled: ['sent', 'cancelled'],
  sent: [],            // 보낸 것은 되돌릴 수 없다
  cancelled: [],
};

export function canTransition(from: unknown, to: DraftStatus): boolean {
  const f = DRAFT_STATUSES.includes(from as DraftStatus) ? (from as DraftStatus) : 'draft';
  return NEXT[f].includes(to);
}

/** 본문을 고칠 수 있는가 — **승인된 뒤에는 못 고친다**(요구 S2-2). */
export function canEditBody(status: unknown): boolean {
  return status === 'draft';
}

export interface DraftInput {
  leadId: string;
  strategyId?: string | null;
  language: MailLang;
  subject?: string;
  body?: string;
  factIds?: string[];
}

export type DraftVerdict =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

export function buildDraft(input: DraftInput): DraftVerdict {
  if (!input.leadId) return { ok: false, error: '리드를 고르지 않았습니다.' };
  if (!MAIL_LANGS.includes(input.language)) return { ok: false, error: '언어가 올바르지 않습니다.' };
  const subject = (input.subject ?? '').trim().slice(0, 300);
  const body = (input.body ?? '').trim();
  if (!subject) return { ok: false, error: '제목을 적어 주세요.' };
  if (!body) return { ok: false, error: '본문을 적어 주세요.' };
  return {
    ok: true,
    row: {
      lead_id: input.leadId,
      strategy_id: input.strategyId ?? null,
      language: input.language,
      subject,
      body,
      fact_ids: input.factIds ?? [],
      status: 'draft',
    },
  };
}

export interface ApprovalCheck {
  canApprove: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * 승인해도 되는가.
 *
 * ⚠️ **억제 규칙에 걸리면 승인할 수 없다**(요구 S2-2). 승인은 "보내도 좋다"는 뜻이라,
 *    거부한 사람에게 보낼 초안을 승인 상태로 두면 사고가 난다.
 * 거부 문구가 빠진 것도 막는다 — 법적 요건이다.
 */
export function checkApproval(a: {
  lead: SuppressionInput & { unsubscribe_token?: unknown };
  subject?: unknown;
  body?: unknown;
  base?: string;
}): ApprovalCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const sup = checkSuppression(a.lead);
  if (sup.blocked) blockers.push(`보낼 수 없는 대상입니다 — ${suppressionText(sup)}`);
  warnings.push(...sup.warnings);

  if (!String(a.subject ?? '').trim()) blockers.push('제목이 비어 있습니다.');
  if (!String(a.body ?? '').trim()) blockers.push('본문이 비어 있습니다.');

  if (!hasUnsubscribeLine(a.body, a.lead.unsubscribe_token, a.base)) {
    blockers.push('수신 거부 문구가 본문에 없습니다.');
  }

  // LEAD-S4 (f): 점검 대상은 **수신자에게 나갈 본문**이다.
  // 제목도 수신자가 보므로 함께 보지만, 라벨·내부 메모 같은 것은 섞지 않는다.
  for (const h of findRiskyPhrases(outgoingText(a.subject, a.body))) {
    warnings.push(`"${h.label}" — ${h.why}`);
  }

  return { canApprove: blockers.length === 0, blockers, warnings };
}

/** 취소 — 사유 필수(DB CHECK 도 같은 규칙). */
export function buildCancel(reason: unknown):
  { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const r = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  if (!r) return { ok: false, error: '취소 사유를 적어 주세요.' };
  return { ok: true, patch: { status: 'cancelled', cancelled_reason: r, updated_at: new Date().toISOString() } };
}

/**
 * 발송 완료로 표시할 때 만드는 활동 기록의 모양.
 * 제목을 요약에 넣어 타임라인에서 무엇을 보냈는지 보이게 한다.
 */
export function sentActivitySummary(subject: unknown): string {
  const s = String(subject ?? '').trim();
  return s ? `메일 보냄 — ${s}` : '메일 보냄';
}

/**
 * 발송 뒤 단계를 올릴지 **제안**한다. 자동으로 바꾸지 않는다(요구 S2-2).
 * '신규'·'연락 대기' 일 때만 '1차 연락함' 을 권한다.
 */
export function suggestStageAfterSend(stage: unknown): string | null {
  return (stage === '신규' || stage === '연락 대기' || !stage) ? '1차 연락함' : null;
}

// ─────────────────── 받는 사람 시간대 ───────────────────

/** 국가 코드 → 대표 시간대(분). 예약 시각을 "현지 몇 시인가"로 보여 주기 위한 것. */
const TZ_BY_COUNTRY: Readonly<Record<string, number>> = {
  KR: 540, JP: 540,
  SG: 480, MY: 480, HK: 480, TW: 480, CN: 480, PH: 480,
  ID: 420, TH: 420, VN: 420, KH: 420, LA: 420,
  MM: 390,
  IN: 330, LK: 330,
  NP: 345,
  BD: 360,
  PK: 300, UZ: 300,
  AE: 240, OM: 240,
  SA: 180, QA: 180, KW: 180, BH: 180, TR: 180,
  GB: 0, IE: 0, PT: 0,
  DE: 60, FR: 60, ES: 60, IT: 60, NL: 60, BE: 60, CH: 60, AT: 60, SE: 60,
  NO: 60, DK: 60, PL: 60, CZ: 60, HU: 60,
  FI: 120, GR: 120, RO: 120, ZA: 120, EG: 120, IL: 120,
  US: -300, CA: -300, MX: -360,
  BR: -180, AR: -180, CL: -180,
  CO: -300, PE: -300,
  AU: 600, NZ: 780,
  MN: 480, KZ: 300, KG: 360,
};

/** 그 나라의 대표 시간대(분). 모르면 null — **추측하지 않는다**. */
export function timezoneOffsetFor(country: unknown): number | null {
  if (typeof country !== 'string') return null;
  const c = country.trim().toUpperCase();
  return c in TZ_BY_COUNTRY ? TZ_BY_COUNTRY[c] : null;
}

export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** 예약 시각을 받는 사람 현지 시각으로. 나라를 모르면 null. */
export function localTimeAt(iso: unknown, country: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const off = timezoneOffsetFor(country);
  if (off === null) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + off * 60 * 1000);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} (${offsetLabel(off)})`;
}

/**
 * 현지 시각 입력(datetime-local)을 UTC ISO 로.
 * 받는 사람 현지 시각으로 고르게 하는 것이 요구사항이라, 브라우저 시간대가 아니라
 * **그 나라의 시간대**로 해석한다.
 */
export function scheduleFromLocal(localValue: unknown, country: unknown): string | null {
  if (typeof localValue !== 'string' || !localValue) return null;
  const off = timezoneOffsetFor(country);
  const m = localValue.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  // 나라를 모르면 한국 시각으로 본다(운영자가 한국에 있다).
  return new Date(asUtc - (off ?? 540) * 60 * 1000).toISOString();
}
