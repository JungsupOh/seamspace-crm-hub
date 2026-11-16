// 접근 전략·관심 신호·조사 메모·쓸 수 있는 사실 — LEAD-S1 (CRM-024)
//
// James 의 흐름:
//   현장 수집 → 등록 → 수집 정보·추가 검색 → **접근 전략 수립**
//     → 1차 접촉 → **전략 수정** → 2차 접촉 → …
//
// 이 파일은 **순수 함수만** 둔다. "몇 차 접촉인가"와 "현재 전략이 무엇인가"가
// 화면마다 다르게 계산되면, 타임라인의 차수와 전략 카드의 버전이 어긋난다.

import { isSystemRecord } from './leadEdit';

// ─────────────────────────── 관심 신호 ───────────────────────────

export type SignalType =
  | 'board_game' | 'pricing' | 'lms' | 'special_ed' | 'language'
  | 'pilot' | 'partnership' | 'trial' | 'demo' | 'other';

export const SIGNAL_TYPES: readonly SignalType[] = [
  'board_game', 'pricing', 'lms', 'special_ed', 'language',
  'pilot', 'partnership', 'trial', 'demo', 'other',
] as const;

export const SIGNAL_LABEL: Record<SignalType, string> = {
  board_game: '보드게임',
  pricing: '가격 문의',
  lms: 'LMS 연동',
  special_ed: '특수교육',
  language: '언어 지원',
  pilot: '파일럿',
  partnership: '제휴 관심',
  trial: '체험 요청',
  demo: '데모 요청',
  other: '기타',
};

export type SignalSource = 'field' | 'badge' | 'trial' | 'email' | 'research' | 'other';
export const SIGNAL_SOURCES: readonly SignalSource[] = [
  'field', 'badge', 'trial', 'email', 'research', 'other',
] as const;
export const SIGNAL_SOURCE_LABEL: Record<SignalSource, string> = {
  field: '현장 상담',
  badge: '배지 스캔',
  trial: '체험권',
  email: '메일',
  research: '조사',
  other: '기타',
};

export interface SignalInput {
  leadId: string;
  signalType: SignalType;
  note?: string;
  source?: SignalSource;
  observedAt?: string;          // YYYY-MM-DD
}

export type SignalVerdict =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

const MAX_NOTE = 500;

/**
 * 신호 한 줄.
 *
 * ⚠️ **유형만으로도 저장된다**(메모는 선택). 부스에서는 한 손으로 적어야 해서
 *    메모를 필수로 하면 아예 안 적는다. 반대로 '기타'는 메모가 없으면 뜻이 없으므로
 *    그때만 메모를 요구한다.
 */
export function buildSignal(input: SignalInput): SignalVerdict {
  if (!input.leadId) return { ok: false, error: '리드를 고르지 않았습니다.' };
  if (!SIGNAL_TYPES.includes(input.signalType)) {
    return { ok: false, error: '신호 유형이 올바르지 않습니다.' };
  }
  const note = (input.note ?? '').trim().slice(0, MAX_NOTE);
  if (input.signalType === 'other' && !note) {
    return { ok: false, error: "'기타'는 무엇인지 한 줄 적어 주세요." };
  }
  const source = input.source && SIGNAL_SOURCES.includes(input.source) ? input.source : 'field';
  return {
    ok: true,
    row: {
      lead_id: input.leadId,
      signal_type: input.signalType,
      note: note || null,
      source,
      ...(input.observedAt ? { observed_at: input.observedAt } : {}),
    },
  };
}

// ─────────────────────────── 조사 메모 ───────────────────────────

export interface ResearchInput {
  leadId: string;
  title: string;
  body?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  collectedBy?: string;
}

export type ResearchVerdict =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

