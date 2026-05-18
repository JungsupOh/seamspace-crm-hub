// APK 구독관리 — CRUD 헬퍼 + Storage 업로드 + SHA256
// 심스페이스 Android 앱 sideload 배포 (Google Play 외 MDM 환경 대상)
// 사용자 노출 텍스트는 모두 '심스페이스' 사용. mDiary 표기 금지.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BUCKET = 'apk-files';

// SELECT용 (anon SELECT 정책 있는 테이블).
const HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// INSERT/UPDATE/DELETE 용 — RLS 정책 'TO authenticated' 통과를 위해 로그인 세션 access_token 사용.
// anon key 로는 mutation 시 RLS 차단 (42501 insufficient_privilege).
async function authHeaders(): Promise<Record<string, string>> {
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_KEY;
  return {
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
}

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
// apk-files 는 private bucket (RLS 'TO authenticated').
// 단일 POST 는 Supabase 프로젝트 글로벌 한도(기본 50MB)에 걸리므로
// 100MB+ APK 는 TUS resumable upload (6MB 청크) 사용 — 글로벌 한도와 무관.
// supabase client 의 storage upload 는 단일 POST 만 지원하므로 tus-js-client 직접 사용.
export async function uploadApkFile(
  versionName: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ path: string; url: string }> {
  if (!file.name.toLowerCase().endsWith('.apk')) {
    throw new Error('APK 파일만 업로드 가능합니다 (.apk 확장자)');
  }
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');

  const tus = await import('tus-js-client');
  const ts = Date.now();
  const safe = versionName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 30) || 'v';
  const path = `releases/${ts}-${safe}.apk`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: BUCKET,
        objectName: path,
        contentType: 'application/vnd.android.package-archive',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024,        // 6MB — Supabase TUS 권장값
      onError: (err) => reject(new Error(`APK 업로드 실패: ${err.message ?? err}`)),
      onProgress: (sent, total) => {
        if (onProgress && total > 0) onProgress(Math.round((sent / total) * 100));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });

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
  const h = await authHeaders();
  if (v.is_latest) {
    await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?is_latest=is.true`, {
      method: 'PATCH',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify({ is_latest: false }),
    }).catch(() => {});
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
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
  // DB row 삭제 전에 Storage 파일도 삭제 — 고아 파일 방지
  const fetchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_versions?id=eq.${id}&select=file_path`,
    { headers: HEADERS },
  );
  if (fetchRes.ok) {
    const rows = await fetchRes.json() as { file_path: string | null }[];
    const path = rows[0]?.file_path;
    if (path) {
      const { supabase } = await import('./supabase');
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    }
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!r.ok) throw new Error('버전 삭제 실패');
}

// ── Storage 파일만 삭제 (DB row 보존 — 발송/다운로드 이력 유지) ─────
// file_path 를 NULL 로 마킹해서 UI에서 "파일 없음" 표시 + 다운로드 차단.
export async function deleteApkFileOnly(id: string): Promise<void> {
  const fetchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_versions?id=eq.${id}&select=file_path`,
    { headers: HEADERS },
  );
  if (!fetchRes.ok) throw new Error('버전 조회 실패');
  const rows = await fetchRes.json() as { file_path: string | null }[];
  const path = rows[0]?.file_path;
  if (!path) return;  // 이미 파일 없음

  const { supabase } = await import('./supabase');
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Storage 파일 삭제 실패: ${error.message}`);

  // DB는 file_path/sha256/file_size 만 null 처리 (이력 보존)
  const upd = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), Prefer: 'return=minimal' },
    body: JSON.stringify({ file_path: null, sha256: null, file_size: null }),
  });
  if (!upd.ok) throw new Error('DB 마킹 실패');
}

// ── 오래된 버전 파일 일괄 정리 — 최근 N개만 보존 ──────────────────
// 정책: version_code 내림차순으로 정렬해 상위 KEEP_RECENT 개의 파일만 보존,
//      나머지는 Storage 파일만 삭제 (DB row + 발송/다운로드 이력은 유지).
// 기본값 2개 — 사용자 요청: "가장 최근의 2개 파일만 보관".
const KEEP_RECENT_FILES = 2;

export async function cleanupOldApkFiles(
  keepRecent: number = KEEP_RECENT_FILES,
): Promise<{ deleted: number; bytesFreed: number; kept: number }> {
  // file_path 가 살아있는 버전만 정리 대상. version_code desc.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_versions?file_path=not.is.null&select=id,version_code,file_path,file_size&order=version_code.desc`,
    { headers: HEADERS },
  );
  if (!r.ok) throw new Error('정리 대상 조회 실패');
  const rows = await r.json() as { id: string; version_code: number; file_path: string; file_size: number | null }[];

  const toDelete = rows.slice(keepRecent);  // 상위 keepRecent 개 제외
  if (toDelete.length === 0) return { deleted: 0, bytesFreed: 0, kept: rows.length };

  const { supabase } = await import('./supabase');
  const paths = toDelete.map(x => x.file_path);
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(`Storage 일괄 삭제 실패: ${error.message}`);

  // DB 일괄 마킹 — id IN (...) — 이력 보존, 파일 메타만 NULL
  const ids = toDelete.map(x => x.id).join(',');
  await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?id=in.(${ids})`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), Prefer: 'return=minimal' },
    body: JSON.stringify({ file_path: null, sha256: null, file_size: null }),
  });

  const bytesFreed = toDelete.reduce((sum, x) => sum + (x.file_size ?? 0), 0);
  return { deleted: toDelete.length, bytesFreed, kept: Math.min(rows.length, keepRecent) };
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
    headers: { ...(await authHeaders()), Prefer: 'return=representation' },
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
    headers: { ...(await authHeaders()), Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error('상태 변경 실패');
}

export async function deleteSubscriber(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!r.ok) throw new Error('구독자 삭제 실패');
}

// ── 발송/다운로드 이력 조회 ──────────────────────────
export async function listSendHistoryByVersion(versionId: string): Promise<ApkSendHistory[]> {
  // apk_send_history 는 RLS 'TO authenticated' 만 — anon SELECT 정책 없음
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/apk_send_history?version_id=eq.${versionId}&order=sent_at.desc`,
    { headers: await authHeaders() },
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
