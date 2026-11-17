// 리드 관리 화면이 쓰는 DB 입구 — LEAD-3·4 (CRM-012·013)
//
// ⚠️ 보안 규칙(명령서): **로그인 세션 토큰**으로만 호출한다. 공개 키(anon)로
//    rest/v1 을 직접 부르지 않는다. 그래서 authedFetch 를 쓴다(021-8b-3).
//    apikey 헤더에 공개 키를 넣는 것은 정상이다 — Authorization 자리에만 쓰지 않으면 된다.

import { authedFetch } from '@/lib/authedFetch';
import { leadKeyColumns, type Market } from '@/lib/leadMarket';
import { buildActivity, leadPatchForActivity, type ActivityInput, type FollowupStage } from '@/lib/leadFollowup';
import {
  archiveSummary, buildEditPatch, changeSummary, diffTracked, unarchiveSummary,
  type EditableLead,
} from '@/lib/leadEdit';
import { sentActivitySummary } from '@/lib/outreach';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const HEADERS = {
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

/** 리드 목록 한 줄. 새 칸(LEAD-2·3·4)까지 포함한다. */
export interface LeadRow {
  id: string;
  campaign_id: string | null;
  name: string;
  phone?: string | null;
  phone_normalized?: string | null;
  email?: string | null;
  email_normalized?: string | null;
  market?: string | null;
  school_name?: string | null;
  position?: string | null;
  status?: string | null;
  created_at: string;
  custom_fields?: Record<string, unknown> | null;

  // LEAD-3
  country?: string | null;
  segment?: string | null;
  probability?: number | null;
  event_name?: string | null;
  source_type?: string | null;
  email_quality?: number | null;
  email_status?: string | null;
  notes?: string | null;

  // LEAD-4
  followup_stage?: string | null;
  last_contact_at?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  owner?: string | null;
  close_reason?: string | null;

  // LEAD-6
  import_batch_id?: string | null;

  // LEAD-UI2
  archived_at?: string | null;

  // LEAD-S1 — 엑셀 등급의 세부 구분(B-교육·B-기업·C2). 값은 제시카가 채운다.
  segment_detail?: string | null;

  // LEAD-S2 — 수신 거부
  unsubscribe_token?: string | null;
  unsubscribed_at?: string | null;
  marketing_consent?: boolean | null;

  // LEAD-S4 — 리드 유형(브리프 H항)
  lead_type?: string | null;
  lead_tags?: unknown;

  // LEAD-S7-7a — 파트너가 직접 넣은 리드. NULL = 우리가 넣은 리드.
  partner_id?: string | null;
  partner_claimed_at?: string | null;
  contact_owner?: string | null;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  occurred_at: string;
  channel: string;
  direction: string;
  summary: string;
  stage_after?: string | null;
  actor?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;

  // LEAD-S1
  attempt_no?: number | null;
  strategy_id?: string | null;
  outcome?: string | null;
  learning?: string | null;
}

/** 목록이 쓰는 열만 읽는다(select=*  금지 — 쓰지 않는 열까지 내려받지 않는다). */
const LEAD_COLS = [
  'id', 'campaign_id', 'name', 'phone', 'phone_normalized', 'email', 'email_normalized',
  'market', 'school_name', 'position', 'status', 'created_at', 'custom_fields',
  'country', 'segment', 'probability', 'event_name', 'source_type',
  'email_quality', 'email_status', 'notes',
  'followup_stage', 'last_contact_at', 'next_action', 'next_action_due', 'owner', 'close_reason',
  'import_batch_id', 'archived_at', 'segment_detail',
  'unsubscribe_token', 'unsubscribed_at', 'marketing_consent',
  'lead_type', 'lead_tags',
  // LEAD-S7-7b: 파트너 등록 구분·보호 기간 (⚠️ 마이그레이션 20261205000000 이
  // 적용된 뒤에 배포해야 한다 — 없는 칸을 요청하면 PostgREST 가 400 을 돌려주고
  // 목록이 통째로 안 보인다. S4 에서 한 번 겪었다.)
  'partner_id', 'partner_claimed_at', 'contact_owner',
].join(',');

export async function getLeads(): Promise<LeadRow[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?select=${LEAD_COLS}&order=created_at.desc&limit=20000`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('리드 조회 실패');
  return r.json();
}

export async function getCampaignNames(): Promise<Array<{ id: string; name: string }>> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/campaigns?select=id,name&order=created_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}

export async function getActivities(leadId: string): Promise<LeadActivity[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_activities?lead_id=eq.${encodeURIComponent(leadId)}` +
      `&select=id,lead_id,occurred_at,channel,direction,summary,stage_after,actor,voided_at,void_reason,` +
      `attempt_no,strategy_id,outcome,learning` +
      `&order=occurred_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('활동 기록 조회 실패');
  return r.json();
}

export interface SaveActivityInput extends ActivityInput {
  nextAction?: string;
  nextActionDue?: string;
  closeReason?: string;

  // LEAD-S1 — 접촉을 n차·전략·결과와 잇는다
  /** 몇 차 접촉인가. 화면이 nextAttemptNo 로 계산해 넘긴다(보낸 접촉만 센다). */
  attemptNo?: number | null;
  /** 그때 어느 전략 판으로 보냈나 */
  strategyId?: string | null;
  outcome?: string | null;
  learning?: string | null;
}

/** 활동 기록을 남기는 사람. 화면이 로그인 사용자로 채운다(LEAD-UI2 R1·R8). */
export interface Actor {
  name?: string | null;
  userId?: string | null;
}

/**
 * 활동 기록 한 줄을 남기고 리드의 현재 상태를 같이 갱신한다.
 *
 * ⚠️ 두 번 쓰기(원장 INSERT + 리드 PATCH)인데 트랜잭션이 없다. 순서를 **원장 먼저**로
 *    둔다 — 원장이 들어가고 리드 갱신이 실패하면 "기록은 있는데 마지막 접촉일이 안 바뀜"
 *    (다시 저장하면 복구된다). 반대 순서면 "접촉했다고 표시되는데 기록이 없다"가 되어
 *    원장의 뜻이 깨진다. 원장은 지우지 않는 기록이므로 그쪽을 진실로 삼는다.
 */
export async function saveActivity(input: SaveActivityInput): Promise<void> {
  const built = buildActivity(input);
  // 이 저장소는 strictNullChecks 가 꺼져 있어 판별 유니온이 좁혀지지 않는다.
  // (기존 테스트 66곳에 같은 오류가 있다 — audit/lead2_market_mode.md §3 참고.)
  // 그래서 ok 를 먼저 확인하고 분기 안에서 좁혀 쓴다.
  if (built.ok !== true) {
    throw new Error('error' in built ? built.error : '활동 기록을 만들 수 없습니다.');
  }

  const ins = await authedFetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({
      ...built.row,
      // LEAD-S1: 사람이 적은 접촉에만 붙는다. 시스템 기록(logSystemActivity)은
      // 이 함수를 지나지 않으므로 차수가 매겨지지 않는다.
      attempt_no: input.attemptNo ?? null,
      strategy_id: input.strategyId ?? null,
      outcome: input.outcome || null,
      learning: input.learning?.trim() || null,
    }),
  });
  if (!ins.ok) throw new Error('활동 기록 저장 실패');

  const patch = leadPatchForActivity({
    occurredAt: input.occurredAt,
    stageAfter: input.stageAfter,
    nextAction: input.nextAction,
    nextActionDue: input.nextActionDue,
    closeReason: input.closeReason,
  });
  const up = await authedFetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${encodeURIComponent(input.leadId)}`,
    { method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch) },
  );
  if (!up.ok) throw new Error('리드 상태 갱신 실패 (활동 기록은 저장됐습니다)');
}

