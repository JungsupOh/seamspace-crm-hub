// LEAD-6 (CRM-014) — 해외 리드 엑셀 가져오기
//
// ⚠️ 이 테스트는 **합성 데이터**만 쓴다. James 의 실제 명단(EDUtech 93~99행)에는
//    실제 개인정보가 있어 저장소에 넣지 않는다. 실제 파일로 돌린 결과는
//    audit/lead6_import.md 에 **건수와 분류 결과만** 적었다.
//
// 지켜야 하는 약속
//   ① 이메일이 열쇠다 — 국내 휴대폰 기준과 섞지 않는다.
//   ② 한글 헤더와 영문 헤더를 모두 받는다.
//   ③ 수신 동의 기본값은 **안전한 쪽**(동의 없음).
//   ④ 발송 보류·신뢰도 낮음을 **표시**한다(버리지 않는다).
//   ⑤ 되돌릴 수 있게 묶음 식별자를 남긴다.
//   ⑥ 우리 칸에 자리가 없는 열은 버리지 않고 원본으로 남긴다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  EVENT_TIMEZONES, emailQuality, excelDateToISO, isExcludedGrade, mapHeaders,
  markExistingDuplicates, parseIntlRows, toEmailStatus, toSegment,
} from '../lib/intlLeadImport';
import { buildLeadRow } from '../lib/leadsApi';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

// James 의 실제 파일과 **같은 열 이름**을 쓴 합성 데이터
const KR_HEADERS = ['등급', '이름', '소속', '이메일', '국가', '출처', '현장 메모/근거', '발송 가능', '주의·메모', '메일 샘플 파일'];
const krRow = (o: Partial<Record<string, string>> = {}) => ({
  '등급': 'B-교육', '이름': 'Test One', '소속': 'Alpha School', '이메일': 'one@alpha.sg',
  '국가': 'Singapore', '출처': '배지 스캔 11/05', '현장 메모/근거': '부스 상담',
  '발송 가능': 'OK', '주의·메모': '', '메일 샘플 파일': 'sample_a.md', ...o,
});

// 브리프 E항의 영문 헤더(행사 앱 내보내기)
const EN_HEADERS = ['Name', 'Organization', 'Position', 'Email', 'Phone', 'Country', 'Visited at', 'Notes'];
const enRow = (o: Partial<Record<string, string>> = {}) => ({
  Name: 'Test Two', Organization: 'Beta Academy', Position: 'Head of IT',
  Email: 'two@beta.my', Phone: '+60 12-345 6789', Country: 'Malaysia',
  'Visited at': '2026-11-05 14:30', Notes: 'LMS 연동 문의', ...o,
});

describe('헤더 매핑 — 두 형식 모두', () => {
  it('한글 헤더(James 실제 파일)를 맞춘다', () => {
    const m = mapHeaders(KR_HEADERS);
    expect(m.name).toBe('이름');
    expect(m.org).toBe('소속');
    expect(m.email).toBe('이메일');
    expect(m.country).toBe('국가');
    expect(m.grade).toBe('등급');
    expect(m.sendable).toBe('발송 가능');
    expect(m.notes).toBe('현장 메모/근거');
    expect(m.caution).toBe('주의·메모');
    expect(m.source).toBe('출처');
  });

  it('영문 헤더(브리프 E항)를 맞춘다', () => {
    const m = mapHeaders(EN_HEADERS);
    expect(m.name).toBe('Name');
    expect(m.org).toBe('Organization');
    expect(m.position).toBe('Position');
    expect(m.email).toBe('Email');
    expect(m.phone).toBe('Phone');
    expect(m.country).toBe('Country');
    expect(m.visitedAt).toBe('Visited at');
    expect(m.notes).toBe('Notes');
  });

  it('대소문자·공백이 달라도 맞춘다', () => {
    const m = mapHeaders(['  E-MAIL ', 'full name', 'COMPANY']);
    expect(m.email).toBe('  E-MAIL ');
    expect(m.name).toBe('full name');
    expect(m.org).toBe('COMPANY');
  });

  it('덧말이 붙은 헤더도 포함 관계로 맞춘다', () => {
    expect(mapHeaders(['Email Address (work)']).email).toBe('Email Address (work)');
  });

  it('맞추지 못한 헤더를 알려 준다 (버리지 않는다)', () => {
    const r = parseIntlRows([krRow()], KR_HEADERS);
    expect(r.unmapped).toContain('메일 샘플 파일');
    expect(r.rows[0].custom_fields['메일 샘플 파일']).toBe('sample_a.md');
  });
});

