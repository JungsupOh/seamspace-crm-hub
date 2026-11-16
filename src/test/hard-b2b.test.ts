// HARD-B2b — 공개 경로를 서버 함수로 (정상/잘못된 입력/남의 데이터/열 제한/행 상한)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateCatalogInput, PRODUCT_COLS, MAX_PRODUCTS } from '../../supabase/functions/shop-catalog/logic';
import { validateInput as vCoupon, evaluateCoupon } from '../../supabase/functions/shop-validate-coupon/logic';
import { validateInput as vOrders, ORDER_COLS, ITEM_COLS, MAX_ORDERS } from '../../supabase/functions/shop-lookup-orders/logic';
import { validateInput as vApk, SUBSCRIBER_COLS, DOWNLOAD_COLS, unsubscribeVerdict } from '../../supabase/functions/apk-lookup/logic';
import { validateInput as vCamp, CAMPAIGN_COLS } from '../../supabase/functions/campaign-public-detail/logic';
import { validateInput as vLookup, matchVerdict, QUOTE_COLS_VERIFY } from '../../supabase/functions/order-lookup-quote/logic';
import { validateInput as vSubmit, nextQuoteNumber, decideDeal, buildQuoteInsert } from '../../supabase/functions/order-submit-quote/logic';
import { pick, pickAll } from '../../supabase/functions/_shared/public-cols';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ────────────────────────────────────────────
describe('공통 — 열 제한 헬퍼', () => {
  it('허용 목록에 없는 열은 떨어진다', () => {
    const row = { id: 1, name: 'A', secret: 'x', cost: 999 };
    expect(pick(row, ['id', 'name'])).toEqual({ id: 1, name: 'A' });
  });
  it('행 수 상한을 지킨다', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, x: 1 }));
    expect(pickAll(rows, ['id'], 10)).toHaveLength(10);
  });
});

describe('shop-catalog', () => {
  it('빈 본문은 전체 목록 조회', () => {
    const v = validateCatalogInput({});
    expect(v.ok && v.value.id).toBe(null);
  });
  it('id 로 단건 조회', () => {
    const v = validateCatalogInput({ id: 'boardgame' });
    expect(v.ok && v.value.id).toBe('boardgame');
  });
  for (const bad of [{ id: 123 }, { id: "a' or 1=1" }, { id: 'x'.repeat(200) }, { foo: 1 }, null, []])
    it(`잘못된 입력 거절: ${JSON.stringify(bad)}`, () => expect(validateCatalogInput(bad).ok).toBe(false));
  it('내부 열 created_at 을 내보내지 않는다', () => {
    expect([...PRODUCT_COLS]).not.toContain('created_at');
    expect(MAX_PRODUCTS).toBeLessThanOrEqual(100);
  });
});

describe('shop-validate-coupon', () => {
  const row = { batch_name: '가을', discount_type: 'amount' as const, discount_value: 5000,
                min_order: 10000, expires_at: '2099-01-01', is_used: false, applicable_products: null };
  it('정상 — 금액 할인', () => {
    expect(evaluateCoupon(row, 20000, [])).toEqual({ valid: true, discount: 5000, couponName: '가을', applicableLabel: undefined });
  });
  it('퍼센트 할인은 반올림한다 (원본과 같은 식)', () => {
    const v = evaluateCoupon({ ...row, discount_type: 'percent', discount_value: 13 }, 10000, []);
    expect(v.discount).toBe(1300);
  });
  it('할인은 적용 합계를 넘지 않는다', () => {
    expect(evaluateCoupon({ ...row, discount_value: 999999 }, 10000, []).discount).toBe(10000);
  });
  it('없는 쿠폰 / 사용됨 / 만료 — 원본 문구', () => {
    expect(evaluateCoupon(null, 1, []).error).toBe('유효하지 않은 쿠폰 코드입니다.');
    expect(evaluateCoupon({ ...row, is_used: true }, 20000, []).error).toBe('이미 사용된 쿠폰입니다.');
    expect(evaluateCoupon({ ...row, expires_at: '2000-01-01' }, 20000, []).error).toBe('만료된 쿠폰입니다.');
  });
  it('최소 주문 미달 문구', () => {
    expect(evaluateCoupon(row, 5000, []).error).toContain('이상 주문 시');
  });
  it('적용 상품이 없으면 거절하고 상품명을 알려 준다', () => {
    const v = evaluateCoupon({ ...row, applicable_products: ['boardgame'] }, 20000,
      [{ productId: 'keyring', unitPrice: 20000, qty: 1 }]);
    expect(v.valid).toBe(false);
    expect(v.error).toContain('보드게임');
  });
  it('일부만 일치하면 그 합계에만 적용', () => {
    const v = evaluateCoupon({ ...row, discount_type: 'percent', discount_value: 10, applicable_products: ['boardgame'] },
      30000, [{ productId: 'boardgame', unitPrice: 10000, qty: 1 }, { productId: 'keyring', unitPrice: 20000, qty: 1 }]);
    expect(v.discount).toBe(1000);
    expect(v.applicableLabel).toBe('일부 상품에만 적용');
  });
  it('입력 검증 — 빈 코드/모르는 필드/과다 장바구니', () => {
    expect(vCoupon({ code: '', subtotal: 1 }).ok).toBe(false);
    expect(vCoupon({ code: 'A', subtotal: 1, foo: 1 }).ok).toBe(false);
    expect(vCoupon({ code: 'A', subtotal: 1, cartItems: Array(99).fill({ productId: 'a', unitPrice: 1, qty: 1 }) }).ok).toBe(false);
  });
  it('코드는 대문자로 정규화한다 (원본과 같다)', () => {
    const v = vCoupon({ code: ' ab-cd ', subtotal: 0 });
    expect(v.ok && v.value.code).toBe('AB-CD');
  });
});

