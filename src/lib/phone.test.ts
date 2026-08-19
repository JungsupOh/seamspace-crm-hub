import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone';

// 이 함수는 contacts.phone_normalized 의 유일한 정본이다.
// 형식이 흔들리면 중복 고객이 대량 생성되고 전환 집계가 어긋난다.
describe('normalizePhone (kr)', () => {
  it('하이픈·공백을 제거해 숫자만 남긴다', () => {
    expect(normalizePhone('010-4252-9423')).toBe('01042529423');
    expect(normalizePhone('010 4252 9423')).toBe('01042529423');
    expect(normalizePhone('01042529423')).toBe('01042529423');
  });

  it('표기가 달라도 같은 키가 나온다 — 중복 판정의 핵심', () => {
    const forms = ['010-4252-9423', '01042529423', '+82 10-4252-9423', '82 10 4252 9423'];
    const keys = new Set(forms.map(f => normalizePhone(f)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('01042529423');
  });

  it('국가번호 82는 국내표기로 되돌린다', () => {
    expect(normalizePhone('+82-10-4252-9423')).toBe('01042529423');
    expect(normalizePhone('821042529423')).toBe('01042529423');
  });

  it('유선번호도 숫자만으로', () => {
    expect(normalizePhone('02-737-6490')).toBe('027376490');
    expect(normalizePhone('031-8027-9875')).toBe('03180279875');
  });

  it('숫자가 없으면 빈 문자열 — 빈 값끼리 한 사람으로 묶이지 않게', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('.')).toBe('');
    expect(normalizePhone('정시욱')).toBe('');
  });
});

describe('normalizePhone (jp / intl)', () => {
  it('일본은 81을 떼고 선두 0을 보존한다', () => {
    expect(normalizePhone('+81 90-1234-5678', 'jp')).toBe('09012345678');
    expect(normalizePhone('09012345678', 'jp')).toBe('09012345678');
  });

  it('intl은 숫자만 보존하고 국가별 가공을 하지 않는다', () => {
    expect(normalizePhone('+1 516-815-6314', 'intl')).toBe('15168156314');
    // kr 규칙이 intl 번호를 건드리지 않는지 (82로 시작하는 해외번호 오인 방지)
    expect(normalizePhone('+82 10-1111-2222', 'intl')).toBe('821011112222');
  });
});
