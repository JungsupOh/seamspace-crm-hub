// LEAD-UI2 순수 로직 — R3 국가표 · R6 같은 기관 · R1 변경 기록 · R4 발송 가능 · R8 보관
//
// 지켜야 하는 약속
//   ① 국가는 한글·영문·코드 어느 것으로 쳐도 같은 코드가 된다.
//   ② 같은 기관 판정에 **자유 메일 도메인을 쓰지 않는다**(gmail 끼리 묶이면 안 된다).
//   ③ 접미사를 뗀 비교는 "추정"일 뿐 "확실"이 아니다.
//   ④ 변경 기록은 `[변경]` 으로 시작하고, 이메일을 바꾸면 email_normalized 도 같이 바뀐다.
//   ⑤ "메일 발송 가능"은 **모르면 보내지 않는다**.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  COUNTRIES, countryLabel, countryShort, findCountry, searchCountries, toCountryCode,
} from '../lib/countries';
import { normalizeCountry, regionOf } from '../lib/leadRegion';
import {
  FREE_EMAIL_DOMAINS, MATCH_LABEL, findOrgMates, normalizeOrgName, orgCore, orgDomain,
  recentOutreachToOrg,
} from '../lib/leadOrg';
import {
  ARCHIVE_PREFIX, CHANGE_PREFIX, EMAIL_STATUS_HELP, TRACKED_FIELDS, archiveSummary,
  buildEditPatch, changeSummary, diffTracked, displayValue, emailStatusLabel,
  excludeArchived, findEmailDuplicates, isArchived, isChangeRecord, isMailable,
  qualityLabel, unarchiveSummary,
} from '../lib/leadEdit';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

// ══════════════════════ R3 국가 ══════════════════════
describe('R3 · 국가 코드표', () => {
  it('40개 이상이고 코드가 겹치지 않는다', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(COUNTRIES.map(c => c.code)).size).toBe(COUNTRIES.length);
  });

  it('코드는 ISO 2자 대문자다', () => {
    for (const c of COUNTRIES) expect(c.code, c.code).toMatch(/^[A-Z]{2}$/);
  });

  it('한글·영문 이름이 비어 있지 않다', () => {
    for (const c of COUNTRIES) {
      expect(c.ko.trim(), c.code).not.toBe('');
      expect(c.en.trim(), c.code).not.toBe('');
    }
  });

  it.each([
    ['SG', 'SG'], ['sg', 'SG'], ['Singapore', 'SG'], ['싱가포르', 'SG'], [' SINGAPORE ', 'SG'],
    ['KR', 'KR'], ['대한민국', 'KR'], ['한국', 'KR'], ['Korea', 'KR'], ['Republic of Korea', 'KR'],
    ['US', 'US'], ['USA', 'US'], ['United States', 'US'], ['미국', 'US'],
    ['GB', 'GB'], ['UK', 'GB'], ['England', 'GB'], ['영국', 'GB'],
    ['TR', 'TR'], ['터키', 'TR'], ['Turkey', 'TR'], ['튀르키예', 'TR'],
    ['AE', 'AE'], ['UAE', 'AE'], ['두바이', 'AE'],
    ['Ireland', 'IE'], ['아일랜드', 'IE'],
    ['Myanmar', 'MM'], ['Burma', 'MM'],
  ])('%s → %s (대소문자·언어 무관)', (input, want) => {
    expect(toCountryCode(input)).toBe(want);
  });

  it('표에 없는 값은 null 이다 (임의로 끼워 맞추지 않는다)', () => {
    for (const v of ['Freedonia', '', '  ', null, 123, 'ZZ']) {
      expect(toCountryCode(v), String(v)).toBeNull();
    }
  });

  it('표시는 "한글 (코드)" 형태다', () => {
    expect(countryLabel('SG')).toBe('싱가포르 (SG)');
    expect(countryLabel('Singapore')).toBe('싱가포르 (SG)');
    expect(countryLabel('싱가포르')).toBe('싱가포르 (SG)');
  });

  it('표에 없는 값은 지우지 않고 그대로 보여 준다 (운영에 자유 입력이 있다)', () => {
    expect(countryLabel('Freedonia')).toBe('Freedonia');
  });

  it('빈 값은 고른 문구로', () => {
    expect(countryLabel('')).toBe('—');
    expect(countryLabel(null, '미정')).toBe('미정');
  });

  it('좁은 자리에는 한글 이름만', () => {
    expect(countryShort('SG')).toBe('싱가포르');
    expect(countryShort('Freedonia')).toBe('Freedonia');
  });

  it('검색 — 한글·영문·코드 어느 것으로도', () => {
    expect(searchCountries('싱가').map(c => c.code)).toContain('SG');
    expect(searchCountries('sing').map(c => c.code)).toContain('SG');
    expect(searchCountries('SG').map(c => c.code)[0]).toBe('SG');
    expect(searchCountries('말레이').map(c => c.code)).toContain('MY');
  });

  it('정확히 맞는 것이 먼저 나온다', () => {
    expect(searchCountries('korea')[0].code).toBe('KR');
  });

  it('빈 검색어는 목록 앞부분을 준다', () => {
    expect(searchCountries('').length).toBeGreaterThan(0);
  });

  it('레코드 조회', () => {
    expect(findCountry('sg')?.ko).toBe('싱가포르');
    expect(findCountry('ZZ')).toBeNull();
  });

  // 운영에 'Ireland' 가 코드로 안 바뀐 채 들어간 적이 있다 — 그 구멍을 막았다
  it('leadRegion 도 같은 표를 쓴다 (Ireland → IE → 유럽)', () => {
    expect(normalizeCountry('Ireland')).toBe('IE');
    expect(regionOf({ country: 'Ireland' })).toBe('EU');
  });

  it('지역 분류는 전과 같다 (코드표를 붙여도 안 바뀐다)', () => {
    expect(regionOf({ country: 'SG' })).toBe('SEA');
    expect(regionOf({ country: '싱가포르(추정)' })).toBe('SEA');
    expect(regionOf({ country: 'CA' })).toBe('OTHER');   // 캐나다
  });
});

