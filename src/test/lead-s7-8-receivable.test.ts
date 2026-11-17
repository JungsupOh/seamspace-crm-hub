// LEAD-S7-8 — 미수금 알림과 도매 정산 현황
//
//   ① **파트너 메일은 기본 꺼짐** — 꺼져 있으면 외부 발송 0건
//   ② 단계 경계 29/30/59/60
//   ③ **같은 알림을 두 번 보내지 않는다**
//   ④ 우리 알림에 **개인정보가 없다**
//   ⑤ 서버 거울이 `partnerLedger` 와 **같은 답**을 준다
//   ⑥ 정산 현황이 `partnerLedger` 를 재사용한다(셈을 두 벌로 만들지 않는다)

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  D30, D60, PARTNER_MAIL_FLAG, alertKey, alertRow, callerAllowed, internalText,
  outbound, partnerMail, partnerMailEnabled, planAlerts, recipientsFor, sentKeys,
  stageOf, toSend, type Candidate,
} from '../../supabase/functions/partner-receivable-alert/logic';
import * as mirror from '../../supabase/functions/_shared/receivable';
import {
  RECEIVABLE_D30, RECEIVABLE_D60, receivableDays, receivableStage,
  type PurchaseLine,
} from '../lib/partnerLedger';
import {
  alertLabel, isWholesaleLive, needsAttention, settlementOf, settlementTotals,
  sortBySeverity, stageTone, type AlertHistoryRow, type SettlementRow,
} from '../lib/partnerSettlement';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sqlOf = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const MIG = read('supabase/migrations/20261206000000_lead_s7_8_receivable_alerts.sql');
const DRY = read('../audit/dryrun_lead_s7_8_receivable_alerts.sql');
const FN  = read('supabase/functions/partner-receivable-alert/index.ts');
/** 주석을 뺀 **코드만** — 설명에 쓴 낱말이 시험을 깨뜨리면 안 된다 */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const FN_CODE = codeOnly(FN);
const UI  = read('src/components/partners/SettlementStatus.tsx');

const TODAY = '2026-11-18';

function cand(o: Partial<Candidate> = {}): Candidate {
  return {
    purchaseId: 'pu1', contractId: 'c1', partnerId: 'p1', partnerName: 'Eduvision',
    contactEmail: 'ops@eduvision.example', locale: 'en',
    daysElapsed: 35, outstanding: 1200, currency: 'USD', ...o,
  };
}

