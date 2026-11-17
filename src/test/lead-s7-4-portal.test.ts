// LEAD-S7-4 — 포털 확장: 계약 구역 · 계약 선택 · 요청
//
// 지켜야 하는 약속
//   ① 계약이 없으면 **지금 화면 그대로**(구역이 통째로 안 보인다).
//   ② 계산은 순수 함수 하나에서 나온다 — 화면이 다시 세지 않는다.
//   ③ 셀 수 없으면 **숫자를 지어내지 않는다**(— 로 보여 준다).
//   ④ 계약 선택: 0개면 기존, 1개면 고정, 2개 이상이면 **고르게 한다**.
//   ⑤ 요청은 **본문의 partner_id 를 믿지 않는다**(서버가 호출자에서 정한다).
//   ⑥ 무효화는 **요청까지만** — "껐다"고 오해하지 않게 문구가 말한다.
//   ⑦ 보안은 **드라이런이 실제 역할 전환으로** 증명한다(구문 시험이 아니다).

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildViews, moneyText, qty, type LicenseLike,
} from '../components/partner-portal/PortalContracts';
import { contractChoice, contractLabel, issuableContracts } from '../lib/portalIssueContract';
import {
  ISSUE_BLOCK_MSG, PORTAL_MSG, isIssueBlockCode, issueBlockMessage,
} from '../lib/partnerPortalMsg';
import { makeT, type Msg } from '../lib/partner-i18n';
import type { PortalContract } from '../lib/partnerPortalContracts';
import {
  RATE_LIMIT_PER_MINUTE, canRequest, errorMessage, okMessage, parseRequest,
  pickLocale, telegramText, toKind,
} from '../../supabase/functions/partner-request/logic';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const sql = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const MIG = read('supabase/migrations/20261202000000_lead_s7_4_partner_requests.sql');
const DRY = read('../audit/dryrun_lead_s7_4_requests.sql');
const FN  = read('supabase/functions/partner-request/index.ts');
const T = '2026-11-17';

// `as never` 로 두면 `list.map(c => c.id)` 에서 타입이 never 가 된다 → 실제 타입으로 캐스팅.
const C = (o: Record<string, unknown> = {}): PortalContract => ({
  id: 'c1', partner_id: 'p1', settlement_method: 'wholesale',
  starts_on: '2026-01-01', ends_on: null, renews_on: null,
  contracted_seat_months: 1200, unit_price_per_seat_year: 120, currency: 'USD',
  is_grant: false, status: 'active', voided_at: null, ...o,
}) as unknown as PortalContract;

const P = (o: Record<string, unknown> = {}) => ({
  id: 'pu1', contract_id: 'c1', purchased_on: '2026-09-01', seat_months: 1200,
  currency: 'USD', amount: 12000, billing_status: 'billed', invoiced_on: '2026-09-02',
  paid_on: null, paid_amount: null, voided_at: null, ...o,
}) as never;

