// apk-lookup 의 순수 로직 — 입력 검증과 열 목록.
//
// 두 가지 일을 한다(공개 /apk/info 와 /apk/unsubscribe 가 쓰던 것).
//   action='info'        이메일로 구독 정보 + 내려받기 이력 조회
//   action='unsubscribe' 해지 토큰으로 상태 변경
//
// "알고 있다는 증거": info 는 이메일 정확 일치, unsubscribe 는 토큰(원본과 같다).

export const MAX_DOWNLOADS = 50;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[A-Za-z0-9._-]{8,200}$/;

/** 화면(ApkInfo)이 쓰는 열만.
 *  **unsubscribe_token 은 절대 내보내지 않는다** — 그 값이면 남의 구독을 해지할 수 있다.
 *  memo(내부 메모)·created_by(담당자)·school_code·consent_at 도 뺀다. */
export const SUBSCRIBER_COLS = ['school_name', 'contact_name', 'phone', 'status', 'created_at'] as const;

/** 내려받기 이력 — ip·user_agent 는 뺀다(본인 것이어도 화면에 쓰지 않는다). */
export const DOWNLOAD_COLS = ['id', 'downloaded_at'] as const;

export type Action = 'info' | 'unsubscribe';
export type Verdict =
  | { ok: true; action: 'info'; email: string }
  | { ok: true; action: 'unsubscribe'; token: string }
  | { ok: false; status: 400; error: string };

export function validateInput(raw: unknown): Verdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
  }
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => !['action', 'email', 'token'].includes(k));
  if (unknown.length > 0) return { ok: false, status: 400, error: '허용되지 않은 필드가 있습니다.' };

  const action = b.action;
  if (action === 'info') {
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
      return { ok: false, status: 400, error: '이메일을 정확히 입력해 주세요.' };
    }
    return { ok: true, action: 'info', email };
  }
  if (action === 'unsubscribe') {
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    if (!token || !TOKEN_RE.test(token)) {
      return { ok: false, status: 400, error: '링크가 올바르지 않습니다.' };
    }
    return { ok: true, action: 'unsubscribe', token };
  }
  return { ok: false, status: 400, error: '요청이 올바르지 않습니다.' };
}

/** 해지 결과 판정 — 원본 ApkUnsubscribe.tsx 의 분기와 문구를 그대로 옮겼다. */
export type UnsubResult =
  | { state: 'notfound'; message: string }
  | { state: 'already'; email: string; message: string }
  | { state: 'done'; email: string; message: string };

export function unsubscribeVerdict(rows: unknown): UnsubResult | null {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      state: 'notfound',
      message: '해당 토큰에 매칭되는 구독자를 찾을 수 없습니다. 이미 처리된 링크이거나 잘못된 링크일 수 있습니다.',
    };
  }
  const sub = rows[0] as { email?: string; status?: string };
  if (sub.status === 'unsubscribed') {
    return { state: 'already', email: String(sub.email ?? ''), message: '이미 구독이 취소되어 있습니다.' };
  }
  return null;   // 상태 변경이 필요하다 — 핸들러가 PATCH 한 뒤 done 을 만든다
}
