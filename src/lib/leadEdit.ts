// 리드 수정과 변경 기록 — LEAD-UI2 R1 · R4 · R8
//
// 핵심 규칙
//   ① 중요한 칸을 바꾸면 **활동 기록에 한 줄 남긴다**. 원장은 지우지 않으므로,
//      "누가 언제 무엇을 바꿨는지"가 영구히 남는다.
//   ② 변경 기록임을 한눈에 알 수 있게 summary 앞에 `[변경]` 을 붙인다.
//   ③ 이메일을 바꾸면 email_normalized 도 **같이** 바꾼다 — 따로 두면 중복 판정이 어긋난다.

import { countryLabel } from './countries';
import { leadTypeLabel } from './leadType';
import { normalizeLeadEmail, normalizeLeadPhone } from './leadMarket';

/** 화면에서 고칠 수 있는 칸. */
export interface EditableLead {
  name?: string | null;
  school_name?: string | null;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  segment?: string | null;
  probability?: number | null;
  event_name?: string | null;
  owner?: string | null;
  source_type?: string | null;
  notes?: string | null;
  email_status?: string | null;
  followup_stage?: string | null;
  /** LEAD-S1 — 엑셀 등급 세부 구분(B-교육·B-기업·C2). 세그먼트 옆에 작게 보인다. */
  segment_detail?: string | null;
  /** LEAD-S4 — 리드 유형(브리프 H항). 바뀌면 활동 기록에 남는다. */
  lead_type?: string | null;
}

/** 바뀌면 **활동 기록을 남기는** 칸 (요구 R1). 메모·직함처럼 자주 다듬는 칸은 뺀다. */
export const TRACKED_FIELDS = [
  'name', 'school_name', 'email', 'country', 'followup_stage',
  'segment', 'probability', 'email_status',
  // LEAD-S4: 유형이 바뀌면 단계 목록과 기본 다음 행동이 달라진다 — 이력에 남아야 한다.
  'lead_type',
] as const;
export type TrackedField = typeof TRACKED_FIELDS[number];

export const FIELD_LABEL: Record<keyof EditableLead, string> = {
  name: '이름',
  school_name: '소속',
  position: '직함',
  email: '이메일',
  phone: '휴대폰',
  country: '국가',
  segment: '세그먼트',
  probability: '가능성',
  event_name: '행사명',
  owner: '담당자',
  source_type: '출처 유형',
  notes: '메모',
  email_status: '이메일 상태',
  followup_stage: '단계',
  segment_detail: '세그먼트 상세',
  lead_type: '리드 유형',
};

export const EMAIL_STATUS_LABEL: Record<string, string> = {
  unverified: '확인 안 함',
  valid: '확인됨',
  invalid: '잘못된 주소',
  bounced: '반송됨',
  hold: '발송 보류',
};

/**
 * 발송 보류 표시 문구 — **의미가 보이게**(요구 R4).
 *
 * 이 값은 시스템이 이메일을 검증한 결과가 **아니다.** 가져온 엑셀의 '발송 가능' 칸
 * 표시를 그대로 옮긴 것이다. 그래서 화면에 "(엑셀에서 표시)" 를 붙인다 —
 * 붙이지 않으면 "우리 시스템이 이 주소를 문제 있다고 판단했다"로 읽힌다.
 */
export function emailStatusLabel(v: unknown, fromImport = true): string {
  const s = typeof v === 'string' ? v : '';
  if (s === 'hold') return fromImport ? '발송 보류 (엑셀에서 표시)' : '발송 보류';
  return EMAIL_STATUS_LABEL[s] ?? '확인 안 함';
}

export const EMAIL_STATUS_HELP =
  '가져온 엑셀의 "발송 가능" 칸을 그대로 옮긴 값입니다. ' +
  '우리 시스템이 이메일 주소를 검증한 결과가 아닙니다.';

/** 이메일 신뢰도 — 숫자만 보여 주면 뜻을 모른다(요구 R4). */
export function qualityLabel(v: unknown): string {
  // ⚠️ `Number(null)` 은 0 이다. 걸러 내지 않으면 **신뢰도를 매긴 적 없는 리드**가
  //    "낮음 (0)" 으로 보여 "우리가 낮다고 판단했다"로 읽힌다. 빈 값은 '—' 여야 한다.
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n <= 2) return `낮음 (${n})`;
  if (n <= 3) return `보통 (${n})`;
  return `높음 (${n})`;
}

export const QUALITY_HELP =
  '손글씨 판독·추측 표시가 있거나 무료 메일이면 낮아집니다. 1~5.';

export interface MailableInput {
  email_normalized?: unknown;
  email_status?: unknown;
  email_quality?: unknown;
  marketing_consent?: unknown;
  unsubscribed_at?: unknown;
}

/**
 * "메일 발송 가능" 판정 (요구 R4 필터).
 *   발송 보류 아님 AND 신뢰도 3 이상 AND 수신 거부 아님 AND 주소가 있음.
 *
 * ⚠️ 신뢰도가 **비어 있으면 보내지 않는다.** 모르는 것을 괜찮다고 보면
 *    보류해야 할 주소로 메일이 나간다 — 되돌릴 수 없다.
 */
export function isMailable(l: MailableInput): boolean {
  if (!normalizeLeadEmail(l.email_normalized)) return false;
  if (l.email_status === 'hold' || l.email_status === 'invalid' || l.email_status === 'bounced') return false;
  if (l.unsubscribed_at) return false;
  const q = typeof l.email_quality === 'number' ? l.email_quality : Number(l.email_quality);
  return Number.isFinite(q) && q >= 3;
}

