// 국가 → 지역(시장) 자동 분류 — LEAD-5 (CRM-008)
//
// 요구(CRM-008 · 브리프 C항): 지역은 **손으로 고르지 않고 country 에서 자동으로** 정해진다.
// 그래서 DB 칸을 만들지 않고 이 파일의 순수 함수로 파생한다 —
//   · 칸을 두면 운영 데이터 백필이 필요해진다(명령서가 운영 데이터 변경을 금지).
//   · "나라를 고치면 지역이 따라 바뀐다"는 요구에도 파생이 맞다.
//
// ⚠️ 운영 contacts.country 는 ISO 코드가 아니다 — 'Korea' 562건 / 빈 값 938건 /
//    'intl' 1건(009-1). 그래서 코드·영문명·한글명을 모두 받아들이고,
//    모르는 값은 **임의로 끼워 맞추지 않고** '기타'로 모은다(목록에서 바로 찾아 배정하게).

export type Region =
  | 'KR' | 'US' | 'GB' | 'EU' | 'GCC' | 'IN' | 'SEA' | 'JP' | 'LATAM' | 'CA'
  | 'OTHER' | 'UNKNOWN';

/** 화면 표시 순서 — 국내가 먼저, '기타'·'미분류'가 마지막. */
export const REGIONS: readonly Region[] = [
  'KR', 'US', 'GB', 'EU', 'GCC', 'IN', 'SEA', 'JP', 'LATAM', 'CA', 'OTHER', 'UNKNOWN',
] as const;

export const REGION_LABEL: Record<Region, string> = {
  KR: '국내',
  US: '미국',
  GB: '영국',
  EU: '유럽',
  GCC: '중동(GCC)',
  IN: '인도',
  SEA: '동남아',
  JP: '일본',
  LATAM: '남미',
  CA: '중앙아시아',
  OTHER: '기타',
  UNKNOWN: '미분류',
};

/**
 * ISO 2자 코드 → 지역.
 *
 * 출처: CRM-008 항목과 브리프 C항의 James 지정 9개 지역 + 국내.
 * James 결정 대기였던 나라(튀르키예·캐나다·호주·중국·남아시아·아프리카·멕시코 등)는
 * **임의로 9개에 넣지 않고 'OTHER'(기타)로 모은다** — 되돌리기 쉽고,
 * 목록에서 '기타'만 걸러 한 번에 배정할 수 있다(audit/lead1_design.md §6 ⑥).
 */
export const COUNTRY_TO_REGION: Readonly<Record<string, Region>> = {
  KR: 'KR',
  US: 'US',
  GB: 'GB',

  // 유럽 — 브리프 C항 "독일·프랑스·스페인·이탈리아·네덜란드·북유럽·동유럽·스위스 등"
  DE: 'EU', FR: 'EU', ES: 'EU', IT: 'EU', NL: 'EU', BE: 'EU', LU: 'EU', AT: 'EU',
  CH: 'EU', SE: 'EU', NO: 'EU', DK: 'EU', FI: 'EU', IS: 'EU', IE: 'EU', PT: 'EU',
  PL: 'EU', CZ: 'EU', SK: 'EU', HU: 'EU', RO: 'EU', BG: 'EU', GR: 'EU', HR: 'EU',
  SI: 'EU', EE: 'EU', LV: 'EU', LT: 'EU', RS: 'EU', MT: 'EU', CY: 'EU',

  // 중동(GCC) — 브리프 C항에 적힌 6개국 그대로. 튀르키예는 여기에 넣지 않는다.
  AE: 'GCC', SA: 'GCC', QA: 'GCC', KW: 'GCC', BH: 'GCC', OM: 'GCC',

  IN: 'IN',

  // 동남아 — 브리프 C항(James 가 홍콩·대만도 이 그룹에 넣었다)
  SG: 'SEA', ID: 'SEA', MY: 'SEA', MM: 'SEA', VN: 'SEA', HK: 'SEA', TW: 'SEA',
  TH: 'SEA', PH: 'SEA', KH: 'SEA', LA: 'SEA', BN: 'SEA',

  JP: 'JP',

  // 남미
  BR: 'LATAM', AR: 'LATAM', CL: 'LATAM', CO: 'LATAM', PE: 'LATAM',
  UY: 'LATAM', PY: 'LATAM', BO: 'LATAM', EC: 'LATAM', VE: 'LATAM',

  // 중앙아시아 — 브리프 C항. **UA(우크라이나)는 James 가 이 그룹으로 적었다**
  // (지리상 유럽에 가깝지만 적힌 대로 둔다. 바꾸려면 이 한 줄만 고치면 된다.)
  MN: 'CA', UZ: 'CA', KZ: 'CA', KG: 'CA', TJ: 'CA', TM: 'CA', UA: 'CA',
};