/** 리드의 칸을 고친다(단계·담당자·가능성·다음 행동 등). 활동 기록 없이 쓰는 경로. */
export async function patchLead(id: string, patch: Record<string, unknown>): Promise<void> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch) },
  );
  if (!r.ok) throw new Error('리드 저장 실패');
}

export interface NewLeadInput {
  market: Market;
  name: string;
  email?: string;
  phone?: string;
  school_name?: string;
  country?: string;
  event_name?: string;
  segment?: string;
  probability?: number;
  owner?: string;
  source_type?: string;
  notes?: string;
  campaign_id?: string | null;
  followup_stage?: FollowupStage;
  import_batch_id?: string | null;
  email_quality?: number;
  email_status?: string;
}

/** 리드를 만든다. 열쇠 칸(market·phone_normalized·email_normalized)은 한 곳에서 채운다. */
export function buildLeadRow(input: NewLeadInput): Record<string, unknown> {
  const keys = leadKeyColumns(input);
  return {
    campaign_id: input.campaign_id ?? null,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    school_name: input.school_name?.trim() || null,
    country: input.country?.trim() || null,
    event_name: input.event_name?.trim() || null,
    segment: input.segment || null,
    probability: input.probability ?? null,
    owner: input.owner?.trim() || null,
    source_type: input.source_type || null,
    notes: input.notes?.trim() || null,
    followup_stage: input.followup_stage ?? '신규',
    email_quality: input.email_quality ?? null,
    email_status: input.email_status ?? null,
    import_batch_id: input.import_batch_id ?? null,
    ...keys,
  };
}