// ══════════════════ ① 기본 꺼짐 ══════════════════
describe('**파트너 메일은 기본 꺼짐**', () => {
  it("정확히 'true' 일 때만 켜진다", () => {
    expect(partnerMailEnabled('true')).toBe(true);
    for (const v of [undefined, null, '', 'false', 'TRUE', 'True', '1', 'yes', 'on']) {
      expect(partnerMailEnabled(v), String(v)).toBe(false);
    }
  });

  it('**꺼져 있으면 외부 발송이 0건**', () => {
    const plans = planAlerts([cand({ daysElapsed: 70 })], new Set(), false);
    expect(outbound(plans)).toEqual([]);
    expect(plans.find(p => p.sentTo === 'partner')?.skip).toBe('mail_disabled');
    // 우리에게는 간다
    expect(toSend(plans).map(p => p.sentTo)).toEqual(['internal']);
  });

  it('켜면 60일 건이 나간다', () => {
    const plans = planAlerts([cand({ daysElapsed: 70 })], new Set(), true);
    expect(outbound(plans).length).toBe(1);
  });

  it('**담당자 이메일이 없으면 켜도 안 나간다**', () => {
    const plans = planAlerts([cand({ daysElapsed: 70, contactEmail: null })], new Set(), true);
    expect(outbound(plans)).toEqual([]);
    expect(plans.find(p => p.sentTo === 'partner')?.skip).toBe('no_contact_email');
  });

  it('**기록이 엇갈리면 파트너에게 보내지 않는다** (우리에게는 알린다)', () => {
    const plans = planAlerts(
      [cand({ daysElapsed: 70, labelDisagrees: true })], new Set(), true);
    expect(outbound(plans)).toEqual([]);
    expect(plans.find(p => p.sentTo === 'partner')?.skip).toBe('label_disagrees');
    // 우리에게는 간다 — 먼저 기록을 맞추라는 신호다
    expect(toSend(plans).map(p => p.sentTo)).toEqual(['internal']);
  });

  it('**돈이 진실이다** — 이름표가 paid 여도 입금이 0이면 미수다', () => {
    const row = { id: 'x', contract_id: 'c1', invoiced_on: '2026-09-01', amount: 1000,
                  paid_amount: 0, billing_status: 'paid' };
    expect(mirror.isPaid(row)).toBe(false);
    expect(mirror.outstandingOf(row)).toBe(1000);
    expect(mirror.labelDisagrees(row)).toBe(true);
    // 그래도 **파트너에게는 안 간다**
    const c = mirror.candidatesFrom({
      purchases: [row],
      contracts: [{ id: 'c1', partner_id: 'p1', settlement_method: 'wholesale' }],
      partners: [{ id: 'p1', name: 'X', contact_email: 'a@b.c', locale: 'en' }],
      today: TODAY });
    expect(c[0].labelDisagrees).toBe(true);
    expect(outbound(planAlerts(c, new Set(), true))).toEqual([]);
  });

  it('일부 입금은 **남은 만큼만** 미수다', () => {
    const row = { id: 'x', invoiced_on: '2026-09-01', amount: 1000,
                  paid_amount: 400, billing_status: 'partial' };
    expect(mirror.outstandingOf(row)).toBe(600);
    expect(mirror.labelDisagrees(row)).toBe(false);
  });

  it('30일 건은 켜져 있어도 파트너에게 안 간다', () => {
    const plans = planAlerts([cand({ daysElapsed: 35 })], new Set(), true);
    expect(outbound(plans)).toEqual([]);
    expect(plans.map(p => p.sentTo)).toEqual(['internal']);
  });

  it('함수가 환경값 이름을 그대로 쓴다', () => {
    expect(PARTNER_MAIL_FLAG).toBe('PARTNER_RECEIVABLE_MAIL_ENABLED');
    expect(FN).toContain('partnerMailEnabled(Deno.env.get(PARTNER_MAIL_FLAG))');
  });
});

// ══════════════════ ② 경계 ══════════════════
describe('단계 경계 — 29 / 30 / 59 / 60', () => {
  it('경계값', () => {
    expect(stageOf(29)).toBeNull();
    expect(stageOf(30)).toBe('d30');
    expect(stageOf(59)).toBe('d30');
    expect(stageOf(60)).toBe('d60');
    expect(stageOf(365)).toBe('d60');
    expect(stageOf(0)).toBeNull();
  });

  it('**셀 수 없으면 알리지 않는다**', () => {
    for (const v of [null, NaN, Infinity]) {
      expect(stageOf(v as number), String(v)).toBeNull();
    }
  });

  it('`partnerLedger` 와 같은 숫자', () => {
    expect(D30).toBe(RECEIVABLE_D30);
    expect(D60).toBe(RECEIVABLE_D60);
    expect(mirror.D30).toBe(RECEIVABLE_D30);
    expect(mirror.D60).toBe(RECEIVABLE_D60);
  });

  it('60일이면 **우리에게도 다시** 간다', () => {
    expect(recipientsFor('d30')).toEqual(['internal']);
    expect(recipientsFor('d60')).toEqual(['internal', 'partner']);
  });
});