/** 코드가 아닌 표기 → ISO 코드. 운영 데이터와 가져오기 원본이 섞여 있어서 필요하다. */
const NAME_TO_CODE: Readonly<Record<string, string>> = {
  // 운영 contacts.country 에 실제로 있는 값(009-1)
  KOREA: 'KR', 'SOUTH KOREA': 'KR', 'REPUBLIC OF KOREA': 'KR', '대한민국': 'KR', '한국': 'KR',
  // 한글 국가명 — James 의 EDUtech 명단에 실제로 섞여 있다(싱가포르 6건·말레이시아·일본 등)
  '싱가포르': 'SG', '말레이시아': 'MY', '인도네시아': 'ID', '베트남': 'VN', '태국': 'TH',
  '필리핀': 'PH', '미얀마': 'MM', '캄보디아': 'KH', '홍콩': 'HK', '대만': 'TW',
  '일본': 'JP', '인도': 'IN', '몽골': 'MN', '미국': 'US', '영국': 'GB',
  '독일': 'DE', '프랑스': 'FR', '아일랜드': 'IE', '카타르': 'QA', '호주': 'AU',
  '중국': 'CN', '캐나다': 'CA_COUNTRY', '스리랑카': 'LK', '튀르키예': 'TR', '터키': 'TR',
  // 전시회 명단에 흔한 영문명
  SINGAPORE: 'SG', MALAYSIA: 'MY', INDONESIA: 'ID', VIETNAM: 'VN', 'VIET NAM': 'VN',
  THAILAND: 'TH', PHILIPPINES: 'PH', MYANMAR: 'MM', BURMA: 'MM', CAMBODIA: 'KH',
  'HONG KONG': 'HK', TAIWAN: 'TW', JAPAN: 'JP', INDIA: 'IN', MONGOLIA: 'MN',
  'UNITED STATES': 'US', USA: 'US', 'UNITED STATES OF AMERICA': 'US',
  'UNITED KINGDOM': 'GB', UK: 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB',
  GERMANY: 'DE', FRANCE: 'FR', SPAIN: 'ES', ITALY: 'IT', NETHERLANDS: 'NL',
  SWITZERLAND: 'CH', SWEDEN: 'SE', NORWAY: 'NO', DENMARK: 'DK', FINLAND: 'FI',
  'UNITED ARAB EMIRATES': 'AE', UAE: 'AE', 'SAUDI ARABIA': 'SA', QATAR: 'QA',
  KUWAIT: 'KW', BAHRAIN: 'BH', OMAN: 'OM',
  BRAZIL: 'BR', ARGENTINA: 'AR', CHILE: 'CL', COLOMBIA: 'CO', PERU: 'PE',
  UZBEKISTAN: 'UZ', KAZAKHSTAN: 'KZ', UKRAINE: 'UA',
  // 지역 9개에 없는 나라들 — 코드로는 바꿔 주되 지역은 '기타'가 된다
  TURKEY: 'TR', TURKIYE: 'TR', 'TÜRKIYE': 'TR',
  CANADA: 'CA_COUNTRY', AUSTRALIA: 'AU', 'NEW ZEALAND': 'NZ', CHINA: 'CN',
  PAKISTAN: 'PK', BANGLADESH: 'BD', 'SRI LANKA': 'LK', NEPAL: 'NP',
  MEXICO: 'MX', 'SOUTH AFRICA': 'ZA', NIGERIA: 'NG', EGYPT: 'EG', KENYA: 'KE',
};

/**
 * 사람이 손으로 덧붙인 주석을 떼어 낸다.
 *
 * ⚠️ James 의 EDUtech 명단에는 국가 칸에 이런 값들이 실제로 들어 있다:
 *    `싱가포르(추정)` · `Malaysia[?]` · `United States(배지 정보)` · `Thailand [?]` ·
 *    `싱가포르(명함 +65)` · `싱가포르(추정, 메모에 Singapore)`.
 *    떼어 내지 않으면 **전부 '기타'로 떨어진다** — 24건이 넘는 싱가포르가 미분류가 된다.
 *
 * 주석 자체는 버리지 않는다 — 가져오기가 `custom_fields` 에 원본을 남기고,
 * 불확실 표시(`?`·추정)는 이메일 신뢰도를 낮추는 근거로 쓴다(hasUncertainty).
 */
