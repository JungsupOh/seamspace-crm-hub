// 행사별 깔때기 — LEAD-S4 (CRM-018)
//
// 브리프 F항: 방문(리드) → 체험권 발송 → 사용 → 만료 → 구매를 **행사 단위로** 본다.
// EDUtech 은 체험권 10건 전원 발송에 사용 0·구매 0 이었다 — 그 모양이 보여야 한다.
//
// ⚠️ 이 파일은 **순수 함수만** 둔다. 분모·분자가 화면마다 다르면 같은 행사의 전환율이
//    두 가지로 보인다. 숫자의 뜻은 FUNNEL_BASIS 한 곳에 적고 화면이 그대로 보여 준다.
//
// 데이터는 이미 목록으로 받아 둔 것을 쓴다(DB 를 더 부르지 않는다).

import { isClosedStage } from './leadFollowup';
import { isMailable } from './leadEdit';
import { regionOf, type Region } from './leadRegion';
import { leadTypeLabel, stagesFor, toLeadType, type LeadType } from './leadType';

export interface FunnelLead {
  id: string;
  event_name?: unknown;
  campaign_id?: unknown;
  followup_stage?: unknown;
  lead_type?: unknown;
  country?: unknown;
  market?: unknown;
  owner?: unknown;
  created_at?: unknown;
  last_contact_at?: unknown;
  archived_at?: unknown;
  email_normalized?: unknown;
  email_status?: unknown;
  email_quality?: unknown;
  unsubscribed_at?: unknown;
}

/**
 * **전환 깔때기의 단계 순서** — 요구 S4-2 그대로.
 * '신규'·'연락 대기' 는 아직 아무 일도 하지 않은 상태라 깔때기 앞에 따로 센다.
 */
export const CONVERSION_STEPS: readonly string[] = [
  '1차 연락함', '응답 받음', '미팅·데모', '체험 중', '협상', '성사',
] as const;

/**
 * 숫자의 뜻 — 화면 하단에 이 문장을 그대로 보여 준다.
 * 분모·분자를 적어 두지 않으면 "전환율 40%" 가 무엇의 40% 인지 알 수 없다.
 */
export const FUNNEL_BASIS =
  '분모는 그 행사의 리드 수(보관된 리드 제외)입니다. ' +
  '단계 전환율은 "그 단계 이상 진행한 사람 ÷ 바로 앞 단계 이상 진행한 사람" 이고, ' +
  '전체 전환율은 "그 단계 이상 ÷ 전체 리드" 입니다. ' +
  '평균 체류일은 마지막 접촉(없으면 등록일)에서 오늘까지의 날수를 그 단계에 머문 사람끼리 평균한 값입니다. ' +
  '"메일 발송 가능"은 수신 거부·발송 보류·반송이 아니고 이메일 신뢰도가 3 이상인 사람입니다.';

const KST = 9 * 60 * 60 * 1000;
const dayOf = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t + KST).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** 그 리드가 속한 행사 이름. 행사명이 없으면 캠페인 이름, 그것도 없으면 '(행사 없음)'. */
export function eventNameOf(l: FunnelLead, campaignName?: Map<string, string>): string {
  const e = typeof l.event_name === 'string' ? l.event_name.trim() : '';
  if (e) return e;
  const cid = typeof l.campaign_id === 'string' ? l.campaign_id : '';
  const c = cid && campaignName ? campaignName.get(cid) : '';
  return c || '(행사 없음)';
}

export interface StageCount { stage: string; count: number; avgDays: number | null }

export interface StepRow {
  step: string;
  /** 그 단계 **이상** 진행한 사람 수 */
  reached: number;
  /** 바로 앞 단계 대비 비율(0~1). 첫 단계는 전체 대비. */
  stepRate: number | null;
  /** 전체 리드 대비 비율(0~1) */
  overallRate: number | null;
}

export interface FunnelSummary {
  event: string;
  total: number;
  /** 아직 아무 연락도 하지 않은 사람('신규'·'연락 대기'·값 없음) */
  untouched: number;
  /**
   * 끝난 사람을 **둘로 나눈다.**
   * 합쳐 세면 "끝남 2명" 이 되는데, 하나는 성사하고 하나는 잃은 것이라 화면에서 뜻이 없다
   * (LEAD-S4 에서 테스트가 이 모호함을 드러냈다).
   */
  won: number;
  lost: number;
  stages: StageCount[];
  steps: StepRow[];
  mailable: number;
  byRegion: Array<{ region: Region; label: string; count: number }>;
  byCountry: Array<{ country: string; count: number }>;
  byType: Array<{ type: LeadType | null; label: string; count: number }>;
}

/** 깔때기에서 그 단계가 "몇 번째"인가. 없으면 -1. */
function stepIndex(stage: unknown): number {
  return typeof stage === 'string' ? CONVERSION_STEPS.indexOf(stage) : -1;
}

/**
 * 그 사람이 **어디까지 갔는가**(깔때기 칸 번호).
 *
 * ⚠️ 끝난 단계는 **그 전에 어디까지 갔는지 알 수 없다.** '종료'·'보류' 는 깔때기에서
 *    빠지고(`closed` 로 따로 센다), '성사' 는 마지막 칸까지 간 것으로 센다.
 *    이렇게 하지 않으면 종료된 리드가 "1차 연락함" 칸에 영원히 남아 전환율이 낮게 보인다.
 */
