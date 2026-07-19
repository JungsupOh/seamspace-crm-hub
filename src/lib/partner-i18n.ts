// ── 파트너 포털 경량 i18n / 포맷 헬퍼 ──────────────────
// PartnerPortal.tsx 전용. 기존 관리자 화면에는 영향 없음.
// locale='ko'면 항상 한국어 원문 그대로 반환 → 국내 파트너 회귀 없음.
// 전용 언어는 한국어/일본어뿐이고 그 외 국가는 영어로 통일한다.
// 일본어는 각 호출부에 ja 값만 채우면 됨(ja 없으면 en, en 없으면 ko 폴백).

export type PartnerLocale = 'ko' | 'ja' | 'en';
export type PartnerCurrency = 'KRW' | 'JPY' | 'USD' | string;

export interface Msg {
  ko: string;
  ja?: string;
  en?: string;
}

// ── 파트너 국가/언어/통화 목록 ────────────────────────
// 국가를 늘릴 때는 PARTNER_COUNTRIES에 한 줄만 추가하면 된다.
// locale/currency는 그 국가의 "기본값"일 뿐, 등록 화면에서 개별 변경 가능.
// 새 언어(예: 베트남어)나 새 통화(예: EUR)가 필요해지면 아래 목록에 추가하고
// PartnerLocale 타입과 makeT 폴백만 함께 늘리면 된다.

export interface PartnerCountry {
  code: string;
  label: string;
  locale: PartnerLocale;
  currency: PartnerCurrency;
}

export const PARTNER_COUNTRIES: PartnerCountry[] = [
  { code: 'KR', label: '한국',     locale: 'ko', currency: 'KRW' },
  { code: 'JP', label: '일본',     locale: 'ja', currency: 'JPY' },
  { code: 'US', label: '미국',     locale: 'en', currency: 'USD' },
  { code: 'TR', label: '튀르키예', locale: 'en', currency: 'USD' },
  { code: 'VN', label: '베트남',   locale: 'en', currency: 'USD' },
  { code: 'MN', label: '몽골',     locale: 'en', currency: 'USD' },
  { code: 'MM', label: '미얀마',   locale: 'en', currency: 'USD' },
];

export const PARTNER_LOCALES: { code: PartnerLocale; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
];

export const PARTNER_CURRENCIES: PartnerCurrency[] = ['KRW', 'JPY', 'USD'];

/** 국가 코드 → 기본 언어/통화. 목록에 없으면 영어/USD로 통일. */
export function defaultsForCountry(code: string): { locale: PartnerLocale; currency: PartnerCurrency } {
  const c = PARTNER_COUNTRIES.find(x => x.code === code);
  return { locale: c?.locale ?? 'en', currency: c?.currency ?? 'USD' };
}

/** locale에 바인딩된 번역 함수 생성 */
export function makeT(locale: PartnerLocale) {
  return (m: Msg): string => {
    if (locale === 'ja') return m.ja ?? m.en ?? m.ko;
    if (locale === 'en') return m.en ?? m.ko;
    return m.ko;
  };
}

/** 금액 → 통화 문자열 (단일 문자열). KRW는 기존 표기(원) 유지. */
export function formatMoney(amount: number, currency: PartnerCurrency): string {
  const n = Math.round(amount || 0);
  if (currency === 'KRW') return `${n.toLocaleString()}원`;
  if (currency === 'JPY') return `¥${n.toLocaleString()}`;
  if (currency === 'USD') return `$${n.toLocaleString()}`;
  return `${n.toLocaleString()} ${currency}`;
}

/** 숫자 span + 단위 span 구조를 유지하기 위한 단위 라벨. KRW='원'(기존 동일). */
export function currencyUnit(currency: PartnerCurrency): string {
  if (currency === 'KRW') return '원';
  if (currency === 'JPY') return '¥';
  return currency;
}

/** 국제 전화번호 정리 — 재포맷 없이 허용 문자만 유지 */
export function formatIntlPhone(v: string): string {
  return v.replace(/[^\d+()\-\s]/g, '');
}