// ══════════════════════ 계약 구역 ══════════════════════
describe('내 계약 구역 — 도매형만, 계산은 한 곳에서', () => {
  it('**계약이 없으면 보여 줄 것이 없다** (기존 화면 그대로)', () => {
    expect(buildViews([], [], [], [])).toEqual([]);
  });

  it('**커미션형은 이 구역에 나오지 않는다**', () => {
    expect(buildViews([C({ settlement_method: 'commission' })], [], [], [])).toEqual([]);
  });

  it('무효·취소된 계약도 나오지 않는다', () => {
    expect(buildViews([C({ voided_at: 'x' })], [], [], [])).toEqual([]);
    expect(buildViews([C({ status: 'cancelled' })], [], [], [])).toEqual([]);
  });

  it('구매 − 발급 = 잔량 (서버·관리자 화면과 같은 계산)', () => {
    const v = buildViews([C()], [P({ seat_months: 1200 })], [
      { contract_id: 'c1', seat_months: 480, status: 'issued' },
      { contract_id: 'c1', seat_months: 120, status: 'revoked' },  // 무효화도 센다
    ], [])[0];
    expect(v.purchased).toBe(1200);
    expect(v.issued).toBe(600);
    expect(v.balance).toBe(600);
  });

  it('**다른 계약의 발급은 섞이지 않는다**', () => {
    const v = buildViews([C()], [P()], [
      { contract_id: 'c1', seat_months: 100, status: 'issued' },
      { contract_id: 'c-other', seat_months: 900, status: 'issued' },
    ], [])[0];
    expect(v.issued).toBe(100);
  });

  it('**계약 전 발급(NULL)은 어느 잔량에도 넣지 않는다**', () => {
    const v = buildViews([C()], [P()], [
      { contract_id: null, seat_months: 900, status: 'issued' },
    ], [])[0];
    expect(v.issued).toBe(0);
    expect(v.balance).toBe(1200);
  });

  it('무효 구매는 빼고 센다', () => {
    const v = buildViews([C()],
      [P({ seat_months: 1000 }), P({ id: 'pu2', seat_months: 500, voided_at: 'x' })], [], [])[0];
    expect(v.purchased).toBe(1000);
  });

  it('**다른 계약의 구매도 섞이지 않는다** (변이 시험에서 샜다)', () => {
    const v = buildViews([C()], [
      P({ seat_months: 1000 }),
      P({ id: 'pu2', contract_id: 'c-other', seat_months: 9000 }),
    ], [], [])[0];
    expect(v.purchased).toBe(1000);
    expect(v.purchases).toHaveLength(1);
  });

  it('계약이 둘이면 각자의 구매·발급만 센다', () => {
    const vs = buildViews(
      [C(), C({ id: 'c2' })],
      [P({ seat_months: 100 }), P({ id: 'pu2', contract_id: 'c2', seat_months: 500 })],
      [{ contract_id: 'c2', seat_months: 50, status: 'issued' }],
      []);
    expect(vs.map(v => [v.contract.id, v.purchased, v.issued, v.balance]))
      .toEqual([['c1', 100, 0, 100], ['c2', 500, 50, 450]]);
  });

  it('**셀 수 없는 발급이 있으면 알려 준다**', () => {
    const v = buildViews([C()], [P()], [
      { contract_id: 'c1', seat_months: null, user_count: null, duration: null, status: 'issued' },
    ], [])[0];
    expect(v.unknownIssues).toBe(1);
  });

  it('열린 추가 구매 요청을 찾아 준다 (또 보내지 않게)', () => {
    const v = buildViews([C()], [], [], [
      { id: 'r1', kind: 'purchase', contract_id: 'c1', license_id: null,
        seat_months: null, status: 'open', requested_at: T, handled_at: null },
    ])[0];
    expect(v.openRequest?.id).toBe('r1');
  });

  it('처리된 요청은 "열린 요청"이 아니다', () => {
    const v = buildViews([C()], [], [], [
      { id: 'r1', kind: 'purchase', contract_id: 'c1', license_id: null,
        seat_months: null, status: 'handled', requested_at: T, handled_at: T },
    ])[0];
    expect(v.openRequest).toBeNull();
  });
});

describe('숫자를 지어내지 않는다', () => {
  it('모르는 수량은 — 다 (0 이 아니다)', () => {
    for (const v of [null, undefined, NaN, 'abc']) {
      expect(qty(v, '인원·개월'), String(v)).toBe('—');
    }
    expect(qty(0, '인원·개월')).toBe('0 인원·개월');
  });

  it('모르는 금액도 — 다', () => {
    for (const v of [null, undefined, '', 'abc']) {
      expect(moneyText(v, 'USD'), String(v)).toBe('—');
    }
    expect(moneyText(0, 'USD')).toBe('0 USD');
    expect(moneyText(12000, 'usd')).toBe('12,000 USD');
    expect(moneyText(12000, null)).toBe('12,000');
  });
});

