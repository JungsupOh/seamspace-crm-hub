// 리드 유형 — LEAD-S4 (CRM-015)
//
// 브리프 H항: 전시회에서 만나는 사람은 고객만이 아니다. 세일즈 파트너·연구 파트너·
// 기술 연동 파트너·투자·정부·미디어가 섞여 있다(EDUtech 에서 LMS 연동 문의 5곳).
//
// **유형별로 다른 것은 단계 목록과 기본 다음 행동뿐이다.**
// 사람·기관 기록, 활동 기록, 지역, 전략, 아웃리치는 유형과 무관하게 같은 것을 쓴다.
//
// James 가 쓰면서 고칠 전제라 **DB CHECK 를 걸지 않았다**. 허용값은 이 파일이 정하고
// 테스트로 지킨다. 유형을 더하려면 이 파일 한 곳만 고치면 된다.

export type LeadType =
  | 'customer'      // 고객 — 학교·기관
  | 'sales'         // 세일즈 파트너 — 유통·리셀러
  | 'research'      // 연구 파트너 — 대학·연구기관
  | 'tech'          // 기술·연동 파트너 — LMS 등
  | 'investor'      // 투자·후원
  | 'government'    // 정부·기관
  | 'media';        // 미디어

export const LEAD_TYPES: readonly LeadType[] = [
  'customer', 'sales', 'research', 'tech', 'investor', 'government', 'media',
] as const;

export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  customer: '고객',
  sales: '세일즈 파트너',
  research: '연구 파트너',
  tech: '기술·연동 파트너',
  investor: '투자·후원',
  government: '정부·기관',
  media: '미디어',
};

/** 짧은 설명 — 화면에서 무엇을 고르는지 알려 준다. */
export const LEAD_TYPE_HINT: Record<LeadType, string> = {
  customer: '학교·기관 (우리 제품을 쓸 곳)',
  sales: '유통·리셀러 (우리 제품을 팔 곳)',
  research: '대학·연구기관 (함께 연구할 곳)',
  tech: 'LMS 등 (연동할 곳)',
  investor: '투자·후원',
  government: '정부·교육청·공공기관',
  media: '기자·매체',
};

export function toLeadType(v: unknown): LeadType | null {
  return typeof v === 'string' && (LEAD_TYPES as readonly string[]).includes(v)
    ? (v as LeadType) : null;
}

export function leadTypeLabel(v: unknown, empty = '미분류'): string {
  const t = toLeadType(v);
  return t ? LEAD_TYPE_LABEL[t] : empty;
}

// ─────────────────── 유형별 단계 목록 (브리프 H항 그대로) ───────────────────

/**
 * 유형별 단계. 브리프 H항에 적힌 순서를 그대로 옮겼다.
 *
 * ⚠️ `customer` 는 **기존 10단계(leadFollowup.FOLLOWUP_STAGES)를 그대로 쓴다.**
 *    운영에 이미 그 값으로 저장된 리드가 있으므로 새 목록을 만들면 기존 데이터가
 *    "모르는 단계"가 된다. 다른 유형만 자기 목록을 갖는다.
 */
export const TYPE_STAGES: Record<LeadType, readonly string[]> = {
  customer: [
    '신규', '연락 대기', '1차 연락함', '응답 받음', '미팅·데모',
    '체험 중', '협상', '성사', '보류', '종료',
  ],
  sales: [
    '발굴', '탐색 대화', '조건 협의', '계약서 검토', '계약',
    '온보딩', '첫 판매', '정기 관리', '보류', '종료',
  ],
  research: [
    '접촉', '관심 확인', '협력 범위', 'MOU·협약', '연구 진행', '성과', '보류', '종료',
  ],
  tech: [
    '접촉', '연동 요구 확인', '기술 검토', '연동 일정', '완료', '보류', '종료',
  ],
  // 브리프: "투자·정부·미디어 등은 단순 접촉 목록 + 다음 행동·기한(단계는 최소로)"
  investor:   ['접촉', '논의 중', '종료'],
  government: ['접촉', '논의 중', '종료'],
  media:      ['접촉', '논의 중', '종료'],
};