/** 링크는 http(s) 만 받는다 — `javascript:` 같은 것이 화면 링크로 들어가면 안 된다. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s.slice(0, 1000);
}

export function buildResearch(input: ResearchInput): ResearchVerdict {
  if (!input.leadId) return { ok: false, error: '리드를 고르지 않았습니다.' };
  const title = (input.title ?? '').trim().slice(0, 200);
  if (!title) return { ok: false, error: '제목을 적어 주세요.' };
  const url = input.sourceUrl?.trim() ? safeUrl(input.sourceUrl) : null;
  if (input.sourceUrl?.trim() && !url) {
    return { ok: false, error: '링크는 http:// 또는 https:// 로 시작해야 합니다.' };
  }
  return {
    ok: true,
    row: {
      lead_id: input.leadId,
      title,
      body: (input.body ?? '').trim() || null,
      source_label: (input.sourceLabel ?? '').trim().slice(0, 200) || null,
      source_url: url,
      collected_by: (input.collectedBy ?? '').trim().slice(0, 100) || null,
    },
  };
}

/** 취소(void) — 지우지 않고 표시만. 사유는 **필수**다. */
export function buildVoid(reason: unknown, nowIso = new Date().toISOString()):
  { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const r = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  if (!r) return { ok: false, error: '취소 사유를 적어 주세요.' };
  return { ok: true, patch: { voided_at: nowIso, void_reason: r } };
}

export function isVoided(row: { voided_at?: unknown }): boolean {
  return !!row.voided_at;
}

// ─────────────────────────── 쓸 수 있는 사실 ───────────────────────────

export type FactStatus = 'confirmed' | 'pending' | 'retired';
export const FACT_STATUSES: readonly FactStatus[] = ['confirmed', 'pending', 'retired'] as const;
export const FACT_STATUS_LABEL: Record<FactStatus, string> = {
  confirmed: '확정',
  pending: '미정',
  retired: '중단',
};

export interface OutreachFact {
  id: string;
  fact_key: string;
  label_ko: string;
  statement_en?: string | null;
  statement_ko?: string | null;
  status: string;
  caveat?: string | null;
  source?: string | null;
}

/** 미정 사실을 메일에 쓸 때 대신 넣는 문구 — 숫자나 조건을 쓰지 않게 한다. */
export const PENDING_PLACEHOLDER = '확인 후 안내';

export function isConfirmed(f: { status?: unknown }): boolean {
  return f.status === 'confirmed';
}

/**
 * 전략이 고른 사실 검증 — **확정만 쓸 수 있다**(요구 S1-2).
 *
 * ⚠️ 미정 사실을 고르면 조용히 버리지 않고 **무엇이 빠졌는지 돌려준다.**
 *    조용히 버리면 "골랐는데 메일에 안 들어간" 줄 모르고 넘어간다.
 */
export function validateFactSelection(
  ids: readonly string[], facts: readonly OutreachFact[],
): { usable: string[]; rejected: Array<{ id: string; label: string; reason: string }> } {
  const byId = new Map(facts.map(f => [f.id, f]));
  const usable: string[] = [];
  const rejected: Array<{ id: string; label: string; reason: string }> = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (!f) { rejected.push({ id, label: '(없는 사실)', reason: '찾을 수 없습니다' }); continue; }
    if (f.status === 'confirmed') { usable.push(id); continue; }
    rejected.push({
      id, label: f.label_ko,
      reason: f.status === 'pending'
        ? `미정이라 메일에 쓸 수 없습니다 — "${PENDING_PLACEHOLDER}"로만 답하세요`
        : '중단된 사실입니다',
    });
  }
  return { usable, rejected };
}

/** 상태 변경 로그 문장. 사람이 읽을 한 줄을 한 곳에서 만든다. */
export function factStatusLogLine(
  oldStatus: unknown, newStatus: unknown, note?: unknown,
): string {
  const lbl = (s: unknown) =>
    FACT_STATUS_LABEL[s as FactStatus] ?? (s ? String(s) : '(없음)');
  const base = `${lbl(oldStatus)} → ${lbl(newStatus)}`;
  const n = typeof note === 'string' ? note.trim() : '';
  return n ? `${base} · ${n}` : base;
}