export async function insertLeads(rows: Record<string, unknown>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await authedFetch(`${SUPABASE_URL}/rest/v1/campaign_leads`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error('리드 등록 실패');
  return rows.length;
}

/**
 * 가져온 묶음을 되돌린다 — **그 묶음으로 들어온 리드만** 지운다.
 * 활동 기록은 ON DELETE CASCADE 로 함께 사라진다(가져오기가 만든 것뿐이다).
 */
export async function deleteImportBatch(batchId: string): Promise<void> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?import_batch_id=eq.${encodeURIComponent(batchId)}`,
    { method: 'DELETE', headers: HEADERS },
  );
  if (!r.ok) throw new Error('가져오기 취소 실패');
}

// ─────────────────── LEAD-UI2 R1 · R7 · R8 ───────────────────

/** 시스템이 남기는 기록(변경·보관·CC). 사람이 적은 기록과 같은 원장에 쌓인다. */
async function logSystemActivity(leadId: string, summary: string, actor: Actor, stageAfter?: string | null) {
  const r = await authedFetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({
      lead_id: leadId,
      occurred_at: new Date().toISOString(),
      // 시스템 기록도 채널·방향이 필수(DB CHECK)라 값을 넣는다. summary 앞의
      // `[변경]`·`[보관]` 으로 사람이 적은 기록과 구분한다.
      channel: 'other',
      direction: 'out',
      summary,
      stage_after: stageAfter ?? null,
      actor: actor.name?.trim() || null,
      actor_user_id: actor.userId ?? null,
    }),
  });
  if (!r.ok) throw new Error('변경 기록 저장 실패');
}

/**
 * 리드를 고치고 **변경 기록을 같이 남긴다**(R1).
 *
 * ⚠️ 순서는 **리드 저장 먼저, 기록 나중**이다. 기록이 먼저 들어가고 저장이 실패하면
 *    "바꿨다고 적혀 있는데 값은 그대로"가 되어 원장이 거짓이 된다.
 *    반대 순서면 "값은 바뀌었는데 기록이 빠짐" — 다시 저장하면 복구된다.
 */
export async function saveLeadEdit(
  id: string, before: EditableLead, after: EditableLead, actor: Actor,
): Promise<{ changed: boolean; logged: boolean }> {
  const patch = buildEditPatch(before, after);
  if (Object.keys(patch).length === 0) return { changed: false, logged: false };

  await patchLead(id, patch);

  const tracked = diffTracked(before, after);
  if (tracked.length === 0) return { changed: true, logged: false };

  const stageChange = tracked.find(c => c.field === 'followup_stage');
  await logSystemActivity(
    id, changeSummary(tracked), actor,
    stageChange ? String(stageChange.after ?? '') || null : null,
  );
  return { changed: true, logged: true };
}

/** 보관·보관 해제. 사유는 활동 기록에 남는다(R8). */
export async function setArchived(
  id: string, archived: boolean, reason: string, actor: Actor,
): Promise<void> {
  await patchLead(id, { archived_at: archived ? new Date().toISOString() : null });
  await logSystemActivity(id, archived ? archiveSummary(reason) : unarchiveSummary(), actor);
}

// ── R7 CC 결정 ──

export interface CcLink {
  id: string;
  lead_id: string;
  cc_lead_id: string;
  decided_at: string;
  note?: string | null;
}

export async function getCcLinks(leadId: string): Promise<CcLink[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_cc_links?lead_id=eq.${encodeURIComponent(leadId)}` +
      `&select=id,lead_id,cc_lead_id,decided_at,note&order=decided_at.asc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('CC 결정 조회 실패');
  return r.json();
}

/**
 * CC 한 명을 넣거나 뺀다. 바뀐 내용은 활동 기록에 `[변경] CC 대상: …` 으로 남는다.
 *
 * `names` 는 기록 문구에 쓸 **현재 CC 전체 목록**이다 — 한 명만 적으면
 * 나중에 원장을 읽을 때 "그때 CC 가 누구였는지"를 알 수 없다.
 */
export async function setCcLink(
  leadId: string, ccLeadId: string, on: boolean,
  names: readonly string[], actor: Actor,
): Promise<void> {
  if (on) {
    const r = await authedFetch(`${SUPABASE_URL}/rest/v1/lead_cc_links`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({ lead_id: leadId, cc_lead_id: ccLeadId, decided_by: actor.userId ?? null }),
    });
    if (!r.ok) throw new Error('CC 저장 실패');
  } else {
    const r = await authedFetch(
      `${SUPABASE_URL}/rest/v1/lead_cc_links?lead_id=eq.${encodeURIComponent(leadId)}` +
        `&cc_lead_id=eq.${encodeURIComponent(ccLeadId)}`,
      { method: 'DELETE', headers: HEADERS },
    );
    if (!r.ok) throw new Error('CC 해제 실패');
  }
  const list = names.length > 0 ? names.join(', ') : '없음';
  await logSystemActivity(leadId, `[변경] CC 대상: ${list}`, actor);
}

/** 기관 안에서 최근 보낸 기록을 찾기 위해 **여러 리드의** 활동을 한 번에 읽는다. */
export async function getActivitiesForLeads(leadIds: readonly string[]): Promise<Array<{
  lead_id: string; direction: string; occurred_at: string; voided_at?: string | null;
}>> {
  if (leadIds.length === 0) return [];
  const inList = leadIds.map(encodeURIComponent).join(',');
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_activities?lead_id=in.(${inList})` +
      `&select=lead_id,direction,occurred_at,voided_at&order=occurred_at.desc&limit=500`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}

