// 배송비 계산 — 기본 + 도서산간 추가 + 5만원당 3,000원 할인

export interface RemoteArea {
  name: string;
  surcharge: number;
  match: (address: string) => boolean;
}

// 더 구체적인 매칭이 먼저 와야 함 (예: 제주 우도면이 제주도 일반보다 앞)
export const REMOTE_AREAS: RemoteArea[] = [
  { name: '제주 우도면',         surcharge: 6000, match: a => /제주.*우도면/.test(a) },
  { name: '제주 추자면',         surcharge: 7000, match: a => /제주.*추자면/.test(a) },
  { name: '울릉도',              surcharge: 8000, match: a => /울릉/.test(a) },
  { name: '신안군',              surcharge: 7000, match: a => /신안군/.test(a) },
  { name: '인천 강화군 교동·삼산·서도면', surcharge: 4500, match: a => /강화군.*(교동|삼산|서도)면/.test(a) },
  { name: '인천 옹진군',         surcharge: 6000, match: a => /옹진군/.test(a) },
  { name: '완도군 금일·금당면',  surcharge: 7000, match: a => /완도군.*(금일읍|금당면)/.test(a) },
  { name: '진도군 조도면',       surcharge: 7000, match: a => /진도군.*조도면/.test(a) },
  { name: '여수시 삼산면',       surcharge: 8000, match: a => /여수.*삼산면/.test(a) },
  { name: '부안군 위도면',       surcharge: 5000, match: a => /부안군.*위도면/.test(a) },
  { name: '군산시 옥도면',       surcharge: 5000, match: a => /군산.*옥도면/.test(a) },
  // 제주도 일반 (위 구체 매칭 외 제주 주소 전체)
  { name: '제주도',              surcharge: 3000, match: a => /제주특별자치도|제주도/.test(a) },
];

export function detectRemoteArea(address: string): RemoteArea | null {
  if (!address) return null;
  return REMOTE_AREAS.find(area => area.match(address)) ?? null;
}

const BASE_SHIPPING_FEE = 3000;
const FREE_SHIPPING_UNIT = 50000;
const FREE_SHIPPING_DISCOUNT = 3000;

export interface ShippingBreakdown {
  base: number;          // 기본 3,000원
  remoteSurcharge: number; // 도서산간 추가
  remoteArea: string | null;
  discount: number;      // 5만원당 3,000원 차감
  total: number;         // 최종 배송비 (음수 안 됨)
}

// subtotal 기준 5만원당 3,000원 할인 — 기본+도서산간 합계에서 차감, 0원까지
export function calcShipping(params: {
  subtotal: number;
  needsShipping: boolean;
  address?: string;
}): ShippingBreakdown {
  if (!params.needsShipping) {
    return { base: 0, remoteSurcharge: 0, remoteArea: null, discount: 0, total: 0 };
  }
  const remote = detectRemoteArea(params.address ?? '');
  const remoteSurcharge = remote?.surcharge ?? 0;
  const beforeDiscount = BASE_SHIPPING_FEE + remoteSurcharge;
  const discount = Math.floor((params.subtotal || 0) / FREE_SHIPPING_UNIT) * FREE_SHIPPING_DISCOUNT;
  const total = Math.max(0, beforeDiscount - discount);
  return {
    base: BASE_SHIPPING_FEE,
    remoteSurcharge,
    remoteArea: remote?.name ?? null,
    discount,
    total,
  };
}
