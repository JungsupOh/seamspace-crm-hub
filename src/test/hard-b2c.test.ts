// HARD-B2c — 마지막 공개 구멍 막기
//
// 이 단위가 지켜야 하는 약속
//   ① 쿠폰 사용은 **증거 없이** 못 부른다 (주문·전화·쿠폰코드 대조). 두 번 불러도 안전하다.
//   ② 공개 /order 가 contacts 를 **직접** 건드리지 않는다. 등록 규칙은 원본과 같다.
//   ③ 결제 링크 서명 토큰은 위조·만료를 막고, **옛 링크를 끊지 않는다**(경고 모드).
//   ④ 공개 경로에서 shop_coupons·contacts 로 가는 anon 호출이 0건이다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildUsagePatch, orderVerdict, usageVerdict,
  validateInput as validateUse, normalizePhone as normUsePhone,
} from '../../supabase/functions/shop-use-coupon/logic.ts';
import {
  buildContactInsert, buildContactPatch, buildQuoteActivityNote,
  normalizeKrPhone, validateInput as validateSubmit, validateLead,
} from '../../supabase/functions/order-submit-quote/logic.ts';
import { validateInput as validateLookup } from '../../supabase/functions/order-lookup-quote/logic.ts';
import {
  DEFAULT_TTL_SEC, payload, shouldEnforce, signPayToken, timingSafeEqual, verifyPayToken,
} from '../../supabase/functions/_shared/quote-token.ts';
import { buildPayUrl } from '../lib/public/payLink';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
/** 주석을 뺀 코드만 — 주석에 적힌 설명 때문에 정적 검사가 통과하면 안 된다. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const USE = { code: 'ABC123', orderId: 'ORD-1', phoneNorm: '01012345678' };

// ─────────────────────────────── ① 쿠폰 사용 ───────────────────────────────
describe('(a) shop-use-coupon — 증거 없이 쿠폰을 태울 수 없다', () => {
  it('정상 입력을 받는다', () => {
    const v = validateUse({ code: 'ABC123', orderId: 'ORD-1', phone: '010-1234-5678' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toEqual(USE);
  });

  it.each([
    ['빈 코드',        { code: '', orderId: 'ORD-1', phone: '01012345678' }],
    ['빈 주문번호',    { code: 'A', orderId: '', phone: '01012345678' }],
    ['짧은 전화',      { code: 'A', orderId: 'ORD-1', phone: '0101' }],
    ['코드에 특수문자', { code: 'A;DROP', orderId: 'ORD-1', phone: '01012345678' }],
    ['배열',           []],
    ['null',           null],
  ])('잘못된 입력을 막는다 — %s', (_n, body) => {
    expect(validateUse(body).ok).toBe(false);
  });

  it('허용하지 않은 필드를 막는다 (p_code 같은 RPC 인자 밀어넣기)', () => {
    expect(validateUse({ code: 'A', orderId: 'O', phone: '01012345678', p_code: 'X' }).ok).toBe(false);
  });

  it('주문이 없으면 거절한다', () => {
    expect(orderVerdict(null, USE)).toEqual({ allow: false, status: 404, error: '주문을 찾을 수 없습니다.' });
  });

  it('남의 주문으로는 못 쓴다 — 전화번호가 다르면 거절', () => {
    const r = orderVerdict({ order_id: 'ORD-1', customer_phone: '01099998888', coupon_code: 'ABC123' }, USE);
    expect(r.allow).toBe(false);
  });

  it('그 주문이 쓴 쿠폰이 아니면 거절한다', () => {
    const r = orderVerdict({ order_id: 'ORD-1', customer_phone: '01012345678', coupon_code: 'OTHER' }, USE);
    expect(r.allow).toBe(false);
  });

  it('실패 문구가 모두 같다 — 무엇이 틀렸는지 알려 주지 않는다', () => {
    const msgs = [
      orderVerdict(null, USE),
      orderVerdict({ order_id: 'ORD-1', customer_phone: '01099998888', coupon_code: 'ABC123' }, USE),
      orderVerdict({ order_id: 'ORD-1', customer_phone: '01012345678', coupon_code: 'OTHER' }, USE),
    // 참·거짓 판별은 `=== true` 로 적어야 좁혀진다(strictNullChecks 가 꺼져 있다)
    ].map(r => (r.allow === true ? '' : r.error));
    expect(new Set(msgs).size).toBe(1);
  });

  it('맞는 주문이면 통과한다 (전화 형식이 달라도 숫자가 같으면 된다)', () => {
    const r = orderVerdict({ order_id: 'ORD-1', customer_phone: '010-1234-5678', coupon_code: 'ABC123' }, USE);
    expect(r.allow).toBe(true);
  });

  it('아직 안 쓴 쿠폰이면 사용 처리한다', () => {
    expect(usageVerdict({ is_used: false }, USE)).toEqual({ apply: true, already: false });
  });

  it('같은 주문이 이미 썼으면 성공으로 본다 (멱등 — 새로고침·재시도)', () => {
    const r = usageVerdict({ is_used: true, used_order_id: 'ORD-1' }, USE);
    expect(r).toEqual({ apply: false, already: true });
  });

  it('다른 주문이 이미 썼으면 거절한다 (중복 사용 금지)', () => {
    const r = usageVerdict({ is_used: true, used_order_id: 'ORD-9' }, USE);
    expect(r.apply).toBe(false);
    expect(r.already).toBe(false);
    expect(r.error).toBe('이미 사용된 쿠폰입니다.');
  });

  it('없는 쿠폰이면 거절한다', () => {
    expect(usageVerdict(null, USE).apply).toBe(false);
  });

  it('사용 기록 네 칸이 원본 RPC 와 같다', () => {
    const patch = buildUsagePatch(USE, '2026-11-16T00:00:00.000Z');
    expect(patch).toEqual({
      is_used: true,
      used_at: '2026-11-16T00:00:00.000Z',
      used_order_id: 'ORD-1',
      used_by_phone: '01012345678',
    });
  });

  it('전화번호에서 숫자만 남긴다', () => {
    expect(normUsePhone('010-1234-5678')).toBe('01012345678');
    expect(normUsePhone(null)).toBe('');
  });

  it('브라우저가 RPC 를 직접 부르지 않는다', () => {
    const shop = code(read('src/lib/shop.ts'));
    expect(shop).not.toContain('rest/v1/rpc/');
    expect(shop).not.toContain('use_shop_coupon');
    expect(shop).toContain('shop-use-coupon');
  });

  it('서버가 주문을 먼저 확인한 뒤에만 쿠폰을 바꾼다', () => {
    const idx = code(read('supabase/functions/shop-use-coupon/index.ts'));
    expect(idx.indexOf('shop_orders')).toBeLessThan(idx.indexOf("method: 'PATCH'"));
    // 동시 호출에서도 한 번만 바뀌도록 조건을 건다
    expect(idx).toContain('is_used=is.false');
  });
});

// ─────────────────────────────── ② contacts ───────────────────────────────
describe('(b) contacts — 공개 /order 가 직접 건드리지 않는다', () => {
  const member = { name: '홍길동', phone: '010-1234-5678', email: 'a@b.com', orgName: '서울초' };

  it('리드 입력을 받는다', () => {
    const v = validateLead({ action: 'lead', ...member, leadSource: 'Web 견적조회', activityNote: '메모' });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.member.name).toBe('홍길동');
      expect(v.options.leadSource).toBe('Web 견적조회');
    }
  });

  it.each([
    ['전화 없음',     { name: 'a', phone: '', email: '', orgName: '' }],
    ['전화 너무 짧음', { name: 'a', phone: '0101', email: '', orgName: '' }],
    ['이메일 형식 오류', { name: 'a', phone: '01012345678', email: 'not-an-email', orgName: '' }],
    ['허용 안 된 필드', { name: 'a', phone: '01012345678', email: '', orgName: '', role: 'admin' }],
  ])('잘못된 입력을 막는다 — %s', (_n, body) => {
    expect(validateLead(body).ok).toBe(false);
  });

  it('비어 있는 칸만 채운다 — 영업팀이 고친 값을 덮어쓰지 않는다', () => {
    const { patch } = buildContactPatch(
      { id: '1', name: '김영업이고침', email: '', org_name: '기존학교' }, member, {},
    );
    expect(patch).toEqual({ email: 'a@b.com' });   // name·org_name 은 그대로
  });

  it('활동이력을 앞에 덧붙인다', () => {
    const { patch, activityAppended } = buildContactPatch(
      { id: '1', notes: '이전 줄' }, member, { activityNote: '새 줄' },
    );
    expect(patch.notes).toBe('새 줄\n이전 줄');
    expect(activityAppended).toBe(true);
  });

  it('같은 활동이력은 두 번 쌓지 않는다 (같은 폼 재제출)', () => {
    const { patch, activityAppended } = buildContactPatch(
      { id: '1', notes: '오늘 견적 조회\n옛날 줄' }, member, { activityNote: '오늘 견적 조회' },
    );
    expect(activityAppended).toBe(false);
    expect(patch.notes).toBeUndefined();
  });

  it('신규 contact 본문이 원본과 같은 필드다', () => {
    const row = buildContactInsert(member, { leadSource: 'Web 견적', activityNote: '첫 줄' }, '01012345678');
    expect(row).toEqual({
      name: '홍길동', phone: '010-1234-5678', phone_normalized: '01012345678',
      email: 'a@b.com', org_name: '서울초', contact_type: '리드',
      lead_source: 'Web 견적', notes: '첫 줄',
    });
  });

  it('유입경로를 안 주면 원본 기본값을 쓴다 (집계가 달라지지 않게)', () => {
    expect(buildContactInsert(member, {}, '01012345678').lead_source).toBe('럭키세븐 5월');
  });

  it('활동이력이 없으면 notes 를 넣지 않는다', () => {
    expect('notes' in buildContactInsert(member, {}, '01012345678')).toBe(false);
  });

  it('접수 활동이력 문구가 원본과 같다 — 신규', () => {
    expect(buildQuoteActivityNote({
      today: '2026-11-16', quoteNumber: '2026-01-0007', planLabel: '표준플랜',
      months: 12, qty: 30, total: 1234000, merged: false, dealType: 'New',
    })).toBe('[2026-11-16] 웹 견적서 발급 — 2026-01-0007 / 표준플랜 12개월 × 30 / 1,234,000원');
  });

  it('접수 활동이력 문구가 원본과 같다 — 머지·재구매 꼬리표', () => {
    const base = { today: '2026-11-16', quoteNumber: 'Q', planLabel: 'P', months: 1, qty: 1, total: 0 };
    expect(buildQuoteActivityNote({ ...base, merged: true, dealType: 'New' })).toContain(' (기존 딜에 추가)');
    expect(buildQuoteActivityNote({ ...base, merged: false, dealType: 'Renewal' })).toContain(' (재구매)');
    expect(buildQuoteActivityNote({ ...base, merged: false, dealType: 'New' })).not.toContain('(');
  });

  it('금액에 쉼표가 들어간다 (서버 로캘에 맡기지 않는다)', () => {
    const n = buildQuoteActivityNote({
      today: 'd', quoteNumber: 'q', planLabel: 'p', months: 1, qty: 1,
      total: 1000000, merged: false, dealType: 'New',
    });
    expect(n).toContain('1,000,000원');
  });

  it('접수 요청이 유입경로를 함께 받는다', () => {
    const v = validateSubmit({
      productCode: '01', productName: 'p', planLabel: 'p', orgName: 'o', contactName: 'c',
      phone: '01012345678', email: '', students: 1, qty: 1, months: 1,
      unitPrice: 100, supply: 100, tax: 10, total: 110, items: [], notesStudents: '',
      leadSource: 'Web 견적',
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.leadSource).toBe('Web 견적');
  });

  it('활동이력 본문은 **받지 않는다** — 서버가 만든다', () => {
    const v = validateSubmit({
      productCode: '01', productName: 'p', planLabel: 'p', orgName: 'o', contactName: 'c',
      phone: '01012345678', email: '', students: 1, qty: 1, months: 1,
      unitPrice: 100, supply: 100, tax: 10, total: 110, items: [], notesStudents: '',
      activityNote: '내가 쓴 메모',
    });
    expect(v.ok).toBe(false);
  });

  it('국내 전화 정규화', () => {
    expect(normalizeKrPhone('010-1234-5678')).toBe('01012345678');
    expect(normalizeKrPhone(undefined)).toBe('');
  });

  it('공개 /order 화면이 contacts 를 직접 부르지 않는다', () => {
    const order = code(read('src/pages/OrderTest.tsx'));
    expect(order).not.toContain('rest/v1/contacts');
    expect(order).not.toContain('leadContact');
  });

  it('접수와 같은 요청 안에서 contacts 를 등록한다 (별도 왕복 없음)', () => {
    const idx = code(read('supabase/functions/order-submit-quote/index.ts'));
    expect(idx).toContain('upsertLeadContact');
    expect(idx).toContain('rest/v1/contacts');
    // 견적 INSERT 뒤에 와야 한다 — 견적이 실패하면 활동이력도 남지 않는다
    expect(idx.indexOf('rest/v1/deal_quotes')).toBeLessThan(idx.lastIndexOf('upsertLeadContact'));
  });

  it('contacts 등록 실패가 접수를 깨뜨리지 않는다', () => {
    const idx = code(read('supabase/functions/order-submit-quote/index.ts'));
    const fn = idx.slice(idx.indexOf('async function upsertLeadContact'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('catch');
  });
});

// ─────────────────────────────── ③ 서명 토큰 ───────────────────────────────
describe('(e) 결제 링크 서명 토큰', () => {
  const SECRET = 'test-secret-not-a-real-key';
  const QN = '2026-01-0007';
  const NOW = 1_800_000_000;

  it('발급한 토큰이 통과한다', async () => {
    const t = await signPayToken(QN, SECRET, NOW + 100);
    expect(await verifyPayToken(QN, t, SECRET, NOW)).toEqual({ valid: true });
  });

  it('다른 견적번호로는 못 쓴다 (링크 돌려쓰기 금지)', async () => {
    const t = await signPayToken(QN, SECRET, NOW + 100);
    expect(await verifyPayToken('2026-01-0008', t, SECRET, NOW)).toEqual({
      valid: false, reason: 'bad-signature',
    });
  });

  it('만료되면 거절한다', async () => {
    const t = await signPayToken(QN, SECRET, NOW - 1);
    expect(await verifyPayToken(QN, t, SECRET, NOW)).toEqual({ valid: false, reason: 'expired' });
  });

  it('만료시각을 늘려 적으면 서명이 깨진다', async () => {
    const t = await signPayToken(QN, SECRET, NOW + 100);
    const forged = `${NOW + 999999}.${t.slice(t.indexOf('.') + 1)}`;
    expect(await verifyPayToken(QN, forged, SECRET, NOW)).toEqual({
      valid: false, reason: 'bad-signature',
    });
  });

  it('다른 키로 만든 토큰은 거절한다', async () => {
    const t = await signPayToken(QN, 'other-secret', NOW + 100);
    expect(await verifyPayToken(QN, t, SECRET, NOW)).toEqual({ valid: false, reason: 'bad-signature' });
  });

  it.each([
    ['빈 값',       ''],
    ['점 없음',     'abcdef'],
    ['만료가 숫자 아님', 'abc.sig'],
    ['서명 없음',   '1800000100.'],
    ['점으로 시작', '.sig'],
  ])('형식이 틀리면 거절한다 — %s', async (_n, tok) => {
    const r = await verifyPayToken(QN, tok, SECRET, NOW);
    expect(r.valid).toBe(false);
  });

  it('토큰이 없으면 missing 으로 구분한다 (경고 모드가 이걸 본다)', async () => {
    expect(await verifyPayToken(QN, null, SECRET, NOW)).toEqual({ valid: false, reason: 'missing' });
  });

  it('키가 없으면 no-secret 을 돌려준다', async () => {
    expect(await verifyPayToken(QN, 'x.y', '', NOW)).toEqual({ valid: false, reason: 'no-secret' });
  });

  it('키가 없으면 **절대 강제 모드로 가지 않는다** (모든 결제 링크가 막히는 것 방지)', () => {
    expect(shouldEnforce('', '1')).toBe(false);
    expect(shouldEnforce('', undefined)).toBe(false);
  });

  it('키가 있고 스위치가 1 일 때만 강제한다 (기본은 경고 모드)', () => {
    expect(shouldEnforce(SECRET, '1')).toBe(true);
    expect(shouldEnforce(SECRET, undefined)).toBe(false);
    expect(shouldEnforce(SECRET, '0')).toBe(false);
    expect(shouldEnforce(SECRET, 'true')).toBe(false);
  });

  it('서명 비교가 길이 다르면 바로 거짓, 같으면 전부 비교한다', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('서명 대상에 견적번호와 만료가 둘 다 들어간다', () => {
    expect(payload('Q', 123)).toBe('Q.123');
  });

  it('토큰이 링크에 그대로 들어갈 수 있는 글자만 쓴다 (base64url)', async () => {
    const t = await signPayToken(QN, SECRET, NOW + 100);
    expect(t).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
  });

  it('유효기간 기본값이 견적 유효기간(30일)과 같다', () => {
    expect(DEFAULT_TTL_SEC).toBe(30 * 24 * 3600);
  });

  it('토큰이 있으면 링크에 붙고, 없으면 옛 모양 그대로다', () => {
    expect(buildPayUrl('https://x.test', '2026-01-0007', 'tok')).toBe(
      'https://x.test/order/pay/2026-01-0007?t=tok');
    expect(buildPayUrl('https://x.test', '2026-01-0007')).toBe(
      'https://x.test/order/pay/2026-01-0007');
    expect(buildPayUrl('https://x.test', '2026-01-0007', '')).toBe(
      'https://x.test/order/pay/2026-01-0007');
  });

  it('pay 모드가 토큰 필드를 받는다', () => {
    const v = validateLookup({ mode: 'pay', quoteNumber: 'Q-1', token: 'a.b' });
    expect(v.ok).toBe(true);
    if (v.ok && v.mode === 'pay') expect(v.token).toBe('a.b');
  });

  it('토큰이 없어도 pay 모드는 성립한다 (옛 링크 호환)', () => {
    const v = validateLookup({ mode: 'pay', quoteNumber: 'Q-1' });
    expect(v.ok).toBe(true);
    if (v.ok && v.mode === 'pay') expect(v.token).toBe('');
  });

  it('서버가 경고 모드에서는 거절하지 않는다', () => {
    const idx = code(read('supabase/functions/order-lookup-quote/index.ts'));
    // 거절(pay 모드의 이른 return)은 shouldEnforce 안쪽에서만 일어나야 한다.
    // lastIndexOf 를 쓰는 이유: 첫 번째는 import 줄이다.
    const at = idx.lastIndexOf('shouldEnforce(');
    expect(at).toBeGreaterThan(-1);
    expect(idx.slice(at, at + 120)).toContain('return json');
  });

  it('토큰 사유를 로그에 남긴다 — 강제 모드로 넘어갈 시점을 알 수 있게', () => {
    expect(code(read('supabase/functions/order-lookup-quote/index.ts'))).toContain('check.reason');
  });

  it('견적번호를 로그에 남기지 않는다', () => {
    const idx = code(read('supabase/functions/order-lookup-quote/index.ts'));
    const logs = idx.split('\n').filter(l => l.includes('console.'));
    expect(logs.some(l => l.includes('quoteNumber'))).toBe(false);
  });
});

// ─────────────────────── ④ 공개 경로에 anon 직접 호출이 없다 ───────────────────────
describe('공개 경로 정적 검사', () => {
  const PUBLIC_FILES = [
    'src/pages/OrderTest.tsx', 'src/pages/OrderPay.tsx', 'src/pages/ShopComplete.tsx',
    'src/lib/public/publicApi.ts', 'src/lib/public/payLink.ts',
  ];

  it.each(PUBLIC_FILES)('%s 에 rest/v1 직접 호출이 없다', (f) => {
    expect(code(read(f))).not.toContain('rest/v1');
  });

  it('공개 파일에 RPC 직접 호출이 없다', () => {
    for (const f of PUBLIC_FILES) expect(code(read(f))).not.toContain('/rpc/');
    expect(code(read('src/lib/shop.ts'))).not.toContain('/rpc/');
  });

  // src/lib/shop.ts 는 공개 함수와 **관리자용 잔재**가 한 파일에 섞여 있다.
  // 공개 쪽만 확인한다. 잔재(lookupShopOrder·getAllShopOrders·updateShopOrderStatus·
  // createCouponBatch)는 호출자가 0이고, 관리자 화면은 ShopOrders.tsx 안의
  // authedFetch 복사본을 쓴다(021-8b-4). 지우는 것은 이 단위 범위가 아니다.
  it('shop.ts 의 공개 함수가 rest/v1 을 직접 부르지 않는다', () => {
    const src = code(read('src/lib/shop.ts'));
    const PUBLIC_FNS = ['getShopProducts', 'getShopProduct', 'validateShopCoupon',
                        'markCouponUsed', 'lookupMyOrders'];
    for (const fn of PUBLIC_FNS) {
      const at = src.indexOf(`export async function ${fn}`);
      expect(at, `${fn} 를 찾지 못함`).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf('\nexport ', at + 10));
      expect(body, `${fn} 가 rest/v1 을 직접 부른다`).not.toContain('rest/v1');
    }
  });

  it('shop.ts 에 남은 rest/v1 은 호출자 0인 잔재뿐이다', () => {
    const src = read('src/lib/shop.ts');
    const DEAD = ['lookupShopOrder', 'createCouponBatch', 'getAllShopOrders', 'updateShopOrderStatus'];
    for (const fn of DEAD) {
      // 저장소 어디에서도 부르지 않는다(정의·테스트 제외)
      const callers = ['src/pages/ShopOrders.tsx', 'src/pages/ShopComplete.tsx', 'src/pages/Shop.tsx']
        .filter(f => fs.existsSync(path.resolve(process.cwd(), f)))
        .filter(f => code(read(f)).includes(fn));
      expect(callers, `${fn} 가 되살아났다`).toEqual([]);
    }
    expect(src).toContain('rest/v1');   // 잔재가 남아 있다는 사실 자체를 고정한다
  });

  it('새 서버 함수가 service_role 로만 DB 를 읽는다', () => {
    const idx = code(read('supabase/functions/shop-use-coupon/index.ts'));
    expect(idx).toContain('headers: DB');
    expect(idx).not.toContain('ANON');
  });

  it('쿠폰 응답이 쿠폰 행을 돌려주지 않는다', () => {
    const idx = code(read('supabase/functions/shop-use-coupon/index.ts'));
    const returns = idx.split('\n').filter(l => l.includes('return json'));
    // 돌려주는 것은 ok/already/error 뿐이다
    for (const r of returns) expect(r).not.toMatch(/\b(coupon|rows|crows|discount_value)\b/);
  });
});