// ─────────────────── LEAD-S1 — 신호 · 조사 · 전략 · 사실 ───────────────────

/** 공통: 새 표에 한 줄 넣는다. 전부 authedFetch(로그인 토큰)로만 간다. */
async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const r = await authedFetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('저장에 실패했습니다.');
}

/**
 * 취소 표시 — **지우지 않는다**(원장). voided_at·void_reason 만 쓴다.
 * 새 표에는 DELETE 권한이 없으므로 이것이 유일한 "되돌리기" 수단이다.
 */
async function voidRow(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(patch) },
  );
  if (!r.ok) throw new Error('취소 처리에 실패했습니다.');
}

// ── 관심 신호 ──

export interface LeadSignal {
  id: string;
  lead_id: string;
  signal_type: string;
  note?: string | null;
  source: string;
  observed_at: string;
  created_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
}

export async function getSignals(leadId: string): Promise<LeadSignal[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_signals?lead_id=eq.${encodeURIComponent(leadId)}` +
      `&select=id,lead_id,signal_type,note,source,observed_at,created_at,voided_at,void_reason` +
      `&order=observed_at.desc,created_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('관심 신호 조회 실패');
  return r.json();
}

export async function addSignal(row: Record<string, unknown>, actor: Actor): Promise<void> {
  await insertRow('lead_signals', { ...row, created_by: actor.userId ?? null });
}

export async function voidSignal(id: string, patch: Record<string, unknown>): Promise<void> {
  await voidRow('lead_signals', id, patch);
}

// ── 조사 메모 ──

export interface LeadResearchNote {
  id: string;
  lead_id: string;
  title: string;
  body?: string | null;
  source_label?: string | null;
  source_url?: string | null;
  collected_by?: string | null;
  created_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
}

export async function getResearchNotes(leadId: string): Promise<LeadResearchNote[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_research_notes?lead_id=eq.${encodeURIComponent(leadId)}` +
      `&select=id,lead_id,title,body,source_label,source_url,collected_by,created_at,voided_at,void_reason` +
      `&order=created_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('조사 메모 조회 실패');
  return r.json();
}

export async function addResearchNote(row: Record<string, unknown>, actor: Actor): Promise<void> {
  await insertRow('lead_research_notes', { ...row, created_by: actor.userId ?? null });
}

export async function voidResearchNote(id: string, patch: Record<string, unknown>): Promise<void> {
  await voidRow('lead_research_notes', id, patch);
}

// ── 접근 전략 ──

export async function getStrategies(leadId: string): Promise<StrategyRow[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_strategies?lead_id=eq.${encodeURIComponent(leadId)}` +
      `&select=id,lead_id,version,goal,angle,key_points,fact_ids,avoid_text,` +
      `next_contact_plan,rationale,based_on_activity_id,created_by,created_at` +
      `&order=version.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('전략 조회 실패');
  return r.json();
}

