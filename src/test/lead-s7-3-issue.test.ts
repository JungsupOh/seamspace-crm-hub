// LEAD-S7-3 — 발급 차감: 잔량 경계 · 계약 선택 · 실패 경로 · 서버/화면 대조
//
// 지켜야 하는 약속
//   ① 같은 규칙이 세 군데(SQL · Deno 공유 모듈 · 화면)에 있고 **같은 답**을 낸다.
//   ② `failed` 만 발급에서 뺀다. `revoked`·`reserved` 는 **센다**.
//   ③ 셀 수 없는 수량을 0 으로 치지 않는다 — 치면 초과 발급이 난다.
//   ④ 예약을 **쿠폰보다 먼저** 넣는다(공짜 발급 방지).
//   ⑤ 계약이 없거나 커미션형이면 **지금 동작 그대로**(차단 없음).
//   ⑥ 동시 발급은 **계약 행 잠금**으로 막는다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  balanceOf as fBalance, canIssue, countsTowardIssued as fCounts,
  isStaleReservation as fStale, issuedSeatMonths as fIssued, overageOf,
  seatMonths, STALE_RESERVATION_MINUTES,
} from '../lib/partnerContract';
import {
  balanceOf as sBalance, blockMessage, countsTowardIssued as sCounts,
  isStaleReservation as sStale, issuedSeatMonths as sIssued, licenseSeatMonths,
  overageWarning, pickLocale, purchasedSeatMonths, requestedSeatMonths,
  STALE_RESERVATION_MINUTES as S_STALE,
} from '../../supabase/functions/_shared/seat-balance';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sql = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const FN   = read('supabase/functions/partner-issue-license/index.ts');
const RPC  = read('supabase/migrations/20261201000100_lead_s7_3_reserve_rpc.sql');
const MIG  = read('supabase/migrations/20261201000000_lead_s7_3_license_contract_link.sql');

// ══════════════════════ 세는 규칙 ══════════════════════
describe('발급으로 세는 상태 — **failed 만 뺀다**', () => {
  const cases: Array<[unknown, boolean]> = [
    ['issued', true], ['revoked', true], ['reserved', true],
    [null, true], [undefined, true], ['', true],       // 기본값은 issued
    ['failed', false],
    ['FAILED', true],                                   // 대소문자가 다르면 다른 값이다
  ];

  it('화면과 서버가 같은 답을 낸다', () => {
    for (const [v, want] of cases) {
      expect(fCounts(v), `화면 ${String(v)}`).toBe(want);
      expect(sCounts(v), `서버 ${String(v)}`).toBe(want);
    }
  });

  it('**무효화해도 수량은 돌려주지 않는다** (James 확정)', () => {
    expect(fCounts('revoked')).toBe(true);
    const { total } = fIssued([
      { seat_months: 480, status: 'issued' },
      { seat_months: 120, status: 'revoked', revoked_at: '2026-11-01' },
    ]);
    expect(total).toBe(600);
  });

  it('**진행 중(reserved)도 센다** — 안 세면 그 틈에 두 번 나간다', () => {
    expect(fIssued([{ seat_months: 100, status: 'reserved' }]).total).toBe(100);
  });

  it('`failed` 는 아무 일도 없었던 줄이다', () => {
    expect(fIssued([
      { seat_months: 100, status: 'issued' },
      { seat_months: 900, status: 'failed' },
    ]).total).toBe(100);
  });
});

describe('수량 읽기 — 문자열 칸도 읽는다 (DB 가 text 다)', () => {
  it('박힌 값을 먼저 쓴다', () => {
    expect(licenseSeatMonths({ seat_months: 480, user_count: '999', duration: '999' })).toBe(480);
  });

  it('없으면 곱한다 (text 로 와도)', () => {
    expect(licenseSeatMonths({ user_count: '40', duration: '12' })).toBe(480);
  });

  it('**셀 수 없으면 null — 0 이 아니다**', () => {
    for (const row of [
      {}, { user_count: '40' }, { user_count: null, duration: null },
      { user_count: '0', duration: '12' }, { user_count: '1.5', duration: '12' },
      { user_count: '', duration: '12' }, { user_count: 'abc', duration: '12' },
    ]) {
      expect(licenseSeatMonths(row), JSON.stringify(row)).toBeNull();
    }
  });

  it('요청 수량도 같은 규칙 (반 달 없음)', () => {
    expect(requestedSeatMonths({ userCount: '40', duration: '12' })).toBe(480);
    expect(requestedSeatMonths({ userCount: '40', duration: '0' })).toBeNull();
    expect(requestedSeatMonths({ userCount: '', duration: '12' })).toBeNull();
  });
});