// ══════════════════════ 계약 선택 ══════════════════════
describe('계약 선택 — 서버 규칙과 같아야 한다', () => {
  it('**0개면 기존 동작** (고르게 하지 않고 null 을 보낸다)', () => {
    const r = contractChoice([], null, T);
    expect(r.mode).toBe('none');
    expect(r.contractId).toBeNull();
    expect(r.needsPick).toBe(false);
  });

  it('**1개면 고정** (보여 주되 바꿀 수 없다)', () => {
    const r = contractChoice([C()], null, T);
    expect(r.mode).toBe('fixed');
    expect(r.contractId).toBe('c1');
    expect(r.needsPick).toBe(false);
  });

  it('**2개 이상이면 고르게 한다**', () => {
    const r = contractChoice([C(), C({ id: 'c2' })], null, T);
    expect(r.mode).toBe('pick');
    expect(r.contractId).toBeNull();
    expect(r.needsPick).toBe(true);
    expect(r.options).toHaveLength(2);
  });

  it('골랐으면 그것을 보낸다', () => {
    const r = contractChoice([C(), C({ id: 'c2' })], 'c2', T);
    expect(r.contractId).toBe('c2');
    expect(r.needsPick).toBe(false);
  });

  it('**없는 것을 골라 두면 다시 고르게 한다**', () => {
    const r = contractChoice([C(), C({ id: 'c2' })], 'c-gone', T);
    expect(r.contractId).toBeNull();
    expect(r.needsPick).toBe(true);
  });

  it('쓸 수 없는 계약은 후보에서 뺀다', () => {
    const list = [
      C({ id: 'ok' }),
      C({ id: 'commission', settlement_method: 'commission' }),
      C({ id: 'draft', status: 'draft' }),
      C({ id: 'ended', ends_on: '2026-11-16' }),
      C({ id: 'voided', voided_at: 'x' }),
    ];
    expect(issuableContracts(list, T).map(c => c.id)).toEqual(['ok']);
  });

  it('마지막 날은 아직 쓸 수 있다', () => {
    expect(issuableContracts([C({ ends_on: '2026-11-17' })], T)).toHaveLength(1);
  });

  it('고른 계약을 사람이 알아볼 수 있게 적는다', () => {
    expect(contractLabel(C() as never)).toContain('2026-01-01');
  });
});

