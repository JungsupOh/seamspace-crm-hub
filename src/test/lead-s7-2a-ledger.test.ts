// LEAD-S7-2a — 도매 선구매 원장 · 미수금 (순수 로직 + 마이그레이션)
//
// 지켜야 하는 약속
//   ① **통화를 섞어 더하지 않는다.** 환산하지 않는다(환율 기준일이 아직 미확정).
//   ② `billing_status` 는 이름표일 뿐이고 **사실은 금액**이다. 어긋나면 알린다.
//   ③ 셀 수 없는 것을 0 으로 바꾸지 않는다(청구 금액 비어 있음 ≠ 0 원 청구).
//   ④ 미수 경과일은 **청구일 기준** 30일·60일(James 확정 Q3).
//   ⑤ 잔량 계산을 두 벌로 만들지 않는다 — partnerContract 를 재사용한다.
//   ⑥ 새 표는 **파트너 쓰기 금지**(S7-1 fix1 과 같은 4개 정책).

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BILLING_LABEL, BILLING_STATUSES, NO_CURRENCY, RECEIVABLE_BASIS, RECEIVABLE_D30,
  RECEIVABLE_D60, STAGE_LABEL, amountDiffers, contractSummary, currencyOf, expectedAmount,
  isInvoiced, isLivePurchase, moneyOf, purchasedSeatMonths, receivableDays, receivableStage,
  statusDisagrees, toBillingStatus, totalsByCurrency, type PurchaseLine,
} from '../lib/partnerLedger';
import { balanceOf } from '../lib/partnerContract';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlCode = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const T = '2026-11-17';

/** 1200 인원·개월을 USD 12,000 에 사고 45일 전에 청구한 줄 */
const P = (o: Partial<PurchaseLine> = {}): PurchaseLine => ({
  id: 'p1', contract_id: 'c1', purchased_on: '2026-09-01',
  seat_months: 1200, unit_price_per_seat_year: 120, currency: 'USD', amount: 12000,
  invoice_no: 'INV-1', billing_status: 'billed', invoiced_on: '2026-10-03', ...o,
});

// ══════════════════════ 청구 상태 ══════════════════════
describe('청구 상태', () => {
  it('네 가지다', () => {
    expect([...BILLING_STATUSES]).toEqual(['unbilled', 'billed', 'partial', 'paid']);
    for (const s of BILLING_STATUSES) expect(BILLING_LABEL[s], s).toBeTruthy();
  });

  it('모르는 값은 null', () => {
    for (const v of ['invoiced', '', null, 7]) expect(toBillingStatus(v), String(v)).toBeNull();
    expect(toBillingStatus('partial')).toBe('partial');
  });

  it('무효 표시한 줄은 살아 있지 않다', () => {
    expect(isLivePurchase(P())).toBe(true);
    expect(isLivePurchase(P({ voided_at: 'x' }))).toBe(false);
  });
});

// ══════════════════════ 계산상의 금액 ══════════════════════
describe('계산상의 청구 금액 — 힌트일 뿐 강제하지 않는다', () => {
  it('1200 인원·개월 × 연 120 = 12,000', () => {
    expect(expectedAmount(P())).toBe(12000);
  });

  it('40 인원·개월 × 연 120 = 400', () => {
    expect(expectedAmount(P({ seat_months: 40 }))).toBe(400);
  });

  it('단가나 수량을 모르면 null (0 이 아니다)', () => {
    expect(expectedAmount(P({ unit_price_per_seat_year: null }))).toBeNull();
    expect(expectedAmount(P({ seat_months: null }))).toBeNull();
  });

  it('무상 배정(단가 0)은 0 이다 — "모름"과 다르다', () => {
    expect(expectedAmount(P({ unit_price_per_seat_year: 0 }))).toBe(0);
  });

  it('실제 금액이 계산값과 다르면 알려 준다 (할인·절삭)', () => {
    expect(amountDiffers(P())).toBe(false);
    expect(amountDiffers(P({ amount: 11000 }))).toBe(true);
    expect(amountDiffers(P({ amount: 12000.5 }))).toBe(false);   // 1 이내는 반올림 차이
  });

  it('셀 수 없으면 판단하지 않는다', () => {
    expect(amountDiffers(P({ amount: null }))).toBeNull();
    expect(amountDiffers(P({ unit_price_per_seat_year: null }))).toBeNull();
  });
});