// ══════════════════════ R6 같은 기관 ══════════════════════
describe('R6 · 이메일 도메인', () => {
  it('자유 메일은 기관 판단에 쓰지 않는다', () => {
    for (const d of ['gmail.com', 'naver.com', 'yahoo.com', 'hotmail.com', 'qq.com', 'icloud.com']) {
      expect(orgDomain(`a@${d}`), d).toBeNull();
    }
  });

  it('기관 도메인은 돌려준다', () => {
    expect(orgDomain('a@alpha.edu.sg')).toBe('alpha.edu.sg');
    expect(orgDomain('A@School.AC.UK')).toBe('school.ac.uk');
  });

  it('도메인이 아니면 null', () => {
    for (const v of ['noat', '@x.com', 'a@nodot', '', null]) {
      expect(orgDomain(v), String(v)).toBeNull();
    }
  });

  it('자유 메일 목록에 주요 서비스가 들어 있다', () => {
    for (const d of ['gmail.com', 'outlook.com', 'naver.com', 'proton.me']) {
      expect(FREE_EMAIL_DOMAINS).toContain(d);
    }
  });
});

describe('R6 · 기관명 정규화', () => {
  it('공백·대소문자·구두점을 맞춘다', () => {
    expect(normalizeOrgName('  Alpha   School, Inc. ')).toBe('alpha school inc');
    expect(normalizeOrgName('ALPHA SCHOOL')).toBe('alpha school');
  });

  it('핵심 이름은 법인·기관 접미사를 뗀다', () => {
    expect(orgCore('Alpha School')).toBe('alpha');
    expect(orgCore('Alpha Pte Ltd')).toBe('alpha');
    expect(orgCore('서울초등학교')).toBe('서울초등학교');   // 한 단어라 안 떼어진다
    expect(orgCore('서울 초등학교')).toBe('서울');
  });

  it('접미사만 있는 이름은 원본을 쓴다 (서로 다른 기관이 한 묶음 되면 안 된다)', () => {
    expect(orgCore('School')).toBe('school');
    expect(orgCore('Academy')).toBe('academy');
    // 둘이 서로 같지 않아야 한다
    expect(orgCore('School')).not.toBe(orgCore('Academy'));
  });

  it('빈 값', () => {
    expect(normalizeOrgName(null)).toBe('');
    expect(orgCore('')).toBe('');
  });
});