// ══════════════════ ③ 중복 방지 ══════════════════
describe('**같은 알림을 두 번 보내지 않는다**', () => {
  it('이미 보낸 것은 건너뛴다', () => {
    const already = sentKeys([{ purchase_id: 'pu1', stage: 'd30', sent_to: 'internal' }]);
    const plans = planAlerts([cand()], already, false);
    expect(toSend(plans)).toEqual([]);
    expect(plans[0].skip).toBe('already_sent');
  });

  it('단계가 올라가면 다시 보낸다', () => {
    const already = sentKeys([{ purchase_id: 'pu1', stage: 'd30', sent_to: 'internal' }]);
    const plans = planAlerts([cand({ daysElapsed: 70 })], already, false);
    expect(toSend(plans).map(p => p.stage)).toEqual(['d60']);
  });

  it('**무효 처리한 기록은 보낸 것으로 치지 않는다**', () => {
    const already = sentKeys([
      { purchase_id: 'pu1', stage: 'd30', sent_to: 'internal', voided_at: '2026-11-01' },
    ]);
    expect(already.size).toBe(0);
    expect(toSend(planAlerts([cand()], already, false)).length).toBe(1);
  });

  it('열쇠는 구매·단계·상대 셋', () => {
    expect(alertKey('a', 'd30', 'internal')).toBe('a|d30|internal');
    expect(alertKey('a', 'd30', 'internal')).not.toBe(alertKey('a', 'd30', 'partner'));
    expect(alertKey('a', 'd30', 'internal')).not.toBe(alertKey('a', 'd60', 'internal'));
  });

  it('**DB 도 막는다** (유일 인덱스)', () => {
    const c = sqlOf(MIG);
    expect(c).toMatch(/create unique index if not exists uniq_receivable_alert_once/);
    expect(c).toMatch(/\(purchase_id, stage, sent_to\)/);
    expect(c).toMatch(/where voided_at is null/);
  });
});

// ══════════════════ ④ 우리 알림 ══════════════════
describe('우리에게 가는 알림 — **개인정보 없이**', () => {
  const plans = planAlerts([
    cand({ purchaseId: 'a', daysElapsed: 35, outstanding: 1000, currency: 'USD' }),
    cand({ purchaseId: 'b', daysElapsed: 70, outstanding: 500, currency: 'USD' }),
    cand({ purchaseId: 'c', partnerId: 'p2', partnerName: 'Nihon', daysElapsed: 40,
           outstanding: 90000, currency: 'JPY', contactEmail: 'x@y.jp' }),
  ], new Set(), false);

  it('파트너 이름·통화별 합계·경과일뿐', () => {
    const t = internalText(plans);
    expect(t).toContain('Eduvision');
    expect(t).toContain('USD 1,500');     // 같은 통화끼리만 더한다
    expect(t).toContain('최장 70일');
    expect(t).toContain('60일 1건');
    expect(t).toContain('Nihon');
    expect(t).toContain('JPY 90,000');
  });

  it('**이메일·구매 id 가 없다**', () => {
    const t = internalText(plans);
    expect(t).not.toContain('@');
    expect(t).not.toContain('pu1');
    expect(t).not.toContain('eduvision.example');
  });

  it('**통화를 섞지 않는다**', () => {
    const t = internalText(plans);
    expect(t).not.toMatch(/1,?590|91,?500/);   // USD + JPY 를 더한 수
  });

  it('꺼져 있으면 그렇다고 말한다', () => {
    expect(internalText(plans)).toContain('파트너 발송은 꺼져 있습니다');
    const on = planAlerts([cand({ daysElapsed: 70 })], new Set(), true);
    expect(internalText(on)).toContain('파트너 담당자에게도 1건 발송');
  });

  it('보낼 것이 없으면 **빈 글** — 빈 알림을 보내지 않는다', () => {
    expect(internalText([])).toBe('');
    const allSent = planAlerts([cand()],
      sentKeys([{ purchase_id: 'pu1', stage: 'd30', sent_to: 'internal' }]), false);
    expect(internalText(allSent)).toBe('');
  });
});

