// 팔로업 단계·기한·활동 기록 — LEAD-4 (CRM-013, James 최우선)
//
// 왜 이 파일이 있나
//   브리프 G항: "리드를 모으는 것보다 **팔로업이 끊기지 않게 하는 것**이 핵심."
//   싱가포르 EDUtech 은 체험권 10건을 전원 발송했는데 사용 0·구매 0 이었다 —
//   보낸 뒤 이어가는 관리가 없었다.
//
// 이 파일은 **순수 함수만** 둔다. 기한 판정("오늘 할 것인가, 지났는가")이 화면마다
// 다르게 계산되면 "지남"이 빠지고, 그게 바로 팔로업이 끊기는 지점이다.
//
// ⚠️ 날짜는 **그 사람이 보는 날짜**로 판정해야 한다. `new Date().toISOString()` 은 UTC 라
//    한국 시간 오전 9시 이전에는 **어제 날짜**가 나온다. 그러면 오늘 기한인 일이
//    "지남"으로 보이거나 오늘 목록에서 빠진다. 그래서 todayKst() 를 쓴다.

export type FollowupStage =
  | '신규' | '연락 대기' | '1차 연락함' | '응답 받음' | '미팅·데모'
  | '체험 중' | '협상' | '성사' | '보류' | '종료';

/**
 * 단계 목록 — 브리프 G항 제안 그대로.
 *
 * DB CHECK 를 **걸지 않았다**. CRM-015 가 유형별 단계 목록(세일즈 파트너·연구 파트너…)을
 * 더할 예정이라(브리프 H항) DB 에 못 박으면 그때 ALTER 가 필요해진다.
 * 대신 이 상수와 테스트로 지킨다.
 */
export const FOLLOWUP_STAGES: readonly FollowupStage[] = [
  '신규', '연락 대기', '1차 연락함', '응답 받음', '미팅·데모',
  '체험 중', '협상', '성사', '보류', '종료',
] as const;

/** 깔때기(funnel)에 세로로 쌓이는 진행 단계 — 성사/보류/종료는 결과라서 뺀다. */
export const FUNNEL_STAGES: readonly FollowupStage[] = [
  '신규', '연락 대기', '1차 연락함', '응답 받음', '미팅·데모', '체험 중', '협상',
] as const;

/** 끝난 단계 — "오늘 할 팔로업"·"7일 무접촉" 목록에서 뺀다. */
export const CLOSED_STAGES: readonly FollowupStage[] = ['성사', '보류', '종료'] as const;

export function isClosedStage(v: unknown): boolean {
  return CLOSED_STAGES.includes(v as FollowupStage);
}

/** 단계가 '종료'면 사유가 필요하다(브리프 G항 "종료(사유 필수)"). DB 가 아니라 앱이 지킨다. */
export function needsCloseReason(stage: unknown): boolean {
  return stage === '종료';
}

export type Channel = 'email' | 'whatsapp' | 'linkedin' | 'phone' | 'meeting' | 'other';
export const CHANNELS: readonly Channel[] = ['email', 'whatsapp', 'linkedin', 'phone', 'meeting', 'other'] as const;
export const CHANNEL_LABEL: Record<Channel, string> = {
  email: '메일', whatsapp: 'WhatsApp', linkedin: 'LinkedIn',
  phone: '전화', meeting: '미팅', other: '기타',
};

export type Direction = 'out' | 'in';
export const DIRECTION_LABEL: Record<Direction, string> = { out: '보냄', in: '받음' };

// ─────────────────────────── 날짜 ───────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 한국 시간 기준 오늘(YYYY-MM-DD).
 *
 * ⚠️ `new Date().toISOString().slice(0,10)` 을 쓰면 안 된다 — UTC 라서 KST 오전 9시
 *    이전에는 **어제**가 나온다. 아침에 "오늘 할 팔로업"을 여는 것이 정상 사용이므로
 *    이 실수는 매일 아침 재현된다.
 */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 두 날짜(YYYY-MM-DD) 사이의 일수. b - a. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / (24 * 3600 * 1000));
}

