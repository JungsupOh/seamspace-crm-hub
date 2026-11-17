// LEAD-S7-1 — 파트너 계약 · 잔량 · 리드 보호 (순수 로직)
//
// 지켜야 하는 약속
//   ① 잔량 = 구매 합계 − 발급 합계. **무효화한 이용권도 발급으로 센다**(James 확정).
//   ② 모르는 값을 0 으로 바꾸지 않는다 — 0 으로 치면 잔량이 많아 보여 초과 발급이 난다.
//   ③ 보호 기간은 저장하지 않고 센다. 90→60 으로 바꿔도 데이터 보정이 필요 없다.
//   ④ 파트너의 리드 등록을 **막지 않는다**. 알리기만 한다.
//   ⑤ 정산 방식은 만든 뒤 바꾸지 않는다.
//   ⑥ 마이그레이션은 추가만. 기존 117건을 건드리지 않는다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUY_MORE_HINT, CONTRACT_STATUSES, PROTECTION_BASIS, PROTECTION_DAYS,
  SETTLEMENT_HINT, SETTLEMENT_LABEL, SETTLEMENT_METHODS, SETTLEMENT_MONEY_LABEL,
  balanceOf, canChangeSettlementMethod, canIssue, checkClaim, isLiveContract,
  isProtected, issuedSeatMonths, issuedSeatMonthsOf, overageOf, protectionDaysLeft,
  protectionEndsOn, purchasedSeatMonths, seatMonths, toSettlementMethod,
  type Contract,
} from '../lib/partnerContract';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const T = '2026-11-17';

const C = (o: Partial<Contract> = {}): Contract => ({
  id: 'c1', partner_id: 'p1', settlement_method: 'wholesale',
  starts_on: '2026-01-01', status: 'active', ...o,
});

// ══════════════════════ 정산 방식 ══════════════════════
describe('정산 방식', () => {
  it('두 가지뿐이다 (James 확정: 계약 건마다 하나)', () => {
    expect([...SETTLEMENT_METHODS]).toEqual(['commission', 'wholesale']);
  });

  it('모르는 값은 null 이다', () => {
    for (const v of ['barter', '', null, 'COMMISSION', 3]) {
      expect(toSettlementMethod(v), String(v)).toBeNull();
    }
    expect(toSettlementMethod('wholesale')).toBe('wholesale');
  });

  it('**돈의 방향을 용어로 가른다** (같은 열에 담으면 뜻이 섞인다)', () => {
    expect(SETTLEMENT_MONEY_LABEL.commission).toContain('지급');
    expect(SETTLEMENT_MONEY_LABEL.wholesale).toContain('수금');
  });

  it('이름과 설명이 다 있다', () => {
    for (const m of SETTLEMENT_METHODS) {
      expect(SETTLEMENT_LABEL[m], m).toBeTruthy();
      expect(SETTLEMENT_HINT[m], m).toBeTruthy();
    }
  });

  it('무효·취소된 계약은 살아 있지 않다', () => {
    expect(isLiveContract(C())).toBe(true);
    expect(isLiveContract(C({ voided_at: 'x' }))).toBe(false);
    expect(isLiveContract(C({ status: 'cancelled' }))).toBe(false);
  });

  it('상태 네 가지', () => {
    expect([...CONTRACT_STATUSES]).toEqual(['draft', 'active', 'ended', 'cancelled']);
  });
});

// ══════════════════════ 인원·개월 ══════════════════════
describe('인원·개월', () => {
  it('100명 연간 = 1,200 (James 확정 단위)', () => {
    expect(seatMonths(100, 12)).toBe(1200);
  });

  it('40명 1개월 = 40', () => {
    expect(seatMonths(40, 1)).toBe(40);
  });

  it('**반 달은 없다** (최소 단위 1명 × 1개월)', () => {
    expect(seatMonths(1.5, 2)).toBeNull();
    expect(seatMonths(2, 0.5)).toBeNull();
  });

  it('0 이나 음수는 셀 수 없다', () => {
    expect(seatMonths(0, 12)).toBeNull();
    expect(seatMonths(10, 0)).toBeNull();
    expect(seatMonths(-1, 12)).toBeNull();
  });

  it('**못 세면 null 이다 — 0 이 아니다**', () => {
    for (const v of [null, undefined, '', 'abc', NaN]) {
      expect(seatMonths(v, 12), String(v)).toBeNull();
      expect(seatMonths(12, v), String(v)).toBeNull();
    }
  });
});

