// 금액 입력 — 3자리 콤마 자동 표시. 내부 값은 number.
import { Input } from '@/components/ui/input';
import { forwardRef, type InputHTMLAttributes, type Ref } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | string | undefined | null;
  onValueChange: (n: number) => void;
  /** 0일 때 빈 문자열로 표시 (false면 "0"으로 표시) — 기본 true */
  blankWhenZero?: boolean;
};

export const AmountInput = forwardRef(function AmountInput(
  { value, onValueChange, blankWhenZero = true, className, ...rest }: Props,
  ref: Ref<HTMLInputElement>,
) {
  const num = typeof value === 'number' ? value : Number(value) || 0;
  const display = blankWhenZero && num === 0 ? '' : num.toLocaleString('ko-KR');

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, '');
        onValueChange(digits ? parseInt(digits, 10) : 0);
      }}
      className={className}
      {...rest}
    />
  );
});