/** timestamptz → KST 날짜(YYYY-MM-DD). 값이 없으면 null. */
export function kstDate(ts: unknown): string | null {
  if (typeof ts !== 'string' || !ts) return null;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return null;
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// ─────────────────────── 기한 판정 ───────────────────────

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export interface FollowupRow {
  followup_stage?: unknown;
  next_action?: unknown;
  next_action_due?: unknown;     // YYYY-MM-DD
  last_contact_at?: unknown;     // timestamptz
  owner?: unknown;
  probability?: unknown;
}

/**
 * 기한 상태.
 *
 * `overdue` 는 **지났다** — 화면에서 눈에 띄게 해야 한다(브리프 G항).
 * `soon` 은 3일 안(미리 보이면 몰아치지 않는다).
 */
export function dueState(row: FollowupRow, today: string = todayKst()): DueState {
  const due = typeof row.next_action_due === 'string' ? row.next_action_due.slice(0, 10) : '';
  if (!due) return 'none';
  const d = daysBetween(today, due);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 3) return 'soon';
  return 'later';
}

/** 며칠 지났나(지나지 않았으면 0). 목록 정렬과 "3일 지남" 표시에 쓴다. */
export function overdueDays(row: FollowupRow, today: string = todayKst()): number {
  const due = typeof row.next_action_due === 'string' ? row.next_action_due.slice(0, 10) : '';
  if (!due) return 0;
  const d = daysBetween(today, due);
  return d < 0 ? -d : 0;
}

/**
 * ① **오늘 할 팔로업** — 기한이 도래했거나 지난 것.
 *
 * 끝난 단계(성사·보류·종료)는 뺀다. 기한이 없는 리드도 뺀다 —
 * "다음 행동"이 정해지지 않은 리드는 ② 7일 무접촉 목록이 잡는다.
 */
export function dueToday<T extends FollowupRow>(rows: readonly T[], today: string = todayKst()): T[] {
  return rows
    .filter(r => !isClosedStage(r.followup_stage))
    .filter(r => { const s = dueState(r, today); return s === 'overdue' || s === 'today'; })
    .sort((a, b) => {
      // 많이 지난 것이 위로, 그다음 가능성 높은 것이 위로
      const od = overdueDays(b, today) - overdueDays(a, today);
      if (od !== 0) return od;
      return probabilityOf(b) - probabilityOf(a);
    });
}

/**
 * ② **N일 넘게 접촉 없음** (기본 7일, 브리프 G항).
 *
 * `last_contact_at` 이 **아예 없는** 리드도 포함한다 — 한 번도 연락하지 않은 리드가
 * 가장 위험하다(EDUtech 10건이 정확히 이 경우였다). 그 경우 리드가 들어온 날
 * (`created_at`)을 기준으로 센다.
 */
export function staleLeads<T extends FollowupRow & { created_at?: unknown }>(
  rows: readonly T[], days = 7, today: string = todayKst(),
): T[] {
  return rows
    .filter(r => !isClosedStage(r.followup_stage))
    .map(r => ({ r, since: lastTouchDate(r) }))
    .filter(({ since }) => since !== null && daysBetween(since, today) >= days)
    // 오래 방치된 것이 위로
    .sort((a, b) => daysBetween(b.since!, today) - daysBetween(a.since!, today))
    .map(({ r }) => r);
}

/** 마지막으로 "닿은" 날 — 접촉일이 없으면 리드가 들어온 날. */
export function lastTouchDate(row: FollowupRow & { created_at?: unknown }): string | null {
  return kstDate(row.last_contact_at) ?? kstDate(row.created_at);
}

/** 며칠째 접촉이 없나. */
export function staleDays(
  row: FollowupRow & { created_at?: unknown }, today: string = todayKst(),
): number | null {
  const since = lastTouchDate(row);
  return since === null ? null : daysBetween(since, today);
}

export function probabilityOf(row: FollowupRow): number {
  const p = typeof row.probability === 'number' ? row.probability : Number(row.probability);
  return Number.isFinite(p) ? p : 0;
}

