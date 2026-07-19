// ── 파트너 포털 경량 i18n / 포맷 헬퍼 ──────────────────
// PartnerPortal.tsx 전용. 기존 관리자 화면에는 영향 없음.
// locale='ko'면 항상 한국어 원문 그대로 반환 → 국내 파트너 회귀 없음.
// 튀르키예어는 나중에 각 호출부에 tr 값만 채우면 됨(tr 없으면 en, en 없으면 ko 폴백).

export type PartnerLocale = 'ko' | 'en' | 'tr';
export type PartnerCurrency = 'KRW' | 'USD' | string;

export interface Msg {
  ko: string;
  en?: string;
  tr?: string;
}

/** locale에 바인딩된 번역 함수 생성 */
export function makeT(locale: PartnerLocale) {
  return (m: Msg): string => {
    if (locale === 'tr') return m.tr ?? m.en ?? m.ko;
    if (locale === 'en') return m.en ?? m.ko;
    return m.ko;
  };
}

/** 금액 → 통화 문자열 (단일 문자열). KRW는 기존 표기(원) 유지. */
export function formatMoney(amount: number, currency: PartnerCurrency): string {
  const n = Math.round(amount || 0);
  if (currency === 'KRW') return `${n.toLocaleString()}원`;
  if (currency === 'USD') return `$${n.toLocaleString()}`;
  return `${n.toLocaleString()} ${currency}`;
}

/** 숫자 span + 단위 span 구조를 유지하기 위한 단위 라벨. KRW='원'(기존 동일). */
export function currencyUnit(currency: PartnerCurrency): string {
  return currency === 'KRW' ? '원' : currency;
}

/** 국제 전화번호 정리 — 재포맷 없이 허용 문자만 유지 */
export function formatIntlPhone(v: string): string {
  return v.replace(/[^\d+()\-\s]/g, '');
}