/** 유형이 없으면 기존(고객) 목록을 쓴다 — 운영 데이터가 그 값이다. */
export function stagesFor(type: unknown): readonly string[] {
  const t = toLeadType(type);
  return t ? TYPE_STAGES[t] : TYPE_STAGES.customer;
}

/** 그 유형에서 끝난 단계(깔때기와 목록에서 뺀다). */
export const TYPE_CLOSED_STAGES: Record<LeadType, readonly string[]> = {
  customer:   ['성사', '보류', '종료'],
  sales:      ['정기 관리', '보류', '종료'],
  research:   ['성과', '보류', '종료'],
  tech:       ['완료', '보류', '종료'],
  investor:   ['종료'],
  government: ['종료'],
  media:      ['종료'],
};

/** 유형별 기본 다음 행동 — 입력 화면의 **제안**일 뿐, 자동으로 넣지 않는다. */
export const TYPE_DEFAULT_NEXT_ACTION: Record<LeadType, string> = {
  customer: '소개 메일 보내기',
  sales: '지역·조건 확인 대화 요청',
  research: '협력 관심 확인 메일',
  tech: '연동 요구사항 확인',
  investor: '회사 소개 자료 보내기',
  government: '사업 담당 부서 확인',
  media: '보도자료·소개 자료 보내기',
};

export function defaultNextAction(type: unknown): string | null {
  const t = toLeadType(type);
  return t ? TYPE_DEFAULT_NEXT_ACTION[t] : null;
}

/**
 * 그 유형에서 쓸 수 없는 단계인가 — **막지 않고 알려만** 준다.
 *
 * 유형을 바꾸면 이미 저장된 단계가 새 목록에 없을 수 있다(고객 '협상' → 연구 파트너).
 * 값을 지우거나 바꾸면 이력이 틀어지므로, 화면이 "이 유형의 단계가 아닙니다" 로
 * 알려 주고 사람이 고치게 한다.
 */
export function isStageForeign(type: unknown, stage: unknown): boolean {
  if (!stage || typeof stage !== 'string') return false;
  return !stagesFor(type).includes(stage);
}

// ─────────────────── 보조 태그 ───────────────────

/** `lead_tags` 는 jsonb 라 무엇이든 올 수 있다. 문자열 배열로만 받아들인다. */
export function leadTagsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(
    v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
     .map(x => x.trim().slice(0, 40)),
  )];
}

export function toggleTag(tags: readonly string[], tag: string): string[] {
  const t = tag.trim().slice(0, 40);
  if (!t) return [...tags];
  return tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t];
}

/**
 * 보조 태그 후보 — 유형과 **겹쳐도 된다**(브리프 H항: 한 사람이 고객이면서 연구 파트너).
 * 자유 입력도 받는다.
 */
export const TAG_SUGGESTIONS: readonly string[] = [
  '고객', '세일즈 파트너', '연구 파트너', '기술 연동', '정부·기관', '미디어',
  '투자', '통역 필요', '재방문', '소개로 연결',
];

// ─────────────────── 파트너 전환 (검토만) ───────────────────

/**
 * 세일즈 파트너가 계약을 맺으면 기존 `partners` 로 **전환**한다(브리프 H항).
 * 이 단계에서는 **전환을 구현하지 않는다** — `partners` 는 국내 파트너와 같은 표이고
 * 계약서·ID·이용권 원장이 붙어 있어 CRM-016·017 과 함께 다뤄야 한다.
 *
 * 전환할 때가 됐는지만 알려 준다(화면에 안내 한 줄).
 */
export function isReadyForPartnerConversion(l: { lead_type?: unknown; followup_stage?: unknown }): boolean {
  if (toLeadType(l.lead_type) !== 'sales') return false;
  const s = l.followup_stage;
  return s === '계약' || s === '온보딩' || s === '첫 판매' || s === '정기 관리';
}

export const PARTNER_CONVERSION_HINT =
  '계약 단계입니다. 파트너로 전환하면 계약서·ID·이용권 원장을 쓸 수 있습니다 ' +
  '(전환 기능은 파트너 정산 단위에서 만듭니다).';