// ══════════════════════ 거절 코드 문구 ══════════════════════
describe('서버 거절 코드 → 파트너 말 (세 언어)', () => {
  const codes = Object.keys(ISSUE_BLOCK_MSG) as Array<keyof typeof ISSUE_BLOCK_MSG>;

  it('**모든 코드에 ko·ja·en 이 다 있다** (번역 빠짐)', () => {
    for (const c of codes) {
      const m = ISSUE_BLOCK_MSG[c] as Msg;
      expect(m.ko, `${c}.ko`).toBeTruthy();
      expect(m.ja, `${c}.ja`).toBeTruthy();
      expect(m.en, `${c}.en`).toBeTruthy();
      expect(m.en, `${c}.en`).not.toMatch(/[가-힣]/);
      expect(m.ja, `${c}.ja`).not.toMatch(/[가-힣]/);
    }
  });

  it('잔량 부족은 **추가 구매를 안내한다**', () => {
    for (const l of ['ko', 'ja', 'en'] as const) {
      const m = makeT(l)(ISSUE_BLOCK_MSG.INSUFFICIENT_BALANCE);
      expect(m, l).toBeTruthy();
    }
    expect(makeT('ko')(ISSUE_BLOCK_MSG.INSUFFICIENT_BALANCE)).toContain('추가 구매');
    expect(makeT('en')(ISSUE_BLOCK_MSG.INSUFFICIENT_BALANCE)).toContain('additional purchase');
  });

  it('아는 코드면 **여기 문구**를 쓴다 (서버 글 대신)', () => {
    const t = makeT('ja');
    expect(issueBlockMessage('INSUFFICIENT_BALANCE', 'server text', t))
      .toBe(t(ISSUE_BLOCK_MSG.INSUFFICIENT_BALANCE));
  });

  it('**모르는 코드면 서버가 준 글을 그대로** 쓴다 (빈 말을 하지 않는다)', () => {
    expect(issueBlockMessage('SOMETHING_NEW', '서버가 준 설명', makeT('ko')))
      .toBe('서버가 준 설명');
  });

  it('코드도 글도 없으면 담백한 기본 문구', () => {
    expect(issueBlockMessage(null, null, makeT('en'))).toContain('could not issue');
  });

  it('코드 판정', () => {
    expect(isIssueBlockCode('UNKNOWN_HISTORY')).toBe(true);
    expect(isIssueBlockCode('nope')).toBe(false);
  });

  it('포털 문구에도 번역이 다 있다', () => {
    for (const [k, m] of Object.entries(PORTAL_MSG)) {
      expect((m as Msg).ko, `${k}.ko`).toBeTruthy();
      expect((m as Msg).ja, `${k}.ja`).toBeTruthy();
      expect((m as Msg).en, `${k}.en`).toBeTruthy();
      expect((m as Msg).en, `${k}.en`).not.toMatch(/[가-힣]/);
    }
  });

  it('**무효화 요청 문구가 "즉시 꺼지지 않는다"를 말한다** (가장 중요)', () => {
    expect(PORTAL_MSG.requestRevokeHint.ko).toContain('즉시 꺼지지는 않습니다');
    expect(PORTAL_MSG.requestRevokeHint.en).toContain('does not stop working right away');
    expect(PORTAL_MSG.requestRevokeHint.ja).toContain('すぐに無効になるわけではありません');
  });

  it('잔량을 셀 수 없을 때 **숫자를 지어내지 않는다고** 말한다', () => {
    expect(PORTAL_MSG.balanceUnknown.ko).toContain('셀 수 없습니다');
    expect(PORTAL_MSG.balanceUnknown.en).toContain('cannot calculate');
  });

  it('미입금이어도 발급된다는 것을 알려 준다', () => {
    expect(PORTAL_MSG.unpaidOk.ko).toContain('입금 전이어도');
  });
});

