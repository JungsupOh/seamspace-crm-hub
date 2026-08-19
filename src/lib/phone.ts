// 국가별 전화번호 정규화
// 한국: 숫자만 추출 (010-1234-5678 → 01012345678)
// 일본: +81/81 prefix 제거하고 선두 0 보존 (+81 90-1234-5678 → 09012345678)

export type PhoneCountry = 'kr' | 'jp' | 'intl';

export function normalizePhone(raw: string, country: PhoneCountry = 'kr'): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';

  // intl: 국가 특정 가공 없이 숫자만 보존 (영어권 해외 캠페인 — 국가 불특정)
  if (country === 'intl') return digits;

  if (country === 'jp') {
    // +81 9012345678 → 09012345678
    // 81 9012345678 → 09012345678
    // 8190 12345678 → 09012345678
    // 09012345678 → 09012345678 (그대로)
    if (digits.startsWith('81') && digits.length >= 11) {
      return '0' + digits.slice(2);
    }
    return digits;
  }

  // kr: 숫자만. 국가번호 82는 제거하고 국내 표기(0…)로 되돌린다
  //     (+82 10-1234-5678 → 01012345678) — 같은 사람이 국가번호 유무로 갈라지는 것 방지
  if (digits.startsWith('82') && digits.length >= 11) return '0' + digits.slice(2);
  return digits;
}

// 일본 휴대전화 표시용 포맷 (저장은 normalize로)
export function formatPhoneJP(raw: string): string {
  const n = normalizePhone(raw, 'jp');
  if (n.length === 11 && n.startsWith('0')) {
    return `${n.slice(0, 3)}-${n.slice(3, 7)}-${n.slice(7)}`;
  }
  return raw;
}
