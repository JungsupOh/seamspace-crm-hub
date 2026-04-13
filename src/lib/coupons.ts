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