// ══════════════════════ 요청 함수(순수) ══════════════════════
describe('요청 다듬기 — **본문의 partner_id 를 읽지 않는다**', () => {
  it('partnerId 를 보내도 무시한다', () => {
    const r = parseRequest({ kind: 'purchase', contractId: 'c1', partnerId: 'someone-else' });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain('someone-else');
  });

  it('로직 파일이 partner_id 를 본문에서 꺼내지 않는다', () => {
    const s = code(read('supabase/functions/partner-request/logic.ts'));
    expect(s).not.toMatch(/b\.partnerId|body\.partnerId|partner_id/);
  });

  it('**함수도 본문의 partnerId 를 쓰지 않는다** (프로필에서 정한다)', () => {
    const c = code(FN);
    expect(c).not.toMatch(/body\.partnerId|\.partnerId\b/);
    expect(FN).toContain('profile?.partner_id');
  });

  it('종류가 없거나 모르면 거부', () => {
    expect(parseRequest({})).toMatchObject({ ok: false, error: 'BAD_KIND' });
    expect(parseRequest({ kind: 'gift' })).toMatchObject({ ok: false, error: 'BAD_KIND' });
    expect(toKind('revoke')).toBe('revoke');
    expect(toKind('x')).toBeNull();
  });

  it('대상이 없으면 거부', () => {
    expect(parseRequest({ kind: 'purchase' })).toMatchObject({ ok: false, error: 'TARGET_REQUIRED' });
    expect(parseRequest({ kind: 'revoke' })).toMatchObject({ ok: false, error: 'TARGET_REQUIRED' });
  });

  it('**종류에 맞는 대상만 들고 간다** (반대쪽은 버린다)', () => {
    const r = parseRequest({ kind: 'purchase', contractId: 'c1', licenseId: 'l1' });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.value.contractId).toBe('c1');
      expect(r.value.licenseId).toBeNull();
    }
  });

  it('**무효화 요청에 계약 id 가 섞여 들어가지 않는다** (변이 시험에서 샜다)', () => {
    const r = parseRequest({ kind: 'revoke', licenseId: 'l1', contractId: 'c1' });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.value.licenseId).toBe('l1');
      expect(r.value.contractId, '무효화에 계약이 붙으면 CHECK 가 막지만 애초에 보내지 않는다')
        .toBeNull();
    }
  });

  it('희망 수량은 비울 수 있고, 0·소수·글자는 거부', () => {
    const okEmpty = parseRequest({ kind: 'purchase', contractId: 'c1' });
    expect(okEmpty.ok && okEmpty.value.seatMonths).toBeNull();
    for (const v of [0, -1, 1.5, 'abc', true]) {
      expect(parseRequest({ kind: 'purchase', contractId: 'c1', seatMonths: v }),
        String(v)).toMatchObject({ ok: false, error: 'BAD_SEAT_MONTHS' });
    }
    const good = parseRequest({ kind: 'purchase', contractId: 'c1', seatMonths: '1200' });
    expect(good.ok && good.value.seatMonths).toBe(1200);
  });

  it('무효화 요청에는 희망 수량이 없다', () => {
    const r = parseRequest({ kind: 'revoke', licenseId: 'l1', seatMonths: 100 });
    expect(r.ok && r.value.seatMonths).toBeNull();
  });

  it('**게스트는 요청을 보낼 수 없다**', () => {
    expect(canRequest('partner_viewer')).toBe(false);
    expect(canRequest('partner_member')).toBe(true);
    expect(canRequest('partner_admin')).toBe(true);
    expect(canRequest('admin')).toBe(true);
    expect(canRequest('')).toBe(false);
  });

  it('언어를 고른다', () => {
    expect(pickLocale('ko')).toBe('ko');
    expect(pickLocale('ja')).toBe('ja');
    expect(pickLocale('tr')).toBe('en');
    expect(pickLocale(null)).toBe('en');
  });

  it('모든 오류·성공 문구가 세 언어로 있다', () => {
    const errs = ['BAD_KIND', 'TARGET_REQUIRED', 'BAD_SEAT_MONTHS', 'ALREADY_OPEN',
      'TOO_MANY', 'NOT_YOURS', 'NOT_ALLOWED'] as const;
    for (const e of errs) {
      for (const l of ['ko', 'ja', 'en'] as const) {
        expect(errorMessage(e, l), `${e}/${l}`).toBeTruthy();
        if (l !== 'ko') expect(errorMessage(e, l), `${e}/${l}`).not.toMatch(/[가-힣]/);
      }
    }
    for (const k of ['purchase', 'revoke'] as const) {
      for (const l of ['ko', 'ja', 'en'] as const) {
        expect(okMessage(k, l), `${k}/${l}`).toBeTruthy();
      }
    }
  });

  it('**무효화 성공 문구도 "즉시 꺼지지 않는다"를 말한다**', () => {
    expect(okMessage('revoke', 'ko')).toContain('즉시 꺼지지는 않으며');
    expect(okMessage('revoke', 'en')).toContain('does not stop working immediately');
  });

  it('폭주 제한이 있다', () => {
    expect(RATE_LIMIT_PER_MINUTE).toBeGreaterThan(0);
    expect(FN).toContain('RATE_LIMIT_PER_MINUTE');
    expect(FN).toContain('TOO_MANY');
  });

  it('**텔레그램에 개인정보를 넣지 않는다**', () => {
    const msg = telegramText({
      kind: 'purchase', partnerName: 'TechVivid',
      targetId: 'abcdef12-3456-7890-abcd-ef1234567890',
      seatMonths: 1200, reason: '학교에서 더 필요하다고 합니다 (kim@school.sg)',
    });
    expect(msg).toContain('TechVivid');
    expect(msg).toContain('1,200');
    expect(msg).toContain('abcdef12');
    // 사유 본문은 **넣지 않는다** — 개인정보가 섞일 수 있다
    expect(msg).not.toContain('kim@school.sg');
    expect(msg).not.toContain('학교에서 더 필요');
    expect(msg).toContain('사유 있음');
    // 식별자는 앞 8자리만
    expect(msg).not.toContain('abcdef12-3456');
  });

  it('사유가 없으면 사유 줄도 없다', () => {
    const msg = telegramText({ kind: 'revoke', partnerName: 'X', targetId: 'aaaaaaaa-bbbb',
      seatMonths: null, reason: null });
    expect(msg).not.toContain('사유');
  });
});