/** 단계별 건수(깔때기). 값이 없는 리드는 '신규'로 센다. */
export function stageCounts<T extends FollowupRow>(
  rows: readonly T[],
): Array<{ stage: FollowupStage; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const s = typeof r.followup_stage === 'string' && r.followup_stage ? r.followup_stage : '신규';
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return FOLLOWUP_STAGES.map(s => ({ stage: s, count: m.get(s) ?? 0 }));
}

// ─────────────────── 활동 기록 저장 모양 ───────────────────

export interface ActivityInput {
  leadId: string;
  channel: Channel;
  direction: Direction;
  summary: string;
  stageAfter?: FollowupStage | '';
  actor?: string;
  actorUserId?: string | null;
  occurredAt?: string;           // 안 주면 지금
}

export type ActivityVerdict =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

const MAX_SUMMARY = 500;

/** 활동 기록 한 줄. **빠르게** 적을 수 있어야 하므로 필수는 요약 한 줄뿐이다. */
export function buildActivity(input: ActivityInput): ActivityVerdict {
  const summary = typeof input.summary === 'string' ? input.summary.trim().slice(0, MAX_SUMMARY) : '';
  if (!input.leadId) return { ok: false, error: '리드를 고르지 않았습니다.' };
  if (!summary) return { ok: false, error: '무엇을 했는지 한 줄로 적어 주세요.' };
  if (!CHANNELS.includes(input.channel)) return { ok: false, error: '채널이 올바르지 않습니다.' };
  if (input.direction !== 'out' && input.direction !== 'in') {
    return { ok: false, error: '보냄/받음을 골라 주세요.' };
  }
  const stageAfter = input.stageAfter && FOLLOWUP_STAGES.includes(input.stageAfter)
    ? input.stageAfter : null;

  return {
    ok: true,
    row: {
      lead_id: input.leadId,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      channel: input.channel,
      direction: input.direction,
      summary,
      stage_after: stageAfter,
      actor: (input.actor ?? '').trim().slice(0, 100) || null,
      actor_user_id: input.actorUserId ?? null,
    },
  };
}

/**
 * 활동 기록을 넣을 때 리드에 같이 반영할 값.
 *
 * `last_contact_at` 을 여기서 함께 갱신한다 — 원장만 쌓고 리드를 갱신하지 않으면
 * "7일 무접촉" 목록이 **연락했는데도 계속 남아** 있다.
 *
 * ⚠️ 단계는 **적은 사람이 고른 경우에만** 바꾼다. 자동 상태 변경은 하지 않는다(명령서 지시).
 */
export function leadPatchForActivity(input: {
  occurredAt?: string;
  stageAfter?: FollowupStage | '';
  nextAction?: string;
  nextActionDue?: string;
  closeReason?: string;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    last_contact_at: input.occurredAt ?? new Date().toISOString(),
  };
  if (input.stageAfter && FOLLOWUP_STAGES.includes(input.stageAfter)) {
    patch.followup_stage = input.stageAfter;
    if (needsCloseReason(input.stageAfter)) {
      patch.close_reason = (input.closeReason ?? '').trim() || null;
    }
  }
  // 다음 행동은 **비우는 것도 뜻이 있다**(할 일이 없어졌다). 그래서 키가 오면 그대로 쓴다.
  if (input.nextAction !== undefined) patch.next_action = input.nextAction.trim() || null;
  if (input.nextActionDue !== undefined) patch.next_action_due = input.nextActionDue || null;
  return patch;
}

/**
 * 1차 연락 권장 기한 — 브리프 G항 "가능성 4~5는 24시간 안, 그 외는 48시간 안".
 * 자동으로 넣지 않고 입력 화면의 **기본값 제안**으로만 쓴다.
 */
export function suggestFirstContactDue(probability: unknown, today: string = todayKst()): string {
  const p = typeof probability === 'number' ? probability : Number(probability);
  const addDays = Number.isFinite(p) && p >= 4 ? 1 : 2;
  const d = new Date(Date.parse(`${today}T00:00:00Z`) + addDays * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