// ══════════════════════ 잔량 ══════════════════════
describe('잔량 — 구매 합계 − 발급 합계', () => {
  it('구매를 더한다', () => {
    expect(purchasedSeatMonths([{ seat_months: 1200 }, { seat_months: 600 }])).toBe(1800);
  });

  it('**취소된 구매 회차는 뺀다** (잘못 적은 것은 지우지 않고 취소 표시한다)', () => {
    expect(purchasedSeatMonths([
      { seat_months: 1200 }, { seat_months: 600, voided_at: '2026-11-01' },
    ])).toBe(1200);
  });

  it('발급 시점에 박아 둔 수량을 쓴다 (규격이 바뀌어도 흔들리지 않게)', () => {
    expect(issuedSeatMonthsOf({ seat_months: 40, user_count: 999, duration: 999 })).toBe(40);
  });

  it('박힌 값이 없으면 그때만 곱한다 (옛 기록)', () => {
    expect(issuedSeatMonthsOf({ user_count: 40, duration: 1 })).toBe(40);
  });

  it('**무효화한 이용권도 발급으로 센다** (James 확정: 수량 복구 없음)', () => {
    const { total } = issuedSeatMonths([
      { seat_months: 40 },
      { seat_months: 60, revoked_at: '2026-11-10' },
    ]);
    expect(total).toBe(100);
  });

  it('수량을 셀 수 없는 줄은 **0 으로 치지 않고 따로 센다**', () => {
    const r = issuedSeatMonths([{ seat_months: 40 }, { user_count: null, duration: null }]);
    expect(r.total).toBe(40);
    expect(r.unknown).toBe(1);
  });

  it('잔량을 모은다', () => {
    const b = balanceOf(
      [{ seat_months: 1200 }],
      [{ seat_months: 40 }, { seat_months: 60, revoked_at: 'x' }],
    );
    expect(b).toEqual({ purchased: 1200, issued: 100, balance: 1100, unknownIssues: 0 });
  });

  it('과거에 초과 발급됐으면 **음수를 그대로 보여 준다** (감추지 않는다)', () => {
    expect(balanceOf([{ seat_months: 100 }], [{ seat_months: 150 }]).balance).toBe(-50);
  });

  it('아무것도 없으면 0', () => {
    expect(balanceOf([], [])).toEqual({ purchased: 0, issued: 0, balance: 0, unknownIssues: 0 });
  });
});

