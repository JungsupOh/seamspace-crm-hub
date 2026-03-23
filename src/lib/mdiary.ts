// mDiary 운영 DB 연동 — Supabase Edge Function 경유

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface CouponStatusRow {
  coupon_code:       string;
  is_used:           number;  // 0: 미사용(대기), 1: 등록됨
  used_group_id:     number | null;
  service_expire_at: string | null; // "YYYY-MM-DD" or null
}

/** 쿠폰코드 목록 → 운영DB 사용현황 조회 */
export async function getCouponStatuses(codes: string[]): Promise<CouponStatusRow[]> {
  if (codes.length === 0) return [];

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/get-coupon-status`,
    {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ codes }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `쿠폰 조회 실패: ${res.status}`);
  }

  return res.json();
}

/** 운영DB 데이터 → LicenseStatus 변환 */
export function resolveLicenseStatus(
  row: CouponStatusRow | undefined,
): '대기' | '사용중' | '만료' | '이탈' {
  if (!row || !row.is_used) return '대기';
  if (row.service_expire_at) {
    const expiry = new Date(row.service_expire_at);
    if (expiry < new Date()) return '만료';
  }
  return '사용중';
}