describe('이메일이 열쇠다', () => {
  it('이메일이 없으면 제외하고 사유를 남긴다', () => {
    const r = parseIntlRows([krRow({ '이메일': '' })], KR_HEADERS);
    expect(r.rows).toHaveLength(0);
    expect(r.excluded[0]).toEqual({ rowNo: 1, reason: 'noEmail', org: 'Alpha School' });
  });

  it('이메일 형식이 아니면 제외한다', () => {
    const r = parseIntlRows([krRow({ '이메일': 'not-an-email' })], KR_HEADERS);
    expect(r.excluded[0].reason).toBe('badEmail');
  });

  it('파일 안에서 이메일이 겹치면 뒤 행을 제외한다 (대소문자 무시)', () => {
    const r = parseIntlRows([
      krRow({ '이메일': 'dup@x.sg' }),
      krRow({ '이메일': ' DUP@X.SG ', '소속': 'Gamma' }),
    ], KR_HEADERS);
    expect(r.rows).toHaveLength(1);
    expect(r.excluded).toEqual([{ rowNo: 2, reason: 'dupInFile', org: 'Gamma' }]);
  });

  it('휴대폰이 겹쳐도 제외하지 않는다 (국내 기준과 섞지 않는다)', () => {
    const r = parseIntlRows([
      enRow({ Email: 'a@x.my', Phone: '+60 12-345 6789' }),
      enRow({ Email: 'b@x.my', Phone: '+60 12-345 6789' }),
    ], EN_HEADERS);
    expect(r.rows).toHaveLength(2);
  });

  it('휴대폰이 없어도 가져온다 (해외는 선택)', () => {
    const r = parseIntlRows([krRow()], KR_HEADERS);
    expect(r.rows[0].phone).toBeNull();
    expect(r.rows[0].phone_normalized).toBeNull();
    expect(r.rows[0].email_normalized).toBe('one@alpha.sg');
  });

  it('이미 등록된 리드는 이메일로 걸러 낸다', () => {
    const r = parseIntlRows([
      krRow({ '이메일': 'new@x.sg' }),
      krRow({ '이메일': 'old@x.sg', '소속': 'Old' }),
    ], KR_HEADERS);
    const { fresh, dupInDb } = markExistingDuplicates(r.rows, ['OLD@X.SG', null, '']);
    expect(fresh.map(x => x.email_normalized)).toEqual(['new@x.sg']);
    expect(dupInDb.map(x => x.email_normalized)).toEqual(['old@x.sg']);
  });
});

describe('등급 → 세그먼트', () => {
  it.each([
    ['A', 'A'], ['B-교육', 'B'], ['B-기업', 'B'], ['C', 'C'], ['C2', 'C'], ['D', 'D'], ['E', 'E'],
  ])('%s → %s (DB CHECK 가 A~E 만 받으므로 첫 글자로 줄인다)', (v, want) => {
    expect(toSegment(v)).toBe(want);
  });

  it('원본 등급을 버리지 않는다', () => {
    const r = parseIntlRows([krRow({ '등급': 'B-교육' })], KR_HEADERS);
    expect(r.rows[0].segment).toBe('B');
    expect(r.rows[0].custom_fields['등급_원본']).toBe('B-교육');
  });

  it("등급이 '제외'인 행은 가져오지 않는다", () => {
    expect(isExcludedGrade('제외')).toBe(true);
    const r = parseIntlRows([krRow({ '등급': '제외' })], KR_HEADERS);
    expect(r.rows).toHaveLength(0);
    expect(r.excluded[0].reason).toBe('excludedGrade');
  });

  it('모르는 등급은 비워 둔다 (임의로 끼워 맞추지 않는다)', () => {
    expect(toSegment('특급')).toBeNull();
    expect(toSegment('')).toBeNull();
  });
});

describe("'발송 가능' → 이메일 상태 — 안전한 쪽으로 기운다", () => {
  it.each([['OK', 'unverified'], ['선택', 'unverified'], ['YES', 'unverified']] as const)(
    '%s → %s (보낼 수 있다)', (v, want) => expect(toEmailStatus(v)).toBe(want));

  it.each(['보류', '확인', '제외', '', '모르는값', null] as const)(
    '%s → hold (발송 보류로 표시)', (v) => expect(toEmailStatus(v)).toBe('hold'));

  it('보류 건수를 세어 미리보기에 보여 준다', () => {
    const r = parseIntlRows([
      krRow({ '이메일': 'a@x.sg', '발송 가능': 'OK' }),
      krRow({ '이메일': 'b@x.sg', '발송 가능': '보류' }),
      krRow({ '이메일': 'c@x.sg', '발송 가능': '확인' }),
    ], KR_HEADERS);
    expect(r.holdCount).toBe(2);
    expect(r.rows).toHaveLength(3);   // 버리지 않고 표시만 한다
  });
});

