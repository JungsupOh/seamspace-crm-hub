// 리드 관리 화면이 쓰는 DB 입구 — LEAD-3·4 (CRM-012·013)
//
// ⚠️ 보안 규칙(명령서): **로그인 세션 토큰**으로만 호출한다. 공개 키(anon)로
//    rest/v1 을 직접 부르지 않는다. 그래서 authedFetch 를 쓴다(021-8b-3).
//    apikey 헤더에 공개 키를 넣는 것은 정상이다 — Authorization 자리에만 쓰지 않으면 된다.

import { authedFetch } from '@/lib/authedFetch';
import { leadKeyColumns, type Market } from '@/lib/leadMarket';
import { buildActivity, leadPatchForActivity, type ActivityInput, type FollowupStage } from '@/lib/leadFollowup';

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
}

/** 목록이 쓰는 열만 읽는다(select=*  금지 — 쓰지 않는 열까지 내려받지 않는다). */
const LEAD_COLS = [
  'id', 'campaign_id', 'name', 'phone', 'phone_normalized', 'email', 'email_normalized',
  'market', 'school_name', 'position', 'status', 'created_at', 'custom_fields',
  'country', 'segment', 'probability', 'event_name', 'source_type',
  'email_quality', 'email_status', 'notes',
  'followup_stage', 'last_contact_at', 'next_action', 'next_action_due', 'owner', 'close_reason',
  'import_batch_id',
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
      `&select=id,lead_id,occurred_at,channel,direction,summary,stage_after,actor,voided_at,void_reason` +
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
    body: JSON.stringify(built.row),
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
