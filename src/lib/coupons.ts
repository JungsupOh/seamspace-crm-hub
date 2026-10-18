// ── 쿠폰 생성·발송 공용 API ─────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type SendType = 'buyer' | 'trial';

export async function apiCreateCoupon(description: string, duration: string, user_limit: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
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
