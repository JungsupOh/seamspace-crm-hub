// 국가 코드표 — LEAD-UI2 R3
//
// 왜 한 곳에 모으나
//   국가는 네 곳에서 쓰인다: 목록 표시 · 상세 편집 · 필터 · 가져오기 미리보기.
//   각자 이름을 만들면 "SG" / "Singapore" / "싱가포르" 가 뒤섞여 보인다.
//   저장 값은 **ISO 2자리 코드**로 통일하고(기존 데이터와 같다), 표시는 여기서만 만든다.
//
// 지역(region) 매핑은 leadRegion.ts 에 따로 있다 — 이 표는 "이름"만 책임진다.

export interface Country {
  /** ISO 3166-1 alpha-2 */
  code: string;
  ko: string;
  en: string;
  /** 검색에 걸리게 할 다른 표기(한글 약칭·옛 이름 등) */
  alt?: readonly string[];
}

/**
 * 우리가 실제로 만나는 나라 위주로 모았다 — 전시회(동남아·중동·유럽·미주),
 * 파트너(인도·미얀마·튀르키예·몽골), 국내.
 * 표에 없는 값도 **버리지 않는다**(직접 입력 허용, 지역은 '미분류'가 된다).
 */
export const COUNTRIES: readonly Country[] = [
  // 동아시아
  { code: 'KR', ko: '대한민국', en: 'South Korea', alt: ['한국', 'Korea', 'Republic of Korea'] },
  { code: 'JP', ko: '일본', en: 'Japan' },
  { code: 'CN', ko: '중국', en: 'China' },
  { code: 'HK', ko: '홍콩', en: 'Hong Kong' },
  { code: 'TW', ko: '대만', en: 'Taiwan' },
  { code: 'MO', ko: '마카오', en: 'Macau' },

  // 동남아
  { code: 'SG', ko: '싱가포르', en: 'Singapore' },
  { code: 'MY', ko: '말레이시아', en: 'Malaysia' },
  { code: 'ID', ko: '인도네시아', en: 'Indonesia' },
  { code: 'TH', ko: '태국', en: 'Thailand' },
  { code: 'VN', ko: '베트남', en: 'Vietnam', alt: ['Viet Nam'] },
  { code: 'PH', ko: '필리핀', en: 'Philippines' },
  { code: 'MM', ko: '미얀마', en: 'Myanmar', alt: ['Burma'] },
  { code: 'KH', ko: '캄보디아', en: 'Cambodia' },
  { code: 'LA', ko: '라오스', en: 'Laos' },
  { code: 'BN', ko: '브루나이', en: 'Brunei' },

  // 남아시아
  { code: 'IN', ko: '인도', en: 'India' },
  { code: 'PK', ko: '파키스탄', en: 'Pakistan' },
  { code: 'BD', ko: '방글라데시', en: 'Bangladesh' },
  { code: 'LK', ko: '스리랑카', en: 'Sri Lanka' },
  { code: 'NP', ko: '네팔', en: 'Nepal' },

  // 중앙아시아·몽골
  { code: 'MN', ko: '몽골', en: 'Mongolia' },
  { code: 'UZ', ko: '우즈베키스탄', en: 'Uzbekistan' },
  { code: 'KZ', ko: '카자흐스탄', en: 'Kazakhstan' },
  { code: 'KG', ko: '키르기스스탄', en: 'Kyrgyzstan' },
  { code: 'TJ', ko: '타지키스탄', en: 'Tajikistan' },
  { code: 'TM', ko: '투르크메니스탄', en: 'Turkmenistan' },
  { code: 'UA', ko: '우크라이나', en: 'Ukraine' },

  // 중동
  { code: 'AE', ko: '아랍에미리트', en: 'United Arab Emirates', alt: ['UAE', '두바이', 'Dubai'] },
  { code: 'SA', ko: '사우디아라비아', en: 'Saudi Arabia' },
  { code: 'QA', ko: '카타르', en: 'Qatar' },
  { code: 'KW', ko: '쿠웨이트', en: 'Kuwait' },
  { code: 'BH', ko: '바레인', en: 'Bahrain' },
  { code: 'OM', ko: '오만', en: 'Oman' },
  { code: 'TR', ko: '튀르키예', en: 'Türkiye', alt: ['터키', 'Turkey', 'Turkiye'] },
  { code: 'IL', ko: '이스라엘', en: 'Israel' },
  { code: 'JO', ko: '요르단', en: 'Jordan' },

  // 유럽
  { code: 'GB', ko: '영국', en: 'United Kingdom', alt: ['UK', 'England', 'Scotland', 'Wales'] },
  { code: 'IE', ko: '아일랜드', en: 'Ireland' },
  { code: 'DE', ko: '독일', en: 'Germany' },
  { code: 'FR', ko: '프랑스', en: 'France' },
  { code: 'ES', ko: '스페인', en: 'Spain' },
  { code: 'IT', ko: '이탈리아', en: 'Italy' },
  { code: 'NL', ko: '네덜란드', en: 'Netherlands' },
  { code: 'BE', ko: '벨기에', en: 'Belgium' },
  { code: 'CH', ko: '스위스', en: 'Switzerland' },
  { code: 'AT', ko: '오스트리아', en: 'Austria' },
  { code: 'SE', ko: '스웨덴', en: 'Sweden' },
  { code: 'NO', ko: '노르웨이', en: 'Norway' },
  { code: 'DK', ko: '덴마크', en: 'Denmark' },
  { code: 'FI', ko: '핀란드', en: 'Finland' },
  { code: 'PL', ko: '폴란드', en: 'Poland' },
  { code: 'PT', ko: '포르투갈', en: 'Portugal' },
  { code: 'CZ', ko: '체코', en: 'Czechia', alt: ['Czech Republic'] },
  { code: 'GR', ko: '그리스', en: 'Greece' },
  { code: 'RO', ko: '루마니아', en: 'Romania' },
  { code: 'HU', ko: '헝가리', en: 'Hungary' },

  // 미주
  { code: 'US', ko: '미국', en: 'United States', alt: ['USA', 'United States of America'] },
  { code: 'CA', ko: '캐나다', en: 'Canada' },
  { code: 'MX', ko: '멕시코', en: 'Mexico' },
  { code: 'BR', ko: '브라질', en: 'Brazil' },
  { code: 'AR', ko: '아르헨티나', en: 'Argentina' },
  { code: 'CL', ko: '칠레', en: 'Chile' },
  { code: 'CO', ko: '콜롬비아', en: 'Colombia' },
  { code: 'PE', ko: '페루', en: 'Peru' },

  // 오세아니아
  { code: 'AU', ko: '호주', en: 'Australia' },
  { code: 'NZ', ko: '뉴질랜드', en: 'New Zealand' },

  // 아프리카
  { code: 'ZA', ko: '남아프리카공화국', en: 'South Africa' },
  { code: 'EG', ko: '이집트', en: 'Egypt' },
  { code: 'NG', ko: '나이지리아', en: 'Nigeria' },
  { code: 'KE', ko: '케냐', en: 'Kenya' },
  { code: 'MA', ko: '모로코', en: 'Morocco' },
];

