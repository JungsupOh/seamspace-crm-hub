import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPhone(value: string): string {
  // 050[5-9]로 시작하는 안심번호는 12자리 4-4-4 split
  // 그 외 (010 등 일반 휴대전화)는 11자리 3-4-4 split
  const digits = value.replace(/\D/g, '');
  const isSafeNum = /^050[5-9]/.test(digits);
  const max = isSafeNum ? 12 : 11;
  const d = digits.slice(0, max);
  if (isSafeNum) {
    // 4-4-4
    if (d.length <= 4) return d;
    if (d.length <= 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`;
  }
  // 3-4-4 (기존)
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
