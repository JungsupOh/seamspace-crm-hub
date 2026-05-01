// 공용 기간 필터 헬퍼 — 모든 페이지(Partners/Deals/Campaigns/Index/Licenses)에서
// 동일한 옵션과 매칭 로직을 사용하기 위한 유틸리티.
//
// 옵션: 이번달 / 지난달 / 올해 / 작년 / 직접입력 (5가지)
// 직접입력은 from-to YYYY-MM-DD 두 값을 받음.

export type PeriodValue = 'all' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom';

export const PERIOD_OPTIONS: { id: PeriodValue; label: string }[] = [
  { id: 'this_month', label: '이번달' },
  { id: 'last_month', label: '지난달' },
  { id: 'this_year',  label: '올해' },
  { id: 'last_year',  label: '작년' },
  { id: 'all',        label: '전체' },
  { id: 'custom',     label: '직접입력' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 기간 범위 (from/to YYYY-MM-DD) + 라벨 반환.
// custom이지만 customFrom/To가 비어있으면 매우 넓은 범위(2000~2099)로 사실상 전체.
export function getPeriodRange(
  value: PeriodValue,
  customFrom?: string,
  customTo?: string,
): { from: string; to: string; label: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  switch (value) {
    case 'all':
      return { from: '2000-01-01', to: '2099-12-31', label: '전체' };
    case 'this_month': {
      const start = new Date(yyyy, mm, 1);
      const end = new Date(yyyy, mm + 1, 0);
      return { from: fmt(start), to: fmt(end), label: `${fmt(start).slice(0, 7)} 이번달` };
    }
    case 'last_month': {
      const start = new Date(yyyy, mm - 1, 1);
      const end = new Date(yyyy, mm, 0);
      return { from: fmt(start), to: fmt(end), label: `${fmt(start).slice(0, 7)} 지난달` };
    }
    case 'this_year':
      return { from: `${yyyy}-01-01`, to: `${yyyy}-12-31`, label: `${yyyy}년` };
    case 'last_year':
      return { from: `${yyyy - 1}-01-01`, to: `${yyyy - 1}-12-31`, label: `${yyyy - 1}년` };
    case 'custom': {
      const from = customFrom || '2000-01-01';
      const to = customTo || '2099-12-31';
      const label = customFrom && customTo ? `${customFrom} ~ ${customTo}` : '직접입력';
      return { from, to, label };
    }
  }
}

// 주어진 날짜 문자열(YYYY-MM-DD 또는 ISO)이 기간 안에 있는지.
// date가 비거나 invalid면 false.
export function matchesPeriod(
  date: string | null | undefined,
  value: PeriodValue,
  customFrom?: string,
  customTo?: string,
): boolean {
  if (!date) return false;
  const d = date.length >= 10 ? date.slice(0, 10) : date;
  const { from, to } = getPeriodRange(value, customFrom, customTo);
  return d >= from && d <= to;
}

// 특정 날짜 필드 + 금액 필드로 row 배열 합산. 카드별 다른 날짜 기준 적용 시 사용.
export function sumByPeriod<T>(
  rows: T[],
  dateField: (row: T) => string | null | undefined,
  amountField: (row: T) => number | null | undefined,
  value: PeriodValue,
  customFrom?: string,
  customTo?: string,
): number {
  let sum = 0;
  for (const r of rows) {
    if (!matchesPeriod(dateField(r), value, customFrom, customTo)) continue;
    const a = amountField(r);
    if (a) sum += a;
  }
  return sum;
}