describe('R6 · 같은 기관 사람 찾기', () => {
  const L = (id: string, school?: string, email?: string) => ({
    id, name: id, school_name: school, email_normalized: email,
  });

  it('소속이 정확히 같으면 확실이다', () => {
    const me = L('me', 'Alpha School');
    const r = findOrgMates(me, [me, L('a', 'ALPHA  SCHOOL'), L('b', 'Beta')]);
    expect(r).toHaveLength(1);
    expect(r[0].lead.id).toBe('a');
    expect(r[0].confidence).toBe('sure');
    expect(r[0].kinds).toContain('org-exact');
  });

  it('기관 도메인이 같으면 확실이다 (소속을 안 적었어도)', () => {
    const me = L('me', '', 'x@alpha.edu.sg');
    const r = findOrgMates(me, [me, L('a', '', 'y@alpha.edu.sg')]);
    expect(r[0].confidence).toBe('sure');
    expect(r[0].kinds).toContain('domain');
  });

  it('**gmail 끼리는 묶이지 않는다** (가장 중요)', () => {
    const me = L('me', '', 'x@gmail.com');
    expect(findOrgMates(me, [me, L('a', '', 'y@gmail.com'), L('b', '', 'z@gmail.com')])).toEqual([]);
  });

  it('접미사만 다르면 추정이다 (확실 아님)', () => {
    const me = L('me', 'Alpha School');
    const r = findOrgMates(me, [me, L('a', 'Alpha Academy')]);
    expect(r[0].confidence).toBe('maybe');
    expect(r[0].kinds).toEqual(['org-fuzzy']);
  });

  it('자기 자신은 빠진다', () => {
    const me = L('me', 'Alpha');
    expect(findOrgMates(me, [me]).map(m => m.lead.id)).toEqual([]);
  });

  it('소속도 기관 도메인도 없으면 아무도 묶지 않는다', () => {
    const me = L('me', '', 'x@gmail.com');
    expect(findOrgMates(me, [me, L('a', 'Alpha'), L('b', '', 'y@beta.edu')])).toEqual([]);
  });

  it('소속이 비면 다른 빈 소속과 묶이지 않는다', () => {
    const me = L('me', '', 'x@alpha.edu');
    const r = findOrgMates(me, [me, L('a', ''), L('b', '', 'y@alpha.edu')]);
    expect(r.map(m => m.lead.id)).toEqual(['b']);
  });

  it('확실이 추정보다 위로 온다', () => {
    const me = L('me', 'Alpha School', 'x@alpha.edu');
    const r = findOrgMates(me, [me, L('fuzzy', 'Alpha Academy'), L('sure', 'alpha school')]);
    expect(r.map(m => m.lead.id)).toEqual(['sure', 'fuzzy']);
  });

  it('두 근거가 같이 잡히면 둘 다 보여 준다', () => {
    const me = L('me', 'Alpha', 'x@alpha.edu');
    const r = findOrgMates(me, [me, L('a', 'Alpha', 'y@alpha.edu')]);
    expect(r[0].kinds.sort()).toEqual(['domain', 'org-exact']);
  });

  it('배지 문구', () => {
    expect(MATCH_LABEL['org-exact']).toBe('소속 일치');
    expect(MATCH_LABEL.domain).toBe('이메일 도메인 일치');
    expect(MATCH_LABEL['org-fuzzy']).toBe('소속 비슷');
  });
});

