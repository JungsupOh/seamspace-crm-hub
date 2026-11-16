// 시장 모드(KR/INTL)와 리드 중복 판정 — LEAD-2 (CRM-011)
//
// 왜 필요한가
//   국내는 휴대폰으로 "누구인지" 알아본다. 해외는 휴대폰이 없는 경우가 많아 이메일이 열쇠다.
//   두 규칙이 섞이면 조용히 틀어진다 — 예를 들어 휴대폰이 없는 해외 리드끼리
//   `phone_normalized = ''` 가 되어 **서로 같은 사람으로 잡힌다.**
//   그래서 "무엇을 열쇠로 보는지"를 이 파일 한 곳에서만 정한다.
//
// 이 파일은 **순수 함수만** 둔다(DB·fetch 없음). 등록 입구가 셋이라
// (공개 폼 서버 함수 · 엑셀 가져오기 · 수동 등록) 각자 계산하면 반드시 어긋난다.

export type Market = 'KR' | 'INTL';

export const MARKETS: readonly Market[] = ['KR', 'INTL'] as const;

export const MARKET_LABEL: Record<Market, string> = {
  KR: '국내',
  INTL: '해외',
};

/** 알 수 없는 값은 국내로 본다 — DB 기본값이 'KR' 이고, 기존 행이 전부 국내다. */
export function toMarket(v: unknown): Market {
  return v === 'INTL' ? 'INTL' : 'KR';
}

/**
 * 해외 중복 판정 열쇠.
 *
 * ⚠️ 소문자·공백 정리를 **반드시** 거친다. `James@x.com ` 과 `james@x.com` 이
 *    다른 사람으로 들어가면 한 사람이 두 줄이 된다(브리프 A항).
 * 빈 값은 빈 문자열이 아니라 **null** 을 돌려준다 — 빈 문자열로 저장하면
 * 이메일 없는 리드끼리 서로 중복으로 잡힌다.
 */
export function normalizeLeadEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s ? s : null;
}

/** 국내 열쇠. 숫자만 남긴다(기존 `lib/phone.ts` 의 'kr' 규칙과 같다). */
export function normalizeLeadPhone(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : '';
}

export interface LeadKeyInput {
  market: Market;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
}

export type KeyVerdict =
  | { ok: true; market: Market; key: 'phone' | 'email'; value: string }
  | { ok: false; error: string };

/**
 * 이 리드의 열쇠가 무엇이고 유효한지.
 *
 * KR   : 휴대폰 필수 (현재 동작 그대로 — 바꾸지 않는다)
 * INTL : 이메일 필수, 휴대폰은 선택
 */
export function leadKey(input: LeadKeyInput): KeyVerdict {
  const market = toMarket(input.market);
  if (market === 'KR') {
    const phone = normalizeLeadPhone(input.phone);
    if (phone.length < 9) return { ok: false, error: '휴대폰 번호를 정확히 입력해 주세요.' };
    return { ok: true, market, key: 'phone', value: phone };
  }
  const email = normalizeLeadEmail(input.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: '이메일을 정확히 입력해 주세요.' };
  }
  return { ok: true, market, key: 'email', value: email };
}

export interface ExistingLead {
  id: string;
  market?: unknown;
  phone_normalized?: unknown;
  email_normalized?: unknown;
}

/**
 * 같은 캠페인 안에서 이미 등록된 사람인가.
 *
 * ⚠️ **국내 열쇠와 해외 열쇠를 섞지 않는다.** 같은 시장끼리만 비교한다.
 *    섞으면 (a) 휴대폰이 없는 해외 리드들이 서로 중복이 되고,
 *    (b) 회사 공용 메일을 쓰는 서로 다른 사람이 한 사람으로 합쳐진다.
 *
 * 교차 매칭(이메일↔휴대폰으로 같은 사람 찾기)은 **일부러 하지 않는다** —
 * 자동으로 합치면 되돌리기 어렵다. 화면은 "같은 사람일 수 있음" 표시만 보여 준다
 * (audit/lead1_design.md §6 ①).
 */
export function findDuplicate(input: LeadKeyInput, existing: readonly ExistingLead[]): ExistingLead | null {
  const k = leadKey(input);
  if (!k.ok) return null;
  for (const e of existing) {
    if (toMarket(e.market) !== k.market) continue;
    const v = k.key === 'phone'
      ? normalizeLeadPhone(e.phone_normalized)
      : normalizeLeadEmail(e.email_normalized);
    if (v && v === k.value) return e;
  }
  return null;
}

/**
 * 같은 사람일 **수 있는** 리드 — 다른 시장에서 반대 열쇠가 겹치는 경우.
 * 자동으로 합치지 않고 화면에 표시만 한다.
 */
export function findCrossMarketCandidates(
  input: LeadKeyInput, existing: readonly ExistingLead[],
): ExistingLead[] {
  const phone = normalizeLeadPhone(input.phone);
  const email = normalizeLeadEmail(input.email);
  const market = toMarket(input.market);
  return existing.filter(e => {
    if (toMarket(e.market) === market) return false;
    const ep = normalizeLeadPhone(e.phone_normalized);
    const ee = normalizeLeadEmail(e.email_normalized);
    return (!!phone && phone === ep) || (!!email && email === ee);
  });
}

/** 저장할 때 늘 같이 채우는 열쇠 칸들. 입구마다 다르게 채우면 중복 판정이 어긋난다. */
export function leadKeyColumns(input: LeadKeyInput): {
  market: Market;
  phone_normalized: string | null;
  email_normalized: string | null;
} {
  const market = toMarket(input.market);
  const phone = normalizeLeadPhone(input.phone);
  return {
    market,
    phone_normalized: phone || null,
    email_normalized: normalizeLeadEmail(input.email),
  };
}

/**
 * 알림톡을 보낼 수 있는가.
 *
 * 해외 리드에게는 보내지 않는다 — 알림톡은 국내 휴대폰 전용이고(카카오),
 * 번호가 없거나 해외 번호면 실패한다. 발송 경로를 타기 전에 여기서 막는다.
 */
export function canSendAlimtalk(input: { market?: unknown; phone?: unknown }): boolean {
  if (toMarket(input.market) !== 'KR') return false;
  return normalizeLeadPhone(input.phone).length >= 9;
}

/** "기존 고객" 판정을 할 수 있는가 — 국내 전용 개념(휴대폰으로 판정하기 때문). */
export function canCheckExistingCustomer(input: { market?: unknown; phone?: unknown }): boolean {
  return canSendAlimtalk(input);
}
