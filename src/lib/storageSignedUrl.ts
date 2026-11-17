// 비공개 버킷 파일을 관리자 화면에서 여는 서명 URL 도우미 (비공개 전환 준비).
//
// 저장된 값은 두 모양이다(저장 형식은 바꾸지 않는다).
//   · 공개 URL  `${SUPABASE_URL}/storage/v1/object/public/<버킷>/<경로>`
//   · 상대 경로 `<버킷>/<경로>`
// 둘 다 (버킷, 경로)로 파싱하고, `authedFetch` 로 서명 URL 을 받는다.
// 서명이 실패하면(버킷이 아직 공개이거나, 관리자 SELECT 정책이 아직 없을 때)
// **기존 공개 URL 로 되돌아가** 화면이 깨지지 않는다.

import { authedFetch as defaultAuthedFetch, type AuthedFetch } from '@/lib/authedFetch';

export const SIGNED_URL_EXPIRES_SEC = 600; // 10분
const CACHE_MARGIN_MS = 30_000;            // 만료 30초 전부터는 새로 받는다

export interface StorageRef { bucket: string; path: string }

const PUBLIC_MARK = '/storage/v1/object/public/';

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** 저장된 값 → 버킷·경로. 알아볼 수 없으면 null. 경로는 **디코딩된 원문**(한글·공백 포함). */
export function parseStorageRef(stored: string | null | undefined): StorageRef | null {
  if (!stored || typeof stored !== 'string') return null;
  let rest: string;
  const trimmed = stored.trim();
  const i = trimmed.indexOf(PUBLIC_MARK);
  if (/^https?:\/\//i.test(trimmed)) {
    if (i < 0) return null;                       // 다른 사이트·다른 형식 URL
    rest = trimmed.slice(i + PUBLIC_MARK.length);
  } else {
    rest = trimmed.replace(/^\/+/, '');
  }
  rest = rest.split(/[?#]/)[0];
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  const bucket = safeDecode(rest.slice(0, slash));
  const path = safeDecode(rest.slice(slash + 1));
  if (!bucket || !path || path.split('/').some(seg => seg === '..')) return null;
  return { bucket, path };
}

/** 경로의 각 구간을 따로 인코딩(슬래시는 유지). */
export function encodeStoragePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** 서명 실패 때 돌아갈 공개 URL. 이미 URL 이면 그대로, 상대 경로면 만들어 준다. */
export function toPublicUrl(stored: string, supabaseUrl: string): string {
  if (/^https?:\/\//i.test(stored)) return stored;
  const ref = parseStorageRef(stored);
  if (!ref) return stored;
  return `${supabaseUrl}${PUBLIC_MARK}${encodeURIComponent(ref.bucket)}/${encodeStoragePath(ref.path)}`;
}

export interface SignedUrlDeps {
  authedFetch: AuthedFetch;
  supabaseUrl: string;
  apiKey: string;
  now: () => number;
}

export interface SignedUrlResolver {
  (stored: string): Promise<string>;
  clearCache: () => void;
}

export function createSignedUrlResolver(deps: SignedUrlDeps): SignedUrlResolver {
  const cache = new Map<string, { url: string; exp: number }>();

  const resolve = (async (stored: string): Promise<string> => {
    const fallback = toPublicUrl(stored, deps.supabaseUrl);
    const ref = parseStorageRef(stored);
    if (!ref) return fallback;
    const key = `${ref.bucket}/${ref.path}`;
    const hit = cache.get(key);
    if (hit && hit.exp - CACHE_MARGIN_MS > deps.now()) return hit.url;
    try {
      const res = await deps.authedFetch(
        `${deps.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(ref.bucket)}/${encodeStoragePath(ref.path)}`,
        {
          method: 'POST',
          headers: { apikey: deps.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRES_SEC }),
        });
      if (!res.ok) return fallback;
      const body = await res.json() as { signedURL?: string; signedUrl?: string };
      const signed = body.signedURL ?? body.signedUrl;
      if (!signed) return fallback;
      // 응답은 `/object/sign/<버킷>/<경로>?token=…` (또는 `/storage/v1` 포함) 상대 경로
      const url = /^https?:\/\//i.test(signed)
        ? signed
        : `${deps.supabaseUrl}${signed.startsWith('/storage/v1') ? '' : '/storage/v1'}${signed.startsWith('/') ? '' : '/'}${signed}`;
      cache.set(key, { url, exp: deps.now() + SIGNED_URL_EXPIRES_SEC * 1000 });
      return url;
    } catch {
      return fallback;
    }
  }) as SignedUrlResolver;
  resolve.clearCache = () => cache.clear();
  return resolve;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** 화면이 쓰는 기본 인스턴스. */
export const getSignedFileUrl = createSignedUrlResolver({
  authedFetch: (i, init) => defaultAuthedFetch(i, init),
  supabaseUrl: SUPABASE_URL,
  apiKey: SUPABASE_KEY,
  now: () => Date.now(),
});
