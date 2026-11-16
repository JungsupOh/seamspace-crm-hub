// order-lookup-quote 의 순수 로직 — 입력 검증, 본인 확인, 열 목록.
//
// 두 모드가 있다. 둘 다 **원본 화면이 요구하던 입력 그대로**다(화면을 바꾸지 않는다).
//   verify : 견적번호 + (이메일 또는 휴대폰)  — /order 의 견적 조회 패널
//   pay    : 견적번호만                      — /order/pay/:quoteNumber (견적 메일 링크)
//
// ⚠️ pay 모드의 한계는 원본 그대로다 — 견적번호를 아는 사람이면 연락처를 본다.
//    더 요구하려면 결제 화면을 바꿔야 하므로 이 단위에서는 바꾸지 않았다(§James 판단).

const MAX_QNUM = 64;
const MAX_EMAIL = 254;

/** 견적 조회 패널(QuoteRecord)이 쓰는 열. 결제 내부값(payment_key·paid_at·order_status)과
 *  내부 메모(notes)·원가성 값은 내보내지 않는다. */
export const QUOTE_COLS_VERIFY = [
  'id', 'deal_id', 'quote_number', 'plan', 'qty', 'license_qty', 'duration', 'items',
  'unit_price', 'supply_price', 'tax_amount', 'final_value', 'quote_date',
  'contact_phone', 'contact_email',
] as const;

/** 결제 화면이 쓰는 열(원본 select 와 같은 범위). */
export const QUOTE_COLS_PAY = [
  'quote_number', 'deal_id', 'contact_email', 'contact_phone',
  'buyer_email', 'buyer_name', 'buyer_phone', 'org_name',
  'plan', 'duration', 'qty', 'license_qty', 'items',
  'unit_price', 'final_value', 'supply_price', 'tax_amount',
] as const;

/** 연락처 보강용으로만 읽는 딜 열 — 딱 3개. deals 의 나머지 42개 열은 읽지 않는다. */
export const DEAL_CONTACT_COLS = ['contact_email', 'contact_name', 'contact_phone'] as const;

export type Verdict =
  | { ok: true; mode: 'verify'; quoteNumber: string; email: string; phone: string }
  | { ok: true; mode: 'pay'; quoteNumber: string }
  | { ok: false; status: 400; error: string };

export function normalizeEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}
export function normalizePhone(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : '';
}

export function validateInput(raw: unknown): Verdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => !['mode', 'quoteNumber', 'email', 'phone'].includes(k));
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const quoteNumber = typeof b.quoteNumber === 'string' ? b.quoteNumber.trim() : '';
  if (!quoteNumber || quoteNumber.length > MAX_QNUM || !/^[A-Za-z0-9._-]+$/.test(quoteNumber)) {
    return { ok: false, status: 400, error: '견적서를 찾을 수 없습니다. 번호를 다시 확인해 주세요.' };
  }

  if (b.mode === 'pay') return { ok: true, mode: 'pay', quoteNumber };

  const email = normalizeEmail(b.email);
  const phone = normalizePhone(b.phone);
  if (email.length > MAX_EMAIL) return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  // 원본과 같은 규칙 — 둘 중 하나는 있어야 한다.
  if (!email && !phone) {
    return { ok: false, status: 400, error: '이메일 또는 휴대폰 번호를 입력해 주세요.' };
  }
  return { ok: true, mode: 'verify', quoteNumber, email, phone };
}

export type MatchResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * 본인 확인 — 원본(OrderTest.tsx QuoteLookupPanel)의 판정을 **그대로** 옮겼다.
 *
 * 원본은 행을 받아 온 **뒤에** 브라우저에서 비교했다. 그래서 번호만 알면 행이 통째로 보였다.
 * 여기서는 같은 판정을 서버에서 하고, 통과했을 때만 열을 돌려준다.
 *
 * ⚠️ 원본의 마지막 분기를 보존한다 — 저장된 연락처가 **하나도 없으면** 통과시킨다
 *    (hasStoredContact && !emailOk && !phoneOk 일 때만 거절). 바꾸면 옛 견적 조회가 끊긴다.
 */
export function matchVerdict(
  row: { contact_email?: unknown; contact_phone?: unknown; buyer_email?: unknown; buyer_phone_normalized?: unknown } | null,
  entEmail: string,
  entPhone: string,
): MatchResult {
  if (!row) return { ok: false, error: '견적서를 찾을 수 없습니다. 번호를 다시 확인해 주세요.' };

  const storedEmail = normalizeEmail(row.contact_email ?? row.buyer_email ?? '');
  const storedPhone = normalizePhone(row.contact_phone ?? row.buyer_phone_normalized ?? '');
  const emailOk = !!entEmail && !!storedEmail && storedEmail === entEmail;
  const phoneOk = !!entPhone && !!storedPhone && storedPhone === entPhone;
  const hasStoredContact = !!(storedEmail || storedPhone);

  if (hasStoredContact && !emailOk && !phoneOk) {
    return { ok: false, error: '이메일 또는 휴대폰 번호가 일치하지 않습니다.' };
  }
  return { ok: true };
}
