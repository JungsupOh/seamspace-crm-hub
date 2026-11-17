// 해외 파트너 등록 마법사 — 순수 로직 (LEAD-S7-6)
//
// 단계 이름·순서는 **브리프 K항 그대로**다(설계와 다르면 브리프가 먼저다).
//   1 회사 기본 · 2 계약서와 기간 · 3 수량·단가 · 4 발급 권한과 한도
//   5 첫 관리자 계정 · 6 확인과 완료
//
// 한 번에 다 입력해야 하는 구조가 튀르키예를 중간에 멈추게 했다(브리프 K항).
// 그래서 **아무 때나 저장되고**, 무엇이 비었는지 단계별로 보여 준다.

import { toSettlementMethod, type SettlementMethod } from '@/lib/partnerContract';

export const STEPS = [1, 2, 3, 4, 5, 6] as const;
export type StepNo = (typeof STEPS)[number];

export interface StepDef { no: StepNo; key: string; ko: string; en: string }

/** 브리프 K항의 여섯 단계. 이름을 바꾸면 테스트가 잡는다. */
export const STEP_DEFS: readonly StepDef[] = [
  { no: 1, key: 'company',  ko: '회사 기본',        en: 'Company basics' },
  { no: 2, key: 'contract', ko: '계약서와 기간',    en: 'Contract file and period' },
  { no: 3, key: 'quantity', ko: '수량·단가',        en: 'Quantity and price' },
  { no: 4, key: 'issuing',  ko: '발급 권한과 한도', en: 'Issuing permission' },
  { no: 5, key: 'account',  ko: '첫 관리자 계정',   en: 'First administrator' },
  { no: 6, key: 'review',   ko: '확인과 완료',      en: 'Review and finish' },
];

export interface OnboardingDraft {
  // 1 회사 기본
  name: string;
  country: string;
  contactName: string;
  locale: string;
  currency: string;
  // 2 계약서·기간
  contractFileId: string;
  startsOn: string;
  endsOn: string;
  renewsOn: string;
  // 3 수량·단가
  settlementMethod: SettlementMethod | '';
  seats: string;
  months: string;
  unitPrice: string;
  commissionRate: string;
  // 4 발급 권한
  canIssueLicenses: boolean;
  issuingNote: string;
  // 5 계정 (안내만 — 실제 생성은 기존 admin-auth 흐름)
  adminAcknowledged: boolean;
}

export function emptyDraft(today: string): OnboardingDraft {
  return {
    name: '', country: '', contactName: '', locale: 'en', currency: 'USD',
    contractFileId: '', startsOn: today, endsOn: '', renewsOn: '',
    settlementMethod: '', seats: '', months: '', unitPrice: '', commissionRate: '',
    canIssueLicenses: false, issuingNote: '',
    adminAcknowledged: false,
  };
}

export interface StepProblem { step: StepNo; field: string; message: string }

/**
 * 단계별로 **무엇이 비었는지**. 비어 있어도 저장은 된다 —
 * 막는 것은 **완료(6단계)뿐**이다.
 */
export function stepProblems(d: OnboardingDraft): StepProblem[] {
  const out: StepProblem[] = [];
  const need = (step: StepNo, field: string, v: string, msg: string) => {
    if (!v.trim()) out.push({ step, field, message: msg });
  };

  // 1 회사 기본
  need(1, 'name', d.name, '회사 이름이 필요합니다.');
  need(1, 'country', d.country, '국가 코드가 필요합니다.');
  need(1, 'locale', d.locale, '언어가 필요합니다.');
  need(1, 'currency', d.currency, '통화가 필요합니다.');
  // ⚠️ 담당자 이름은 **선택**이다 — 모르는 채로 등록을 시작할 수 있어야 한다.

  // 2 계약서·기간
  need(2, 'startsOn', d.startsOn, '계약 시작일이 필요합니다.');
  if (d.endsOn.trim() && d.startsOn.trim() && d.endsOn < d.startsOn) {
    out.push({ step: 2, field: 'endsOn', message: '종료일이 시작일보다 앞섭니다.' });
  }
  // 계약서 파일은 **선택** — 아직 서명 전일 수 있다(브리프: 중간에 멈추지 않게).

  // 3 수량·단가
  const method = toSettlementMethod(d.settlementMethod);
  if (!method) out.push({ step: 3, field: 'settlementMethod', message: '정산 방식을 고르세요.' });
  if (method === 'wholesale') {
    need(3, 'unitPrice', d.unitPrice, '연간 인원당 단가가 필요합니다.');
  } else if (method === 'commission') {
    need(3, 'commissionRate', d.commissionRate, '수수료율이 필요합니다.');
  }
  const s = d.seats.trim(), m = d.months.trim();
  if ((s === '') !== (m === '')) {
    out.push({ step: 3, field: 'seats', message: '인원과 개월 수를 함께 적으세요(또는 둘 다 비우세요).' });
  } else if (s !== '' && !(Number.isInteger(Number(s)) && Number(s) > 0
                        && Number.isInteger(Number(m)) && Number(m) > 0)) {
    out.push({ step: 3, field: 'seats', message: '인원과 개월 수는 1 이상 정수여야 합니다.' });
  }

  // 4 발급 권한 — 켜고 끄는 것뿐이라 빠질 것이 없다.

  // 5 계정 — 첫 관리자를 어떻게 만들지 **읽었다**는 확인만 받는다.
  if (!d.adminAcknowledged) {
    out.push({ step: 5, field: 'adminAcknowledged', message: '첫 관리자 계정 안내를 확인해 주세요.' });
  }

  return out;
}