describe('shop-lookup-orders', () => {
  it('이름+휴대폰이 있어야 한다', () => {
    expect(vOrders({ name: '홍길동', phone: '010-1234-5678' }).ok).toBe(true);
    expect(vOrders({ name: '', phone: '010-1234-5678' }).ok).toBe(false);
    expect(vOrders({ name: '홍길동', phone: '123' }).ok).toBe(false);   // 너무 짧은 번호로 쓸어보기 차단
  });
  it('30일 창을 지킨다', () => {
    const v = vOrders({ name: 'A', phone: '01012345678' }, new Date('2026-11-16T00:00:00Z'));
    expect(v.ok && v.value.since.slice(0, 10)).toBe('2026-10-17');
  });
  it('결제 내부값과 고객 개인정보 열을 내보내지 않는다', () => {
    for (const c of ['payment_key', 'toss_method', 'approved_at', 'customer_name', 'customer_phone', 'customer_email'])
      expect([...ORDER_COLS], c).not.toContain(c);
    expect([...ITEM_COLS]).not.toContain('product_id');
    expect(MAX_ORDERS).toBeLessThanOrEqual(20);
  });
});

describe('apk-lookup', () => {
  it('info 는 이메일 형식을 본다', () => {
    expect(vApk({ action: 'info', email: 'a@b.com' }).ok).toBe(true);
    expect(vApk({ action: 'info', email: 'nope' }).ok).toBe(false);
  });
  it('unsubscribe 는 토큰 형식을 본다', () => {
    expect(vApk({ action: 'unsubscribe', token: 'abcd1234efgh' }).ok).toBe(true);
    expect(vApk({ action: 'unsubscribe', token: 'x' }).ok).toBe(false);
  });
  it('모르는 action·필드는 거절', () => {
    expect(vApk({ action: 'delete' }).ok).toBe(false);
    expect(vApk({ action: 'info', email: 'a@b.com', extra: 1 }).ok).toBe(false);
  });
  // ★ 이번 단위가 막는 핵심 — 해지 토큰이 밖으로 나가면 남의 구독을 해지할 수 있다
  it('구독 정보에 unsubscribe_token 을 절대 넣지 않는다', () => {
    expect([...SUBSCRIBER_COLS]).not.toContain('unsubscribe_token');
    for (const c of ['memo', 'created_by', 'email', 'school_code', 'consent_at'])
      expect([...SUBSCRIBER_COLS], c).not.toContain(c);
  });
  it('내려받기 이력에 ip·user_agent 를 넣지 않는다', () => {
    expect([...DOWNLOAD_COLS]).not.toContain('ip');
    expect([...DOWNLOAD_COLS]).not.toContain('user_agent');
  });
  it('해지 판정 — 없음/이미 해지됨', () => {
    expect(unsubscribeVerdict([])?.state).toBe('notfound');
    expect(unsubscribeVerdict([{ email: 'a@b.com', status: 'unsubscribed' }])?.state).toBe('already');
    expect(unsubscribeVerdict([{ email: 'a@b.com', status: 'active' }])).toBeNull();
  });
});

