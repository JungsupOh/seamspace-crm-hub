// 관리자 리드 화면의 "파트너 등록 리드" 표시 (LEAD-S7-7b)
//
// **서버(엣지 함수)와 같은 규칙으로 센다.** 두 곳이 다른 날짜를 말하면
// 파트너와 우리가 다른 것을 보게 되고, 그건 돈 문제로 번진다.
// (`supabase/functions/partner-lead/logic.ts` 의 보호 기간 규칙과 같다.)

export const PROTECTION_DAYS = 90;

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 보호 기간의 시작점 — 접촉이 있으면 접촉일, 없으면 등록일. */
export function protectionAnchor(claimedAt: unknown, lastContactAt: unknown): Date | null {
  const c = toDate(claimedAt);
  const l = toDate(lastContactAt);
  if (!c && !l) return null;
  if (!c) return l;
  if (!l) return c;
  return l > c ? l : c;
}

export function protectionEndsAt(claimedAt: unknown, lastContactAt: unknown): Date | null {
  const a = protectionAnchor(claimedAt, lastContactAt);
  return a ? new Date(a.getTime() + PROTECTION_DAYS * 24 * 60 * 60 * 1000) : null;
}

export function protectionDaysLeft(
  claimedAt: unknown, lastContactAt: unknown, now: Date,
): number {
  const end = protectionEndsAt(claimedAt, lastContactAt);
  if (!end) return 0;
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** 파트너가 넣은 리드인가. **셋이 함께** 있어야 하지만 표시는 하나로 판단한다. */
export function isPartnerLead(row: { partner_id?: unknown }): boolean {
  return typeof row.partner_id === 'string' && row.partner_id.trim() !== '';
}

export type PartnerLeadTone = 'protected' | 'ending' | 'open';

export function partnerLeadTone(
  row: { partner_claimed_at?: unknown; last_contact_at?: unknown }, now: Date,
): PartnerLeadTone {
  const d = protectionDaysLeft(row.partner_claimed_at, row.last_contact_at, now);
  if (d <= 0) return 'open';
  if (d <= 14) return 'ending';
  return 'protected';
}

export const CONTACT_OWNER_LABEL: Record<string, string> = {
  end_user: '기관 담당자',
  partner: '파트너 대행',
};

export function contactOwnerLabel(v: unknown): string | null {
  return typeof v === 'string' ? (CONTACT_OWNER_LABEL[v] ?? null) : null;
}

/** 파트너 이름을 id 로 찾는 작은 표(화면이 파트너 목록을 한 번 읽어 넘긴다). */
export function partnerNameOf(
  row: { partner_id?: unknown }, names: Record<string, string>,
): string | null {
  const id = typeof row.partner_id === 'string' ? row.partner_id : null;
  return id ? (names[id] ?? null) : null;
}

/** 보호 기간 칩에 쓸 글. 날짜를 그대로 보여 주지 않고 **남은 일수**로 말한다. */
export function protectionLabel(
  row: { partner_claimed_at?: unknown; last_contact_at?: unknown }, now: Date,
): string {
  const d = protectionDaysLeft(row.partner_claimed_at, row.last_contact_at, now);
  return d <= 0 ? '보호 끝' : `보호 ${d}일`;
}