/** 그 단계가 끝났는가(그 단계에 남은 문제가 없는가). */
export function isStepDone(d: OnboardingDraft, step: StepNo): boolean {
  if (step === 6) return stepProblems(d).length === 0;
  return !stepProblems(d).some(p => p.step === step);
}

export interface Progress { done: number; total: number; percent: number; firstOpen: StepNo }

/** "몇 단계 중 몇" 과 **처음으로 비어 있는 단계**(거기부터 이어서 쓴다). */
export function progressOf(d: OnboardingDraft): Progress {
  const flags = STEPS.map(n => isStepDone(d, n));
  const done = flags.filter(Boolean).length;
  const firstOpenIdx = flags.findIndex(f => !f);
  return {
    done, total: STEPS.length,
    percent: Math.round((done / STEPS.length) * 100),
    firstOpen: (firstOpenIdx === -1 ? 6 : STEPS[firstOpenIdx]),
  };
}

/** 완료할 수 있는가. **막는 것은 여기뿐**이다. */
export function canFinish(d: OnboardingDraft): boolean {
  return stepProblems(d).length === 0;
}

// ───────────────────────── 저장 모양 ─────────────────────────

export interface PartnerDraftPayload {
  name: string;
  country: string | null;
  contact_name: string | null;
  locale: string | null;
  currency: string | null;
  can_issue_licenses: boolean;
  commission_rate: number | null;
  onboarding_status: 'draft' | 'done';
  onboarding_steps: Record<string, boolean>;
  notes: string | null;
}

function textOrNull(v: string): string | null {
  const s = v.trim();
  return s === '' ? null : s;
}
function numOrNull(v: string): number | null {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * `partners` 에 저장할 모양.
 *
 * ⚠️ **완료 전에는 `can_issue_licenses` 를 켜지 않는다.** 초안 상태에서 권한이 켜지면
 *    아직 계약도 계정도 없는 파트너가 발급을 시도할 수 있다.
 */
export function toPartnerPayload(d: OnboardingDraft, finish: boolean): PartnerDraftPayload {
  const steps: Record<string, boolean> = {};
  for (const n of STEPS) steps[String(n)] = isStepDone(d, n);
  return {
    name: d.name.trim(),
    country: textOrNull(d.country),
    contact_name: textOrNull(d.contactName),
    locale: textOrNull(d.locale),
    currency: textOrNull(d.currency),
    can_issue_licenses: finish ? d.canIssueLicenses : false,
    commission_rate: toSettlementMethod(d.settlementMethod) === 'commission'
      ? numOrNull(d.commissionRate) : null,
    onboarding_status: finish ? 'done' : 'draft',
    onboarding_steps: steps,
    notes: textOrNull(d.issuingNote),
  };
}

/** 저장된 파트너 행 → 마법사 폼(이어서 쓰기). */
export function partnerToDraft(
  row: Record<string, unknown>, today: string,
): OnboardingDraft {
  const d = emptyDraft(today);
  const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
  return {
    ...d,
    name: str(row.name),
    country: str(row.country),
    contactName: str(row.contact_name),
    locale: str(row.locale) || 'en',
    currency: str(row.currency) || 'USD',
    commissionRate: row.commission_rate === null || row.commission_rate === undefined
      ? '' : String(row.commission_rate),
    canIssueLicenses: row.can_issue_licenses === true,
    issuingNote: str(row.notes),
  };
}

/** 목록 배지 — NULL 은 **기존 파트너**라 완료로 본다. */
export type OnboardingBadge = 'draft' | 'done' | 'legacy';

export function onboardingBadge(v: unknown): OnboardingBadge {
  if (v === 'draft') return 'draft';
  if (v === 'done') return 'done';
  return 'legacy';
}

export function isDraftPartner(v: unknown): boolean {
  return onboardingBadge(v) === 'draft';
}