describe('파트너 메일 — **독촉이 아니라 확인 요청**', () => {
  const p = planAlerts([cand({ daysElapsed: 70 })], new Set(), true)
    .find(x => x.sentTo === 'partner')!;

  it('세 언어', () => {
    for (const l of ['ko', 'ja', 'en']) {
      const m = partnerMail(p, l);
      expect(m.subject, l).toBeTruthy();
      expect(m.body, l).toBeTruthy();
      expect(m.subject, l).toContain('USD 1,200');
      if (l !== 'ko') expect(m.body, l).not.toMatch(/[가-힣]/);
    }
  });

  it('**우리 기록이 틀렸을 수도 있다**고 적는다', () => {
    expect(partnerMail(p, 'ko').body).toContain('저희 기록이 틀렸을 수도 있습니다');
    expect(partnerMail(p, 'en').body).toContain('our records are out of date');
  });

  it('문의처가 언어에 맞다 (국내 sales / 해외 contact)', () => {
    expect(partnerMail(p, 'ko').body).toContain('sales@tebahsoft.com');
    expect(partnerMail(p, 'en').body).toContain('contact@tebahsoft.com');
    expect(partnerMail(p, 'ja').body).toContain('contact@tebahsoft.com');
  });

  it('경과일을 적는다', () => {
    expect(partnerMail(p, 'en').body).toContain('70 days');
  });
});

describe('기록할 행', () => {
  it('사실을 그대로 남긴다 — **개인정보는 없다**', () => {
    const p = planAlerts([cand()], new Set(), false)[0];
    const r = alertRow(p, true);
    expect(r).toMatchObject({
      purchase_id: 'pu1', contract_id: 'c1', partner_id: 'p1',
      stage: 'd30', sent_to: 'internal',
      days_elapsed: 35, outstanding: 1200, currency: 'USD', delivered: true,
    });
    expect(JSON.stringify(r)).not.toContain('@');
    expect(JSON.stringify(r)).not.toContain('Eduvision');
  });

  it('**실패해도 기록은 남는다**', () => {
    const p = planAlerts([cand()], new Set(), false)[0];
    expect(alertRow(p, false, 'send-email 500'))
      .toMatchObject({ delivered: false, note: 'send-email 500' });
    expect(FN).toContain('// **실패해도 기록은 남긴다** — 실패도 사실이다.');
  });
});

// ══════════════════ 호출자 ══════════════════
describe('**사람이 부르는 함수가 아니다**', () => {
  const base = { serviceRoleKey: 'SRK', internalSecret: 'SEC' };

  it('service_role 키로 부를 수 있다', () => {
    expect(callerAllowed({ ...base, authHeader: 'Bearer SRK', internalHeader: null })).toBe(true);
  });

  it('내부 비밀값으로도 부를 수 있다', () => {
    expect(callerAllowed({ ...base, authHeader: null, internalHeader: 'SEC' })).toBe(true);
  });

  it('**둘 다 없으면 거절**', () => {
    expect(callerAllowed({ ...base, authHeader: 'Bearer anon-key', internalHeader: null })).toBe(false);
    expect(callerAllowed({ ...base, authHeader: null, internalHeader: 'wrong' })).toBe(false);
    expect(callerAllowed({ ...base, authHeader: null, internalHeader: null })).toBe(false);
  });

  it('**비밀값이 비어 있으면 빈 헤더로 뚫리지 않는다**', () => {
    expect(callerAllowed({ serviceRoleKey: '', internalSecret: '',
                           authHeader: 'Bearer ', internalHeader: '' })).toBe(false);
    expect(callerAllowed({ serviceRoleKey: '', internalSecret: '',
                           authHeader: null, internalHeader: null })).toBe(false);
  });

  it('함수가 맨 앞에서 본다', () => {
    expect(FN).toContain('if (!callerAllowed({');
    expect(FN).toContain("return json({ error: 'Forbidden' }, 403)");
  });
});