// ══════════════════════ 모를는 금액은 0 이 아니다 ══════════════════════
//
// 처음에 `Number(v)` 를 그대로 쓰고 `Number.isFinite` 만 봤다.
// `Number(null)` 은 **0** 이므로 금여가 비어 있는 줄이 **0 원 진짜**로 보여
// 미수금이 사라졌다. 돈에서는 이 상처가 제일 나빠다.
describe('모를는 금액을 0 으로 치지 않는다', () => {
  const blanks = [null, undefined, '', true, false, [], {}, 'abc', NaN];

  it('금여가 비면 청구도 미수도 **null** 이다', () => {
    for (const v of blanks) {
      const m = moneyOf(P({ amount: v as never }));
      expect(m.billed, String(v)).toBeNull();
      expect(m.outstanding, String(v)).toBeNull();
    }
  });

  it('단가가 비면 계산값도 null 이다 (0 원으로 계산하지 않는다)', () => {
    for (const v of blanks) {
      expect(expectedAmount(P({ unit_price_per_seat_year: v as never })), String(v)).toBeNull();
    }
  });

  it('입금이 비어 있으면 0 이 맞다 (안 들어왔다 = 0)', () => {
    expect(moneyOf(P({ paid_amount: null })).paid).toBe(0);
  });

  it('**금여 모를는 줄은 미수금 합계에서 제외되고 세어진다**', () => {
    const t = totalsByCurrency([P({ amount: 12000 }), P({ amount: null })]);
    expect(t[0].outstanding).toBe(12000);   // 0 원을 더하지 않았다
    expect(t[0].unknownAmounts).toBe(1);    // 모른다는 사실은 남았다
  });

  it('0 은 진짜 0 이다 (무상 배정 — "모름"과 구분한다)', () => {
    expect(moneyOf(P({ amount: 0 })).billed).toBe(0);
    expect(expectedAmount(P({ unit_price_per_seat_year: 0 }))).toBe(0);
  });

  it('모를는 을 0 으로 치면 **미수금이 사라진다**는 것을 설명에 남겼다', () => {
    const s = read('src/lib/partnerLedger.ts');
    expect(s).toContain('Number(null)');
    expect(s).toContain('미수금이 사라진다');
  });
});

// ══════════════════════ 금액에서 읽는 상태 ══════════════════════
describe('돈은 금액이 사실이다 — 이름표를 믿지 않는다', () => {
  it('청구만 했으면 미수액이 전액이다', () => {
    const m = moneyOf(P());
    expect(m).toMatchObject({ billed: 12000, paid: 0, outstanding: 12000, overpaid: 0, derived: 'billed' });
  });

  it('일부 입금', () => {
    const m = moneyOf(P({ paid_amount: 5000, paid_on: '2026-10-20' }));
    expect(m.outstanding).toBe(7000);
    expect(m.derived).toBe('partial');
  });

  it('다 받았으면 미수액 0', () => {
    const m = moneyOf(P({ paid_amount: 12000, paid_on: '2026-10-20' }));
    expect(m.outstanding).toBe(0);
    expect(m.derived).toBe('paid');
  });

  it('**초과 입금을 음수로 숨기지 않고 따로 보여 준다**', () => {
    const m = moneyOf(P({ paid_amount: 13000, paid_on: '2026-10-20' }));
    expect(m.outstanding).toBe(-1000);
    expect(m.overpaid).toBe(1000);
    expect(m.derived).toBe('paid');
  });

  it('청구 전은 미수금이 아니다 (아직 달라고 하지 않았다)', () => {
    const m = moneyOf(P({ billing_status: 'unbilled', invoiced_on: null, invoice_no: null }));
    expect(m.derived).toBe('unbilled');
  });

  it('무상 배정(금액 0)은 받을 것이 없다', () => {
    const m = moneyOf(P({ amount: 0, unit_price_per_seat_year: 0 }));
    expect(m.outstanding).toBe(0);
    expect(m.derived).toBe('paid');
  });

  it('**청구 금액이 비어 있으면 null — 0 원 청구가 아니다**', () => {
    const m = moneyOf(P({ amount: null }));
    expect(m.billed).toBeNull();
    expect(m.outstanding).toBeNull();
  });
});

describe('청구했는지 판정', () => {
  it('청구일이 있으면 청구한 것', () => {
    expect(isInvoiced(P({ billing_status: 'unbilled', invoice_no: null }))).toBe(true);
  });

  it('청구서 번호만 있어도 청구한 것', () => {
    expect(isInvoiced(P({ invoiced_on: null, billing_status: 'unbilled' }))).toBe(true);
  });

  it('상태만 있어도 청구한 것으로 본다', () => {
    expect(isInvoiced({ billing_status: 'partial' })).toBe(true);
    expect(isInvoiced({ billing_status: 'unbilled' })).toBe(false);
    expect(isInvoiced({})).toBe(false);
  });
});

