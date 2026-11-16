// 같은 기관 사람 찾기 — LEAD-UI2 R6
//
// 왜 필요한가
//   한 학교에서 두세 명을 부스에서 만났는데, 서로 모른 채 각각 메일을 보내면
//   **같은 기관에 중복으로 연락**하게 된다. 운영 데이터에 실제로 그런 묶음이 있다
//   (소속이 겹치는 기관 22곳, 76명 — 개인정보 없이 건수만 셌다).
//
// 이 파일은 **순수 함수만** 둔다. 목록 전체가 이미 메모리에 있으므로 DB 를 더 부르지 않는다.

/** 자유 메일(개인 메일) 도메인 — 도메인이 같아도 **같은 기관이 아니다**. */
export const FREE_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.jp', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'outlook.kr', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'gmx.de', 'mail.com',
  'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com', 'tutanota.com',
  'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'korea.com',
  'qq.com', '163.com', '126.com', 'sina.com', 'foxmail.com',
];

const FREE = new Set(FREE_EMAIL_DOMAINS);

/** 이메일에서 도메인만. 자유 메일이면 null — 기관 판단에 쓰면 안 된다. */
export function orgDomain(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return null;
  const d = email.trim().toLowerCase().slice(at + 1);
  if (!d || !d.includes('.')) return null;
  return FREE.has(d) ? null : d;
}

/** 법인·기관 접미사 — 비교 전에 뗀다. `Alpha School` 과 `Alpha` 는 같은 곳일 수 있다. */
const SUFFIXES = [
  'inc', 'inc.', 'llc', 'ltd', 'ltd.', 'limited', 'pte', 'pte.', 'plc', 'co', 'co.',
  'corp', 'corp.', 'corporation', 'company', 'gmbh', 'bv', 'nv', 'sa', 'ag', 'pty',
  'school', 'schools', 'college', 'university', 'univ', 'academy', 'institute',
  'institution', 'foundation', 'center', 'centre', 'group', 'holdings',
  '학교', '초등학교', '중학교', '고등학교', '대학교', '대학', '재단', '주식회사', '유한회사',
];

/**
 * 기관명 정규화 — 공백·대소문자·구두점·법인 접미사를 떼고 비교할 모양으로.
 *
 * ⚠️ 접미사를 떼는 것은 **되돌릴 수 없는 손실**이라 "확실"이 아니라 "추정" 판정에만 쓴다.
 *    `A School` 과 `A University` 가 둘 다 `a` 가 되어 같은 곳으로 보일 수 있다.
 */
export function normalizeOrgName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .toLowerCase()
    .replace(/[.,'"()\[\]{}/\\|&·−–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 접미사까지 떼어 낸 '핵심' 이름. 추정 비교에 쓴다. */
export function orgCore(v: unknown): string {
  const n = normalizeOrgName(v);
  if (!n) return '';
  const words = n.split(' ').filter(w => w && !SUFFIXES.includes(w));
  const core = words.join(' ').trim();
  // 접미사만으로 된 이름(예: "School")은 핵심이 비므로 원본을 쓴다 —
  // 빈 문자열끼리 맞춰 **서로 다른 기관이 전부 한 묶음**이 되면 안 된다.
  return core || n;
}

export type MatchKind = 'org-exact' | 'org-fuzzy' | 'domain';
export type Confidence = 'sure' | 'maybe';

export interface OrgMate<T> {
  lead: T;
  kinds: MatchKind[];
  confidence: Confidence;
}

export interface OrgLead {
  id: string;
  school_name?: unknown;
  email_normalized?: unknown;
  email?: unknown;
}

export const MATCH_LABEL: Record<MatchKind, string> = {
  'org-exact': '소속 일치',
  'org-fuzzy': '소속 비슷',
  domain: '이메일 도메인 일치',
};

/**
 * 같은 기관 사람들.
 *
 * 판정 순서
 *   ① 정규화한 소속이 **정확히 같다** → 확실
 *   ② 자유 메일이 아닌 **이메일 도메인이 같다** → 확실
 *   ③ 접미사를 뗀 핵심 이름이 같다 → **추정**
 *
 * 자기 자신은 뺀다. 소속도 도메인도 없으면 빈 배열(아무나 묶지 않는다).
 */
export function findOrgMates<T extends OrgLead>(me: T, all: readonly T[]): OrgMate<T>[] {
  const myOrg = normalizeOrgName(me.school_name);
  const myCore = orgCore(me.school_name);
  const myDomain = orgDomain(me.email_normalized ?? me.email);
  if (!myOrg && !myDomain) return [];

  const out: OrgMate<T>[] = [];
  for (const other of all) {
    if (other.id === me.id) continue;
    const kinds: MatchKind[] = [];

    const otherOrg = normalizeOrgName(other.school_name);
    if (myOrg && otherOrg && myOrg === otherOrg) kinds.push('org-exact');

    const otherDomain = orgDomain(other.email_normalized ?? other.email);
    if (myDomain && otherDomain && myDomain === otherDomain) kinds.push('domain');

    if (!kinds.includes('org-exact')) {
      const otherCore = orgCore(other.school_name);
      if (myCore && otherCore && myCore === otherCore) kinds.push('org-fuzzy');
    }

    if (kinds.length === 0) continue;
    const confidence: Confidence =
      kinds.includes('org-exact') || kinds.includes('domain') ? 'sure' : 'maybe';
    out.push({ lead: other, kinds, confidence });
  }

  // 확실한 것이 위로, 그다음 이름순
  return out.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'sure' ? -1 : 1;
    return String((a.lead as { name?: string }).name ?? '')
      .localeCompare(String((b.lead as { name?: string }).name ?? ''), 'ko');
  });
}

// ─────────────────── 중복 접촉 경고 ───────────────────

export interface OutActivity {
  lead_id: string;
  direction: string;
  occurred_at: string;
  voided_at?: unknown;
}

export interface RecentContact {
  leadId: string;
  daysAgo: number;
}

/**
 * 같은 기관의 **다른 사람**에게 최근 N일 안에 보낸 적이 있는가.
 *
 * 받은 것(`direction='in'`)은 세지 않는다 — 중복 연락을 막는 것이 목적이다.
 * 취소된 기록(`voided_at`)도 세지 않는다.
 */
export function recentOutreachToOrg<T extends OrgLead>(
  mates: readonly OrgMate<T>[],
  activities: readonly OutActivity[],
  todayIso: string,
  withinDays = 14,
): RecentContact | null {
  const mateIds = new Set(mates.map(m => m.lead.id));
  if (mateIds.size === 0) return null;
  const today = Date.parse(`${todayIso}T00:00:00Z`);

  let best: RecentContact | null = null;
  for (const a of activities) {
    if (a.direction !== 'out') continue;
    if (a.voided_at) continue;
    if (!mateIds.has(a.lead_id)) continue;
    const t = Date.parse(a.occurred_at);
    if (Number.isNaN(t)) continue;
    const days = Math.floor((today - t) / (24 * 3600 * 1000));
    if (days < 0 || days > withinDays) continue;
    if (!best || days < best.daysAgo) best = { leadId: a.lead_id, daysAgo: days };
  }
  return best;
}
