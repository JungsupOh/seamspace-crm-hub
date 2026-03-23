// NEIS 학교기본정보 오픈 API
// https://open.neis.gov.kr/hub/schoolInfo

const NEIS_KEY  = '7d82795a2695490c8ac02d76eee7e110';
const NEIS_BASE = 'https://open.neis.go.kr/hub/schoolInfo';

export interface SchoolInfo {
  name:        string;   // SCHUL_NM
  kind:        string;   // SCHUL_KND_SC_NM (초등학교/중학교/고등학교…)
  eduOffice:   string;   // ATPT_OFCDC_SC_NM
  zipCode:     string;   // ORG_RDNZC
  address:     string;   // ORG_RDNMA
  addressDetail: string; // ORG_RDNDA
  tel:         string;   // ORG_TELNO
  homepage:    string;   // HMPG_ADRES
}

export async function searchSchools(query: string): Promise<SchoolInfo[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    Key:      NEIS_KEY,
    Type:     'json',
    pIndex:   '1',
    pSize:    '20',
    SCHUL_NM: query.trim(),
  });
  const res = await fetch(`${NEIS_BASE}?${params}`);
  if (!res.ok) throw new Error(`NEIS API 오류: ${res.status}`);
  const json = await res.json();

  // 결과 없음
  const info = json?.schoolInfo;
  if (!info) return [];

  // 오류 코드 체크
  const head = info[0]?.head;
  const result = head?.[1]?.RESULT;
  if (result?.CODE !== 'INFO-000') return [];

  const rows: Record<string, string>[] = info[1]?.row ?? [];
  return rows.map(r => ({
    name:          r.SCHUL_NM       ?? '',
    kind:          r.SCHUL_KND_SC_NM ?? '',
    eduOffice:     r.ATPT_OFCDC_SC_NM ?? '',
    zipCode:       r.ORG_RDNZC      ?? '',
    address:       r.ORG_RDNMA      ?? '',
    addressDetail: r.ORG_RDNDA      ?? '',
    tel:           r.ORG_TELNO      ?? '',
    homepage:      r.HMPG_ADRES     ?? '',
  }));
}