export type StrategyRow = {
  id: string; lead_id: string; version: number;
  goal?: string | null; angle?: string | null; key_points?: string | null;
  fact_ids?: unknown; avoid_text?: string | null; next_contact_plan?: string | null;
  rationale?: string | null; based_on_activity_id?: string | null;
  created_by?: string | null; created_at: string;
};

/**
 * 전략 한 판을 넣는다.
 *
 * ⚠️ `version` 이 (lead_id, version) UNIQUE 라, 두 사람이 같은 순간에 새 판을 쓰면
 *    **뒤에 온 쪽이 실패한다**(조용히 덮어쓰지 않는다 — 그게 맞다).
 *    화면은 그때 "다시 불러와 주세요"로 안내한다.
 */
export async function addStrategy(row: Record<string, unknown>, actor: Actor): Promise<void> {
  const r = await authedFetch(`${SUPABASE_URL}/rest/v1/lead_strategies`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ ...row, created_by: actor.userId ?? null }),
  });
  if (!r.ok) {
    // 409 = 같은 버전이 이미 있다(동시에 썼다)
    throw new Error(r.status === 409
      ? '다른 곳에서 새 전략이 저장됐습니다. 화면을 다시 불러와 주세요.'
      : '전략 저장에 실패했습니다.');
  }
}

/** 목록 화면이 쓰는 "리드별 현재 전략" — 전체를 한 번에 읽는다(리드마다 부르지 않게). */
export async function getStrategyHeads(): Promise<Array<{
  lead_id: string; version: number; next_contact_plan?: string | null; goal?: string | null;
}>> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_strategies?select=lead_id,version,next_contact_plan,goal` +
      `&order=lead_id.asc,version.desc&limit=20000`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}

// ── 쓸 수 있는 사실 ──

export interface OutreachFactRow {
  id: string;
  fact_key: string;
  label_ko: string;
  statement_en?: string | null;
  statement_ko?: string | null;
  status: string;
  caveat?: string | null;
  source?: string | null;
  updated_at: string;
}

export interface OutreachFactLogRow {
  id: string;
  fact_id: string;
  old_status?: string | null;
  new_status?: string | null;
  note?: string | null;
  changed_at: string;
}

export async function getFacts(): Promise<OutreachFactRow[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/outreach_facts?select=id,fact_key,label_ko,statement_en,` +
      `statement_ko,status,caveat,source,updated_at&order=status.asc,label_ko.asc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('사실 조회 실패');
  return r.json();
}

export async function getFactLog(factId: string): Promise<OutreachFactLogRow[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/outreach_fact_log?fact_id=eq.${encodeURIComponent(factId)}` +
      `&select=id,fact_id,old_status,new_status,note,changed_at&order=changed_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}

export async function addFact(row: Record<string, unknown>, actor: Actor): Promise<void> {
  await insertRow('outreach_facts', { ...row, updated_by: actor.userId ?? null });
}

/**
 * 사실을 고친다. **상태가 바뀌면 로그 한 줄을 같이 넣는다.**
 *
 * 순서는 **사실 먼저, 로그 나중**이다. 로그가 먼저 들어가고 수정이 실패하면
 * "바뀌었다고 적혀 있는데 값은 그대로"가 되어 로그가 거짓이 된다.
 */
export async function updateFact(
  id: string, patch: Record<string, unknown>,
  statusChange: { from: string; to: string; note?: string } | null,
  actor: Actor,
): Promise<void> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/outreach_facts?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_by: actor.userId ?? null, updated_at: new Date().toISOString() }),
    },
  );
  if (!r.ok) throw new Error('사실 저장에 실패했습니다.');

  if (statusChange && statusChange.from !== statusChange.to) {
    await insertRow('outreach_fact_log', {
      fact_id: id,
      old_status: statusChange.from,
      new_status: statusChange.to,
      note: statusChange.note?.trim() || null,
      changed_by: actor.userId ?? null,
    });
  }
}

// ─────────────────── LEAD-S2 — 아웃리치 초안 ───────────────────

export interface OutreachDraft {
  id: string;
  lead_id: string;
  strategy_id?: string | null;
  language: string;
  subject?: string | null;
  body?: string | null;
  status: string;
  fact_ids?: unknown;
  cc_snapshot?: unknown;
  scheduled_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  sent_activity_id?: string | null;
  cancelled_reason?: string | null;
  created_at: string;
  updated_at: string;
}

const DRAFT_COLS = [
  'id', 'lead_id', 'strategy_id', 'language', 'subject', 'body', 'status',
  'fact_ids', 'cc_snapshot', 'scheduled_at', 'approved_by', 'approved_at',
  'sent_at', 'sent_activity_id', 'cancelled_reason', 'created_at', 'updated_at',
].join(',');

export async function getDrafts(leadId: string): Promise<OutreachDraft[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_outreach_drafts?lead_id=eq.${encodeURIComponent(leadId)}` +
      `&select=${DRAFT_COLS}&order=created_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('초안 조회 실패');
  return r.json();
}

/** 큐 화면이 쓰는 전체 목록. 상태별 탭이라 전부 읽고 화면에서 가른다. */
export async function getAllDrafts(): Promise<OutreachDraft[]> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_outreach_drafts?select=${DRAFT_COLS}` +
      `&order=updated_at.desc&limit=2000`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('초안 조회 실패');
  return r.json();
}

