// ── 고객 여정 퍼널 (Lead_Stage) ───────────────────
export type FunnelStage = '신규' | '관심' | '체험' | '구매' | '유지';

export const FUNNEL_STAGES: { key: FunnelStage; color: string; desc: string }[] = [
  { key: '신규', color: 'bg-slate-100 text-slate-600',   desc: '첫 접촉, 관심 미확인' },
  { key: '관심', color: 'bg-blue-100 text-blue-700',     desc: '상담·미팅, 관심 표현' },
  { key: '체험', color: 'bg-yellow-100 text-yellow-700', desc: '체험권 사용 중' },
  { key: '구매', color: 'bg-green-100 text-green-700',   desc: '첫 구매 완료' },
  { key: '유지', color: 'bg-teal-100 text-teal-700',     desc: '재구매·갱신 고객' },
];

export const EXTRA_STAGES = ['미활성', '이탈'] as const;
export const ALL_STAGES = [...FUNNEL_STAGES.map(s => s.key), ...EXTRA_STAGES];

export const STAGE_COLOR: Record<string, string> = {
  ...Object.fromEntries(FUNNEL_STAGES.map(s => [s.key, s.color])),
  // 딜 스테이지 색상
  '체험권':          'bg-yellow-100 text-yellow-700',
  '견적':            'bg-blue-100 text-blue-700',
  '계약체결/구매':   'bg-violet-100 text-violet-700',
  '템플릿 회신대기': 'bg-orange-100 text-orange-700',
  '이용권 발송완료': 'bg-purple-100 text-purple-700',
  '결제예정':        'bg-sky-100 text-sky-700',
  '입금대기':        'bg-amber-100 text-amber-700',
  '입금완료':        'bg-green-100 text-green-700',
  '딜취소':          'bg-red-100 text-red-700',
};

// ── 교사 유형 (Contact_Type) ──────────────────────
// key = Airtable 실제 저장값, label = 화면 표시
export const CONTACT_TYPES: { key: string; label: string; color: string }[] = [
  { key: '교사',        label: '일반교사', color: 'bg-slate-100 text-slate-700'   },
  { key: 'Advocate',    label: '선도교사', color: 'bg-purple-100 text-purple-700' },
  { key: '행정담당자',  label: '관리자',   color: 'bg-indigo-100 text-indigo-700' },
  { key: '파트너',      label: '파트너',   color: 'bg-sky-100 text-sky-700'       },
  { key: '구매고객',    label: '구매고객', color: 'bg-green-100 text-green-700'   },
];

// key 또는 label → 색상 (둘 다 검색)
export const CONTACT_TYPE_COLOR: Record<string, string> = {
  ...Object.fromEntries(CONTACT_TYPES.map(t => [t.key,   t.color])),
  ...Object.fromEntries(CONTACT_TYPES.map(t => [t.label, t.color])),
};

// Airtable 저장값 → 화면 표시 한글
const TYPE_LABEL_MAP: Record<string, string> = {
  ...Object.fromEntries(CONTACT_TYPES.map(t => [t.key, t.label])),
  // 레거시 값 정규화
  'Lead':    '일반교사',
  'Trial':   '일반교사',
  'Lost':    '일반교사',
  'Customer':'구매고객',
  'Partner': '파트너',
  '교사':    '일반교사',
  '강사':    '일반교사',
};

export function normalizeContactType(raw: string | undefined): string {
  if (!raw) return '';
  return TYPE_LABEL_MAP[raw] ?? raw;
}

// 라벨 또는 레거시값 → Airtable 저장 key (드롭다운 value 매칭용)
const LABEL_TO_KEY: Record<string, string> = {
  ...Object.fromEntries(CONTACT_TYPES.map(t => [t.label, t.key])),
};

export function resolveContactTypeKey(raw: string | undefined): string {
  if (!raw) return '';
  if (CONTACT_TYPES.some(t => t.key === raw)) return raw; // 이미 key
  return LABEL_TO_KEY[normalizeContactType(raw)] ?? raw;
}

// ── 딜 파이프라인 ──────────────────────────────────
export const DEAL_STAGES = [
  '체험권', '견적', '계약체결/구매', '템플릿 회신대기', '이용권 발송완료', '결제예정', '입금대기', '입금완료',
] as const;

export const ALL_DEAL_STAGES = [
  '체험권', '견적', '계약체결/구매', '템플릿 회신대기', '이용권 발송완료', '결제예정', '입금대기', '입금완료', '딜취소',
] as const;

export type DealStage = typeof DEAL_STAGES[number];

export const DEAL_STAGE_LABELS: Record<string, string> = {
  '체험권':          '체험권',
  '견적':            '견적',
  '계약체결/구매':   '계약체결/구매',
  '템플릿 회신대기': '템플릿 회신대기',
  '이용권 발송완료': '이용권 발송완료',
  '결제예정':        '결제예정',
  '입금대기':        '입금대기',
  '입금완료':        '입금완료',
  '딜취소':          '딜취소',
  // 레거시 Airtable 값 호환
  Lead:        '체험권',
  Proposal:    '견적',
  Contract:    '이용권 발송완료',
  Closed_Won:  '입금완료',
  Active_User: '사용중',
  Closed_Lost: '딜취소',
};

// ── 레거시 스테이지 매핑 ──────────────────────────
// Airtable 기존 값 → 새 퍼널 단계로 정규화 (데이터 변경 없이 표시만 변환)
const LEGACY_STAGE_MAP: Record<string, FunnelStage> = {
  '신규':        '신규',
  '관심표명':    '관심',
  '1개월체험권': '관심',
  'Advocate':    '관심',
  '체험활성화':  '체험',
  '견적요청':    '체험',
  '협의중':      '구매',
  '구매':        '구매',
  '재구매':      '유지',
  '레퍼런스':    '유지',
};

export function normalizeStage(raw: string | undefined): string {
  if (!raw) return '';
  return LEGACY_STAGE_MAP[raw] ?? raw;  // 이미 새 값이면 그대로
}

// ── 유틸 ──────────────────────────────────────────
export function daysUntilExpiry(expirationDate: string | undefined): number | null {
  if (!expirationDate) return null;
  const diff = new Date(expirationDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
