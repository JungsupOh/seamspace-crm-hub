// ── 쿠폰 생성·발송 공용 API ─────────────────────────

import { authedFetch } from '@/lib/authedFetch';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type SendType = 'buyer' | 'trial';

/**
 * 관리자 쿠폰 생성 — `admin-issue-coupon` 경유 (HARD-A H-2).
 *
 * 전에는 `create-coupon` 을 **공개 키로 직접** 불렀다. 그 함수는 인증을 보지 않아
 * 번들에서 키만 꺼내면 누구나 쿠폰을 무제한으로 만들 수 있었다(009-6 발견).
 * 이제 로그인 세션 토큰으로 `admin-issue-coupon` 을 부르고, 그 함수가 호출자 역할이
 * admin·sub_admin 인지 확인한 뒤 내부에서 create-coupon 을 호출한다(021-6).
 *
 * 응답 모양(`{ coupon_code }`)과 이 함수의 시그니처·오류 문구는 그대로다 —
 * 호출부는 고치지 않아도 된다.
 *
 * 공개 경로(공개 캠페인 폼·럭키세븐 폼)는 더 이상 이 함수를 쓰지 않는다.
 * 캠페인 신청은 서버 함수 campaign-submit-lead 가 대신하고(H-2), 럭키세븐 공개 폼은
 * 라우트에서 분리됐다(H-1). 그래서 "로그인 필요" 로 바꿔도 공개 경로가 깨지지 않는다.
 */
export async function apiCreateCoupon(description: string, duration: string, user_limit: string): Promise<string> {
  const res = await authedFetch(`${SUPABASE_URL}/functions/v1/admin-issue-coupon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ description, duration, user_limit }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '쿠폰 생성 실패');
  return data.coupon_code;
}

export async function apiSendCoupon(params: {
  first_name: string;
  phone: string;
  coupon_code: string;
  user_limit: string;
  duration: string;
  send_type: SendType;
}): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-coupon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '발송 실패');
}

/**
 * 견적에서 발급할 이용권 **장수**를 센다.
 *
 * `qty` 는 총인원(명)이라 장수로 쓸 수 없다 — 같은 컬럼에 40·80·200(인원)과
 * 1·2·3(장수)이 섞여 저장돼 있다. 그래서 "40명 2개월 2장"(qty 80, license_qty 2)과
 * "160명 1개월 1장"(qty 160, license_qty 1)을 qty 로는 구분하지 못한다.
 *
 * 우선순위: license_qty → 견적 항목 수량 합 → 1장.
 * **qty 로 폴백하지 않는다.** 160명 1장짜리가 160장이 되는 사고가 난다.
 */
export function resolveLicenseQty(q: {
  license_qty?: number | null;
  items?: { qty?: number | string | null }[] | null;
}): number {
  if (q.license_qty != null && q.license_qty > 0) return Math.floor(q.license_qty);
  const fromItems = (q.items ?? []).reduce((sum, it) => sum + (Number(it?.qty) || 0), 0);
  return fromItems > 0 ? Math.floor(fromItems) : 1;
}