// ══════════════════════ 엣지 함수 ══════════════════════
describe('요청 함수 — 남의 것에 붙이지 못하게', () => {
  it('대상이 **그 파트너의 것인지** 확인한다', () => {
    expect(FN).toContain("from('partner_contracts')");
    expect(FN).toContain("from('partner_licenses')");
    expect(FN).toMatch(/contract\.partner_id !== partnerId/);
    expect(FN).toMatch(/lic\.partner_id !== partnerId/);
  });

  it('남의 것이면 **있는지 없는지도 알려 주지 않는다** (둘 다 404)', () => {
    const notFound = FN.match(/NOT_YOURS'\s*\}, 404\)/g) ?? [];
    expect(notFound.length).toBeGreaterThanOrEqual(4);
  });

  it('**열린 요청이 있으면 새로 만들지 않는다**', () => {
    expect(FN).toContain('ALREADY_OPEN');
    expect(FN).toMatch(/\.eq\('status', 'open'\)/);
    // 동시 요청은 유니크 인덱스가 막는다 — 그 오류도 같은 답으로 바꾼다
    expect(FN).toContain("'23505'");
  });

  it('게스트를 막는다', () => {
    expect(FN).toContain('canRequest(role)');
    expect(FN).toContain('NOT_ALLOWED');
  });

  it('status 를 open 으로 박는다 (스스로 처리됨을 만들 수 없다)', () => {
    expect(FN).toMatch(/status: 'open'/);
    expect(FN).toMatch(/requested_by: caller\.id/);
  });

  it('로그에 개인정보를 쓰지 않는다', () => {
    for (const m of FN.match(/console\.(log|warn|error)\([^)]*\)/g) ?? []) {
      expect(m, m).not.toMatch(/reason|contact|email|name/i);
    }
  });
});