// ══════════════════ ⑤ 거울 ══════════════════
describe('서버 거울이 `partnerLedger` 와 **같은 답**', () => {
  const rows: PurchaseLine[] = [
    { invoiced_on: '2026-10-01', amount: 1000, currency: 'USD', billing_status: 'billed' },
    { invoiced_on: '2026-11-17', amount: 500, currency: 'USD', billing_status: 'billed' },
    // **이름표가 아니라 돈이 진실** — 'paid' 로 적혀 있어도 입금이 0이면 미수다
    { invoiced_on: '2026-10-01', amount: 1000, currency: 'USD', billing_status: 'paid' },
    { invoiced_on: '2026-10-01', amount: 1000, paid_amount: 1000, currency: 'USD',
      billing_status: 'paid' },
    { invoiced_on: '2026-10-01', amount: 1000, paid_amount: 400, currency: 'USD',
      billing_status: 'partial' },
    { invoiced_on: null, amount: 1000, currency: 'USD', billing_status: 'billed' },
    { invoiced_on: '2026-10-01', amount: null, currency: 'USD', billing_status: 'billed' },
    { invoiced_on: '2027-01-01', amount: 100, currency: 'USD', billing_status: 'billed' },
    { invoiced_on: '2026-10-01', amount: 100, currency: 'USD', billing_status: 'billed',
      voided_at: '2026-10-05' },
  ] as never;

  it('경과일이 같다', () => {
    rows.forEach((r, i) => {
      expect(mirror.daysElapsed(r as never, TODAY), `행 ${i}`)
        .toBe(receivableDays(r, TODAY));
    });
  });

  it('단계가 같다', () => {
    rows.forEach((r, i) => {
      const mine = stageOf(mirror.daysElapsed(r as never, TODAY)) ?? 'none';
      expect(mine, `행 ${i}`).toBe(receivableStage(r, TODAY));
    });
  });

  it('**빈 금액은 0원이 아니라 모름**', () => {
    expect(mirror.num(null)).toBeNull();
    expect(mirror.num('')).toBeNull();
    expect(mirror.num(true)).toBeNull();
    expect(mirror.num('abc')).toBeNull();
    expect(mirror.num(0)).toBe(0);
    expect(mirror.outstandingOf({ id: 'x', invoiced_on: '2026-10-01',
      amount: null, billing_status: 'billed' })).toBeNull();
  });

  it('**추정하지 않는다** — 수량×단가로 금액을 지어내지 않는다', () => {
    const r = { id: 'x', invoiced_on: '2026-10-01', amount: null,
                seat_months: 1200, unit_price_per_seat_year: 12, billing_status: 'billed' };
    expect(mirror.outstandingOf(r)).toBeNull();
    const c = mirror.candidatesFrom({
      purchases: [r], contracts: [{ id: 'c1', partner_id: 'p1',
        settlement_method: 'wholesale' }], partners: [], today: TODAY });
    expect(c).toEqual([]);
  });
});

describe('후보 추리기', () => {
  const contracts = [
    { id: 'c1', partner_id: 'p1', settlement_method: 'wholesale' },
    { id: 'c2', partner_id: 'p2', settlement_method: 'commission' },
    { id: 'c3', partner_id: 'p3', settlement_method: 'wholesale', voided_at: '2026-01-01' },
  ];
  const partners = [{ id: 'p1', name: 'Eduvision', contact_email: 'a@b.c', locale: 'en' }];
  const mk = (id: string, cid: string, days: number) => ({
    id, contract_id: cid, invoiced_on: '2026-09-01', amount: 100,
    currency: 'USD', billing_status: 'billed',
  });

  it('**도매형만** — 커미션형은 우리가 받을 돈이 아니다', () => {
    const out = mirror.candidatesFrom({
      purchases: [mk('a', 'c1', 78), mk('b', 'c2', 78)],
      contracts, partners, today: TODAY });
    expect(out.map(c => c.purchaseId)).toEqual(['a']);
  });

  it('무효 계약은 뺀다', () => {
    const out = mirror.candidatesFrom({
      purchases: [mk('a', 'c3', 78)], contracts, partners, today: TODAY });
    expect(out).toEqual([]);
  });

  it('**30일 전에는 후보가 아니다**', () => {
    const out = mirror.candidatesFrom({
      purchases: [{ ...mk('a', 'c1', 0), invoiced_on: '2026-11-01' }],  // 17일
      contracts, partners, today: TODAY });
    expect(out).toEqual([]);
  });

  it('파트너 정보를 붙인다 (없어도 터지지 않는다)', () => {
    const out = mirror.candidatesFrom({
      purchases: [mk('a', 'c1', 78)], contracts, partners, today: TODAY });
    expect(out[0]).toMatchObject({ partnerName: 'Eduvision', contactEmail: 'a@b.c', locale: 'en' });
    const none = mirror.candidatesFrom({
      purchases: [mk('a', 'c1', 78)], contracts, partners: [], today: TODAY });
    expect(none[0]).toMatchObject({ partnerName: '', contactEmail: null, locale: 'en' });
  });

  it('통화가 없으면 따로 모은다', () => {
    const out = mirror.candidatesFrom({
      purchases: [{ ...mk('a', 'c1', 78), currency: null }],
      contracts, partners, today: TODAY });
    expect(out[0].currency).toBe(mirror.NO_CURRENCY);
  });
});

