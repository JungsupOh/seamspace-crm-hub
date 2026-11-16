// 공개 /apk/info·/apk/unsubscribe 가 쓰는 입구 — 서버 함수 apk-lookup 경유 (HARD-B2b)
//
// 원본은 `apk_subscribers?select=*` 로 구독자 행을 통째로 받았다. 거기에는
// **unsubscribe_token** 이 들어 있다 — 그 값이면 남의 구독을 해지할 수 있다.
// 이제 서버가 화면에 필요한 열만 돌려준다(토큰은 나가지 않는다).

import { callPublicFn } from '@/lib/public/publicApi';
import type { ApkSubscriber, ApkDownload } from '@/lib/apk';

export interface ApkInfoResult {
  subscriber: ApkSubscriber | null;
  downloads: ApkDownload[];
}

/** 이메일로 구독 정보 + 내려받기 이력을 한 번에 받는다. */
export async function publicApkInfo(email: string): Promise<ApkInfoResult> {
  try {
    const d = await callPublicFn<Partial<ApkInfoResult>>('apk-lookup', { action: 'info', email });
    return { subscriber: d.subscriber ?? null, downloads: Array.isArray(d.downloads) ? d.downloads : [] };
  } catch {
    return { subscriber: null, downloads: [] };
  }
}

export type UnsubState = 'notfound' | 'already' | 'done';
export interface UnsubResult { state: UnsubState | 'error'; email?: string; message: string }

/** 해지 토큰 처리. 상태 변경은 서버(service_role)가 한다. */
export async function publicApkUnsubscribe(token: string): Promise<UnsubResult> {
  try {
    const d = await callPublicFn<Partial<UnsubResult> & { error?: string }>(
      'apk-lookup', { action: 'unsubscribe', token });
    if (d.state && d.message) return { state: d.state as UnsubState, email: d.email, message: d.message };
    return { state: 'error', message: d.error ?? '처리 중 오류가 발생했습니다.' };
  } catch {
    return { state: 'error', message: '처리 중 오류가 발생했습니다.' };
  }
}