describe('이메일 신뢰도', () => {
  it('이메일이 없으면 1', () => {
    expect(emailQuality(null, [])).toBe(1);
  });

  it('추측·불확실 표시가 있으면 낮춘다', () => {
    expect(emailQuality('a@school.sg', ['싱가포르(추정)'])).toBeLessThan(
      emailQuality('a@school.sg', ['Singapore']));
    expect(emailQuality('a@school.sg', ['Malaysia[?]'])).toBeLessThanOrEqual(2);
  });

  it('무료 메일은 한 단계 낮춘다 (발송을 막지는 않는다)', () => {
    expect(emailQuality('a@gmail.com', [])).toBeLessThan(emailQuality('a@school.sg', []));
  });

  it('1~5 를 벗어나지 않는다', () => {
    expect(emailQuality('a@gmail.com', ['(추정)', '[?]'])).toBeGreaterThanOrEqual(1);
    expect(emailQuality('a@school.sg', [])).toBeLessThanOrEqual(5);
  });

  it('신뢰도 낮은 건수를 센다', () => {
    const r = parseIntlRows([
      krRow({ '이메일': 'a@school.sg', '국가': 'Singapore' }),
      krRow({ '이메일': 'b@gmail.com', '국가': '싱가포르(추정)' }),
    ], KR_HEADERS);
    expect(r.lowQualityCount).toBe(1);
  });
});

describe('국가·지역', () => {
  it('주석이 붙은 국가도 알아본다 (실제 파일에 24건 넘게 있다)', () => {
    for (const [v, region] of [
      ['Singapore', 'SEA'], ['싱가포르', 'SEA'], ['싱가포르(추정)', 'SEA'],
      ['Malaysia[?]', 'SEA'], ['United States(배지 정보)', 'US'], ['Thailand [?]', 'SEA'],
      ['싱가포르(명함 +65)', 'SEA'], ['Republic Of Korea', 'KR'],
    ] as const) {
      const r = parseIntlRows([krRow({ '국가': v })], KR_HEADERS);
      expect(r.rows[0].region, v).toBe(region);
    }
  });

  it('국가가 비면 미분류다 (해외 리드는 휴대폰이 없다)', () => {
    const r = parseIntlRows([krRow({ '국가': '' })], KR_HEADERS);
    expect(r.rows[0].region).toBe('UNKNOWN');
  });

  it('주석이 붙었으면 원본을 남긴다', () => {
    const r = parseIntlRows([krRow({ '국가': '싱가포르(추정)' })], KR_HEADERS);
    expect(r.rows[0].custom_fields['국가_원본']).toBe('싱가포르(추정)');
  });
});

describe('행사별 시간대', () => {
  it('싱가포르(UTC+8)로 해석한다', () => {
    // 현지 14:30 → UTC 06:30
    expect(excelDateToISO('2026-11-05 14:30', 480)).toBe('2026-11-05T06:30:00.000Z');
  });

  it('한국(UTC+9)으로 해석한다', () => {
    expect(excelDateToISO('2026-11-05 14:30', 540)).toBe('2026-11-05T05:30:00.000Z');
  });

  it('미국 동부(UTC-5)로 해석한다', () => {
    expect(excelDateToISO('2026-12-06 09:00', -300)).toBe('2026-12-06T14:00:00.000Z');
  });

  it('AM/PM 과 오전/오후를 모두 읽는다', () => {
    expect(excelDateToISO('2026-11-05 2:30 PM', 480)).toBe('2026-11-05T06:30:00.000Z');
    expect(excelDateToISO('2026-11-05 오후 2:30', 480)).toBe('2026-11-05T06:30:00.000Z');
  });

  it('빈 값은 null', () => {
    expect(excelDateToISO('', 480)).toBeNull();
    expect(excelDateToISO(null, 480)).toBeNull();
  });

  it('행사 시간대 목록에 싱가포르·런던·미국 동부가 있다', () => {
    const mins = EVENT_TIMEZONES.map(t => t.minutes);
    expect(mins).toContain(480);
    expect(mins).toContain(0);
    expect(mins).toContain(-300);
  });
});

