// LEAD-2 (CRM-011) — 시장 모드와 해외 이메일 열쇠
//
// 지켜야 하는 약속
//   ① 국내 동작은 **그대로**다 (휴대폰 필수, 휴대폰으로 중복 판단).
//   ② 해외는 이메일 필수·이메일로 중복 판단·휴대폰 선택.
//   ③ 국내 열쇠와 해외 열쇠를 **섞지 않는다** — 섞으면 조용히 틀어진다.
//   ④ 해외 리드에게 알림톡을 보내지 않는다.
//   ⑤ phone NOT NULL 해제에 대비해 읽는 쪽이 전부 가드를 갖는다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MARKETS, MARKET_LABEL, canCheckExistingCustomer, canSendAlimtalk, findCrossMarketCandidates,
  findDuplicate, leadKey, leadKeyColumns, normalizeLeadEmail, normalizeLeadPhone, toMarket,
} from '../lib/leadMarket';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

describe('시장 모드', () => {
  it('두 가지뿐이다', () => {
    expect(MARKETS).toEqual(['KR', 'INTL']);
    expect(MARKET_LABEL.KR).toBe('국내');
    expect(MARKET_LABEL.INTL).toBe('해외');
  });

  it('알 수 없는 값은 국내로 본다 (기존 행이 전부 국내)', () => {
    for (const v of [undefined, null, '', 'kr', 'intl', 'XX', 0, {}]) {
      expect(toMarket(v)).toBe('KR');
    }
    expect(toMarket('INTL')).toBe('INTL');
  });
});

describe('열쇠 정규화', () => {
  it('이메일은 소문자·공백 정리 (한 사람이 두 줄이 되지 않게)', () => {
    expect(normalizeLeadEmail('  James@Example.COM ')).toBe('james@example.com');
  });

  it('빈 이메일은 null 이다 — 빈 문자열이면 서로 중복으로 잡힌다', () => {
    for (const v of ['', '   ', null, undefined, 123]) expect(normalizeLeadEmail(v)).toBeNull();
  });

  it('휴대폰은 숫자만 남긴다', () => {
    expect(normalizeLeadPhone('010-1234-5678')).toBe('01012345678');
    expect(normalizeLeadPhone(null)).toBe('');
  });
});

describe('국내(KR) — 현재 동작 그대로', () => {
  it('휴대폰이 있으면 통과하고 열쇠가 휴대폰이다', () => {
    const k = leadKey({ market: 'KR', phone: '010-1234-5678', email: 'a@b.com' });
    expect(k).toEqual({ ok: true, market: 'KR', key: 'phone', value: '01012345678' });
  });

  it('휴대폰이 없으면 거절한다 (이메일이 있어도)', () => {
    const k = leadKey({ market: 'KR', phone: '', email: 'a@b.com' });
    expect(k.ok).toBe(false);
  });

  it('휴대폰이 짧으면 거절한다', () => {
    expect(leadKey({ market: 'KR', phone: '0101234' }).ok).toBe(false);
  });

  it('같은 휴대폰이면 중복이다', () => {
    const dup = findDuplicate(
      { market: 'KR', phone: '010-1234-5678' },
      [{ id: 'x', market: 'KR', phone_normalized: '01012345678' }],
    );
    expect(dup?.id).toBe('x');
  });

  it('이메일이 같아도 국내에서는 중복이 아니다 (휴대폰이 열쇠)', () => {
    const dup = findDuplicate(
      { market: 'KR', phone: '01099998888', email: 'same@x.com' },
      [{ id: 'x', market: 'KR', phone_normalized: '01012345678', email_normalized: 'same@x.com' }],
    );
    expect(dup).toBeNull();
  });
});

describe('해외(INTL) — 이메일이 열쇠', () => {
  it('이메일만 있으면 통과한다 (휴대폰 없이)', () => {
    const k = leadKey({ market: 'INTL', email: 'A@B.com' });
    expect(k).toEqual({ ok: true, market: 'INTL', key: 'email', value: 'a@b.com' });
  });

  it('이메일이 없으면 거절한다 (휴대폰이 있어도)', () => {
    expect(leadKey({ market: 'INTL', phone: '01012345678' }).ok).toBe(false);
  });

  it('이메일 형식이 아니면 거절한다', () => {
    for (const e of ['abc', 'a@b', 'a b@c.com', '@b.com']) {
      expect(leadKey({ market: 'INTL', email: e }).ok, e).toBe(false);
    }
  });

  it('대소문자가 달라도 같은 사람으로 본다', () => {
    const dup = findDuplicate(
      { market: 'INTL', email: ' JOHN@School.SG ' },
      [{ id: 'y', market: 'INTL', email_normalized: 'john@school.sg' }],
    );
    expect(dup?.id).toBe('y');
  });

  it('휴대폰이 같아도 해외에서는 중복이 아니다 (이메일이 열쇠)', () => {
    const dup = findDuplicate(
      { market: 'INTL', email: 'new@x.com', phone: '01012345678' },
      [{ id: 'y', market: 'INTL', phone_normalized: '01012345678', email_normalized: 'old@x.com' }],
    );
    expect(dup).toBeNull();
  });

  it('휴대폰 없는 해외 리드끼리 서로 중복이 되지 않는다 (가장 중요)', () => {
    const existing = [
      { id: 'a', market: 'INTL', phone_normalized: null, email_normalized: 'a@x.com' },
      { id: 'b', market: 'INTL', phone_normalized: null, email_normalized: 'b@x.com' },
    ];
    expect(findDuplicate({ market: 'INTL', email: 'c@x.com' }, existing)).toBeNull();
  });
});