// ══════════════════════ 마이그레이션 ══════════════════════
describe('요청 표 — 정책 넷 + 지울 수 없음', () => {
  const ADMIN = /\(select up\.role from public\.user_profiles up where up\.id = auth\.uid\(\)\) = any \(array\['admin','sub_admin'\]\)/;
  const policy = (n: string) => (MIG.match(new RegExp(`create policy "${n}"[\\s\\S]*?;`)) ?? [''])[0];

  it('**FOR ALL 정책이 없다**', () => {
    expect(sql(MIG)).not.toMatch(/create policy[^;]*\bfor all\b/i);
  });

  it('읽기: 자기 파트너 또는 admin', () => {
    const p = policy('partner_requests_select');
    expect(p).toMatch(/for select/);
    expect(p).toContain('partner_id = (select up.partner_id');
    expect(p).toMatch(ADMIN);
  });

  it('**넣기: 자기 partner_id · 자기 이름 · open 상태만**', () => {
    const p = policy('partner_requests_insert');
    expect(p).toMatch(/for insert/);
    expect(p).toContain('partner_id = (select up.partner_id');
    expect(p).toContain('requested_by = auth.uid()');
    expect(p).toContain("status = 'open'");
    expect(p).toContain('handled_by is null');
  });

  it('**고치기는 admin 만** (파트너는 보낸 요청을 못 고친다)', () => {
    const p = policy('partner_requests_admin_update');
    expect(p).toMatch(/for update/);
    expect(p).not.toContain('up.partner_id');
    expect(p).toMatch(ADMIN);
  });

  it('**아무도 지우지 못한다**', () => {
    expect(policy('partner_requests_no_delete'))
      .toMatch(/as restrictive for delete to public using \( false \)/);
  });

  it('권한: anon·public 회수, DELETE 없음', () => {
    const c = sql(MIG);
    expect(c).toContain('revoke all on public.partner_requests from anon');
    expect(c).toContain('revoke all on public.partner_requests from public');
    expect(c).toMatch(/grant select, insert, update on public\.partner_requests to authenticated/);
    expect(c).not.toMatch(/grant[^;]*\bdelete\b[^;]*partner_requests/i);
  });

  it('종류와 대상의 짝을 CHECK 가 맞춘다', () => {
    const c = sql(MIG);
    expect(c).toMatch(/kind = 'purchase' and contract_id is not null and license_id is null/);
    expect(c).toMatch(/kind = 'revoke' and license_id is not null/);
    expect(c).toMatch(/check \(kind in \('purchase', 'revoke'\)\)/);
  });

  it('처리에는 **누가·언제**가 같이 있어야 한다', () => {
    expect(sql(MIG)).toMatch(/status <> 'open' and handled_at is not null and handled_by is not null/);
  });

  it('**열린 요청은 대상마다 하나**(유니크 인덱스 — 동시 요청도 막는다)', () => {
    const c = sql(MIG);
    expect(c).toMatch(/create unique index if not exists uniq_partner_requests_open_purchase[\s\S]{0,160}where kind = 'purchase' and status = 'open'/);
    expect(c).toMatch(/create unique index if not exists uniq_partner_requests_open_revoke[\s\S]{0,160}where kind = 'revoke' and status = 'open'/);
  });

  it('외래키는 on delete restrict (기록 보호)', () => {
    for (const r of sql(MIG).match(/references[^,\n]*/g) ?? []) {
      expect(r, r).toContain('on delete restrict');
    }
  });

  it('왜 한 표인지 적어 두었다', () => {
    expect(MIG).toContain('정책이 한 벌');
    expect(MIG).toContain('버그가 난 자리는 전부 정책이었다');
  });
});

// ══════════════════════ 드라이런 ══════════════════════
describe('드라이런 — **실제 역할 전환으로** 증명한다', () => {
  it('psql 전용 명령 없이 한 파일로 돈다', () => {
    expect(DRY).not.toMatch(/^\\\w/m);
    expect(sql(DRY)).toMatch(/^\s*begin;/m);
    expect(sql(DRY).trimEnd().endsWith('rollback;')).toBe(true);
    expect(sql(DRY)).not.toMatch(/^\s*commit\s*;/mi);
  });

  it('마이그레이션 본문이 직접 들어 있다', () => {
    expect(DRY).toContain('create table if not exists public.partner_requests');
    expect(DRY).toContain('create policy "partner_requests_insert"');
  });

  // ⚠️ 처음에는 "`set local role authenticated` 라는 글자가 있다"만 봤다.
  //    그러면 **한 군데만 남기고 나머지를 지워도 통과한다**(변이 시험에서 드러났다).
  //    이 단계의 요구는 "보안을 실제 역할 전환으로 증명하라"이므로,
  //    **몇 번 바꾸는지**와 **바꾼 뒤 되돌리는지**까지 센다.
  it('**구문이 아니라 역할을 바꿔** 넣고 고쳐 본다', () => {
    const switches = DRY.match(/set local role (authenticated|service_role)/g) ?? [];
    const resets = DRY.match(/reset role/g) ?? [];
    // 파트너·admin 두 역할로 바꾸고, 그때마다 되돌린다
    expect(switches.length, '역할 전환이 모자란다').toBeGreaterThanOrEqual(2);
    expect(resets.length, '되돌리기가 모자란다').toBeGreaterThanOrEqual(switches.length);
    expect(DRY).toContain('request.jwt.claims');

    // 파트너 시험 블록 **안에서** 역할을 바꾼다(밖에서만 바꾸면 의미가 없다)
    const at = DRY.indexOf('파트너 계정인 척');
    expect(at, '파트너 역할 전환 지점을 찾지 못했다').toBeGreaterThan(-1);
    expect(DRY.slice(at, at + 400)).toContain('set local role authenticated');

    const adminAt = DRY.indexOf('admin 인 척');
    expect(adminAt).toBeGreaterThan(-1);
    expect(DRY.slice(adminAt, adminAt + 400)).toContain('set local role authenticated');

    // 왜 이렇게 하는지 적어 두었다(앞 단계의 교훈)
    expect(DRY).toContain('security definer');
  });

  it('요구한 시험이 전부 있다', () => {
    for (const probe of [
      '파트너: 자기 요청 INSERT', '파트너: 다른 partner_id 로', '파트너: 남의 이름으로 INSERT',
      '파트너: handled 로 INSERT', '파트너: 남의 요청 SELECT', '파트너: 자기 요청 UPDATE',
      '파트너: 자기 요청 DELETE', '파트너: 같은 계약에 또 요청',
      'admin: 전체 SELECT', 'admin: status UPDATE', 'admin: DELETE',
      'anon 권한 (없어야)', 'authenticated DELETE (없어야)',
    ]) {
      expect(DRY, probe).toContain(probe);
    }
  });

  it('CHECK 도 찔러 본다', () => {
    for (const probe of ['추가 구매인데 계약이 없음', '무효화인데 이용권이 없음',
                         '모르는 종류', '처리됨인데 handled_by 없음']) {
      expect(DRY, probe).toContain(probe);
    }
  });

  it('기존 건수 보존을 확인한다', () => {
    expect(DRY).toContain('기대 15');
    expect(DRY).toContain('기대 2');
  });
});