// ══════════════════════ 서버·화면 대조 ══════════════════════
describe('**서버와 화면이 같은 잔량을 낸다** (대조 시험)', () => {
  const purchases = [
    { seat_months: 1200 }, { seat_months: 600 },
    { seat_months: 300, voided_at: '2026-11-01' },      // 취소된 구매
    { seat_months: null }, { seat_months: '400' },      // 문자열·빈 값
  ];
  const licenses = [
    { seat_months: 480, status: 'issued' },
    { seat_months: 120, status: 'revoked' },
    { seat_months: 100, status: 'reserved' },
    { seat_months: 999, status: 'failed' },
    { user_count: '40', duration: '1', status: 'issued' },
    { user_count: null, duration: null, status: 'issued' },   // 셀 수 없음
  ];

  it('구매·발급·잔량·셀 수 없는 건수가 모두 같다', () => {
    const f = fBalance(purchases, licenses);
    const s = sBalance(purchases, licenses);
    expect(f).toEqual(s);
    expect(f.purchased).toBe(2200);                      // 1200+600+400
    expect(f.issued).toBe(740);                          // 480+120+100+40
    expect(f.balance).toBe(1460);
    expect(f.unknownIssues).toBe(1);
  });

  it('빈 목록도 같다', () => {
    expect(fBalance([], [])).toEqual(sBalance([], []));
  });

  it('구매만 있어도 같다', () => {
    expect(fBalance([{ seat_months: 100 }], [])).toEqual(sBalance([{ seat_months: 100 }], []));
  });

  it('초과 발급(음수)도 같다', () => {
    const p = [{ seat_months: 100 }], l = [{ seat_months: 150, status: 'issued' }];
    expect(fBalance(p, l)).toEqual(sBalance(p, l));
    expect(fBalance(p, l).balance).toBe(-50);
  });

  it('예약 오래 남음 판정도 같다', () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    const rows = [
      { status: 'reserved', created_at: '2026-11-17T11:00:00Z' },   // 60분 전
      { status: 'reserved', created_at: '2026-11-17T11:55:00Z' },   // 5분 전
      { status: 'issued',   created_at: '2026-11-17T10:00:00Z' },
      { status: 'reserved', created_at: null },
      { status: 'reserved', created_at: '어제' },
    ];
    for (const r of rows) expect(sStale(r, now), JSON.stringify(r)).toBe(fStale(r, now));
    expect(fStale(rows[0], now)).toBe(true);
    expect(fStale(rows[1], now)).toBe(false);
    expect(STALE_RESERVATION_MINUTES).toBe(S_STALE);
  });

  it('구매 합계 함수도 같은 답', () => {
    expect(purchasedSeatMonths(purchases)).toBe(fBalance(purchases, []).purchased);
  });

  it('발급 합계 함수도 같은 답', () => {
    expect(sIssued(licenses)).toEqual(fIssued(licenses));
  });
});

