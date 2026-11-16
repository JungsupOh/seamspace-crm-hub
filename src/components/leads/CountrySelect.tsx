// 국가 검색 선택 — LEAD-UI2 R3
//
// 한글 이름·영어 이름·코드 어느 것으로 쳐도 찾아진다. 저장 값은 **ISO 2자 코드**다.
// 코드표에 없는 값은 "직접 입력"으로 그대로 저장한다(지역은 '미분류'가 된다) —
// 운영에 `Ireland` 같은 자유 입력이 이미 있어서, 못 고르게 하면 그 값을 지우게 된다.

import { useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { countryLabel, findCountry, searchCountries } from '@/lib/countries';

export function CountrySelect({ value, onChange, id }: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCountries(q, 30), [q]);
  const known = findCountry(value);
  const typed = q.trim();
  // 표에 없는 값을 그대로 쓰는 길 — 결과가 없을 때만 보여 준다
  const showCustom = typed.length > 0 && results.length === 0;

  const pick = (code: string | null) => {
    onChange(code);
    setOpen(false);
    setQ('');
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setTimeout(() => inputRef.current?.focus(), 30); }}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open}
          className="h-9 w-full justify-between font-normal">
          <span className={value ? '' : 'text-muted-foreground'}>
            {value ? countryLabel(value) : '국가 선택'}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <div className="p-2 border-b">
          <Input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} className="h-8"
            placeholder="싱가포르 · Singapore · SG" />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {value && (
            <button type="button" onClick={() => pick(null)}
              className="w-full px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted">
              비우기
            </button>
          )}
          {results.map(c => (
            <button key={c.code} type="button" onClick={() => pick(c.code)}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2">
              {known?.code === c.code
                ? <Check className="h-3.5 w-3.5 shrink-0" />
                : <span className="w-3.5 shrink-0" />}
              <span>{c.ko}</span>
              <span className="text-muted-foreground text-xs">{c.en} · {c.code}</span>
            </button>
          ))}
          {showCustom && (
            <button type="button" onClick={() => pick(typed)}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted">
              <span className="text-muted-foreground">직접 입력:</span> {typed}
              <div className="text-xs text-muted-foreground mt-0.5">
                코드표에 없어 지역은 미분류가 됩니다.
              </div>
            </button>
          )}
          {!showCustom && results.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">찾는 국가가 없습니다.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