const BY_CODE = new Map(COUNTRIES.map(c => [c.code, c]));

/** 검색·입력 정규화에 쓰는 표. 대문자 키 → 코드. */
const LOOKUP = (() => {
  const m = new Map<string, string>();
  for (const c of COUNTRIES) {
    m.set(c.code.toUpperCase(), c.code);
    m.set(c.ko.toUpperCase(), c.code);
    m.set(c.en.toUpperCase(), c.code);
    for (const a of c.alt ?? []) m.set(a.toUpperCase(), c.code);
  }
  return m;
})();

/** 사람이 적은 표기를 ISO 코드로. 못 찾으면 null(= 표에 없는 값). */
export function toCountryCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return LOOKUP.get(s.toUpperCase()) ?? null;
}

export function findCountry(code: unknown): Country | null {
  return typeof code === 'string' ? BY_CODE.get(code.trim().toUpperCase()) ?? null : null;
}

/**
 * 화면 표시 — "싱가포르 (SG)".
 *
 * 표에 없는 값은 **지우지 않고 그대로** 보여 준다(`Ireland` 같은 자유 입력이
 * 운영에 이미 있다). 빈 값은 호출부가 고른 문구를 쓴다.
 */
export function countryLabel(v: unknown, empty = '—'): string {
  if (typeof v !== 'string' || !v.trim()) return empty;
  const raw = v.trim();
  const c = findCountry(raw) ?? (toCountryCode(raw) ? findCountry(toCountryCode(raw)!) : null);
  return c ? `${c.ko} (${c.code})` : raw;
}

/** 짧은 표시 — 목록처럼 좁은 자리용. 코드가 아는 값이면 한글 이름만. */
export function countryShort(v: unknown, empty = '—'): string {
  if (typeof v !== 'string' || !v.trim()) return empty;
  const c = findCountry(v.trim());
  return c ? c.ko : v.trim();
}

/**
 * 검색 — 한글 이름·영어 이름·코드·별칭 어느 것으로 쳐도 찾아진다.
 * 앞에서부터 일치하는 것을 위로 올린다(`sin` → 싱가포르가 먼저).
 */
export function searchCountries(q: string, limit = 20): Country[] {
  const s = q.trim().toUpperCase();
  if (!s) return COUNTRIES.slice(0, limit);
  const scored: Array<{ c: Country; score: number }> = [];
  for (const c of COUNTRIES) {
    const keys = [c.code, c.ko, c.en, ...(c.alt ?? [])].map(k => k.toUpperCase());
    let best = -1;
    for (const k of keys) {
      if (k === s) { best = 0; break; }
      if (k.startsWith(s)) { best = best < 0 ? 1 : Math.min(best, 1); continue; }
      if (k.includes(s)) { best = best < 0 ? 2 : Math.min(best, 2); }
    }
    if (best >= 0) scored.push({ c, score: best });
  }
  scored.sort((a, b) => a.score - b.score || a.c.ko.localeCompare(b.c.ko, 'ko'));
  return scored.slice(0, limit).map(x => x.c);
}
