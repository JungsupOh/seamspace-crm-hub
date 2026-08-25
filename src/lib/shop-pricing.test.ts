import { describe, it, expect } from 'vitest';
import { calcShipping } from './shipping';
import { getCartTotal, optionPrice, optionLabel, qtyUnitFromLabel, type CartItem } from './shop';

const item = (o: Partial<CartItem> & { productId: string }): CartItem => ({
  productName: 'x', qty: 1, unitPrice: 10000, ...o,
});

describe('calcShipping — 공통 정책', () => {
  it('기본 3,000원', () => {
    expect(calcShipping({ subtotal: 30000, needsShipping: true }).total).toBe(3000);
  });
  it('5만원 이상이면 무료', () => {
    expect(calcShipping({ subtotal: 50000, needsShipping: true }).total).toBe(0);
  });
  it('배송이 필요없으면 0원', () => {
    expect(calcShipping({ subtotal: 99999, needsShipping: false }).total).toBe(0);
  });
  it('도서산간 추가금이 붙는다', () => {
    const r = calcShipping({ subtotal: 10000, needsShipping: true, address: '제주특별자치도 제주시' });
    expect(r.remoteArea).toBe('제주도');
    expect(r.total).toBe(6000); // 3000 + 3000
  });
});

describe('calcShipping — 고정 배송비(제작 상품)', () => {
  it('고정 금액을 그대로 쓴다', () => {
    const r = calcShipping({ subtotal: 26000, needsShipping: true, fixedFee: 3500 });
    expect(r.total).toBe(3500);
    expect(r.isFixed).toBe(true);
  });
  it('5만원을 넘어도 무료배송이 되지 않는다 — 제작 실비라 깎이지 않는다', () => {
    const r = calcShipping({ subtotal: 200000, needsShipping: true, fixedFee: 3500 });
    expect(r.discount).toBe(0);
    expect(r.total).toBe(3500);
  });
  it('도서산간 추가금은 고정 배송비에도 붙는다', () => {
    const r = calcShipping({ subtotal: 26000, needsShipping: true, fixedFee: 3500, address: '울릉군 울릉읍' });
    expect(r.total).toBe(11500); // 3500 + 8000
  });
  it('fixedFee가 0이나 null이면 공통 정책으로 돌아간다', () => {
    expect(calcShipping({ subtotal: 10000, needsShipping: true, fixedFee: 0 }).total).toBe(3000);
    expect(calcShipping({ subtotal: 10000, needsShipping: true, fixedFee: null }).total).toBe(3000);
  });
});

describe('getCartTotal — 장바구니 합계', () => {
  it('일반 상품만 담으면 공통 배송비', () => {
    const r = getCartTotal([item({ productId: 'keyring', unitPrice: 30000 })]);
    expect(r.subtotal).toBe(30000);
    expect(r.shippingFee).toBe(3000);
    expect(r.total).toBe(33000);
  });

  it('제본을 담으면 3,500원 고정', () => {
    const r = getCartTotal([item({ productId: 'diary', unitPrice: 26000, shippingFee: 3500 })]);
    expect(r.shippingFee).toBe(3500);
    expect(r.total).toBe(29500);
  });

  it('제본 여러 권이어도 배송비는 3,500원 한 번만', () => {
    const r = getCartTotal([item({ productId: 'diary', unitPrice: 38000, qty: 5, shippingFee: 3500 })]);
    expect(r.subtotal).toBe(190000);
    expect(r.shippingFee).toBe(3500);   // 무료배송 할인 미적용
  });

  it('제본 + 일반 상품을 함께 담으면 더 비싼 배송비 하나만', () => {
    const r = getCartTotal([
      item({ productId: 'diary', unitPrice: 26000, shippingFee: 3500 }),
      item({ productId: 'keyring', unitPrice: 30000 }),
    ]);
    expect(r.subtotal).toBe(56000);
    expect(r.shippingFee).toBe(3500);   // 3000+3500 합산이 아니라 3500 하나
    expect(r.total).toBe(59500);
  });

  it('디지털 상품만 담으면 배송비 없음', () => {
    const r = getCartTotal([item({ productId: 'minddiary', unitPrice: 40000 })]);
    expect(r.needsShipping).toBe(false);
    expect(r.shippingFee).toBe(0);
  });
});

describe('옵션 가격', () => {
  const PAGE_OPTIONS = [
    { label: '36~100p',  price: 26000 },
    { label: '101~150p', price: 29000 },
    { label: '151~200p', price: 32000 },
    { label: '201~250p', price: 35000 },
    { label: '251~300p', price: 38000 },
  ];

  it('요청받은 5개 구간 단가가 그대로 나온다', () => {
    expect(PAGE_OPTIONS.map(o => optionPrice(o, 0)))
      .toEqual([26000, 29000, 32000, 35000, 38000]);
  });

  it('구간이 서로 겹치지 않는다', () => {
    const bounds = PAGE_OPTIONS.map(o => o.label.match(/^(\d+)~(\d+)p$/)!.slice(1).map(Number));
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i][0]).toBe(bounds[i - 1][1] + 1);  // 101=100+1, 151=150+1 ...
    }
  });

  it('문자열 옵션은 상품 기본가를 쓴다 — 기존 보드게임 동작 유지', () => {
    expect(optionPrice('한글판', 32000)).toBe(32000);
    expect(optionLabel('한글판')).toBe('한글판');
    expect(optionLabel({ label: '36~100p', price: 26000 })).toBe('36~100p');
  });

  it('옵션 미선택이면 기본가', () => {
    expect(optionPrice(undefined, 26000)).toBe(26000);
  });
});

describe('수량 단위 표시', () => {
  it("'1권'/'1개'처럼 명확하면 단위를 붙인다", () => {
    expect(qtyUnitFromLabel('1권')).toBe('권');   // 일기 제본
    expect(qtyUnitFromLabel('1개')).toBe('개');   // 보드게임
  });

  it('수량 단위가 애매한 상품에는 붙이지 않는다', () => {
    expect(qtyUnitFromLabel('10개 1세트')).toBe('');    // 키링 — 수량은 '세트' 수라 '개'는 오해를 준다
    expect(qtyUnitFromLabel('1학급 1개월')).toBe('');   // 마음일기 — 학급·개월 복합
  });

  it('값이 없으면 빈 문자열', () => {
    expect(qtyUnitFromLabel(undefined)).toBe('');
    expect(qtyUnitFromLabel(null)).toBe('');
    expect(qtyUnitFromLabel('')).toBe('');
  });
});
