// 공개 /apk/info 가 쓰는 조회 — 로그인하지 않은 방문자용 (HARD-B2a 에서 분리)
//
// findSubscriberByEmail 하나를 공개 /apk/info 와 관리자 /apk 가 함께 쓰고 있었다.
// 관리자 쪽은 로그인 토큰으로 옮겼고(lib/apk.ts), 공개 쪽만 여기 남긴다.
// HARD-B2b 에서 APK 조회를 서버 함수로 옮기면 이 파일은 사라진다.

import type { ApkSubscriber } from '@/lib/apk';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const PUBLIC_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

/** 공개 /apk/info 의 구독 조회. 동작은 원본과 같고 공개 키로 나간다. */
export async function publicFindSubscriberByEmail(email: string): Promise<ApkSubscriber | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_subscribers?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    { headers: PUBLIC_HEADERS },
  );
  if (!r.ok) return null;
  const rows = await r.json() as ApkSubscriber[];
  return rows[0] ?? null;
}