// ══════════════════════ 발급 가능 판정 ══════════════════════
describe('발급 가능 판정 (도매형)', () => {
  const bal = balanceOf([{ seat_months: 1200 }], [{ seat_months: 200 }]);  // 잔량 1000

  it('잔량 안이면 발급할 수 있다', () => {
    const r = canIssue(C(), bal, { userCount: 40, months: 12 }, T);
    expect(r.ok).toBe(true);
    expect(r.requested).toBe(480);
    expect(r.remaining).toBe(520);
  });

  it('**딱 맞게 쓰는 것은 된다** (경계)', () => {
    expect(canIssue(C(), bal, { userCount: 1000, months: 1 }, T).ok).toBe(true);
    expect(canIssue(C(), bal, { userCount: 1001, months: 1 }, T).ok).toBe(false);
  });

  it('모자라면 막고 **추가 구매를 안내**한다 (James 확정 Q2)', () => {
    const r = canIssue(C(), bal, { userCount: 100, months: 12 }, T);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient');
    expect(r.message).toContain(BUY_MORE_HINT);
  });

  it('**계정별 한도는 없다** — 잔량이 유일한 한도다 (James 확정 Q6)', () => {
    // 같은 계약에서 여러 번 발급해도 잔량만 보면 된다
    const big = balanceOf([{ seat_months: 100000 }], []);
    expect(canIssue(C(), big, { userCount: 5000, months: 12 }, T).ok).toBe(true);
  });

  it('잔량이 0 이면 막힌다', () => {
    const zero = balanceOf([{ seat_months: 40 }], [{ seat_months: 40 }]);
    const r = canIssue(C(), zero, { userCount: 1, months: 1 }, T);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient');
  });

  it('**인원·개월 합계 한도 안이면 긴 개월도 된다** (James 위임 확정 ③)', () => {
    // 40명 18개월 = 720 ≤ 1000
    expect(canIssue(C(), bal, { userCount: 40, months: 18 }, T).ok).toBe(true);
  });

  it('계약이 없거나 무효면 막힌다', () => {
    expect(canIssue(null, bal, { userCount: 1, months: 1 }, T).reason).toBe('no_contract');
    expect(canIssue(C({ voided_at: 'x' }), bal, { userCount: 1, months: 1 }, T).reason).toBe('no_contract');
  });

  it('작성 중·종료된 계약으로는 발급하지 않는다', () => {
    expect(canIssue(C({ status: 'draft' }), bal, { userCount: 1, months: 1 }, T).reason)
      .toBe('contract_not_active');
    expect(canIssue(C({ status: 'ended' }), bal, { userCount: 1, months: 1 }, T).reason)
      .toBe('contract_not_active');
  });

  it('계약 기간이 지났으면 막힌다', () => {
    expect(canIssue(C({ ends_on: '2026-11-16' }), bal, { userCount: 1, months: 1 }, T).reason)
      .toBe('contract_expired');
    expect(canIssue(C({ ends_on: '2026-11-17' }), bal, { userCount: 1, months: 1 }, T).ok)
      .toBe(true);   // 마지막 날은 유효
  });

  it('잘못된 요청은 막힌다', () => {
    expect(canIssue(C(), bal, { userCount: 0, months: 1 }, T).reason).toBe('bad_request');
    expect(canIssue(C(), bal, { userCount: 1.5, months: 1 }, T).reason).toBe('bad_request');
  });

  it('**수량을 셀 수 없는 옛 발급이 있으면 막고 사람에게 알린다**', () => {
    const murky = balanceOf([{ seat_months: 1200 }], [{ user_count: null, duration: null }]);
    const r = canIssue(C(), murky, { userCount: 1, months: 1 }, T);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_history');
  });
});

// ══════════════════════ 초과 경고 (커미션형) ══════════════════════
describe('초과 경고 — 막지 않고 알린다', () => {
  it('계약 수량을 넘으면 경고한다', () => {
    const o = overageOf(C({ settlement_method: 'commission', contracted_seat_months: 1200 }), 1500);
    expect(o.over).toBe(300);
    expect(o.warn).toBe(true);
  });

  it('안 넘으면 경고하지 않는다', () => {
    expect(overageOf(C({ contracted_seat_months: 1200 }), 1200).warn).toBe(false);
  });

  it('**계약 수량이 없으면 판단하지 않는다** (0 으로 치면 전부 초과가 된다)', () => {
    const o = overageOf(C({ contracted_seat_months: null }), 500);
    expect(o.contracted).toBeNull();
    expect(o.over).toBeNull();
    expect(o.warn).toBe(false);
  });

  it('계약이 없어도 터지지 않는다', () => {
    expect(overageOf(null, 10).warn).toBe(false);
  });
});

// ══════════════════════ 정산 방식 변경 금지 ══════════════════════
describe('정산 방식은 만든 뒤 바꾸지 않는다', () => {
  const none = { purchases: 0, issues: 0, deals: 0 };

  it('작성 중이고 아무것도 안 달렸으면 바꿀 수 있다', () => {
    expect(canChangeSettlementMethod(C({ status: 'draft' }), none).ok).toBe(true);
  });

  it('**유효한 계약은 못 바꾼다** — 새 계약을 만들라고 한다', () => {
    const r = canChangeSettlementMethod(C({ status: 'active' }), none);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('새 계약');
  });

  it('구매·발급·판매가 달려 있으면 못 바꾼다', () => {
    for (const k of ['purchases', 'issues', 'deals'] as const) {
      const r = canChangeSettlementMethod(C({ status: 'draft' }), { ...none, [k]: 1 });
      expect(r.ok, k).toBe(false);
      expect(r.message, k).toContain('1건');
    }
  });
});