// ─────────────────────────── 접근 전략 ───────────────────────────

export interface Strategy {
  id: string;
  lead_id: string;
  version: number;
  goal?: string | null;
  angle?: string | null;
  key_points?: string | null;
  fact_ids?: unknown;
  avoid_text?: string | null;
  next_contact_plan?: string | null;
  rationale?: string | null;
  based_on_activity_id?: string | null;
  created_at?: string;
}

/** `fact_ids` 는 jsonb 라 무엇이든 올 수 있다. 문자열 배열로만 받아들인다. */
export function factIdsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/**
 * **현재 전략 = 가장 큰 version**(요구 S1-1).
 *
 * 날짜로 고르지 않는다 — 같은 날 두 판을 쓰면 순서가 흔들린다.
 */
export function currentStrategy(list: readonly Strategy[]): Strategy | null {
  let best: Strategy | null = null;
  for (const s of list) {
    if (!best || s.version > best.version) best = s;
  }
  return best;
}

export function nextVersion(list: readonly Strategy[]): number {
  const cur = currentStrategy(list);
  return cur ? cur.version + 1 : 1;
}

export interface StrategyDraft {
  version: number;
  goal: string;
  angle: string;
  keyPoints: string;
  factIds: string[];
  avoidText: string;
  nextContactPlan: string;
  rationale: string;
  basedOnActivityId: string | null;
}

/**
 * 새 판 초안 — **이전 판 내용을 미리 채운다**(요구 S1-2).
 *
 * ⚠️ `rationale`(왜 바꿨나)만 **비운다.** 이전 근거를 그대로 남기면 "무엇을 왜
 *    바꿨는지"가 거짓이 된다 — 전략 이력을 쌓는 뜻이 사라진다.
 */
export function draftNextVersion(
  list: readonly Strategy[], basedOnActivityId: string | null = null,
): StrategyDraft {
  const cur = currentStrategy(list);
  return {
    version: nextVersion(list),
    goal: cur?.goal ?? '',
    angle: cur?.angle ?? '',
    keyPoints: cur?.key_points ?? '',
    factIds: factIdsOf(cur?.fact_ids),
    avoidText: cur?.avoid_text ?? '',
    nextContactPlan: cur?.next_contact_plan ?? '',
    rationale: '',
    basedOnActivityId,
  };
}

export type StrategyVerdict =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * 전략 한 판.
 *
 * 목표(goal)만 필수다. 1판은 근거가 없을 수 있지만(처음이라서),
 * **2판 이상은 근거를 요구한다** — 왜 바꿨는지가 이력의 핵심이다.
 */
export function buildStrategy(
  leadId: string, draft: StrategyDraft, facts: readonly OutreachFact[],
): StrategyVerdict {
  if (!leadId) return { ok: false, error: '리드를 고르지 않았습니다.' };
  const goal = (draft.goal ?? '').trim().slice(0, 300);
  if (!goal) return { ok: false, error: '이번 접촉의 목표를 한 줄 적어 주세요.' };
  if (draft.version >= 2 && !(draft.rationale ?? '').trim()) {
    return { ok: false, error: '이전 판에서 무엇을 왜 바꿨는지 적어 주세요.' };
  }
  const { usable, rejected } = validateFactSelection(draft.factIds ?? [], facts);
  if (rejected.length > 0) {
    return { ok: false, error: `쓸 수 없는 사실이 있습니다: ${rejected.map(r => r.label).join(', ')}` };
  }
  return {
    ok: true,
    row: {
      lead_id: leadId,
      version: draft.version,
      goal,
      angle: (draft.angle ?? '').trim() || null,
      key_points: (draft.keyPoints ?? '').trim() || null,
      fact_ids: usable,
      avoid_text: (draft.avoidText ?? '').trim() || null,
      next_contact_plan: (draft.nextContactPlan ?? '').trim() || null,
      rationale: (draft.rationale ?? '').trim() || null,
      based_on_activity_id: draft.basedOnActivityId ?? null,
    },
  };
}