describe('국내·해외 열쇠를 섞지 않는다', () => {
  it('다른 시장의 같은 휴대폰은 중복이 아니다', () => {
    const dup = findDuplicate(
      { market: 'KR', phone: '01012345678' },
      [{ id: 'z', market: 'INTL', phone_normalized: '01012345678' }],
    );
    expect(dup).toBeNull();
  });

  it('다른 시장의 같은 이메일은 중복이 아니다', () => {
    const dup = findDuplicate(
      { market: 'INTL', email: 'a@x.com' },
      [{ id: 'z', market: 'KR', email_normalized: 'a@x.com' }],
    );
    expect(dup).toBeNull();
  });

  it('대신 "같은 사람일 수 있음" 후보로 보여 준다 (자동 합치기 안 함)', () => {
    const c = findCrossMarketCandidates(
      { market: 'INTL', email: 'a@x.com', phone: '01012345678' },
      [
        { id: 'kr1', market: 'KR', phone_normalized: '01012345678' },
        { id: 'kr2', market: 'KR', email_normalized: 'a@x.com' },
        { id: 'intl1', market: 'INTL', email_normalized: 'a@x.com' },  // 같은 시장은 제외
        { id: 'kr3', market: 'KR', phone_normalized: '01099998888' },  // 안 겹침
      ],
    );
    expect(c.map(x => x.id)).toEqual(['kr1', 'kr2']);
  });
});

describe('저장할 열쇠 칸', () => {
  it('국내 리드', () => {
    expect(leadKeyColumns({ market: 'KR', phone: '010-1234-5678', email: 'A@B.com' })).toEqual({
      market: 'KR', phone_normalized: '01012345678', email_normalized: 'a@b.com',
    });
  });

  it('해외 리드 — 휴대폰이 없으면 null (빈 문자열 금지)', () => {
    expect(leadKeyColumns({ market: 'INTL', email: 'a@b.com' })).toEqual({
      market: 'INTL', phone_normalized: null, email_normalized: 'a@b.com',
    });
  });
});

describe('알림톡·기존 고객 판정은 국내 전용', () => {
  it('해외 리드에게는 알림톡을 보내지 않는다', () => {
    expect(canSendAlimtalk({ market: 'INTL', phone: '01012345678' })).toBe(false);
  });

  it('국내 리드는 휴대폰이 있으면 보낸다', () => {
    expect(canSendAlimtalk({ market: 'KR', phone: '010-1234-5678' })).toBe(true);
  });

  it('국내인데 휴대폰이 없으면 보내지 않는다', () => {
    expect(canSendAlimtalk({ market: 'KR', phone: '' })).toBe(false);
  });

  it('기존 고객 판정도 같은 조건이다 (휴대폰으로 판정하므로)', () => {
    expect(canCheckExistingCustomer({ market: 'INTL', phone: '01012345678' })).toBe(false);
    expect(canCheckExistingCustomer({ market: 'KR', phone: '01012345678' })).toBe(true);
  });
});

describe('phone NOT NULL 해제 대비 — 읽는 쪽 가드', () => {
  const C = code(read('src/pages/Campaigns.tsx'));

  it('phone 에 가드 없는 문자열 연산이 없다', () => {
    expect(C).not.toMatch(/\bl\.phone\.replace/);
    expect(C).not.toMatch(/\blead\.phone\.replace/);
    expect(C).not.toMatch(/normalize\(l\.phone_normalized \|\| l\.phone\)/);
  });

  it('타입이 phone 을 nullable 로 선언한다 (새 코드를 컴파일 때 잡게)', () => {
    expect(C).toContain('phone?: string | null;');
  });
});

/** SQL 의 `--` 주석을 걷어낸다 — 주석에 적은 설명 때문에 검사가 통과하거나
 *  실패하면 안 된다(이 파일 스스로 그 함정에 빠졌었다). */
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

describe('마이그레이션 — 추가만, 되돌릴 수 있게', () => {
  const M = sqlCode(read('supabase/migrations/20261120000000_lead_market_mode.sql'));

  it('기존 열을 지우거나 형을 바꾸지 않는다', () => {
    expect(M).not.toMatch(/drop\s+column/i);
    expect(M).not.toMatch(/alter\s+column\s+\w+\s+type/i);
    expect(M).not.toMatch(/\b(delete|truncate|update)\s+/i);
  });

  it('NOT NULL 을 **추가**하지 않는다 (해제만)', () => {
    expect(M).not.toMatch(/set\s+not\s+null/i);
    expect(M).toMatch(/drop\s+not\s+null/i);
  });

  it('새 열은 기본값이 있어 기존 행이 국내로 남는다', () => {
    expect(M).toMatch(/campaigns[\s\S]*?market text not null default 'KR'/);
    expect(M).toMatch(/campaign_leads[\s\S]*?market text not null default 'KR'/);
  });

  it('UNIQUE 제약을 만들지 않는다 (운영 중복 데이터를 막지 않게)', () => {
    expect(M).not.toMatch(/unique/i);
  });

  it('여러 번 돌려도 같은 결과다', () => {
    const adds = M.match(/add column/gi) ?? [];
    expect(adds.length).toBeGreaterThan(0);
    expect((M.match(/add column if not exists/gi) ?? []).length).toBe(adds.length);
  });

  it('롤백·드라이런이 같이 있다', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), '../audit/rollback_lead2.sql'))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), '../audit/dryrun_lead2.sql'))).toBe(true);
  });

  it('드라이런은 아무것도 남기지 않는다', () => {
    const D = sqlCode(read('../audit/dryrun_lead2.sql'));
    expect(D).toMatch(/^\s*begin;/m);
    expect(D.trimEnd().endsWith('rollback;')).toBe(true);
    expect(D).not.toMatch(/\bcommit\b/i);
  });
});