// ══════════════════════ 리드 보호 기간 ══════════════════════
describe('리드 보호 — 90일, 접촉 시 연장 (James 확정 Q4)', () => {
  it('90일이다', () => {
    expect(PROTECTION_DAYS).toBe(90);
    expect(PROTECTION_BASIS).toContain('90일');
    expect(PROTECTION_BASIS).toContain('등록·이력은 그대로');
  });

  it('등록일부터 90일', () => {
    expect(protectionEndsOn({ partner_claimed_at: '2026-09-01' })).toBe('2026-11-30');
  });

  it('**접촉하면 그날부터 다시 90일**', () => {
    expect(protectionEndsOn({
      partner_claimed_at: '2026-09-01', last_contact_at: '2026-11-01T05:00:00Z',
    })).toBe('2027-01-30');
  });

  it('접촉일이 등록일보다 앞서면(데이터 오류) 등록일을 쓴다 — 짧아지는 쪽이 안전하다', () => {
    expect(protectionEndsOn({
      partner_claimed_at: '2026-09-01', last_contact_at: '2026-08-01',
    })).toBe('2026-11-30');
  });

  it('**등록일이 없으면 보호도 없다** (언제부터인지 모르는 보호는 주장할 수 없다)', () => {
    expect(protectionEndsOn({})).toBeNull();
    expect(protectionEndsOn({ partner_claimed_at: '' })).toBeNull();
    expect(protectionEndsOn({ partner_claimed_at: 'yesterday' })).toBeNull();
    expect(isProtected({}, T)).toBe(false);
  });

  it('보호 중인지 센다', () => {
    const lead = { partner_claimed_at: '2026-09-01' };   // ~2026-11-30
    expect(isProtected(lead, '2026-11-17')).toBe(true);
    expect(isProtected(lead, '2026-11-29')).toBe(true);
    expect(isProtected(lead, '2026-11-30')).toBe(false);  // 끝나는 날은 풀린다
    expect(isProtected(lead, '2026-12-01')).toBe(false);
  });

  it('남은 날을 센다', () => {
    expect(protectionDaysLeft({ partner_claimed_at: '2026-09-01' }, '2026-11-17')).toBe(13);
    expect(protectionDaysLeft({ partner_claimed_at: '2026-09-01' }, '2026-12-01')).toBeNull();
    expect(protectionDaysLeft({}, T)).toBeNull();
  });
});