// ─────────────────────────── n차 접촉 ───────────────────────────

export interface ActivityRow {
  id?: string;
  direction?: unknown;
  summary?: unknown;
  attempt_no?: unknown;
  outcome?: unknown;
  learning?: unknown;
  strategy_id?: unknown;
  occurred_at?: unknown;
  voided_at?: unknown;
}

/**
 * 이 기록이 **접촉**인가 — 차수를 세는 대상인지.
 *
 * ⚠️ 보낸 것(`out`)만, 그리고 **시스템 기록은 뺀다.**
 *    `[변경]`·`[보관]` 둘 다 `direction='out'` 으로 저장되므로(DB CHECK 가 값을
 *    요구한다) 걸러 내지 않으면 국가를 한 번 고친 것이나 리드를 보관한 것이
 *    "2차 접촉"으로 세어진다. 판정은 leadEdit.isSystemRecord 한 곳에 있다.
 */
export function isOutreach(a: ActivityRow): boolean {
  if (a.direction !== 'out') return false;
  if (a.voided_at) return false;
  return !isSystemRecord(a.summary);
}

/** 다음 차수 — 기존 접촉 기록 수 + 1. */
export function nextAttemptNo(activities: readonly ActivityRow[]): number {
  return activities.filter(isOutreach).length + 1;
}

/**
 * 타임라인에 보일 차수를 **시간순으로 다시 매긴다**.
 *
 * 저장된 `attempt_no` 를 그대로 믿지 않는 이유: 과거 기록을 나중에 넣거나
 * 취소하면 번호에 구멍이 생긴다. 보여 줄 때 한 번 더 세면 늘 1,2,3… 이 된다.
 */
export function attemptNumbers(activities: readonly ActivityRow[]): Map<string, number> {
  const out = [...activities]
    .filter(isOutreach)
    .sort((a, b) => String(a.occurred_at ?? '').localeCompare(String(b.occurred_at ?? '')));
  const m = new Map<string, number>();
  out.forEach((a, i) => { if (a.id) m.set(a.id, i + 1); });
  return m;
}

export type Outcome =
  | 'no_reply' | 'replied' | 'bounced' | 'meeting' | 'trial_started' | 'declined' | 'other';

export const OUTCOMES: readonly Outcome[] = [
  'no_reply', 'replied', 'bounced', 'meeting', 'trial_started', 'declined', 'other',
] as const;

export const OUTCOME_LABEL: Record<Outcome, string> = {
  no_reply: '답 없음',
  replied: '답장 받음',
  bounced: '반송',
  meeting: '미팅 잡힘',
  trial_started: '체험 시작',
  declined: '거절',
  other: '기타',
};

/** 결과가 전략을 고칠 만한 것인가 — 화면이 "전략을 고칠까요?" 를 띄우는 기준. */
export function suggestsRevision(outcome: unknown): boolean {
  return outcome === 'replied' || outcome === 'meeting'
    || outcome === 'trial_started' || outcome === 'declined' || outcome === 'bounced';
}

/**
 * 가장 최근 접촉 중 **결과가 적혔고 아직 그 뒤로 전략 판이 없는** 것.
 * 있으면 "결과가 기록됐습니다. 전략을 고칠까요?" 를 보여 준다.
 */
export function pendingRevision(
  activities: readonly ActivityRow[], strategies: readonly Strategy[],
): ActivityRow | null {
  const done = [...activities]
    .filter(a => isOutreach(a) && !!a.outcome && suggestsRevision(a.outcome))
    .sort((a, b) => String(b.occurred_at ?? '').localeCompare(String(a.occurred_at ?? '')));
  const last = done[0];
  if (!last || !last.id) return null;
  // 이미 그 접촉을 근거로 쓴 판이 있으면 더 묻지 않는다.
  if (strategies.some(s => s.based_on_activity_id === last.id)) return null;
  return last;
}