// ══════════════════ ⑥ 정산 현황 ══════════════════
describe('도매 정산 현황', () => {
  const C = { id: 'c1', partner_id: 'p1', settlement_method: 'wholesale' };
  const P = [
    { id: 'pu1', invoiced_on: '2026-09-01', amount: 1000, currency: 'USD', billing_status: 'billed' },
    { id: 'pu2', invoiced_on: '2026-11-01', amount: 500, currency: 'USD', billing_status: 'billed' },
    { id: 'pu3', invoiced_on: '2026-08-01', amount: 300, paid_amount: 300,
      currency: 'USD', billing_status: 'paid' },
  ] as never as (PurchaseLine & { id: string })[];
  const A: AlertHistoryRow[] = [
    { id: 'a1', purchase_id: 'pu1', partner_id: 'p1', stage: 'd60', sent_to: 'internal',
      days_elapsed: 78, outstanding: 1000, currency: 'USD',
      sent_at: '2026-11-10T00:00:00Z', delivered: true, voided_at: null },
    { id: 'a2', purchase_id: 'pu1', partner_id: 'p1', stage: 'd30', sent_to: 'internal',
      days_elapsed: 31, outstanding: 1000, currency: 'USD',
      sent_at: '2026-10-02T00:00:00Z', delivered: true, voided_at: null },
    { id: 'a3', purchase_id: 'other', partner_id: 'p9', stage: 'd30', sent_to: 'internal',
      days_elapsed: 31, outstanding: 1, currency: 'USD',
      sent_at: '2026-11-11T00:00:00Z', delivered: true, voided_at: null },
  ];

  it('도매·살아 있는 계약만', () => {
    expect(isWholesaleLive(C)).toBe(true);
    expect(isWholesaleLive({ ...C, settlement_method: 'commission' })).toBe(false);
    expect(isWholesaleLive({ ...C, voided_at: '2026-01-01' })).toBe(false);
  });

  it('요약', () => {
    const r = settlementOf(C, P, A, 'Eduvision', TODAY);
    expect(r.worstStage).toBe('d60');
    expect(r.oldestDays).toBe(78);
    expect(r.openLines).toBe(2);
    expect(r.purchaseLines).toBe(3);
    expect(r.alerts.map(a => a.id)).toEqual(['a1', 'a2']);   // 최근순, 남의 것 제외
    expect(r.lastAlertAt).toBe('2026-11-10T00:00:00Z');
  });

  it('**무효 처리한 알림은 이력에서 뺀다**', () => {
    const r = settlementOf(C, P, A.map(a => ({ ...a, voided_at: '2026-11-12' })),
                           'Eduvision', TODAY);
    expect(r.alerts).toEqual([]);
    expect(r.lastAlertAt).toBeNull();
  });

  it('**셈을 다시 하지 않는다** — partnerLedger 를 쓴다', () => {
    const lib = read('src/lib/partnerSettlement.ts');
    expect(lib).toContain("from '@/lib/partnerLedger'");
    // 날짜 산술이 없다
    expect(lib).not.toMatch(/86400000|Date\.parse|24 \* 60/);
  });

  it('걱정되는 것부터', () => {
    const mk = (id: string, s: 'none' | 'd30' | 'd60', d: number | null): SettlementRow => ({
      contractId: id, partnerId: 'p', partnerName: id, money: [],
      oldestDays: d, worstStage: s, openLines: 1, purchaseLines: 1,
      alerts: [], lastAlertAt: null,
    });
    const sorted = sortBySeverity([mk('a', 'none', null), mk('b', 'd30', 40),
                                   mk('c', 'd60', 70), mk('d', 'd60', 90)]);
    expect(sorted.map(r => r.contractId)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('합계가 **통화를 섞지 않는다**', () => {
    const rows: SettlementRow[] = [
      { contractId: 'a', partnerId: 'p', partnerName: 'A',
        money: [{ currency: 'USD', billed: 1000, paid: 0, outstanding: 1000, lines: 1 }] as never,
        oldestDays: 70, worstStage: 'd60', openLines: 1, purchaseLines: 1,
        alerts: [], lastAlertAt: null },
      { contractId: 'b', partnerId: 'q', partnerName: 'B',
        money: [{ currency: 'JPY', billed: 90000, paid: 0, outstanding: 90000, lines: 1 }] as never,
        oldestDays: 35, worstStage: 'd30', openLines: 1, purchaseLines: 1,
        alerts: [{ id: 'x' } as never], lastAlertAt: 'x' },
    ];
    const t = settlementTotals(rows);
    expect(t.outstanding).toEqual([
      { currency: 'JPY', amount: 90000 }, { currency: 'USD', amount: 1000 }]);
    expect(t).toMatchObject({ contracts: 2, d30: 1, d60: 1, alerted: 1, neverAlerted: 1 });
  });

  it('**알림이 안 간 건**을 집어낸다 — 이게 이 화면의 쓸모다', () => {
    const rows: SettlementRow[] = [
      { contractId: 'a', partnerId: 'p', partnerName: 'A', money: [], oldestDays: 70,
        worstStage: 'd60', openLines: 1, purchaseLines: 1, alerts: [], lastAlertAt: null },
      { contractId: 'b', partnerId: 'q', partnerName: 'B', money: [], oldestDays: 35,
        worstStage: 'd30', openLines: 1, purchaseLines: 1,
        alerts: [{ id: 'x' } as never], lastAlertAt: 'x' },
      { contractId: 'c', partnerId: 'r', partnerName: 'C', money: [], oldestDays: null,
        worstStage: 'none', openLines: 0, purchaseLines: 1, alerts: [], lastAlertAt: null },
    ];
    expect(needsAttention(rows).map(r => r.contractId)).toEqual(['a']);
  });

  it('색', () => {
    expect(stageTone('d60')).toBe('bad');
    expect(stageTone('d30')).toBe('warn');
    expect(stageTone('none')).toBe('none');
  });

  it('알림 한 줄', () => {
    expect(alertLabel(A[0])).toBe('2026-11-10 · 60일 · 우리');
    expect(alertLabel({ ...A[0], sent_to: 'partner', delivered: false }))
      .toBe('2026-11-10 · 60일 · 파트너 담당자 (실패)');
  });

  it('화면에 산술이 없다', () => {
    expect(UI).not.toMatch(/86400000|Date\.parse|invoiced_on.*-/);
    expect(UI).toContain("from '@/lib/partnerSettlement'");
  });

  it('**알림 표가 없어도 화면이 뜬다** (마이그레이션 전)', () => {
    expect(UI).toContain('alerts: a.ok ? await a.json() : []');
  });
});

// ══════════════════ 마이그레이션 ══════════════════
describe('알림 기록 표', () => {
  it('**먼저 거두고** 필요한 것만 준다 (S7-5 fix1 교훈)', () => {
    const c = sqlOf(MIG);
    expect(c).toContain('revoke all on public.partner_receivable_alerts from anon');
    expect(c).toContain('revoke all on public.partner_receivable_alerts from public');
    expect(c).toContain('revoke all on public.partner_receivable_alerts from authenticated');
    expect(c).toMatch(/grant select, update on public\.partner_receivable_alerts to authenticated/);
    // 거두기가 주기보다 **먼저** 나온다
    expect(c.indexOf('revoke all on public.partner_receivable_alerts from authenticated'))
      .toBeLessThan(c.indexOf('grant select, update'));
  });

  it('**INSERT 정책이 없다**', () => {
    expect(sqlOf(MIG)).not.toMatch(/create policy[^;]*for insert/i);
  });

  it('**아무도 지우지 못한다**', () => {
    expect(sqlOf(MIG)).toMatch(/as restrictive for delete to public\s*\n?\s*using \( false \)/);
  });

  it('**파트너에게 보이지 않는다** — admin 만', () => {
    const p = (MIG.match(/create policy "partner_receivable_alerts_select"[\s\S]*?;/) ?? [''])[0];
    expect(p).toContain('app_is_admin()');
    expect(p).not.toContain('partner_id');
  });

  it('고칠 수 있는 것은 무효 처리뿐(admin)', () => {
    const p = (MIG.match(/create policy "partner_receivable_alerts_void"[\s\S]*?;/) ?? [''])[0];
    expect(p).toMatch(/for update to authenticated/);
    expect(p).toContain('using ( public.app_is_admin() )');
    expect(p).toContain('with check ( public.app_is_admin() )');
  });

  it('외래키는 전부 restrict', () => {
    const c = sqlOf(MIG);
    expect((c.match(/on delete restrict/g) ?? []).length).toBe(3);
    expect(c).not.toMatch(/on delete cascade/);
  });

  it('단계·상대를 CHECK 로 좁힌다', () => {
    const c = sqlOf(MIG);
    expect(c).toMatch(/check \(stage in \('d30', 'd60'\)\)/);
    expect(c).toMatch(/check \(sent_to in \('internal', 'partner'\)\)/);
  });

  it('무효 칸이 있다 (지우는 대신 표시)', () => {
    const c = sqlOf(MIG);
    expect(c).toContain('voided_at   timestamptz');
    expect(c).toContain('void_reason text');
  });
});

describe('드라이런 — 실제 역할 전환', () => {
  it('psql 전용 없이 한 파일', () => {
    expect(DRY).not.toMatch(/^\\\w/m);
    expect(sqlOf(DRY).trimEnd().endsWith('rollback;')).toBe(true);
  });

  it('세 역할로 바꿔 본다', () => {
    expect((DRY.match(/set local role authenticated/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('요구한 확인이 다 있다', () => {
    for (const probe of ['① authenticated INSERT (없어야)', '① authenticated DELETE (없어야)',
                         '② 같은 구매·단계·상대 두 번째', '② 같은 구매, 다른 단계',
                         '② 같은 단계, 다른 상대', '③ 무효 처리 뒤 같은 알림',
                         '④ 파트너: 알림 이력', '④ admin: 무효 처리(UPDATE)',
                         '⑤ admin: DELETE', '④ 파트너: INSERT']) {
      expect(DRY, probe).toContain(probe);
    }
  });

  it('마이그레이션 본문이 들어 있다', () => {
    expect(DRY).toContain('create table if not exists public.partner_receivable_alerts');
    expect(DRY).toContain('uniq_receivable_alert_once');
  });
});

// ══════════════════ 범위 ══════════════════
describe('범위', () => {
  it('**cron 을 붙이지 않았다**', () => {
    expect(FN_CODE).not.toMatch(/cron|pg_cron|schedule/i);
    expect(sqlOf(MIG)).not.toMatch(/cron/i);
  });

  it('시크릿을 설정하지 않는다 — 읽기만', () => {
    expect(FN).not.toMatch(/env\.set|secrets set/);
    expect((FN.match(/Deno\.env\.get/g) ?? []).length).toBeGreaterThan(0);
  });

  it('키·개인정보를 로그에 남기지 않는다', () => {
    for (const m of FN.match(/console\.(log|warn|error)\([^)]*\)/g) ?? []) {
      expect(m, m).not.toMatch(/email|name|SERVICE_ROLE|SECRET|token/i);
    }
  });

  it('돌려만 보는 모드가 있다 (처음 켤 때)', () => {
    expect(FN).toContain('const dryRun = body.dryRun === true');
    expect(FN).toContain('if (dryRun) {');
  });
});