// ══════════════════════ 잔량 경계 ══════════════════════
describe('잔량 경계', () => {
  const C = { id: 'c1', settlement_method: 'wholesale', status: 'active', starts_on: '2026-01-01' };
  const bal = (p: number, i: number) =>
    fBalance([{ seat_months: p }], i > 0 ? [{ seat_months: i, status: 'issued' }] : []);

  it('딱 맞게 쓰는 것은 된다', () => {
    expect(canIssue(C, bal(1200, 200), { userCount: 1000, months: 1 }, '2026-11-17').ok).toBe(true);
  });

  it('**1 부족하면 막힌다**', () => {
    const r = canIssue(C, bal(1200, 200), { userCount: 1001, months: 1 }, '2026-11-17');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient');
  });

  it('**정확히 0 이면 막힌다**', () => {
    const r = canIssue(C, bal(480, 480), { userCount: 1, months: 1 }, '2026-11-17');
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(-1);
  });

  it('구매가 없으면 막힌다', () => {
    expect(canIssue(C, fBalance([], []), { userCount: 1, months: 1 }, '2026-11-17').ok).toBe(false);
  });

  it('**무효 구매는 빼고, 무효 발급은 뺀다** (서로 다르다)', () => {
    const b = fBalance(
      [{ seat_months: 1000 }, { seat_months: 500, voided_at: 'x' }],
      [{ seat_months: 400, status: 'revoked' }],
    );
    expect(b.purchased).toBe(1000);   // 취소된 구매는 뺀다
    expect(b.issued).toBe(400);       // 무효화된 발급은 **센다**
    expect(b.balance).toBe(600);
  });

  it('수량을 알 수 없는 발급이 있으면 **막고 사람에게 알린다**', () => {
    const b = fBalance([{ seat_months: 1200 }], [{ user_count: null, duration: null, status: 'issued' }]);
    const r = canIssue(C, b, { userCount: 1, months: 1 }, '2026-11-17');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_history');
  });

  it('**미입금이어도 발급을 막지 않는다** (James 확정: 입금 전 발급 허용)', () => {
    // 잔량 계산에 입금 여부가 들어가지 않는다 — 구매 수량만 본다.
    const b = fBalance([{ seat_months: 1200 }], []);
    expect(canIssue(C, b, { userCount: 100, months: 12 }, '2026-11-17').ok).toBe(true);
    const code = read('src/lib/partnerContract.ts');
    expect(code).not.toMatch(/canIssue[\s\S]{0,600}(paid_amount|billing_status|invoiced_on)/);
  });

  it('계약 기간이 끝났으면 막힌다', () => {
    expect(canIssue({ ...C, ends_on: '2026-11-16' }, bal(1200, 0), { userCount: 1, months: 1 }, '2026-11-17').reason)
      .toBe('contract_expired');
  });
});

describe('커미션형 초과 — 막지 않고 경고', () => {
  it('넘으면 알린다', () => {
    expect(overageWarning(1200, 1000, 400)).toEqual({ over: 200 });
    expect(overageOf({ id: 'c', contracted_seat_months: 1200 }, 1400).warn).toBe(true);
  });

  it('안 넘으면 조용하다', () => {
    expect(overageWarning(1200, 1000, 200)).toBeNull();
  });

  it('**계약 수량이 없으면 판단하지 않는다** (0 으로 치면 전부 초과가 된다)', () => {
    for (const v of [null, undefined, '', 'abc', 0, -1]) {
      expect(overageWarning(v, 0, 100), String(v)).toBeNull();
    }
  });
});

// ══════════════════════ 막힌 이유 문구 ══════════════════════
describe('막힌 이유를 파트너 말로', () => {
  it('언어는 partners.locale 로 고르고 모르면 영어', () => {
    expect(pickLocale('ko')).toBe('ko');
    expect(pickLocale('ko-KR')).toBe('ko');
    expect(pickLocale('tr')).toBe('en');
    expect(pickLocale(null)).toBe('en');
  });

  it('잔량 부족이면 **추가 구매를 안내한다** (James 확정 Q2 — 자동 청구서 없음)', () => {
    const ko = blockMessage('INSUFFICIENT_BALANCE', { balance: 40, requested: 480 }, 'ko');
    expect(ko).toContain('추가 구매');
    expect(ko).toContain('40');
    expect(ko).toContain('480');
    const en = blockMessage('INSUFFICIENT_BALANCE', { balance: 40, requested: 480 }, 'en');
    expect(en).toContain('additional purchase');
    expect(en).not.toMatch(/[가-힣]/);
  });

  it('모든 코드에 두 언어 문구가 있다', () => {
    const codes = ['BAD_REQUEST', 'CONTRACT_REQUIRED', 'NO_CONTRACT', 'CONTRACT_NOT_ACTIVE',
      'CONTRACT_EXPIRED', 'NOT_WHOLESALE', 'UNKNOWN_HISTORY', 'INSUFFICIENT_BALANCE'] as const;
    for (const c of codes) {
      for (const l of ['ko', 'en'] as const) {
        const m = blockMessage(c, { contractCount: 2, unknownIssues: 1 }, l);
        expect(m, `${c}/${l}`).toBeTruthy();
        if (l === 'en') expect(m, `${c}/en`).not.toMatch(/[가-힣]/);
      }
    }
  });

  it('**개인정보를 넣지 않는다**', () => {
    const src = read('supabase/functions/_shared/seat-balance.ts');
    expect(src).not.toMatch(/contact_email|contact_name|contact_phone/);
  });
});