describe('R6 · 중복 접촉 경고', () => {
  const mates = [{ lead: { id: 'a' }, kinds: ['org-exact' as const], confidence: 'sure' as const }];
  const T = '2026-11-17';

  it('14일 안에 보낸 적이 있으면 알려 준다', () => {
    const r = recentOutreachToOrg(mates, [
      { lead_id: 'a', direction: 'out', occurred_at: '2026-11-14T00:00:00Z' },
    ], T);
    expect(r).toEqual({ leadId: 'a', daysAgo: 3 });
  });

  it('받은 것(in)은 세지 않는다 — 중복 "연락"을 막는 것이 목적', () => {
    expect(recentOutreachToOrg(mates, [
      { lead_id: 'a', direction: 'in', occurred_at: '2026-11-16T00:00:00Z' },
    ], T)).toBeNull();
  });

  it('취소된 기록은 세지 않는다', () => {
    expect(recentOutreachToOrg(mates, [
      { lead_id: 'a', direction: 'out', occurred_at: '2026-11-16T00:00:00Z', voided_at: '2026-11-16T01:00:00Z' },
    ], T)).toBeNull();
  });

  it('14일보다 오래되면 알리지 않는다', () => {
    expect(recentOutreachToOrg(mates, [
      { lead_id: 'a', direction: 'out', occurred_at: '2026-10-01T00:00:00Z' },
    ], T)).toBeNull();
  });

  it('가장 최근 것을 고른다', () => {
    const r = recentOutreachToOrg(mates, [
      { lead_id: 'a', direction: 'out', occurred_at: '2026-11-10T00:00:00Z' },
      { lead_id: 'a', direction: 'out', occurred_at: '2026-11-16T00:00:00Z' },
    ], T);
    expect(r?.daysAgo).toBe(1);
  });

  it('같은 기관이 없으면 null', () => {
    expect(recentOutreachToOrg([], [
      { lead_id: 'a', direction: 'out', occurred_at: '2026-11-16T00:00:00Z' },
    ], T)).toBeNull();
  });
});

// ══════════════════════ R1 변경 기록 ══════════════════════
describe('R1 · 변경 기록', () => {
  it('기록 대상 칸이 요구대로다', () => {
    // LEAD-S4 에서 lead_type 이 더해졌다 — 유형이 바뀌면 단계 목록과 기본 다음 행동이
    // 달라지므로 이력에 남아야 한다(요구 S4-1).
    expect([...TRACKED_FIELDS].sort()).toEqual([
      'country', 'email', 'email_status', 'followup_stage', 'lead_type', 'name',
      'probability', 'school_name', 'segment',
    ]);
  });

  it('메모·직함처럼 자주 다듬는 칸은 기록하지 않는다', () => {
    expect(diffTracked({ notes: 'a', position: 'x' }, { notes: 'b', position: 'y' })).toEqual([]);
  });

  it('국가를 바꾸면 "국가: (비어 있음) → 싱가포르 (SG)" 로 적는다', () => {
    const d = diffTracked({ country: null }, { country: 'SG' });
    expect(d[0].line).toBe('국가: (비어 있음) → 싱가포르 (SG)');
  });

  it('이메일 상태는 한글로 적는다', () => {
    const d = diffTracked({ email_status: 'hold' }, { email_status: 'valid' });
    expect(d[0].line).toBe('이메일 상태: 발송 보류 → 확인됨');
  });

  it('요약은 [변경] 으로 시작한다', () => {
    const s = changeSummary(diffTracked({ name: 'A' }, { name: 'B' }));
    expect(s.startsWith(CHANGE_PREFIX)).toBe(true);
    expect(s).toBe('[변경] 이름: A → B');
  });

  it('여러 칸을 한 줄로 묶는다', () => {
    const s = changeSummary(diffTracked(
      { name: 'A', probability: 1 }, { name: 'B', probability: 5 }));
    expect(s).toBe('[변경] 이름: A → B · 가능성: 1 → 5');
  });

  it('빈 문자열과 null 을 같은 값으로 본다 (헛 기록 방지)', () => {
    expect(diffTracked({ name: '' }, { name: null })).toEqual([]);
    expect(diffTracked({ country: null }, { country: '' })).toEqual([]);
  });

  it('변경 기록인지 알아본다', () => {
    expect(isChangeRecord('[변경] 이름: A → B')).toBe(true);
    expect(isChangeRecord('소개 메일 보냄')).toBe(false);
    expect(isChangeRecord(null)).toBe(false);
  });

  it('값 표시', () => {
    expect(displayValue('country', null)).toBe('(비어 있음)');
    expect(displayValue('probability', 5)).toBe('5');
  });
});