describe('이름표와 금액이 어긋나면 알린다', () => {
  it('맞으면 조용하다', () => {
    expect(statusDisagrees(P())).toBe(false);
  });

  it("'paid' 라고 적혔는데 입금이 없으면 어긋난 것", () => {
    expect(statusDisagrees(P({ billing_status: 'paid' }))).toBe(true);
  });

  it("'billed' 라고 적혔는데 다 받았으면 어긋난 것", () => {
    expect(statusDisagrees(P({ paid_amount: 12000, paid_on: '2026-10-20' }))).toBe(true);
  });

  it('모르는 이름표도 어긋난 것으로 본다', () => {
    expect(statusDisagrees(P({ billing_status: 'invoiced' }))).toBe(true);
  });
});

// ══════════════════════ 미수 경과일 ══════════════════════
describe('미수 경과일 — **청구일 기준** 30일·60일 (James 확정 Q3)', () => {
  it('기준이 30·60 이다', () => {
    expect(RECEIVABLE_D30).toBe(30);
    expect(RECEIVABLE_D60).toBe(60);
  });

  it('기준을 글로 적어 두었다 (왜 청구일인지, 왜 기한 칸이 없는지)', () => {
    expect(RECEIVABLE_BASIS).toContain('청구일');
    expect(RECEIVABLE_BASIS).toContain('추측하지 않습니다');
    expect(STAGE_LABEL.d60).toContain('파트너');
  });

  it('청구일부터 센다', () => {
    expect(receivableDays(P({ invoiced_on: '2026-10-03' }), T)).toBe(45);
  });

  it('30일·60일 경계 (경계는 ≥ 이다)', () => {
    const at = (d: string) => receivableStage(P({ invoiced_on: d }), T);
    expect(at('2026-10-18')).toBe('d30');   // 30일 — 딱 닿으면 알린다
    expect(at('2026-10-19')).toBe('none');  // 29일 — 아직
    expect(at('2026-09-18')).toBe('d60');   // 60일
    expect(at('2026-09-19')).toBe('d30');   // 59일 — 60 은 아니지만 30 은 넘었다
  });

  it('**29일은 아직 알리지 않는다** (처음에 이 테스트를 설명과 거꾸로 줬다)', () => {
    expect(receivableDays(P({ invoiced_on: '2026-10-19' }), T)).toBe(29);
    expect(receivableStage(P({ invoiced_on: '2026-10-19' }), T)).toBe('none');
  });

  it('**다 받은 줄은 미수금이 아니다**', () => {
    expect(receivableDays(P({ paid_amount: 12000, paid_on: '2026-10-10' }), T)).toBeNull();
    expect(receivableStage(P({ paid_amount: 12000, paid_on: '2026-10-10' }), T)).toBe('none');
  });

  it('일부만 받았으면 여전히 미수금이다', () => {
    expect(receivableStage(P({ paid_amount: 5000, paid_on: '2026-10-10' }), T)).toBe('d30');
  });

  it('**청구 전은 세지 않는다**', () => {
    expect(receivableDays(
      P({ billing_status: 'unbilled', invoiced_on: null, invoice_no: null }), T)).toBeNull();
  });

  // `receivableDays` 에서 "unbilled 면 null" 을 따로 거를 필요가 없는 이유는
  // **청구일이 있으면 unbilled 일 수 없기 때문**이다. 그 부분을 직접 잡는 변이가
  // 없어서(재현 불가), 그 자리 대신 **불변식**을 고정한다.
  it('청구일이 있으면 unbilled 일 수 없다 (불변식)', () => {
    for (const label of ['unbilled', 'billed', 'partial', null]) {
      const m = moneyOf(P({ invoiced_on: '2026-10-03', billing_status: label as never, invoice_no: null }));
      expect(m.derived, String(label)).not.toBe('unbilled');
    }
    // 반대로 청구 흔적이 하나도 없으면 반드시 unbilled 다
    expect(moneyOf({ amount: 100, invoiced_on: null, invoice_no: null, billing_status: 'unbilled' })
      .derived).toBe('unbilled');
  });

  it('**청구일이 비어 있으면 세지 않는다** (추측해서 알리면 안 된다)', () => {
    expect(receivableDays(P({ invoiced_on: null }), T)).toBeNull();
    expect(receivableStage(P({ invoiced_on: null }), T)).toBe('none');
  });

  it('무효 표시한 줄은 세지 않는다', () => {
    expect(receivableDays(P({ voided_at: 'x', void_reason: '잘못 적음' }), T)).toBeNull();
  });

  it('청구 금액을 모르면 세지 않는다', () => {
    expect(receivableDays(P({ amount: null }), T)).toBeNull();
  });

  it('미래 청구일(입력 오류)은 세지 않는다', () => {
    expect(receivableDays(P({ invoiced_on: '2026-12-01' }), T)).toBeNull();
  });

  it('날짜가 망가져 있으면 세지 않는다', () => {
    for (const v of ['어제', '2026-13-45', '', null]) {
      expect(receivableDays(P({ invoiced_on: v as never }), T), String(v)).toBeNull();
    }
  });
});

