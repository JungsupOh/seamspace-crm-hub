// ── 상품/가격 유틸리티 (견적, 주문 공통) ──────────────

export interface QuoteLineItem {
  plan: string;
  duration: number;
  qty: number;
  unit_price: number;
  amount: number;
  s2b_number: string;
}

export const PLAN_LIST = ['소수학급플랜', '학급플랜', '학년플랜', '학교(소)', '학교(중)', '학교(대)'];
export const DURATION_OPTIONS = [1, 4, 6, 12];

export const PLAN_CAPACITY: Record<string, number> = {
  '소수학급플랜': 10, '학급플랜': 40, '학년플랜': 200, '학교(소)': 500, '학교(중)': 1000, '학교(대)': 99999,
};

// 학년플랜 이상 = "대형 플랜" — 이용권 무제한, 기간 중 전체 인원 커버
const BIG_PLANS = ['학년플랜', '학교(소)', '학교(중)', '학교(대)'];

const PRICING: Record<number, Record<string, number>> = {
  1:  { '학급플랜':  40000, '학년플랜':  180000, '학교(소)':  440000, '학교(중)':  850000, '학교(대)':  1200000 },
  4:  { '소수학급플랜': 40000, '학급플랜': 150000, '학년플랜':  700000, '학교(소)': 1700000, '학교(중)': 3300000, '학교(대)':  4600000 },
  6:  { '소수학급플랜': 60000, '학급플랜': 200000, '학년플랜': 1000000, '학교(소)': 2500000, '학교(중)': 4800000, '학교(대)':  6500000 },
  12: { '소수학급플랜': 100000, '학급플랜': 390000, '학년플랜': 1950000, '학교(소)': 4800000, '학교(중)': 9500000, '학교(대)': 11000000 },
};

export const S2B_MAP: Record<string, Record<number, string>> = {
  '학급플랜': { 1: '202408279365687', 4: '202408279366246', 6: '202408279366260', 12: '202408279366288' },
  '학년플랜': { 1: '202408279366329', 4: '202408279366637', 6: '202408279366713', 12: '202408279366732' },
  '학교(소)': { 1: '202408289369131', 4: '202408289369199', 6: '202408289369224', 12: '202408289369259' },
  '학교(중)': { 1: '202408299381787', 4: '202408299381806', 6: '202408299381871', 12: '202408299381889' },
  '학교(대)': { 1: '202408299381899', 4: '202408309387156', 6: '202408309387168', 12: '202408309387266' },
  '이벤트':   { 1: '202502100673587' },
};

export function getUnitPrice(plan: string, duration: number): number {
  return PRICING[duration]?.[plan] ?? 0;
}

export function getS2BNumber(plan: string, duration: number): string {
  return S2B_MAP[plan]?.[duration] ?? '';
}

export function makeItem(plan: string, duration: number, qty: number): QuoteLineItem {
  const unitPrice = getUnitPrice(plan, duration);
  return {
    plan, duration, qty,
    unit_price: unitPrice,
    amount: unitPrice * qty,
    s2b_number: getS2BNumber(plan, duration),
  };
}

// ── DP: 기간을 표준 단위(1,4,6,12개월)로 최저가 분해 ──
function decomposeDuration(months: number, plan: string): { period: number; count: number }[] {
  if (months <= 0) return [];
  const dp: { cost: number; combo: number[] }[] = Array.from(
    { length: months + 1 }, () => ({ cost: Infinity, combo: [] }),
  );
  dp[0] = { cost: 0, combo: [] };
  for (let i = 1; i <= months; i++) {
    for (const p of [12, 6, 4, 1]) {
      if (p > i) continue;
      const price = getUnitPrice(plan, p);
      if (!price) continue;
      const c = dp[i - p].cost + price;
      if (c < dp[i].cost) dp[i] = { cost: c, combo: [...dp[i - p].combo, p] };
    }
  }
  if (dp[months].cost === Infinity) return [];
  const grouped: Record<number, number> = {};
  for (const m of dp[months].combo) grouped[m] = (grouped[m] ?? 0) + 1;
  return Object.entries(grouped)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([period, count]) => ({ period: Number(period), count }));
}

// 분해 결과를 QuoteLineItem[]로 변환 (qty를 period 횟수에 곱함)
function decomposeToItems(months: number, plan: string, qtyPerPeriod: number): QuoteLineItem[] | null {
  const decomp = decomposeDuration(months, plan);
  if (!decomp.length) return null;
  return decomp.map(d => makeItem(plan, d.period, qtyPerPeriod * d.count));
}

function totalCost(items: QuoteLineItem[]): number {
  return items.reduce((s, it) => s + it.amount, 0);
}