export function reachedIndex(l: FunnelLead): number {
  const s = l.followup_stage;
  if (s === '성사') return CONVERSION_STEPS.length - 1;
  if (isClosedStage(s)) return -1;         // 보류·종료 — 깔때기 밖
  return stepIndex(s);
}

export function isUntouched(l: FunnelLead): boolean {
  const s = l.followup_stage;
  return !s || s === '신규' || s === '연락 대기';
}

/** 한 행사의 깔때기. `today` 를 받는 이유는 테스트에서 날짜를 고정하기 위해서다. */
export function funnelFor(
  event: string, leads: readonly FunnelLead[], today: string,
): FunnelSummary {
  const rows = leads.filter(l => !l.archived_at);
  const total = rows.length;

  // ── 단계별 인원과 평균 체류일 ──
  const stageMap = new Map<string, { n: number; days: number[] }>();
  for (const l of rows) {
    const s = typeof l.followup_stage === 'string' && l.followup_stage ? l.followup_stage : '신규';
    const cur = stageMap.get(s) ?? { n: 0, days: [] };
    cur.n += 1;
    const since = dayOf(l.last_contact_at) ?? dayOf(l.created_at);
    if (since) cur.days.push(Math.max(0, daysBetween(since, today)));
    stageMap.set(s, cur);
  }
  // 표시 순서: 가장 흔한 유형의 단계 목록을 따르고, 그 밖의 값은 뒤에 붙인다.
  const order = [...stagesFor(mostCommonType(rows))];
  const extra = [...stageMap.keys()].filter(s => !order.includes(s)).sort();
  const stages: StageCount[] = [...order, ...extra]
    .filter(s => stageMap.has(s))
    .map(s => {
      const v = stageMap.get(s)!;
      return {
        stage: s,
        count: v.n,
        avgDays: v.days.length > 0
          ? Math.round(v.days.reduce((a, b) => a + b, 0) / v.days.length)
          : null,
      };
    });

  // ── 전환 ──
  const reached = CONVERSION_STEPS.map((_, i) =>
    rows.filter(l => reachedIndex(l) >= i).length);
  const steps: StepRow[] = CONVERSION_STEPS.map((step, i) => ({
    step,
    reached: reached[i],
    stepRate: i === 0
      ? (total > 0 ? reached[0] / total : null)
      : (reached[i - 1] > 0 ? reached[i] / reached[i - 1] : null),
    overallRate: total > 0 ? reached[i] / total : null,
  }));

  // ── 국가·지역·유형 ──
  const regionMap = new Map<Region, number>();
  const countryMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  for (const l of rows) {
    const g = regionOf(l);
    regionMap.set(g, (regionMap.get(g) ?? 0) + 1);
    const c = typeof l.country === 'string' && l.country.trim() ? l.country.trim() : '(없음)';
    countryMap.set(c, (countryMap.get(c) ?? 0) + 1);
    const t = toLeadType(l.lead_type) ?? '(미분류)';
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
  }

  return {
    event,
    total,
    untouched: rows.filter(isUntouched).length,
    won: rows.filter(l => l.followup_stage === '성사').length,
    lost: rows.filter(l => l.followup_stage === '보류' || l.followup_stage === '종료').length,
    stages,
    steps,
    mailable: rows.filter(l => isMailable(l)).length,
    byRegion: [...regionMap.entries()]
      .map(([region, count]) => ({ region, label: regionLabel(region), count }))
      .sort((a, b) => b.count - a.count),
    byCountry: [...countryMap.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country)),
    byType: [...typeMap.entries()]
      .map(([t, count]) => ({
        type: t === '(미분류)' ? null : (t as LeadType),
        label: t === '(미분류)' ? '미분류' : leadTypeLabel(t),
        count,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

// 지역 표시 이름은 leadRegion 이 갖고 있다. 순환 import 를 피해 여기서 다시 쓴다.
import { REGION_LABEL } from './leadRegion';
function regionLabel(r: Region): string {
  return REGION_LABEL[r] ?? String(r);
}

/** 그 묶음에서 가장 흔한 유형 — 단계 표시 순서를 고를 때 쓴다. */
export function mostCommonType(rows: readonly FunnelLead[]): LeadType | null {
  const m = new Map<LeadType, number>();
  for (const l of rows) {
    const t = toLeadType(l.lead_type);
    if (t) m.set(t, (m.get(t) ?? 0) + 1);
  }
  let best: LeadType | null = null;
  let n = 0;
  for (const [t, c] of m) if (c > n) { best = t; n = c; }
  return best;
}

/** 행사별로 묶어 깔때기를 만든다. 리드가 많은 행사가 먼저 온다. */
export function funnelsByEvent(
  leads: readonly FunnelLead[], today: string, campaignName?: Map<string, string>,
): FunnelSummary[] {
  const groups = new Map<string, FunnelLead[]>();
  for (const l of leads) {
    const e = eventNameOf(l, campaignName);
    const arr = groups.get(e) ?? [];
    arr.push(l);
    groups.set(e, arr);
  }
  return [...groups.entries()]
    .map(([e, rows]) => funnelFor(e, rows, today))
    .sort((a, b) => b.total - a.total || a.event.localeCompare(b.event, 'ko'));
}

/** 비율을 보기 좋게. 분모가 0 이면 '—'(0% 가 아니다 — 셀 것이 없는 것과 0 은 다르다). */
export function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}