// ══════════════════════ 통화별 합계 ══════════════════════
describe('통화별 합계 — **섞어 더하지 않는다**', () => {
  it('통화마다 따로 센다', () => {
    const t = totalsByCurrency([
      P({ currency: 'USD', amount: 12000 }),
      P({ currency: 'USD', amount: 3000, paid_amount: 3000, paid_on: '2026-11-01' }),
      P({ currency: 'KRW', amount: 5000000 }),
    ]);
    expect(t).toHaveLength(2);
    const usd = t.find(x => x.currency === 'USD')!;
    expect(usd.billed).toBe(15000);
    expect(usd.paid).toBe(3000);
    expect(usd.outstanding).toBe(12000);
    const krw = t.find(x => x.currency === 'KRW')!;
    expect(krw.outstanding).toBe(5000000);
  });

  it('**환산하지 않는다** — 통화 수만큼 줄이 나온다', () => {
    const t = totalsByCurrency([
      P({ currency: 'USD' }), P({ currency: 'EUR' }), P({ currency: 'JPY' }),
    ]);
    expect(t.map(x => x.currency).sort()).toEqual(['EUR', 'JPY', 'USD']);
  });

  it('통화 이름을 대문자로 모은다', () => {
    const t = totalsByCurrency([P({ currency: 'usd' }), P({ currency: ' USD ' })]);
    expect(t).toHaveLength(1);
    expect(t[0].currency).toBe('USD');
    expect(t[0].lines).toBe(2);
  });

  it('통화가 비면 **(미지정)으로 따로** 모은다 (다른 통화와 섞지 않는다)', () => {
    expect(currencyOf(P({ currency: null }))).toBe(NO_CURRENCY);
    const t = totalsByCurrency([P({ currency: 'USD' }), P({ currency: '' })]);
    expect(t).toHaveLength(2);
    expect(t.some(x => x.currency === NO_CURRENCY)).toBe(true);
  });

  it('무효 표시한 줄은 합계에서 뺀다', () => {
    const t = totalsByCurrency([
      P({ amount: 12000 }),
      P({ amount: 9000, voided_at: 'x', void_reason: '잘못 적음' }),
    ]);
    expect(t[0].billed).toBe(12000);
    expect(t[0].lines).toBe(1);
  });

  it('**청구 금액을 모르는 줄은 0 으로 치지 않고 따로 센다**', () => {
    const t = totalsByCurrency([P({ amount: 12000 }), P({ amount: null })]);
    expect(t[0].billed).toBe(12000);
    expect(t[0].unknownAmounts).toBe(1);
  });

  it('청구 전은 미수액에 넣지 않는다', () => {
    const t = totalsByCurrency([
      P({ amount: 12000, billing_status: 'unbilled', invoiced_on: null, invoice_no: null }),
    ]);
    expect(t[0].billed).toBe(12000);
    expect(t[0].outstanding).toBe(0);
  });

  it('초과 입금을 따로 센다', () => {
    const t = totalsByCurrency([P({ amount: 1000, paid_amount: 1500, paid_on: '2026-11-01' })]);
    expect(t[0].overpaid).toBe(500);
    expect(t[0].outstanding).toBe(0);
  });

  it('미수액이 큰 통화부터 나온다', () => {
    const t = totalsByCurrency([
      P({ currency: 'KRW', amount: 100 }), P({ currency: 'USD', amount: 99999 }),
    ]);
    expect(t[0].currency).toBe('USD');
  });

  it('빈 목록은 빈 배열', () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});

// ══════════════════════ 계약 한 줄 요약 ══════════════════════
describe('계약 한 줄 요약 — S7-2b 화면이 그대로 쓴다', () => {
  const C = { id: 'c1' };

  it('잔량은 partnerContract 의 계산을 **그대로** 쓴다', () => {
    const purchases = [P({ seat_months: 1200 }), P({ seat_months: 600 })];
    const issues = [{ seat_months: 480 }, { seat_months: 60, revoked_at: 'x' }];
    const s = contractSummary(C, purchases, issues, T);
    const direct = balanceOf(purchases, issues);
    expect(s.purchased).toBe(direct.purchased);
    expect(s.issued).toBe(direct.issued);
    expect(s.balance).toBe(direct.balance);
    expect(s.balance).toBe(1800 - 540);
  });

  it('**무효화한 이용권도 발급으로 센다** (S7-1 규칙 그대로)', () => {
    const s = contractSummary(C, [P({ seat_months: 1000 })],
      [{ seat_months: 400, revoked_at: '2026-11-01' }], T);
    expect(s.issued).toBe(400);
    expect(s.balance).toBe(600);
  });

  it('무효 표시한 구매는 빼고 센다', () => {
    const s = contractSummary(C,
      [P({ seat_months: 1000 }), P({ seat_months: 500, voided_at: 'x', void_reason: '오타' })],
      [], T);
    expect(s.purchased).toBe(1000);
    expect(s.purchaseLines).toBe(1);
  });

  it('가장 오래된 미수 경과일과 가장 심한 단계', () => {
    const s = contractSummary(C, [
      P({ invoiced_on: '2026-11-10' }),          // 7일
      P({ invoiced_on: '2026-10-03' }),          // 45일
      P({ invoiced_on: '2026-09-01' }),          // 77일
    ], [], T);
    expect(s.oldestReceivableDays).toBe(77);
    expect(s.worstStage).toBe('d60');
  });

  // ⚠️ 위 테스트는 심한 줄이 **마지막**에 있어서, "가장 심한 것" 대신
  //    "마지막 것"을 쓰는 상처를 잡지 못한다(변이 시험에서 드러났다).
  //    심한 줄을 **앞에** 두어 순서에 혐씨이지 않게 한다.
  it('심한 줄이 앞에 있어도 가장 심한 것을 고른다 (순서 무상관)', () => {
    const d60 = P({ id: 'a', invoiced_on: '2026-09-01' });                       // 77일
    const paid = P({ id: 'b', paid_amount: 12000, paid_on: '2026-11-01' });       // 미수 없음
    const d30 = P({ id: 'c', invoiced_on: '2026-10-10' });                       // 38일

    for (const order of [[d60, paid, d30], [d30, paid, d60], [paid, d30, d60], [d60, d30, paid]]) {
      const s = contractSummary(C, order, [], T);
      expect(s.worstStage, order.map(x => x.id).join('>')).toBe('d60');
      expect(s.oldestReceivableDays, order.map(x => x.id).join('>')).toBe(77);
    }
  });

  it('d30 만 있으면 d30 이고, 그 뒤에 미수 없는 줄이 와도 내려가지 않는다', () => {
    const s = contractSummary(C, [
      P({ invoiced_on: '2026-10-10' }),                                // 38일 → d30
      P({ paid_amount: 12000, paid_on: '2026-11-01' }),                // 미수 없음
    ], [], T);
    expect(s.worstStage).toBe('d30');
  });

  it('미수금이 없으면 null·none', () => {
    const s = contractSummary(C,
      [P({ paid_amount: 12000, paid_on: '2026-10-10' })], [], T);
    expect(s.oldestReceivableDays).toBeNull();
    expect(s.worstStage).toBe('none');
  });

  it('30일만 넘었으면 d30 이다', () => {
    const s = contractSummary(C, [P({ invoiced_on: '2026-10-10' })], [], T);  // 38일
    expect(s.worstStage).toBe('d30');
  });

  it('어긋난 줄 수를 센다', () => {
    const s = contractSummary(C,
      [P(), P({ billing_status: 'paid' }), P({ billing_status: 'invoiced' })], [], T);
    expect(s.disagreeingLines).toBe(2);
  });

  it('수량을 셀 수 없는 발급을 따로 센다 (잔량을 믿지 말라는 표시)', () => {
    const s = contractSummary(C, [P()], [{ user_count: null, duration: null }], T);
    expect(s.unknownIssues).toBe(1);
  });

  it('통화별 돈이 요약에 들어 있다', () => {
    const s = contractSummary(C, [P({ currency: 'USD' }), P({ currency: 'KRW' })], [], T);
    expect(s.money).toHaveLength(2);
  });

  it('빈 계약도 터지지 않는다', () => {
    const s = contractSummary(C, [], [], T);
    expect(s).toMatchObject({ purchased: 0, issued: 0, balance: 0, worstStage: 'none' });
    expect(s.oldestReceivableDays).toBeNull();
  });

  it('구매 합계 함수를 **다시 만들지 않고 재사용**한다', () => {
    expect(purchasedSeatMonths([{ seat_months: 100 }, { seat_months: 50 }])).toBe(150);
    const src = read('src/lib/partnerLedger.ts');
    expect(src).toContain("from './partnerContract'");
    expect(src).toContain('balanceOf(live, issues)');
    // 잔량을 여기서 다시 세지 않는다
    expect(src).not.toMatch(/purchased\s*-\s*issued/);
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('마이그레이션 — 추가만, 파트너 쓰기 금지', () => {
  const A = sqlCode(read('supabase/migrations/20261130000000_lead_s7_2a_partner_purchases.sql'));
  const B = sqlCode(read('supabase/migrations/20261130000100_lead_s7_2a_license_seat_months.sql'));

  it('구매 원장 표를 만든다', () => {
    expect(A).toContain('create table if not exists public.partner_purchases');
  });

  it('**기존 데이터를 바꾸지 않는다**', () => {
    for (const sql of [A, B]) {
      expect(sql).not.toMatch(/drop\s+table/i);
      expect(sql).not.toMatch(/\b(delete\s+from|truncate)\b/i);
      expect(sql).not.toMatch(/update\s+public\./i);
      expect(sql).not.toMatch(/drop\s+column/i);
      expect(sql).not.toMatch(/insert\s+into/i);
    }
  });

  it('**partner_id 칸을 두지 않는다** (계약이 파트너를 정한다 — 어긋남이 생길 수 없다)', () => {
    const cols = A.slice(A.indexOf('create table'), A.indexOf(');'));
    expect(cols).not.toMatch(/^\s*partner_id\b/m);
    expect(cols).toContain('contract_id   uuid not null references public.partner_contracts(id) on delete restrict');
  });

  it('`seat_months` 는 NULL 허용이고 기본값이 없다 (테이블 재작성 없음)', () => {
    const add = (B.match(/add column[^;]*;/i) ?? [''])[0];
    expect(add).toContain('seat_months bigint');
    expect(add).not.toMatch(/not null/i);
    expect(add).not.toMatch(/default/i);
  });

  it('**백필하지 않는다** (발급 2건을 어떻게 셀지는 화면 단계에서 정한다)', () => {
    expect(B).not.toMatch(/\b(update|insert)\b/i);
    expect(read('supabase/migrations/20261130000100_lead_s7_2a_license_seat_months.sql'))
      .toContain('백필하지 않는다');
  });

  it('값의 범위를 CHECK 로 좁힌다', () => {
    expect(A).toMatch(/check \(billing_status in \('unbilled', 'billed', 'partial', 'paid'\)\)/);
    expect(A).toContain('seat_months > 0');
    expect(A).toContain('check (paid_on is null or paid_amount is not null)');
  });

  // 처음에는 "seat_months > 0 이 있다"만 봤다. 그러면 **단가·금액·입금의
  // 어느 줄을 지워도 잡히지 않는다**(변이 시험에서 새는 것을 발견).
  // 돈은 넣는 것마다 새지 않았는지 **낱낱이** 본다.
  it('**음수 금액을 막는 줄이 하나도 빠지지 않는다**', () => {
    // ⚠️ `indexOf` 는 앞에 있는 `drop constraint …;` 줄을 잡는다.
    //    지정해야 하는 것은 `add constraint … check (…)` 쪽이다.
    const at = A.indexOf('add constraint partner_purchases_amount_check');
    expect(at, 'amount check 를 찾지 못했다').toBeGreaterThan(-1);
    const body = A.slice(at, A.indexOf(';', at));
    for (const col of ['unit_price_per_seat_year', 'amount', 'paid_amount']) {
      expect(body, col).toContain(`${col} is null or ${col} >= 0`);
    }
    expect(body).toContain('seat_months > 0');
  });

  it('무효는 **시각과 사유가 같이** 있어야 한다 (양방향)', () => {
    const v = A.slice(A.indexOf('partner_purchases_void_check'));
    expect(v).toContain("voided_at is null     and coalesce(trim(void_reason), '') =  ''");
    expect(v).toContain("voided_at is not null and coalesce(trim(void_reason), '') <> ''");
  });

  it('새 외래키는 on delete restrict', () => {
    const refs = A.match(/references[^,\n]*/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r, r).toContain('on delete restrict');
  });

  it('**잔량·미수액 칸을 만들지 않는다** (저장하지 않고 센다)', () => {
    expect(A).not.toMatch(/balance_seat_months|outstanding|receivable_days/i);
  });

  it('여러 번 돌려도 같다', () => {
    expect(A.match(/create table(?! if not exists)/gi) ?? []).toHaveLength(0);
    expect(A.match(/create index(?! if not exists)/gi) ?? []).toHaveLength(0);
    expect(B.match(/add column(?! if not exists)/gi) ?? []).toHaveLength(0);
  });

  // ── 정책: S7-1 fix1 과 같은 4개 구조 ──
  describe('정책 — 파트너는 읽기만', () => {
    const ADMIN = /\(select up\.role from public\.user_profiles up where up\.id = auth\.uid\(\)\) = any \(array\['admin','sub_admin'\]\)/;
    const policy = (name: string) => {
      const m = A.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
      return m ? m[0] : '';
    };
    const clause = (pol: string, kw: 'using' | 'with check') => {
      const m = pol.match(new RegExp(`${kw} \\(([\\s\\S]*?)\\)\\s*(?:with check|;)`));
      return m ? m[1].trim() : '';
    };

    it('RLS 가 켜져 있다', () => {
      expect(A).toContain('alter table public.partner_purchases enable row level security');
    });

    it('**FOR ALL 정책이 없다**', () => {
      expect(A).not.toMatch(/create policy[^;]*\bfor all\b/i);
    });

    it('읽기는 **계약을 타고** 자기 것만 (또는 admin)', () => {
      const pol = policy('partner_purchases_select');
      expect(pol).toMatch(/for select/);
      expect(pol).toContain('from public.partner_contracts c');
      expect(pol).toContain('c.id = partner_purchases.contract_id');
      expect(pol).toContain('c.partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())');
      expect(pol).toMatch(ADMIN);
      expect(clause(pol, 'using')).not.toMatch(/^true$/);
    });

    it('**쓰기는 admin 전용 — 자기 partner 조건이 섞이지 않는다**', () => {
      for (const name of ['partner_purchases_admin_insert', 'partner_purchases_admin_update']) {
        const pol = policy(name);
        expect(pol, name).toBeTruthy();
        expect(pol, name).not.toContain('up.partner_id');
        expect(pol, name).not.toContain('partner_contracts');
        expect(pol, name).toMatch(ADMIN);
      }
    });

    it('update 는 using·with check 둘 다 admin', () => {
      const upd = policy('partner_purchases_admin_update');
      expect(clause(upd, 'using'), 'using').toMatch(ADMIN);
      expect(clause(upd, 'with check'), 'with check').toMatch(ADMIN);
    });

    it('삭제 불가 + anon·public REVOKE + DELETE 권한 없음', () => {
      expect(A).toMatch(/as restrictive for delete to authenticated using \( false \)/);
      expect(A).toContain('revoke all on public.partner_purchases from anon');
      expect(A).toContain('revoke all on public.partner_purchases from public');
      expect(A).toMatch(/grant select, insert, update on public\.partner_purchases to authenticated/);
      expect(A).not.toMatch(/grant[^;]*\bdelete\b[^;]*partner_purchases/i);
    });
  });
});

// ══════════════════════ 드라이런·롤백 ══════════════════════
describe('드라이런 — SQL 편집기에서 한 번에 돌아간다', () => {
  const D = read('../audit/dryrun_lead_s7_2a_ledger.sql');

  it('**psql 전용 명령을 쓰지 않는다** (S7-1 드라이런의 잘못)', () => {
    expect(D).not.toMatch(/^\\\w/m);        // \i, \echo 등
    expect(D).not.toContain('\\i ');
  });

  it('마이그레이션 본문이 **직접 들어 있다**', () => {
    expect(D).toContain('create table if not exists public.partner_purchases');
    expect(D).toContain('add column if not exists seat_months bigint');
    expect(D).toContain('create policy "partner_purchases_admin_update"');
  });

  it('아무것도 남기지 않는다', () => {
    expect(sqlCode(D)).toMatch(/^\s*begin;/m);
    expect(sqlCode(D).trimEnd().endsWith('rollback;')).toBe(true);
    expect(sqlCode(D)).not.toMatch(/^\s*commit\s*;/mi);
  });

  it('**사전 집계가 새 칸을 참조하지 않는다** (S7-1 드라이런의 잘못)', () => {
    const before = D.slice(D.indexOf('create temp table _before'), D.indexOf('마이그레이션 (a)'));
    expect(before).not.toContain('seat_months');
    expect(before).not.toContain('partner_purchases');
    expect(before).not.toContain('billing_status');
  });

  it('잘못된 값을 실제로 찔러 본다', () => {
    for (const probe of ['수량 0', '수량 음수', '금액 음수', '입금액 음수',
                         '입금일만 있고 입금액 없음', '모르는 청구 상태',
                         '무효인데 사유 없음', '사유만 있고 무효 시각 없음']) {
      expect(D, probe).toContain(probe);
    }
  });

  it('없는 계약·다른 파트너 계약을 다룬다', () => {
    expect(D).toContain('없는 계약에 구매 붙이기');
    expect(D).toContain('다른 파트너 계약에 붙이기');
    expect(D).toContain('다른 파트너 계약에 INSERT');
  });

  it('**파트너 쓰기 거부를 건수로** 본다', () => {
    for (const probe of ['자기 구매 SELECT', '다른 파트너 구매 SELECT',
                         '자기 구매 UPDATE(입금 처리)', '자기 계약에 구매 INSERT',
                         '자기 구매 DELETE']) {
      expect(D, probe).toContain(probe);
    }
    expect(D).toContain('건수로');
    expect(D).toContain('set local role authenticated');
    expect(D).toContain('reset role');
  });

  it('기존 건수 보존을 숫자로 확인한다', () => {
    expect(D).toContain('기대 2');      // partner_licenses
    expect(D).toContain('기대 117');    // partner_deals
    expect(D).toContain('기대 15');     // partners
    expect(D).toContain('기대 0 — 백필 안 함');
  });

  it('정책·권한·RLS·FOR ALL 없음을 확인한다', () => {
    expect(D).toContain('FOR ALL 정책 (없어야)');
    expect(D).toContain('anon·public 권한');
    expect(D).toContain('RLS 켜짐');
  });
});

describe('롤백 — 건수를 먼저 보게 한다', () => {
  const R = read('../audit/rollback_lead_s7_2a_ledger.sql');

  it('DROP 은 주석이다', () => {
    expect(R).toMatch(/먼저 보세요/);
    expect(sqlCode(R)).not.toMatch(/^\s*drop (table|column)/mi);
    expect(R).toContain('-- drop table if exists public.partner_purchases;');
    expect(R).toContain('-- alter table public.partner_licenses drop column if exists seat_months;');
  });

  it('새 정책 이름 네 개를 모두 안다', () => {
    for (const n of ['partner_purchases_select', 'partner_purchases_admin_insert',
                     'partner_purchases_admin_update', 'partner_purchases_no_delete']) {
      expect(R, n).toContain(n);
    }
  });

  it('**통화를 섞어 더하지 않는다** (조회에서도)', () => {
    expect(R).toContain('group by 1');
    expect(R).toContain('환산하지 않습니다');
  });
});

// ══════════════════════ 보안 ══════════════════════
describe('보안', () => {
  it('순수 로직은 DB 를 부르지 않는다', () => {
    const s = read('src/lib/partnerLedger.ts');
    expect(s).not.toContain('rest/v1');
    expect(s).not.toMatch(/\bfetch\(/);
    expect(s).not.toContain('supabase');
  });

  it('키·개인정보를 담지 않는다', () => {
    for (const f of ['src/lib/partnerLedger.ts',
                     'supabase/migrations/20261130000000_lead_s7_2a_partner_purchases.sql']) {
      const s = read(f);
      expect(s, f).not.toMatch(/eyJ[A-Za-z0-9]|service_role|SUPABASE_/);
      expect(s, f).not.toMatch(/@[a-z0-9-]+\.(com|net|org|sg)/i);
    }
  });

  it('S7-1 드라이런의 결함을 기록으로 남겼다', () => {
    const old = read('../audit/dryrun_lead_s7_1_contracts.sql');
    expect(old).toContain('돌아가지 않았고');
    expect(old).toContain('dryrun_lead_s7_2a_ledger.sql');
  });
});