// ── AI 추천: 최소 금액 조합 탐색 ──────────────────────
// 규칙:
// 1. 소수학급은 다른 플랜과 혼합 불가, 4개월+ 전용
// 2. 학급 단독: qty = 이용권 수량, 각 기간 분해마다 qty 적용
// 3. 대형(학년+) 포함 시: 대형이 기간 앞부분 커버 → 남은 기간은 학급이 초과인원만 커버
export function recommendItems(students: number, licenseQty: number, duration: number): QuoteLineItem[] {
  if (!students && !licenseQty && !duration) return [];
  const lq = Math.max(licenseQty || 1, 1);
  const st = Math.max(students || 0, 0);
  const dur = Math.max(duration || 1, 1);

  type Candidate = { items: QuoteLineItem[]; cost: number };
  const candidates: Candidate[] = [];
  const add = (items: QuoteLineItem[] | null) => {
    if (!items || items.some(it => !it.unit_price || it.qty <= 0)) return;
    candidates.push({ items, cost: totalCost(items) });
  };

  // ── 1. 소수학급 단독 (다른 플랜과 혼합 불가, 4개월+) ──
  if (dur >= 4 && lq * 10 >= st) {
    add(decomposeToItems(dur, '소수학급플랜', lq));
  }

  // ── 2. 학급 단독: 전체 기간 분해, qty = 이용권 수량 ──
  if (lq * 40 >= st) {
    add(decomposeToItems(dur, '학급플랜', lq));
  }

  // ── 3. 대형 플랜 단독 (인원 커버 시) ──
  for (const bp of BIG_PLANS) {
    if (PLAN_CAPACITY[bp] >= st) {
      add(decomposeToItems(dur, bp, 1));
    }
  }

  // ── 4. 대형 플랜 전체 기간 + 학급 필러 전체 기간 ──
  for (const bp of BIG_PLANS) {
    const excess = st - PLAN_CAPACITY[bp];
    if (excess <= 0) continue;
    const fillerQty = Math.ceil(excess / 40);
    const bigItems = decomposeToItems(dur, bp, 1);
    const fillerItems = decomposeToItems(dur, '학급플랜', fillerQty);
    if (bigItems && fillerItems) add([...bigItems, ...fillerItems]);
  }

  // ── 5. 하이브리드: 대형(앞 기간) + 학급 필러(나머지 기간 × 초과인원) ──
  // 대형 기간 중 전체 인원 커버 (무제한 이용권), 만료 후 초과분만 학급 커버
  for (const bp of BIG_PLANS) {
    const excess = st - PLAN_CAPACITY[bp];
    if (excess <= 0) continue;
    const fillerQty = Math.ceil(excess / 40);

    for (const bigPeriod of DURATION_OPTIONS) {
      const remaining = dur - bigPeriod;
      if (bigPeriod >= dur || remaining <= 0) continue;
      // 대형 플랜은 나머지 기간 이상이어야 함 (과반수 커버)
      if (bigPeriod < remaining) continue;
      const bigPrice = getUnitPrice(bp, bigPeriod);
      if (!bigPrice) continue;

      const fillerItems = decomposeToItems(remaining, '학급플랜', fillerQty);
      if (fillerItems) {
        add([makeItem(bp, bigPeriod, 1), ...fillerItems]);
      }
    }

    // 대형을 기간 분해(여러 period)로 + 학급 필러도 같은 구조
    const bigDecomp = decomposeDuration(dur, bp);
    if (bigDecomp.length > 1) {
      // 대형의 가장 큰 기간만 사용, 나머지는 학급 필러
      const largestPeriod = bigDecomp[0].period;
      const remaining = dur - largestPeriod;
      if (remaining > 0) {
        const fillerItems = decomposeToItems(remaining, '학급플랜', fillerQty);
        if (fillerItems) {
          add([makeItem(bp, largestPeriod, 1), ...fillerItems]);
        }
      }
    }
  }

  // ── 6. 학년 × N + 학급 필러 ──
  for (let ny = 2; ny <= Math.ceil(st / 200) && ny <= 5; ny++) {
    const covered = ny * 200;
    if (covered >= st) {
      add(decomposeToItems(dur, '학년플랜', ny));
    } else {
      const fq = Math.ceil((st - covered) / 40);
      const big = decomposeToItems(dur, '학년플랜', ny);
      const fill = decomposeToItems(dur, '학급플랜', fq);
      if (big && fill) add([...big, ...fill]);
    }
  }

  // ── 결과 ──
  if (!candidates.length) {
    return decomposeToItems(dur, '학급플랜', lq) ?? [makeItem('학급플랜', dur, lq)];
  }
  candidates.sort((a, b) => a.cost - b.cost);
  return candidates[0].items;
}

export function calcQuoteTotals(items: QuoteLineItem[], discountAmount: number) {
  const subtotal = items.reduce((sum, it) => sum + it.amount, 0);
  const finalValue = Math.max(subtotal - (discountAmount || 0), 0);
  const supplyPrice = Math.round(finalValue / 1.1);
  const taxAmount = finalValue - supplyPrice;
  return { subtotal, finalValue, supplyPrice, taxAmount };
}