describe('campaign-public-detail', () => {
  it('슬러그 형식을 본다', () => {
    expect(vCamp({ slug: 'eduspaze-tour-2026' }).ok).toBe(true);
    expect(vCamp({ slug: '../../etc' }).ok).toBe(false);
    expect(vCamp({ slug: '' }).ok).toBe(false);
  });
  // ★ 공개 폼에 내부 값이 내려가던 것을 막는다
  it('budget·actual_cost·쿠폰/체험권 설정을 내보내지 않는다', () => {
    for (const c of ['budget', 'actual_cost', 'coupon_settings', 'trial_license_settings', 'type', 'created_at'])
      expect([...CAMPAIGN_COLS], c).not.toContain(c);
  });
  it('폼을 그리는 데 필요한 열은 있다', () => {
    for (const c of ['id', 'name', 'title', 'description', 'image_url', 'status', 'end_date', 'form_settings'])
      expect([...CAMPAIGN_COLS], c).toContain(c);
  });
});

describe('order-lookup-quote', () => {
  const row = { contact_email: 'a@b.com', contact_phone: '010-1234-5678' };
  it('verify 는 이메일 또는 전화를 요구한다 (원본과 같다)', () => {
    expect(vLookup({ quoteNumber: '2026-01-0001' }).ok).toBe(false);
    expect(vLookup({ quoteNumber: '2026-01-0001', email: 'a@b.com' }).ok).toBe(true);
  });
  it('이메일이 맞으면 통과', () => {
    expect(matchVerdict(row, 'a@b.com', '').ok).toBe(true);
  });
  it('전화가 맞으면 통과 (형식 무관)', () => {
    expect(matchVerdict(row, '', '01012345678').ok).toBe(true);
  });
  // ★ 남의 견적 열람 차단
  it('둘 다 틀리면 거절한다', () => {
    const v = matchVerdict(row, 'evil@x.com', '01099998888');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain('일치하지 않습니다');
  });
  it('저장된 연락처가 하나도 없으면 통과 — 원본 동작 보존', () => {
    expect(matchVerdict({}, 'any@x.com', '').ok).toBe(true);
  });
  it('결제 내부값·내부 메모를 내보내지 않는다', () => {
    for (const c of ['payment_key', 'paid_at', 'order_status', 'notes', 'discount_amount'])
      expect([...QUOTE_COLS_VERIFY], c).not.toContain(c);
  });
  it('견적번호 형식을 본다', () => {
    expect(vLookup({ quoteNumber: 'a b', email: 'a@b.com' }).ok).toBe(false);
  });
});

