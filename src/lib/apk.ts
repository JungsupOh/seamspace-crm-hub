// APK 구독관리 — CRUD 헬퍼 + Storage 업로드 + SHA256
// 심스페이스 Android 앱 sideload 배포 (Google Play 외 MDM 환경 대상)
// 사용자 노출 텍스트는 모두 '심스페이스' 사용. mDiary 표기 금지.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BUCKET = 'apk-files';

const HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// ── Types ────────────────────────────────────────────
export interface ApkVersion {
  id: string;
  version_name: string;
  version_code: number;
  file_path: string;
  file_size?: number;
  sha256?: string;
  changelog?: string;
  min_android?: string;
  uploaded_by?: string | null;
  is_latest: boolean;
  created_at: string;
}

export type SubscriberStatus = 'active' | 'paused' | 'unsubscribed';
export interface ApkSubscriber {
  id: string;
  email: string;
  school_name: string;
  school_code?: string | null;
  school_kind?: string | null;
  contact_name: string;
  phone?: string | null;
  memo?: string | null;
  status: SubscriberStatus;
  consent_at: string;
  created_by?: string | null;
  unsubscribe_token: string;
  created_at: string;
}

export interface ApkSendHistory {
  id: string;
  version_id: string;
  subscriber_id: string;
  sent_at: string;
  email_status: 'sent' | 'failed';
  error_message?: string | null;
}

export interface ApkDownload {
  id: string;
  version_id: string;
  subscriber_id?: string | null;
  email: string;
  downloaded_at: string;
  ip?: string | null;
  user_agent?: string | null;
}

// ── SHA256 (Web Crypto API) ──────────────────────────
export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Storage 업로드 ───────────────────────────────────
export async function uploadApkFile(versionName: string, file: File): Promise<{ path: string; url: string }> {
  if (!file.name.toLowerCase().endsWith('.apk')) {
    throw new Error('APK 파일만 업로드 가능합니다 (.apk 확장자)');
  }
  const ts = Date.now();
  const safe = versionName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 30) || 'v';
  const path = `releases/${ts}-${safe}.apk`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/vnd.android.package-archive',
      'x-upsert': 'false',
    },
    body: file,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `APK 업로드 실패 (${res.status})`);
  }
  return { path, url: `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}` };
}

// ── apk_versions CRUD ────────────────────────────────
export async function listApkVersions(): Promise<ApkVersion[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?order=version_code.desc`, { headers: HEADERS });
  if (!r.ok) throw new Error('버전 목록 조회 실패');
  return r.json();
}

export async function getLatestApkVersion(): Promise<ApkVersion | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?is_latest=eq.true&select=*&limit=1`, { headers: HEADERS });
  if (!r.ok) return null;
  const rows = await r.json() as ApkVersion[];
  return rows[0] ?? null;
}

export async function createApkVersion(v: Omit<ApkVersion, 'id' | 'created_at'>): Promise<ApkVersion> {
  // is_latest 처리: 새 버전이 is_latest=true면 기존 row 모두 false로
  if (v.is_latest) {
    await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?is_latest=is.true`, {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ is_latest: false }),
    }).catch(() => {});
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(v),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`버전 등록 실패: ${err}`);
  }
  const [row] = await r.json();
  return row as ApkVersion;
}

export async function deleteApkVersion(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?id=eq.${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!r.ok) throw new Error('버전 삭제 실패');
}

// ── apk_subscribers CRUD ─────────────────────────────
export async function listApkSubscribers(): Promise<ApkSubscriber[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers?order=created_at.desc`, { headers: HEADERS });
  if (!r.ok) throw new Error('구독자 목록 조회 실패');
  return r.json();
}

export async function findSubscriberByEmail(email: string): Promise<ApkSubscriber | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_subscribers?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    { headers: HEADERS },
  );
  if (!r.ok) return null;
  const rows = await r.json() as ApkSubscriber[];
  return rows[0] ?? null;
}

export async function findSubscriberByToken(token: string): Promise<ApkSubscriber | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
    { headers: HEADERS },
  );
  if (!r.ok) return null;
  const rows = await r.json() as ApkSubscriber[];
  return rows[0] ?? null;
}

export async function createSubscriber(input: {
  email: string;
  school_name: string;
  school_code?: string | null;
  school_kind?: string | null;
  contact_name: string;
  phone?: string | null;
  memo?: string | null;
  created_by?: string | null;
}): Promise<ApkSubscriber> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ ...input, status: 'active' }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`구독자 등록 실패: ${err}`);
  }
  const [row] = await r.json();
  return row as ApkSubscriber;
}

export async function updateSubscriberStatus(id: string, status: SubscriberStatus): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error('상태 변경 실패');
}

export async function deleteSubscriber(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers?id=eq.${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!r.ok) throw new Error('구독자 삭제 실패');
}

// ── 발송/다운로드 이력 조회 ──────────────────────────
export async function listSendHistoryByVersion(versionId: string): Promise<ApkSendHistory[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_send_history?version_id=eq.${versionId}&order=sent_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}

export async function listDownloadsByVersion(versionId: string): Promise<ApkDownload[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_downloads?version_id=eq.${versionId}&order=downloaded_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}

export async function listDownloadsByEmail(email: string): Promise<ApkDownload[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_downloads?email=eq.${encodeURIComponent(email)}&order=downloaded_at.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) return [];
  return r.json();
}