describe('R1 · 저장 패치', () => {
  it('이메일을 바꾸면 email_normalized 도 같이 바꾼다', () => {
    const p = buildEditPatch({ email: 'a@b.com' }, { email: ' NEW@X.COM ' });
    expect(p.email).toBe(' NEW@X.COM ');
    expect(p.email_normalized).toBe('new@x.com');
  });

  it('휴대폰을 바꾸면 phone_normalized 도 같이 바꾼다', () => {
    const p = buildEditPatch({ phone: '' }, { phone: '010-1234-5678' });
    expect(p.phone_normalized).toBe('01012345678');
  });

  it('안 바꾼 칸은 패치에 없다 (덮어쓰기 사고 방지)', () => {
    const p = buildEditPatch({ name: 'A', notes: 'keep' }, { name: 'B', notes: 'keep' });
    expect(Object.keys(p)).toEqual(['name']);
  });

  it('빈 문자열은 null 로 저장한다', () => {
    expect(buildEditPatch({ country: 'SG' }, { country: '' }).country).toBeNull();
  });

  it('이메일을 지우면 email_normalized 도 null 이다', () => {
    const p = buildEditPatch({ email: 'a@b.com' }, { email: '' });
    expect(p.email).toBeNull();
    expect(p.email_normalized).toBeNull();
  });
});

describe('R1 · 같은 이메일 경고 (막지 않는다)', () => {
  const all = [
    { id: '1', email_normalized: 'a@x.com' },
    { id: '2', email_normalized: 'A@X.COM' },
    { id: '3', email_normalized: 'b@x.com' },
  ];

  it('같은 주소의 다른 리드를 찾아 준다 (대소문자 무시)', () => {
    expect(findEmailDuplicates('1', 'a@x.com', all).map(l => l.id)).toEqual(['2']);
  });

  it('자기 자신은 빼고', () => {
    expect(findEmailDuplicates('2', 'A@X.COM', all).map(l => l.id)).toEqual(['1']);
  });

  it('빈 이메일이면 경고하지 않는다', () => {
    expect(findEmailDuplicates('1', '', all)).toEqual([]);
  });
});

// ══════════════════════ R4 발송 보류 ══════════════════════
describe('R4 · 발송 보류 표시', () => {
  it('의미가 보이게 적는다 — 시스템 검증이 아님', () => {
    expect(emailStatusLabel('hold')).toBe('발송 보류 (엑셀에서 표시)');
    expect(emailStatusLabel('hold', false)).toBe('발송 보류');
  });

  it('도움말이 "검증 결과가 아니다"를 말한다', () => {
    expect(EMAIL_STATUS_HELP).toContain('검증한 결과가 아닙니다');
  });

  it('다른 상태도 한글로', () => {
    expect(emailStatusLabel('valid')).toBe('확인됨');
    expect(emailStatusLabel('bounced')).toBe('반송됨');
    expect(emailStatusLabel(null)).toBe('확인 안 함');
  });

  it('신뢰도는 숫자만이 아니라 말로도', () => {
    expect(qualityLabel(1)).toBe('낮음 (1)');
    expect(qualityLabel(3)).toBe('보통 (3)');
    expect(qualityLabel(5)).toBe('높음 (5)');
    expect(qualityLabel(null)).toBe('—');
  });

  // Number(null) 이 0 이라 "낮음 (0)" 으로 보이던 결함을 고정한다 —
  // 매긴 적 없는 것을 "우리가 낮다고 판단했다"로 읽히면 안 된다.
  it('신뢰도를 매긴 적 없으면 "—" 이다 (0 점이 아니다)', () => {
    for (const v of [null, undefined, '']) expect(qualityLabel(v), String(v)).toBe('—');
    expect(qualityLabel(0)).toBe('낮음 (0)');   // 진짜 0 은 그대로 보여 준다
  });
});

describe('R4 · 메일 발송 가능 판정', () => {
  const ok = { email_normalized: 'a@x.com', email_status: 'unverified', email_quality: 4 };

  it('정상이면 보낼 수 있다', () => {
    expect(isMailable(ok)).toBe(true);
  });

  it('발송 보류면 못 보낸다', () => {
    expect(isMailable({ ...ok, email_status: 'hold' })).toBe(false);
  });

  it('반송·잘못된 주소면 못 보낸다', () => {
    expect(isMailable({ ...ok, email_status: 'bounced' })).toBe(false);
    expect(isMailable({ ...ok, email_status: 'invalid' })).toBe(false);
  });

  it('신뢰도 2 이하면 못 보낸다', () => {
    expect(isMailable({ ...ok, email_quality: 2 })).toBe(false);
    expect(isMailable({ ...ok, email_quality: 3 })).toBe(true);
  });

  it('**신뢰도를 모르면 보내지 않는다** (모르는 것을 괜찮다고 보면 안 된다)', () => {
    expect(isMailable({ ...ok, email_quality: null })).toBe(false);
    expect(isMailable({ ...ok, email_quality: undefined })).toBe(false);
  });

  it('주소가 없으면 못 보낸다', () => {
    expect(isMailable({ ...ok, email_normalized: '' })).toBe(false);
  });

  it('수신 거부면 못 보낸다', () => {
    expect(isMailable({ ...ok, unsubscribed_at: '2026-11-01T00:00:00Z' })).toBe(false);
  });
});