describe('order-submit-quote', () => {
  const base = { productCode: '01', productName: '마음일기', planLabel: '표준', orgName: '서울초',
    contactName: '홍길동', phone: '010-1234-5678', email: 'a@b.com', students: 40, qty: 2,
    months: 6, unitPrice: 1000, supply: 100000, tax: 10000, total: 110000, items: [], notesStudents: '40' };

  it('정상 입력', () => expect(vSubmit(base).ok).toBe(true));
  it('공급가+세액 ≠ 합계면 거절한다 (내부 정합성)', () => {
    expect(vSubmit({ ...base, total: 999999 }).ok).toBe(false);
  });
  it('필수 정보가 비면 거절', () => {
    expect(vSubmit({ ...base, orgName: '' }).ok).toBe(false);
    expect(vSubmit({ ...base, phone: '' }).ok).toBe(false);
  });
  it('모르는 필드·범위 밖 값 거절', () => {
    expect(vSubmit({ ...base, evil: 1 }).ok).toBe(false);
    expect(vSubmit({ ...base, qty: -1 }).ok).toBe(false);
    expect(vSubmit({ ...base, total: 1e12, supply: 1e12, tax: 0 }).ok).toBe(false);
  });
  it('이메일 형식을 본다', () => expect(vSubmit({ ...base, email: 'nope' }).ok).toBe(false));

  it('견적번호 채번이 원본 규칙과 같다', () => {
    expect(nextQuoteNumber('2026-01-', null)).toBe('2026-01-0001');
    expect(nextQuoteNumber('2026-01-', '2026-01-0007')).toBe('2026-01-0008');
    expect(nextQuoteNumber('2026-01-', '깨진값')).toBe('2026-01-0001');
  });

  it('재구매·머지 판정이 원본 규칙과 같다', () => {
    const today = '2026-11-16';
    expect(decideDeal([], today)).toEqual({ dealType: 'New', mergeDealId: null });
    expect(decideDeal([{ id: 'd1', deal_stage: '입금완료', created_date: '2025-01-01' }], today).dealType).toBe('Renewal');
    // 30일 안의 미클로즈 딜에 머지
    expect(decideDeal([{ id: 'd2', deal_stage: '견적', created_date: '2026-11-10' }], today).mergeDealId).toBe('d2');
    // 30일 지난 미클로즈 딜은 머지하지 않는다
    expect(decideDeal([{ id: 'd3', deal_stage: '견적', created_date: '2026-09-01' }], today).mergeDealId).toBe(null);
  });

  it('견적 행에 원본과 같은 필드가 들어간다', () => {
    const v = vSubmit(base);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const row = buildQuoteInsert(v.value, '2026-11-16', '2026-01-0001', 'deal-1', '01012345678');
    expect(row.source).toBe('web');
    expect(row.order_status).toBe('견적');
    expect(row.is_selected).toBe(true);
    expect(row.license_qty).toBe(2);
    expect(row.qty).toBe(40);               // 총인원
    expect(row.student_count).toBe(40);
    expect(row.buyer_phone_normalized).toBe('01012345678');
  });

  it('이용권 상품이 아니면 기간·단가를 넣지 않는다 (원본과 같다)', () => {
    const v = vSubmit({ ...base, productCode: '02', supply: 0, tax: 0, total: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const row = buildQuoteInsert(v.value, '2026-11-16', 'Q', 'd', '0');
    expect(row.duration).toBeUndefined();
    expect(row.unit_price).toBeUndefined();
  });
});

// ────────────────────────────────────────────
describe('프런트 — 공개 화면에 rest/v1 직접 호출이 없다', () => {
  const FILES = ['src/pages/OrderTest.tsx', 'src/pages/OrderPay.tsx', 'src/pages/CampaignForm.tsx',
                 'src/pages/ApkInfo.tsx', 'src/pages/ApkUnsubscribe.tsx',
                 'src/lib/public/apkPublic.ts', 'src/lib/public/publicApi.ts'];
  for (const f of FILES) {
    it(`${f} — rest/v1 0건`, () => {
      expect(code(read(f)), f).not.toContain('rest/v1');
    });
  }

  // shop.ts 는 **죽은 함수**(호출자 0)와 markCouponUsed 의 RPC 가 남아 있다.
  // 죽은 코드는 지우지 않는다(감사·되돌리기). 허용 목록을 넘으면 실패한다.
  it('src/lib/shop.ts — 살아 있는 공개 함수는 rest/v1 을 쓰지 않는다', () => {
    const SRC = read('src/lib/shop.ts');
    const DEAD = ['lookupShopOrder', 'createCouponBatch', 'getAllShopOrders', 'updateShopOrderStatus'];
    const LIVE_RPC = ['markCouponUsed'];   // use_shop_coupon RPC — B2c 대상
    const lines = SRC.split('\n');
    let sym = '<file>';
    const bad: string[] = [];
    lines.forEach((l, i) => {
      const m = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(l);
      if (m) sym = m[1];
      if (l.includes('rest/v1') && !DEAD.includes(sym) && !LIVE_RPC.includes(sym)) {
        bad.push(`${sym}()@${i + 1}`);
      }
    });
    expect(bad, bad.join(', ')).toHaveLength(0);
  });

  it('getShopProducts·validateShopCoupon·lookupMyOrders 는 서버 함수를 부른다', () => {
    const SRC = code(read('src/lib/shop.ts'));
    for (const fn of ['shop-catalog', 'shop-validate-coupon', 'shop-lookup-orders']) {
      expect(SRC, fn).toContain(fn);
    }
  });
  it('공개 입구가 서버 함수를 부른다', () => {
    expect(code(read('src/lib/public/publicApi.ts'))).toContain('/functions/v1/');
    expect(code(read('src/lib/shop.ts'))).toContain("callPublicFn");
  });
  it('contacts 는 아직 공개 경로가 쓴다 (B2b 에서 옮기지 않음)', () => {
    // leadContact.ts 는 /order 접수 뒤 contacts upsert 에 쓰인다 — 문서 §James 판단
    expect(code(read('src/lib/public/leadContact.ts'))).toContain('rest/v1/contacts');
  });
});
