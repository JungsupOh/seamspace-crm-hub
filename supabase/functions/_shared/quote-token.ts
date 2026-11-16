// 견적 결제 링크 서명 토큰 — HARD-B2c
//
// 무엇을 막나
//   /order/pay/<견적번호> 는 **견적번호만으로** 연락처·금액을 보여 준다(원본 동작).
//   견적번호는 `2026-01-0007` 처럼 순번이라 **앞뒤로 세어 볼 수 있다**. 즉 번호를
//   맞히면 남의 견적을 열 수 있다. 조회 패널(verify)은 이미 이메일·전화를 대조하지만
//   결제 링크는 메일로 받은 사람이 바로 눌러야 해서 입력을 더 요구할 수 없다.
//
// 어떻게
//   메일 링크에 `?t=<만료>.<서명>` 을 붙이고 서버가 확인한다. 서명은 서버만 만들 수
//   있으므로 번호를 세어 보는 것으로는 못 만든다. **화면 입력과 문구는 그대로다** —
//   사용자는 링크를 누르는 것뿐이고, 바뀌는 것은 링크의 생김새다.
//
// 옛 링크를 끊지 않기 위한 2단계
//   ① 경고 모드(기본): 토큰이 없거나 틀려도 **지금처럼 열어 주고** 로그만 남긴다.
//      이미 나간 메일의 링크가 계속 동작한다.
//   ② 강제 모드: 환경변수 QUOTE_LINK_ENFORCE=1 을 켜면 토큰이 없거나 틀리면 거절한다.
//      옛 링크의 유효기간(견적 유효기간)이 지난 뒤에 켠다 — 절차는 결과 문서 §E-3.
//
// ⚠️ 서명 키(QUOTE_LINK_SECRET)가 **설정돼 있지 않으면 강제 모드로 가지 않는다.**
//    키가 없는데 강제하면 모든 결제 링크가 막힌다. 이 판정은 shouldEnforce() 한 곳에 모았다.

const enc = new TextEncoder();

/** base64url (패딩 없음) — 링크에 그대로 넣을 수 있게. */
function b64url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

/** 서명 대상 — 견적번호와 만료시각을 묶는다. 둘 중 하나만 바꿔도 서명이 깨진다. */
export function payload(quoteNumber: string, expSec: number): string {
  return `${quoteNumber}.${expSec}`;
}

/** 토큰 발급. `<만료(초)>.<서명>` 한 덩어리로 링크에 붙인다. */
export async function signPayToken(
  quoteNumber: string, secret: string, expSec: number,
): Promise<string> {
  return `${expSec}.${await hmac(secret, payload(quoteNumber, expSec))}`;
}

export type TokenCheck =
  | { valid: true }
  | { valid: false; reason: 'missing' | 'malformed' | 'expired' | 'bad-signature' | 'no-secret' };

/**
 * 토큰 확인.
 *
 * ⚠️ 서명 비교는 **길이가 같을 때만** 바이트를 모두 돌아 본다(조기 반환 금지).
 *    문자가 어디서 틀렸는지 시간으로 알려 주면 서명을 한 글자씩 맞혀 볼 수 있다.
 */
export async function verifyPayToken(
  quoteNumber: string, token: string | null | undefined, secret: string, nowSec: number,
): Promise<TokenCheck> {
  if (!secret) return { valid: false, reason: 'no-secret' };
  if (!token) return { valid: false, reason: 'missing' };

  const dot = token.indexOf('.');
  if (dot <= 0) return { valid: false, reason: 'malformed' };
  const expRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{1,12}$/.test(expRaw) || !sig) return { valid: false, reason: 'malformed' };

  const exp = Number(expRaw);
  if (exp < nowSec) return { valid: false, reason: 'expired' };

  const want = await hmac(secret, payload(quoteNumber, exp));
  if (!timingSafeEqual(want, sig)) return { valid: false, reason: 'bad-signature' };
  return { valid: true };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 거절해도 되는가.
 *
 * 키가 없으면 **절대 거절하지 않는다** — 키를 넣기 전에 강제 모드가 켜지면
 * 모든 결제 링크가 막힌다. 이 판정을 호출부에 흩어 놓지 않고 여기 한 곳에 둔다.
 */
export function shouldEnforce(secret: string, enforceFlag: string | undefined): boolean {
  return !!secret && enforceFlag === '1';
}

/** 기본 유효기간 — 견적 유효기간(30일)과 맞춘다. */
export const DEFAULT_TTL_SEC = 30 * 24 * 3600;