// ══════════════════════ 범위 ══════════════════════
describe('건드리지 않은 것', () => {
  it('발급 함수의 예약 로직을 바꾸지 않았다', () => {
    const issue = read('supabase/functions/partner-issue-license/index.ts');
    expect(issue).toContain('partner_reserve_license_seats');
    expect(issue).toContain('partner_release_license_reservation');
  });

  it('커미션형 화면 동작을 바꾸지 않았다 (요청은 도매형에서만)', () => {
    const portal = read('src/pages/PartnerPortal.tsx');
    expect(portal).toContain('isWholesaleLicense');
    expect(portal).toMatch(/if \(isWholesaleLicense\(lic\)\) \{/);
    // 커미션 경로는 기존 revokeLicense 를 그대로 쓴다
    expect(portal).toContain('await revokeLicense(lic, revokeReason)');
  });

  it('포털이 계약·구매를 쓰지 않는다 (읽기만)', () => {
    const api = code(read('src/lib/partnerPortalContracts.ts'));
    expect(api).not.toMatch(/method: '(POST|PATCH|PUT|DELETE)'[\s\S]{0,200}partner_(contracts|purchases)/);
    // 쓰기는 요청 하나뿐이고 그것도 엣지 함수다
    expect(api).toContain('functions/v1/partner-request');
  });

  it('**계약서 파일을 포털이 가져오지 않는다** (열람은 관리자만)', () => {
    // 주석에는 "contract_file_id 도 빼서…"라고 적혀 있으므로 **코드만** 본다.
    const api = read('src/lib/partnerPortalContracts.ts');
    expect(code(api)).not.toContain('contract_file_id');
    expect(api).toContain('계약서 파일은 가져오지 않는다');
  });

  it('키·개인정보를 담지 않는다', () => {
    for (const f of ['src/lib/partnerPortalContracts.ts', 'src/lib/partnerPortalMsg.ts',
                     'src/lib/portalIssueContract.ts',
                     'src/components/partner-portal/PortalContracts.tsx',
                     'supabase/functions/partner-request/logic.ts']) {
      const c = code(read(f));
      expect(c, f).not.toMatch(/eyJ[A-Za-z0-9]|service_role|SUPABASE_SERVICE/);
    }
  });
});
