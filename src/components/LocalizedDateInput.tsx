// 파트너 언어를 따르는 날짜 입력.
//
// <input type="date">를 쓰지 않는 이유: 네이티브 달력의 표기(연/월/일, 요일, '오늘'/'삭제')는
// 브라우저 UI 언어로 그려지며 요소의 lang 속성으로는 바뀌지 않는다. 그래서 한국어 브라우저로
// 해외 파트너 포털을 열면 계약일만 한국어 달력이 떴다. react-day-picker로 직접 그려 통제한다.
//
// 값(value/onChange)은 기존과 동일하게 'YYYY-MM-DD' 문자열이라 호출부 교체 부담이 없다.

import { useState } from 'react';
import { format, parse, isValid } from 'date-fns';
import { ko, ja, enUS } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { PartnerLocale } from '@/lib/partner-i18n';

const LOCALES = { ko, ja, en: enUS };

const DISPLAY_FORMAT: Record<PartnerLocale, string> = {
  ko: 'yyyy-MM-dd',
  ja: 'yyyy-MM-dd',
  en: 'yyyy-MM-dd',
};

const PLACEHOLDER: Record<PartnerLocale, string> = {
  ko: '날짜 선택',
  ja: '日付を選択',
  en: 'Select a date',
};

const CLEAR_LABEL: Record<PartnerLocale, string> = {
  ko: '지우기',
  ja: 'クリア',
  en: 'Clear',
};

const TODAY_LABEL: Record<PartnerLocale, string> = {
  ko: '오늘',
  ja: '今日',
  en: 'Today',
};

interface Props {
  /** 'YYYY-MM-DD' 또는 '' */
  value: string;
  onChange: (value: string) => void;
  locale?: PartnerLocale;
  className?: string;
  disabled?: boolean;
}

export function LocalizedDateInput({ value, onChange, locale = 'ko', className, disabled }: Props) {
  const [open, setOpen] = useState(false);

  const parsed = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;

  const commit = (d: Date | undefined) => {
    onChange(d ? format(d, 'yyyy-MM-dd') : '');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm',
            'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {selected ? format(selected, DISPLAY_FORMAT[locale]) : PLACEHOLDER[locale]}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={LOCALES[locale]}
          selected={selected}
          defaultMonth={selected}
          onSelect={commit}
          initialFocus
        />
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => commit(undefined)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {CLEAR_LABEL[locale]}
          </button>
          <button
            type="button"
            onClick={() => commit(new Date())}
            className="text-xs text-primary hover:underline"
          >
            {TODAY_LABEL[locale]}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