// ─────────────────── 변경 기록 ───────────────────

const EMPTY = '(비어 있음)';

/** 값을 사람이 읽는 문자열로. 국가는 "싱가포르 (SG)", 이메일 상태는 한글로. */
export function displayValue(field: keyof EditableLead, v: unknown): string {
  if (v === null || v === undefined || v === '') return EMPTY;
  if (field === 'country') return countryLabel(v, EMPTY);
  if (field === 'email_status') return emailStatusLabel(v, false);
  if (field === 'lead_type') return leadTypeLabel(v, EMPTY);
  return String(v);
}

export interface FieldChange {
  field: keyof EditableLead;
  before: unknown;
  after: unknown;
  /** 활동 기록에 쓸 한 줄 */
  line: string;
}

const same = (a: unknown, b: unknown) => {
  const na = a === null || a === undefined || a === '' ? null : a;
  const nb = b === null || b === undefined || b === '' ? null : b;
  if (na === null && nb === null) return true;
  return String(na) === String(nb);
};

/** 바뀐 칸만 골라 낸다(기록 대상 칸만). */
export function diffTracked(before: EditableLead, after: EditableLead): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of TRACKED_FIELDS) {
    if (same(before[f], after[f])) continue;
    out.push({
      field: f,
      before: before[f],
      after: after[f],
      line: `${FIELD_LABEL[f]}: ${displayValue(f, before[f])} → ${displayValue(f, after[f])}`,
    });
  }
  return out;
}

/** 변경 기록 한 줄. 앞에 `[변경]` 을 붙여 사람이 적은 기록과 구분한다. */
export function changeSummary(changes: readonly FieldChange[]): string {
  return `[변경] ${changes.map(c => c.line).join(' · ')}`;
}

export const CHANGE_PREFIX = '[변경]';
export const ARCHIVE_PREFIX = '[보관]';

export function isChangeRecord(summary: unknown): boolean {
  return typeof summary === 'string' && summary.startsWith(CHANGE_PREFIX);
}

/**
 * 사람이 적은 기록이 아니라 **시스템이 남긴 기록**인가.
 *
 * ⚠️ `[변경]` 뿐 아니라 `[보관]` 도 시스템 기록이다. 둘 다 DB CHECK 때문에
 *    `direction='out'` 으로 저장되므로, 하나만 걸러 내면 나머지가 **접촉 차수로
 *    세어진다**(리드를 보관한 것이 "2차 접촉"이 된다 — LEAD-S1 에서 테스트가 잡았다).
 *    접두사를 더할 때 이 함수만 고치면 되도록 한 곳에 모았다.
 */
export function isSystemRecord(summary: unknown): boolean {
  if (typeof summary !== 'string') return false;
  return summary.startsWith(CHANGE_PREFIX) || summary.startsWith(ARCHIVE_PREFIX);
}

/**
 * 저장할 패치. 이메일을 바꾸면 `email_normalized` 를, 휴대폰을 바꾸면
 * `phone_normalized` 를 **같이** 넣는다 — 따로 두면 중복 판정이 어긋난다.
 */
export function buildEditPatch(before: EditableLead, after: EditableLead): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const FIELDS = Object.keys(FIELD_LABEL) as Array<keyof EditableLead>;
  for (const f of FIELDS) {
    if (same(before[f], after[f])) continue;
    const v = after[f];
    patch[f] = v === '' || v === undefined ? null : v;
  }
  if ('email' in patch) patch.email_normalized = normalizeLeadEmail(after.email);
  if ('phone' in patch) patch.phone_normalized = normalizeLeadPhone(after.phone) || null;
  return patch;
}

export interface DupWarning {
  id: string;
  name?: unknown;
}

/**
 * 이메일을 바꿀 때 같은 주소의 다른 리드가 있는지 — **막지 않고 알려만 준다**(요구 R1).
 * 같은 사람이 두 번 들어간 것일 수도, 공용 주소를 쓰는 다른 사람일 수도 있어
 * 사람이 판단해야 한다.
 */
export function findEmailDuplicates<T extends { id: string; email_normalized?: unknown }>(
  myId: string, email: unknown, all: readonly T[],
): T[] {
  const e = normalizeLeadEmail(email);
  if (!e) return [];
  return all.filter(l => l.id !== myId && normalizeLeadEmail(l.email_normalized) === e);
}

// ─────────────────── 보관(archive) — 요구 R8 ───────────────────

/** 보관 사유 한 줄. 사유를 안 적으면 "(사유 없음)". */
export function archiveSummary(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  return `${ARCHIVE_PREFIX} 보관함: ${r || '(사유 없음)'}`;
}

export function unarchiveSummary(): string {
  return `${ARCHIVE_PREFIX} 보관 해제`;
}

export function isArchived(l: { archived_at?: unknown }): boolean {
  return !!l.archived_at;
}

/**
 * 보관된 리드를 뺀다.
 *
 * ⚠️ "오늘 할 팔로업"·"7일 넘게 접촉 없음" 은 **반드시** 보관본을 빼야 한다(요구 R8).
 *    시험 리드가 거기 남으면 매일 아침 목록이 지저분해져서 화면을 안 보게 된다.
 */
export function excludeArchived<T extends { archived_at?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter(r => !r.archived_at);
}