// ══════════════════════ SQL — 동시성과 규칙 ══════════════════════
describe('예약 RPC — **계약 행을 잠그고 다시 센다**', () => {
  it('`for update` 로 계약 행을 잠근다 (동시 발급 차단의 핵심)', () => {
    expect(sql(RPC)).toMatch(/from public\.partner_contracts[\s\S]{0,80}where id = p_contract_id[\s\S]{0,40}for update/);
  });

  it('**잠근 뒤에** 합계를 센다 (순서가 바뀌면 막지 못한다)', () => {
    const body = sql(RPC);
    const lock = body.indexOf('for update');
    const sumPurchases = body.indexOf('from public.partner_purchases');
    const sumLicenses = body.indexOf('from public.partner_licenses');
    const insert = body.indexOf('insert into public.partner_licenses');
    expect(lock).toBeGreaterThan(-1);
    expect(sumPurchases).toBeGreaterThan(lock);
    expect(sumLicenses).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(sumLicenses);
  });

  it('구매는 무효를 빼고, 발급은 `failed` 만 뺀다 (TS 와 같은 규칙)', () => {
    const body = sql(RPC);
    expect(body).toMatch(/from public\.partner_purchases[\s\S]{0,120}voided_at is null/);
    expect(body).toMatch(/coalesce\(status, 'issued'\) <> 'failed'/);
    // revoked 를 빼는 조건이 없어야 한다
    expect(body).not.toMatch(/revoked_at is null/);
  });

  it('셀 수 없는 발급이 있으면 **거절한다** (0 으로 치지 않는다)', () => {
    expect(sql(RPC)).toContain('UNKNOWN_HISTORY');
    expect(sql(RPC)).toMatch(/if v_unknown > 0 then/);
  });

  it('잔량이 모자라면 INSUFFICIENT_BALANCE', () => {
    expect(sql(RPC)).toMatch(/if v_balance < v_seat_months then[\s\S]{0,200}INSUFFICIENT_BALANCE/);
  });

  it('남의 계약으로는 예약할 수 없다', () => {
    expect(sql(RPC)).toMatch(/v_contract\.partner_id <> p_partner_id/);
  });

  it('도매형이 아니면 예약하지 않는다', () => {
    expect(sql(RPC)).toMatch(/settlement_method <> 'wholesale'/);
  });

  it('**security definer 인데 search_path 를 고정했다**', () => {
    expect(sql(RPC)).toContain('security definer');
    expect(sql(RPC)).toMatch(/set search_path = public, pg_temp/);
    // 두 함수 모두
    expect((sql(RPC).match(/set search_path = public, pg_temp/g) ?? []).length).toBe(2);
  });

  it('**service_role 만 호출할 수 있다**', () => {
    const body = sql(RPC);
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(body, role).toMatch(new RegExp(`revoke all on function[\\s\\S]{0,400}from ${role}`));
    }
    expect(body).toMatch(/grant execute on function[\s\S]{0,400}to service_role/);
    expect(body).not.toMatch(/grant execute[\s\S]{0,200}to (anon|authenticated)\b/);
  });

  it('예약 행은 **진짜 쿠폰과 섞이지 않는다**', () => {
    expect(sql(RPC)).toMatch(/'RESERVED-' \|\| replace\(gen_random_uuid\(\)/);
    expect(sql(RPC)).toMatch(/'reserved'/);
  });

  it('되돌리기는 **예약 상태인 줄만** 지운다', () => {
    const rel = sql(RPC).slice(sql(RPC).indexOf('partner_release_license_reservation'));
    expect(rel).toMatch(/status = 'reserved'/);
    expect(rel).toMatch(/coupon_code like 'RESERVED-%'/);
  });
});