describe('파트너가 리드를 등록할 때 — **막지 않는다**', () => {
  it('아무도 안 잡았으면 그냥 등록', () => {
    const r = checkClaim(null, 'p1', T);
    expect(r.verdict).toBe('free');
    expect(r.blocked).toBe(false);
    expect(r.notifyUs).toBe(false);
  });

  it('내가 등록한 것이면 알려만 준다', () => {
    const r = checkClaim({ partner_id: 'p1', partner_claimed_at: '2026-11-01' }, 'p1', T);
    expect(r.verdict).toBe('mine');
    expect(r.daysLeft).toBe(74);
  });

  it('**다른 파트너가 보호 중이어도 막지 않고** 우리에게 알린다', () => {
    const r = checkClaim({ partner_id: 'p2', partner_claimed_at: '2026-11-01' }, 'p1', T);
    expect(r.verdict).toBe('other_partner');
    expect(r.blocked).toBe(false);
    expect(r.notifyUs).toBe(true);
  });

  it('⚠️ **어느 파트너인지 알려 주지 않는다** (다른 파트너의 정보다)', () => {
    const r = checkClaim({ partner_id: 'p2-eduvision', partner_claimed_at: '2026-11-01' }, 'p1', T);
    expect(r.message).not.toContain('p2');
    expect(r.message).not.toContain('eduvision');
  });

  it('보호가 끝났으면 가져갈 수 있다', () => {
    const r = checkClaim({ partner_id: 'p2', partner_claimed_at: '2026-01-01' }, 'p1', T);
    expect(r.verdict).toBe('free');
    expect(r.notifyUs).toBe(false);
  });

  it('**우리 리드면 우리가 우선**이고 파트너에게 알린다', () => {
    const r = checkClaim({ partner_id: null, partner_claimed_at: null }, 'p1', T);
    expect(r.verdict).toBe('ours');
    expect(r.blocked).toBe(false);
    expect(r.notifyUs).toBe(true);
  });

  it('어떤 경우에도 blocked 가 참이 되지 않는다', () => {
    const cases = [
      null,
      { partner_id: 'p1', partner_claimed_at: '2026-11-01' },
      { partner_id: 'p2', partner_claimed_at: '2026-11-01' },
      { partner_id: null },
    ];
    for (const c of cases) expect(checkClaim(c, 'p1', T).blocked).toBe(false);
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('마이그레이션 — 추가만, 기존을 건드리지 않는다', () => {
  const A = sqlCode(read('supabase/migrations/20261129000000_lead_s7_1_partner_contracts.sql'));
  const B = sqlCode(read('supabase/migrations/20261129000100_lead_s7_1_deal_contract_link.sql'));

  it('표를 만든다', () => {
    expect(A).toContain('create table if not exists public.partner_contracts');
  });

  it('**기존 데이터를 바꾸지 않는다**', () => {
    for (const sql of [A, B]) {
      expect(sql).not.toMatch(/drop\s+table/i);
      expect(sql).not.toMatch(/\b(delete\s+from|truncate)\b/i);
      expect(sql).not.toMatch(/update\s+public\.partner_(deals|licenses|files)\b/i);
      expect(sql).not.toMatch(/drop\s+column/i);
    }
  });

  it('`contract_id` 는 NULL 허용이다 (기존 117건이 그대로 동작)', () => {
    expect(B).toMatch(/add column if not exists contract_id uuid references public\.partner_contracts\(id\)/);
    // add column 문장만 볼 것 — 아래 create index 에도 "is not null" 이 있어
    // 느슨한 정규식은 그걸 잡는다(처음에 그러다 이 주석을 남긴다).
    const addCol = (B.match(/add column[^;]*;/i) ?? [''])[0];
    expect(addCol).toBeTruthy();
    expect(addCol).not.toMatch(/not null/i);
    expect(addCol).not.toMatch(/default/i);   // 기본값 없음 = 테이블 재작성 없음
  });

  it('**백필하지 않는다** (어느 판매가 어느 계약인지는 사람이 정한다)', () => {
    expect(B).not.toMatch(/insert\s+into/i);
    expect(B).not.toMatch(/\bupdate\b/i);
  });

  it('새 외래키는 전부 on delete restrict (이력 보호)', () => {
    const refs = A.match(/references[^,\n]*/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r, r).toContain('on delete restrict');
    expect(B).toMatch(/references public\.partner_contracts\(id\) on delete restrict/);
  });

  // fix1 (2026-11-17): 처음에는 H-4 의 partner_scoped_* 를 베껴 **FOR ALL** 로 두었다.
  // 그러면 파트너 계정이 자기 계약의 수량·단가·수수료율을 직접 고칠 수 있었다
  // (수량을 늘리면 발급 한도가 늘어난다). 베껴야 했던 것은 **partners** 다 —
  // 읽기는 자기 것 OR admin, 쓰기는 admin 전용으로 **나뉘어** 있다.
  describe('정책 — 파트너는 **읽기만**, 쓰기는 admin 전용 (fix1)', () => {
    const SCOPED =
      'partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())';
    const ADMIN = /\(select up\.role from public\.user_profiles up where up\.id = auth\.uid\(\)\) = any \(array\['admin','sub_admin'\]\)/;

    /** 이름으로 정책 한 덩어리를 떼어 낸다 */
    const policy = (name: string) => {
      const m = A.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
      return m ? m[0] : '';
    };
    const clause = (pol: string, kw: 'using' | 'with check') => {
      const m = pol.match(new RegExp(`${kw} \\(([\\s\\S]*?)\\)\\s*(?:with check|;)`));
      return m ? m[1].trim() : '';
    };

    it('RLS 가 켜져 있다', () => {
      expect(A).toContain('enable row level security');
    });

    it('**FOR ALL 정책이 없다** — 하나로 묶으면 읽기와 쓰기가 같은 조건이 된다', () => {
      expect(A).not.toMatch(/create policy[^;]*\bfor all\b/i);
    });

    it('읽기: 자기 계약 **또는** admin', () => {
      const pol = policy('partner_contracts_select');
      expect(pol, '읽기 정책을 찾지 못했다').toBeTruthy();
      expect(pol).toMatch(/for select/);
      const u = clause(pol, 'using');
      expect(u).toContain(SCOPED);
      expect(u).toMatch(ADMIN);
      expect(u).not.toMatch(/^true$/);
    });

    it('**쓰기는 admin 전용이다 — partner_id 조건이 아예 없다**', () => {
      for (const name of ['partner_contracts_admin_insert', 'partner_contracts_admin_update']) {
        const pol = policy(name);
        expect(pol, name).toBeTruthy();
        // 자기 partner 면 쓸 수 있다는 조건이 섞이면 안 된다
        expect(pol, name).not.toContain(SCOPED);
        expect(pol, name).toMatch(ADMIN);
      }
    });

    it('insert 는 with check, update 는 using·with check 둘 다 admin 이다', () => {
      const ins = policy('partner_contracts_admin_insert');
      expect(ins).toMatch(/for insert/);
      expect(clause(ins, 'with check')).toMatch(ADMIN);

      const upd = policy('partner_contracts_admin_update');
      expect(upd).toMatch(/for update/);
      // using 이 비면 **아무 행도 못 고치고**, 넓으면 남의 행을 고친다. 둘 다 admin 이어야 한다.
      expect(clause(upd, 'using'), 'using').toMatch(ADMIN);
      expect(clause(upd, 'with check'), 'with check').toMatch(ADMIN);
      expect(clause(upd, 'using')).not.toMatch(/^true$/);
    });

    it('fix1 이전 이름(한 개짜리 FOR ALL)이 남아 있지 않다', () => {
      expect(A).not.toMatch(/create policy "partner_scoped_partner_contracts"/);
      // 혹시 손으로 올려 본 적이 있을 수 있어 DROP 은 남겨 둔다
      expect(A).toContain('drop policy if exists "partner_scoped_partner_contracts"');
    });

    it('드라이런이 **파트너 쓰기 거부를 실제로 찔러 본다**', () => {
      const D = read('../audit/dryrun_lead_s7_1_contracts.sql');
      for (const probe of [
        '파트너가 자기 계약 SELECT', '다른 파트너 계약 SELECT',
        '파트너가 자기 계약 UPDATE', '파트너가 계약 INSERT', '파트너가 계약 DELETE',
      ]) {
        expect(D, probe).toContain(probe);
      }
      // 건수로 본다 — "오류가 없었다"를 성공으로 읽지 않는다
      expect(D).toContain('건수로');
      expect(D).toContain("set local role authenticated");
      expect(D).toContain('reset role');
    });

    it('롤백이 새 정책 이름 네 개를 모두 안다', () => {
      const R = read('../audit/rollback_lead_s7_1_contracts.sql');
      for (const name of [
        'partner_contracts_select', 'partner_contracts_admin_insert',
        'partner_contracts_admin_update', 'partner_contracts_no_delete',
      ]) {
        expect(R, name).toContain(name);
      }
    });
  });

  it('**삭제 불가**다 (원장)', () => {
    expect(A).toMatch(/as restrictive for delete to authenticated using \( false \)/);
  });

  it('anon·public 에서 권한을 거둔다', () => {
    expect(A).toContain('revoke all on public.partner_contracts from anon');
    expect(A).toContain('revoke all on public.partner_contracts from public');
    expect(A).toMatch(/grant select, insert, update on public\.partner_contracts to authenticated/);
    expect(A).not.toMatch(/grant[^;]*delete[^;]*partner_contracts/i);
  });

  it('정산 방식과 상태를 CHECK 로 좁힌다', () => {
    expect(A).toMatch(/check \(settlement_method in \('commission', 'wholesale'\)\)/);
    expect(A).toMatch(/check \(status in \('draft', 'active', 'ended', 'cancelled'\)\)/);
  });

  it('**draft 는 비어도 되고 active 만 필수값을 따진다** (마법사 중간 저장)', () => {
    expect(A).toMatch(/status <> 'active'/);
    expect(A).toContain('when \'wholesale\'  then unit_price_per_seat_year is not null');
    expect(A).toContain('when \'commission\' then commission_rate is not null');
  });

  it('무상 배정은 도매형 + 단가 0 이다', () => {
    expect(A).toMatch(/not is_grant\s*\n?\s*or \(settlement_method = 'wholesale' and coalesce\(unit_price_per_seat_year, -1\) = 0\)/);
  });

  it('무효에는 사유가 있어야 한다', () => {
    expect(A).toMatch(/voided_at is null or coalesce\(trim\(void_reason\), ''\) <> ''/);
  });

  it('**잔량 칸을 만들지 않는다** (저장하지 않고 센다)', () => {
    expect(A).not.toMatch(/balance_seat_months|remaining_seat_months|current_balance/i);
  });

  it('여러 번 돌려도 같다', () => {
    expect((A.match(/create table(?! if not exists)/gi) ?? [])).toHaveLength(0);
    expect((A.match(/create index(?! if not exists)/gi) ?? [])).toHaveLength(0);
    expect((B.match(/add column(?! if not exists)/gi) ?? [])).toHaveLength(0);
  });

  it('드라이런은 아무것도 남기지 않는다', () => {
    const D = sqlCode(read('../audit/dryrun_lead_s7_1_contracts.sql'));
    expect(D).toMatch(/^\s*begin;/m);
    expect(D.trimEnd().endsWith('rollback;')).toBe(true);
    // `commit;` 문장이 없어야 한다. `on commit drop`(임시 표)은 커밋이 아니다.
    expect(D).not.toMatch(/^\s*commit\s*;/mi);
  });

  it('드라이런이 **CHECK 를 실제로 찔러 본다**', () => {
    const D = read('../audit/dryrun_lead_s7_1_contracts.sql');
    for (const probe of ['barter', '음수 계약 수량', 'active 도매형에 단가 없음', '무상인데 단가 0 아님']) {
      expect(D, probe).toContain(probe);
    }
  });

  it('롤백은 DROP 을 주석으로 두고 건수를 먼저 보게 한다', () => {
    const R = read('../audit/rollback_lead_s7_1_contracts.sql');
    expect(R).toMatch(/먼저 보세요/);
    expect(sqlCode(R)).not.toMatch(/^\s*drop table/mi);
    expect(R).toMatch(/-- drop table if exists public\.partner_contracts;/);
  });
});

// ══════════════════════ 보안 ══════════════════════
describe('보안 — 이 단계에 해당하는 항목', () => {
  it('순수 로직은 DB 를 부르지 않는다', () => {
    const s = read('src/lib/partnerContract.ts');
    expect(s).not.toContain('rest/v1');
    expect(s).not.toMatch(/\bfetch\(/);
    expect(s).not.toContain('supabase');
  });

  it('키·개인정보를 담지 않는다', () => {
    const s = read('src/lib/partnerContract.ts');
    expect(s).not.toMatch(/eyJ[A-Za-z0-9]|service_role|SUPABASE_/);
    expect(s).not.toMatch(/@[a-z0-9-]+\.(com|net|org|sg)/i);
  });

  it('**판정만 하고 쓰기는 서버가 한다**고 적어 두었다 (경쟁 상태)', () => {
    const s = read('src/lib/partnerContract.ts');
    expect(s).toContain('for update');
    expect(s).toContain('동시에 발급하면');
  });
});