describe('저장 모양 — 안전한 기본값과 되돌리기', () => {
  it('수신 동의를 **켜지 않는다** (가져오기는 동의를 알 수 없다)', () => {
    const row = buildLeadRow({ market: 'INTL', name: 'x', email: 'a@b.com' });
    // marketing_consent 를 아예 보내지 않는다 → DB DEFAULT false 가 적용된다
    expect('marketing_consent' in row).toBe(false);
  });

  it('열쇠 칸을 한 곳에서 채운다', () => {
    const row = buildLeadRow({ market: 'INTL', name: 'x', email: ' A@B.com ', phone: '' });
    expect(row.market).toBe('INTL');
    expect(row.email_normalized).toBe('a@b.com');
    expect(row.phone_normalized).toBeNull();
  });

  it('국내 리드는 휴대폰이 열쇠다', () => {
    const row = buildLeadRow({ market: 'KR', name: 'x', phone: '010-1234-5678' });
    expect(row.market).toBe('KR');
    expect(row.phone_normalized).toBe('01012345678');
  });

  it('묶음 식별자를 남긴다 (가져오기 취소용)', () => {
    const row = buildLeadRow({ market: 'INTL', name: 'x', email: 'a@b.com', import_batch_id: 'B1' });
    expect(row.import_batch_id).toBe('B1');
  });

  it('단계 기본값은 신규다', () => {
    expect(buildLeadRow({ market: 'INTL', name: 'x', email: 'a@b.com' }).followup_stage).toBe('신규');
  });
});

describe('미리보기가 보여 줘야 하는 것', () => {
  it('건수·중복·오류가 다 나온다', () => {
    const r = parseIntlRows([
      krRow({ '이메일': 'a@x.sg' }),
      krRow({ '이메일': 'a@x.sg', '소속': 'Dup' }),
      krRow({ '이메일': '', '소속': 'NoMail' }),
      krRow({ '등급': '제외', '이메일': 'x@x.sg', '소속': 'Excl' }),
      krRow({ '이메일': 'b@x.sg', '발송 가능': '보류' }),
    ], KR_HEADERS);
    expect(r.total).toBe(5);
    // 가져올 수 있는 것은 a@x.sg 와 b@x.sg 두 건이다(중복·이메일없음·제외등급 3건이 빠진다)
    expect(r.rows).toHaveLength(2);
    expect(r.excluded.map(e => e.reason).sort()).toEqual(['dupInFile', 'excludedGrade', 'noEmail']);
    expect(r.holdCount).toBe(1);
  });

  it('제외 목록에 **소속만** 적는다 (이름·이메일은 개인정보)', () => {
    const r = parseIntlRows([krRow({ '이메일': '', '이름': '실명', '소속': 'Org' })], KR_HEADERS);
    expect(Object.keys(r.excluded[0])).toEqual(['rowNo', 'reason', 'org']);
    expect(JSON.stringify(r.excluded)).not.toContain('실명');
  });

  it('엑셀 행 번호를 남긴다 (사람이 파일에서 찾아갈 수 있게)', () => {
    const r = parseIntlRows([krRow({ '이메일': 'a@x.sg' }), krRow({ '이메일': 'b@x.sg' })], KR_HEADERS);
    expect(r.rows.map(x => x.rowNo)).toEqual([1, 2]);
  });
});

describe('기존 국내 가져오기를 건드리지 않았다', () => {
  it('campaign-lead-import.ts 는 그대로 휴대폰 기준이다', () => {
    const old = read('src/lib/campaign-lead-import.ts');
    expect(old).toContain('noPhone');
    expect(old).toContain("txt(r['핸드폰'])");
  });

  it('새 모듈은 별도 파일이다 (한 파일에 두 규칙을 섞지 않는다)', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/lib/intlLeadImport.ts'))).toBe(true);
  });
});

describe('LEAD-6 마이그레이션', () => {
  const M = sqlCode(read('supabase/migrations/20261123000000_lead_import_batch.sql'));

  it('묶음 식별자를 더한다', () => {
    expect(M).toContain('add column if not exists import_batch_id uuid');
  });

  it('기존 데이터를 건드리지 않는다', () => {
    expect(M).not.toMatch(/drop\s+column/i);
    expect(M).not.toMatch(/\b(delete|truncate|update)\s+/i);
    expect(M).not.toMatch(/set\s+not\s+null/i);
  });

  it('롤백·드라이런이 있다', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), '../audit/rollback_lead6.sql'))).toBe(true);
    const D = sqlCode(read('../audit/dryrun_lead6.sql'));
    expect(D).toMatch(/^\s*begin;/m);
    expect(D.trimEnd().endsWith('rollback;')).toBe(true);
  });
});
