// ── 딜 사용자(이용권 수신자) CRUD ────────────────────

import { authedFetch } from '@/lib/authedFetch';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BASE_URL = `${SUPABASE_URL}/rest/v1/deal_users`;
// 관리자 화면·파트너 포털 전용 — Authorization 은 authedFetch 가 로그인 세션 토큰으로 붙인다 (HARD-B2a).
// 이 모듈에는 공개 경로에서 불리는 함수가 없다(호출 그래프로 확인).
const ADMIN_HEADERS: Record<string, string> = {
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

export interface DealUser {
  id: string;
  deal_id: string;
  user_name?: string;
  user_phone?: string;
  user_email?: string;
  student_count?: number;
  month_count?: number;
  plan_name?: string;
  is_primary?: boolean;
  created_at: string;
  updated_at: string;
}

export type DealUserInput = Omit<DealUser, 'id' | 'deal_id' | 'created_at' | 'updated_at'>;

export async function getDealUsers(dealId: string): Promise<DealUser[]> {
  const res = await authedFetch(
    `${BASE_URL}?deal_id=eq.${encodeURIComponent(dealId)}&order=is_primary.desc,created_at.asc`,
    { headers: ADMIN_HEADERS }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function saveDealUsers(dealId: string, users: DealUserInput[]): Promise<DealUser[]> {
  // 기존 사용자 삭제 후 새로 생성 (upsert 대신 replace)
  await authedFetch(`${BASE_URL}?deal_id=eq.${encodeURIComponent(dealId)}`, {
    method: 'DELETE',
    headers: ADMIN_HEADERS,
  });
  if (users.length === 0) return [];
  const rows = users.map(u => ({ ...u, deal_id: dealId }));
  const res = await authedFetch(BASE_URL, {
    method: 'POST',
    headers: { ...ADMIN_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `사용자 저장 실패: ${res.status}`);
  }
  return res.json();
}