describe('마이그레이션 — 추가만', () => {
  it('`contract_id` 는 NULL 허용 + restrict', () => {
    expect(sql(MIG)).toMatch(/add column if not exists contract_id uuid references public\.partner_contracts\(id\) on delete restrict/);
    const add = (sql(MIG).match(/add column[^;]*;/i) ?? [''])[0];
    expect(add).not.toMatch(/not null/i);
    expect(add).not.toMatch(/default/i);
  });

  it('**기존 2건을 채우지 않는다**', () => {
    expect(sql(MIG)).not.toMatch(/\b(update|insert into)\b/i);
    expect(MIG).toContain('기존 2건은 채우지 않는다');
  });

  it('RLS·권한을 넓히지 않는다', () => {
    expect(sql(MIG)).not.toMatch(/create policy|grant |revoke /i);
  });
});

// ══════════════════════ 엣지 함수 흐름 ══════════════════════
describe('발급 함수 — 예약 → 쿠폰 → 확정', () => {
  it('**예약이 쿠폰보다 먼저다** (공짜 발급 방지)', () => {
    const reserve = FN.indexOf("rpc(\n        'partner_reserve_license_seats'");
    const coupon = FN.indexOf('functions/v1/create-coupon');
    const confirm = FN.indexOf("status: 'issued' })");
    expect(reserve).toBeGreaterThan(-1);
    expect(coupon).toBeGreaterThan(reserve);
    expect(confirm).toBeGreaterThan(coupon);
  });

  // ⚠️ 처음에는 "되돌리기 호출이 그 근처에 있다"만 봤다. 그러면 `if (false)` 로
  //    **꺼 두어도 통과한다**(변이 시험에서 드러났다). 이 길은 공짜로 잔량이
  //    사라지는 길이라, **어떤 조건에서 부르는지**까지 본다.
  it('쿠폰이 실패하면 **예약을 되돌린다**', () => {
    const at = FN.indexOf('쿠폰 생성 실패');
    expect(at, '쿠폰 실패 분기를 찾지 못했다').toBeGreaterThan(-1);
    const seg = FN.slice(Math.max(0, at - 1100), at + 100);

    // 예약이 있을 때만 부르고, 조건이 꺼져 있지 않아야 한다
    expect(seg).toMatch(/if \(reservedLicenseId\) \{/);
    expect(seg).not.toMatch(/if \((false|0|null)\)/);
    expect(seg).toMatch(/rpc\(\s*\n?\s*'partner_release_license_reservation'/);
    expect(seg).toContain('p_license_id: reservedLicenseId');

    // 되돌리기 호출이 쿠폰 실패 분기 **안쪽**에 있다(성공 경로에서 부르면 안 된다)
    const release = FN.indexOf('partner_release_license_reservation');
    const couponFail = FN.indexOf('if (!couponRes.ok || !couponJson.coupon_code)');
    expect(couponFail).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(couponFail);
    expect(release).toBeLessThan(at + 100);

    // 함수 전체에서 되돌리기를 부르는 곳은 **한 군데뿐**이다
    expect((FN.match(/'partner_release_license_reservation'/g) ?? []).length).toBe(1);
  });

  it('되돌리기까지 실패하면 **사람에게 알린다** (예약이 남아 잔량을 먹는다)', () => {
    expect(FN).toContain('발급 예약이 남았습니다');
  });

  it('**확정이 실패해도 예약을 지우지 않는다** (쿠폰은 실제로 나갔다)', () => {
    const at = FN.indexOf('예약 확정 실패');
    expect(at).toBeGreaterThan(-1);
    const seg = FN.slice(at - 400, at + 400);
    expect(seg).not.toContain('partner_release_license_reservation');
    expect(FN).toContain('발급 확정 실패');
  });

  it('확정은 **예약 상태인 줄만** 덮어쓴다', () => {
    expect(FN).toMatch(/\.eq\('status', 'reserved'\)/);
  });

  it('계약이 없으면 **기존 동작 그대로** (차단 없음)', () => {
    // chosen 이 없으면 예약을 건너뛰고 insert 로 간다
    expect(FN).toMatch(/if \(chosen\) \{/);
    expect(FN).toMatch(/if \(reservedLicenseId\) \{[\s\S]{0,800}\} else \{[\s\S]{0,400}\.insert\(/);
  });

  it('도매 계약이 2개 이상이면 **고르게 한다**', () => {
    expect(FN).toMatch(/wholesale\.length > 1/);
    expect(FN).toContain('CONTRACT_REQUIRED');
  });

  it('계약 조회가 실패하면 **막는다** (fail-closed)', () => {
    const at = FN.indexOf('계약 조회 실패');
    const seg = FN.slice(at, at + 300);
    expect(seg).toContain('503');
  });

  it('커미션형은 **막지 않고 경고만** 한다', () => {
    expect(FN).toContain('막지 않습니다');
    expect(FN).toMatch(/overageWarning\(/);
    // 커미션 경로에 차단 응답이 없다
    const at = FN.indexOf('커미션형: **막지 않고 경고만**');
    const seg = FN.slice(at, at + 1400);
    expect(seg).not.toMatch(/return block\(/);
  });

  it('커미션 초과를 **수량으로** 센다 (건수가 아니다)', () => {
    const at = FN.indexOf('이미 나간 수량을');
    expect(at).toBeGreaterThan(-1);
    const seg = FN.slice(at, at + 600);
    expect(seg).toContain('issuedSeatMonths(');
    expect(seg).not.toMatch(/count: 'exact'/);
  });

  it('새 칸(`contract_id`·`seat_months`)을 박는다', () => {
    expect(FN).toMatch(/seat_months:\s+requestedSeatMonths/);
    expect(FN).toMatch(/contract_id:\s+commissionContractId/);
  });

  it('**기존 응답 모양을 지키고 칸만 더한다**', () => {
    // ⚠️ `lastIndexOf('return json({')` 는 맨 끝의 catch 블록을 잡는다.
    //    성공 응답은 `ok: true` 가 있는 쪽이다.
    const at = FN.indexOf('ok: true,');
    expect(at, '성공 응답을 찾지 못했다').toBeGreaterThan(-1);
    const seg = FN.slice(at - 40, at + 420);
    for (const k of ['ok: true', 'coupon_code', 'license_id', 'ledger_saved']) {
      expect(seg, k).toContain(k);
    }
    for (const k of ['contract_id', 'seat_months', 'balance_after']) {
      expect(seg, k).toContain(k);
    }
  });

  it('텔레그램에 잔량 한 줄이 **개인정보 없이** 들어간다', () => {
    const at = FN.indexOf('const balanceLine');
    const seg = FN.slice(at, at + 300);
    expect(seg).toContain('잔량');
    expect(seg).toMatch(/slice\(0, 8\)/);       // 계약은 앞 8자리로만
    expect(seg).not.toMatch(/contactEmail|customerName/);
  });

  it('**로그에 개인정보를 쓰지 않는다**', () => {
    for (const m of FN.match(/console\.(log|warn|error)\([^)]*\)/g) ?? []) {
      expect(m, m).not.toMatch(/contactEmail|customerName|contactPhone|orgName/);
    }
  });

  it('기존 보안을 건드리지 않았다', () => {
    expect(FN).toContain('internalHeaders()');
    expect(FN).toContain("user_metadata 로 폴백하지 않는다");
    expect(FN).toMatch(/if \(isPartner && role !== 'partner_admin'\)/);
    expect(FN).toMatch(/const partnerId = isPartner \? profile\?\.partner_id/);
  });
});
