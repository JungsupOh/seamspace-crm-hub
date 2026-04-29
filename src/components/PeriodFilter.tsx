// 공용 기간 필터 — 5개 칩 (이번달/지난달/올해/작년/직접입력) + popover calendar
// 모든 페이지(Partners/Deals/Campaigns/Index/Licenses)에서 동일한 UX 사용.
import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PERIOD_OPTIONS, type PeriodValue } from '@/lib/period';
import type { DateRange } from 'react-day-picker';

interface PeriodFilterProps {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
  customFrom?: string;
  customTo?: string;
  onCustomChange?: (from: string, to: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string): Date | undefined => {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

export function PeriodFilter({
  value, onChange, customFrom, customTo, onCustomChange,
  size = 'sm', className = '',
}: PeriodFilterProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(() => ({
    from: parse(customFrom ?? ''),
    to: parse(customTo ?? ''),
  }));

  const isActive = (v: PeriodValue) => value === v;

  const handleRangeSelect = (r: DateRange | undefined) => {
    setRange(r);
    if (r?.from && r?.to) {
      onCustomChange?.(fmt(r.from), fmt(r.to));
      onChange('custom');
      // from/to 모두 선택되면 자동 닫지 않고 사용자가 닫게 둠 (재선택 가능)
    }
  };

  const handleCustomClick = () => {
    onChange('custom');
    setPopoverOpen(true);
  };

  const customLabel =
    customFrom && customTo ? `${customFrom.slice(5)} ~ ${customTo.slice(5)}` : '직접입력';

  const heightCls = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3 text-sm';

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {PERIOD_OPTIONS.map((opt) => {
        if (opt.id === 'custom') {
          return (
            <Popover key={opt.id} open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={handleCustomClick}
                  className={`${heightCls} rounded-full border transition-colors inline-flex items-center gap-1 ${
                    isActive('custom')
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  <CalendarIcon className="h-3 w-3" />
                  {isActive('custom') && customFrom && customTo ? customLabel : '직접입력'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={handleRangeSelect}
                  numberOfMonths={2}
                  defaultMonth={range?.from}
                />
                <div className="border-t border-border px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {range?.from ? fmt(range.from) : '시작일'} ~ {range?.to ? fmt(range.to) : '종료일'}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setPopoverOpen(false)}
                  >
                    닫기
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          );
        }
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`${heightCls} rounded-full border transition-colors ${
              isActive(opt.id)
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