export async function addDraft(row: Record<string, unknown>, actor: Actor): Promise<void> {
  const r = await authedFetch(`${SUPABASE_URL}/rest/v1/lead_outreach_drafts`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ ...row, created_by: actor.userId ?? null }),
  });
  if (!r.ok) throw new Error('초안 저장 실패');
}

async function patchDraft(id: string, patch: Record<string, unknown>): Promise<void> {
  const r = await authedFetch(
    `${SUPABASE_URL}/rest/v1/lead_outreach_drafts?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  if (!r.ok) throw new Error('초안 저장 실패');
}

/** 초안 본문 수정 — **초안 상태에서만** 부른다(화면이 canEditBody 로 막는다). */
export async function updateDraftBody(
  id: string, patch: { subject?: string; body?: string; language?: string; fact_ids?: string[] },
): Promise<void> {
  await patchDraft(id, patch);
}

/**
 * 승인 — 승인자와 시각을 박고, **그때의 CC 대상을 스냅샷으로 남긴다**.
 * `lead_cc_links` 는 나중에 바뀔 수 있어서, 스냅샷이 없으면 "그때 누구를 참조에
 * 넣기로 했는지"를 알 수 없다.
 */
export async function approveDraft(
  id: string, ccSnapshot: Array<{ lead_id: string; name?: string | null }>, actor: Actor,
): Promise<void> {
  await patchDraft(id, {
    status: 'approved',
    approved_by: actor.userId ?? null,
    approved_at: new Date().toISOString(),
    cc_snapshot: ccSnapshot,
  });
}

export async function scheduleDraft(id: string, scheduledAtIso: string): Promise<void> {
  await patchDraft(id, { status: 'scheduled', scheduled_at: scheduledAtIso });
}

export async function cancelDraft(id: string, patch: Record<string, unknown>): Promise<void> {
  await patchDraft(id, patch);
}

/**
 * 발송 완료로 표시한다 — **CRM 이 보내는 것이 아니다.**
 * 제시카가 James 계정으로 보낸 뒤 돌아와서 누르는 버튼이다.
 *
 * 순서: 활동 기록 먼저 → 초안에 그 기록을 잇는다.
 * 기록이 먼저 들어가고 초안 갱신이 실패하면 "보낸 기록은 있는데 초안이 예약 상태"가
 * 되어 다시 누르면 복구된다. 반대 순서면 "보냈다고 적혀 있는데 기록이 없다"가 된다.
 */
export async function markDraftSent(a: {
  draftId: string;
  leadId: string;
  subject: string;
  attemptNo: number;
  strategyId: string | null;
  stageAfter?: string | null;
  actor: Actor;
}): Promise<void> {
  const now = new Date().toISOString();
  const ins = await authedFetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({
      lead_id: a.leadId,
      occurred_at: now,
      channel: 'email',
      direction: 'out',
      summary: sentActivitySummary(a.subject),
      attempt_no: a.attemptNo,
      strategy_id: a.strategyId,
      stage_after: a.stageAfter ?? null,
      actor: a.actor.name?.trim() || null,
      actor_user_id: a.actor.userId ?? null,
    }),
  });
  if (!ins.ok) throw new Error('발송 기록 저장 실패');
  const created = await ins.json();
  const activityId = Array.isArray(created) && created[0]?.id ? String(created[0].id) : null;

  // 리드의 마지막 접촉일(과 고른 경우 단계)을 갱신한다.
  await patchLead(a.leadId, {
    last_contact_at: now,
    ...(a.stageAfter ? { followup_stage: a.stageAfter } : {}),
  });

  await patchDraft(a.draftId, { status: 'sent', sent_at: now, sent_activity_id: activityId });
}