export function stripAnnotation(v: string): string {
  return v
    .replace(/[([][^)\]]*[)\]]/g, ' ')   // (…) [ … ] 제거
    .replace(/[?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 손글씨 판독·추측 표시가 있는가 — 이메일 신뢰도를 낮추는 근거. */
export function hasUncertainty(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return /[?？]|추정|확인\s*필요|불확실|\[\s*\?/.test(v);
}

/**
 * 자유 표기의 country 를 ISO 2자 코드로.
 *
 * ⚠️ 캐나다는 'CA' 인데 우리 지역 코드에도 'CA'(중앙아시아)가 있다. 이름이 겹치면
 *    캐나다가 중앙아시아로 들어가므로, 이름 표에서는 'CA_COUNTRY' 로 피해 두고
 *    여기서 되돌린다. 지역 매핑에는 없으므로 결과는 '기타'다.
 */
export function normalizeCountry(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const raw = stripAnnotation(v);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const named = NAME_TO_CODE[upper];
  if (named) return named === 'CA_COUNTRY' ? 'CA' : named;
  // 이미 2자 코드인 경우
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return raw;   // 모르는 표기는 원본을 그대로 들고 간다(지역은 '기타'가 된다)
}

export interface RegionInput {
  country?: unknown;
  /** country 가 비었을 때의 보조 판단용 — 한국 휴대폰이면 국내로 본다. */
  phone?: unknown;
  market?: unknown;
}

/**
 * 지역 판정.
 *
 * James 결정(2026-11-14, 009-1 결과 기반):
 *   · `Korea` → 국내
 *   · country 가 **비어 있으면**: 전화번호가 한국 휴대폰(010 등)이면 국내, 아니면 미분류
 *   · `intl` 은 국가가 아닌 구분값이므로 미분류(James 가 건별로 정한다)
 */
export function regionOf(input: RegionInput): Region {
  const code = normalizeCountry(input.country);

  // 'intl' 같은 구분값은 국가가 아니다 → 미분류
  if (code && code.toUpperCase() === 'INTL') return 'UNKNOWN';

  if (code) {
    const upper = code.toUpperCase();
    // 캐나다('CA')가 중앙아시아 코드와 겹치는 것을 막는다 — 매핑표에 CA 키가 없으므로
    // 자연히 '기타'가 되지만, 표를 나중에 고칠 때 실수하지 않도록 못 박아 둔다.
    if (upper === 'CA') return 'OTHER';
    const r = COUNTRY_TO_REGION[upper];
    if (r) return r;
    return 'OTHER';
  }

  // country 가 비었다 → 한국 휴대폰이면 국내
  const digits = typeof input.phone === 'string' ? input.phone.replace(/\D/g, '') : '';
  if (isKoreanMobile(digits)) return 'KR';
  return 'UNKNOWN';
}

/**
 * 한국 휴대폰인가 — 010/011/016/017/018/019 로 시작하는 10~11자리.
 *
 * ⚠️ 국가번호 표기가 두 가지다. 국제 표준은 앞의 0 을 **떼므로** `+82 10-1234-5678`
 *    → `821012345678` 이 되고, 손으로 적을 때는 0 을 남겨 `82010...` 이 되기도 한다.
 *    둘 다 받아야 한다 — 하나만 받으면 "한국 사람인데 미분류"가 조용히 생긴다.
 */
export function isKoreanMobile(digits: string): boolean {
  const body = digits.startsWith('82')
    ? (digits[2] === '0' ? digits.slice(2) : `0${digits.slice(2)}`)
    : digits;
  return /^01[0169]\d{7,8}$/.test(body);
}

/** 지역별 건수 요약. 표시 순서를 지키고, 0건인 지역도 넣을지 고를 수 있다. */
export function regionCounts<T extends RegionInput>(
  rows: readonly T[], includeEmpty = false,
): Array<{ region: Region; label: string; count: number }> {
  const m = new Map<Region, number>();
  for (const r of rows) {
    const g = regionOf(r);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return REGIONS
    .filter(g => includeEmpty || (m.get(g) ?? 0) > 0)
    .map(g => ({ region: g, label: REGION_LABEL[g], count: m.get(g) ?? 0 }));
}
