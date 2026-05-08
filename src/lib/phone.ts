// 국가별 전화번호 정규화
// 한국: 숫자만 추출 (010-1234-5678 → 01012345678)
// 일본: +81/81 prefix 제거하고 선두 0 보존 (+81 90-1234-5678 → 09012345678)

export type PhoneCountry = 'kr' | 'jp';

export function normalizePhone(raw: string, country: PhoneCountry = 'kr'): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return '';

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

  // kr: 그대로 숫자만
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