// ══════════════════════ R8 보관 ══════════════════════
describe('R8 · 보관', () => {
  it('보관 기록은 사유를 담는다', () => {
    expect(archiveSummary('내부 시험 리드')).toBe('[보관] 보관함: 내부 시험 리드');
    expect(archiveSummary('')).toBe('[보관] 보관함: (사유 없음)');
    expect(unarchiveSummary()).toBe('[보관] 보관 해제');
    expect(ARCHIVE_PREFIX).toBe('[보관]');
  });

  it('보관 여부 판정', () => {
    expect(isArchived({ archived_at: '2026-11-17T00:00:00Z' })).toBe(true);
    expect(isArchived({ archived_at: null })).toBe(false);
    expect(isArchived({})).toBe(false);
  });

  it('보관본을 뺀다', () => {
    const rows = [{ id: 'a' }, { id: 'b', archived_at: '2026-11-17T00:00:00Z' }];
    expect(excludeArchived(rows).map(r => r.id)).toEqual(['a']);
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('마이그레이션 — 추가만, 보안 규칙', () => {
  const A = sqlCode(read('supabase/migrations/20261125000000_lead_archive.sql'));
  const C = sqlCode(read('supabase/migrations/20261125001000_lead_cc_links.sql'));

  it('보관 칸은 ADD COLUMN 하나뿐이다', () => {
    expect(A).toContain('add column if not exists archived_at timestamptz');
    expect(A).not.toMatch(/drop\s+column/i);
    expect(A).not.toMatch(/\b(delete|truncate|update)\s+/i);
    expect(A).not.toMatch(/set\s+not\s+null/i);
  });

  it('CC 표에 RLS 를 켠다', () => {
    expect(C).toMatch(/enable row level security/i);
  });

  it('CC 표는 admin 전용이고 anon 정책이 없다', () => {
    expect(C).toMatch(/public\.app_is_admin\(\)/);
    expect(C).toMatch(/to authenticated/);
    expect(C).not.toMatch(/to anon/);
  });

  it('anon·public 권한을 명시적으로 회수한다', () => {
    expect(C).toMatch(/revoke all on public\.lead_cc_links from anon/i);
    expect(C).toMatch(/revoke all on public\.lead_cc_links from public/i);
  });

  it('anon 에 GRANT 를 주지 않는다', () => {
    for (const g of C.match(/grant[^;]*;/gi) ?? []) expect(g, g).not.toMatch(/\banon\b/);
  });

  it('같은 짝을 두 번 넣지 못한다', () => {
    expect(C).toMatch(/unique index[\s\S]*?\(lead_id, cc_lead_id\)/i);
  });

  it('자기 자신을 CC 하지 못한다', () => {
    expect(C).toMatch(/check \(lead_id <> cc_lead_id\)/i);
  });

  it('리드가 지워지면 CC 결정도 함께 사라진다', () => {
    expect((C.match(/on delete cascade/gi) ?? []).length).toBe(2);
  });

  it('롤백·드라이런이 있고 드라이런은 아무것도 남기지 않는다', () => {
    for (const u of ['archive', 'cc']) {
      expect(fs.existsSync(path.resolve(process.cwd(), `../audit/rollback_lead_ui2_${u}.sql`)), u).toBe(true);
      const D = sqlCode(read(`../audit/dryrun_lead_ui2_${u}.sql`));
      expect(D, u).toMatch(/^\s*begin;/m);
      expect(D.trimEnd().endsWith('rollback;'), u).toBe(true);
      expect(D, u).not.toMatch(/\bcommit\b/i);
    }
  });
});
