// send-email-authed 의 순수 로직 — 인증 판정 / 역할 판정 / 본문 검증.
//
// I/O 가 없다. 운영 DB 도 실제 발송도 없이 vitest 로 검증할 수 있게 떼어 둔다
// (admin-issue-coupon 과 같은 방식, 021-6).

// ── 1) JWT 헤더 판정 (admin-issue-coupon 과 같은 규칙) ──

export type AuthVerdict =
  | { ok: true; jwt: string }
  | { ok: false; status: 401; error: string };

export function authVerdict(authHeader: string | null | undefined): AuthVerdict {
  const header = authHeader ?? '';
  if (!header.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing authorization header' };
  }
  const jwt = header.replace('Bearer ', '');
  if (!jwt.trim()) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
  return { ok: true, jwt };
}

// ── 2) 역할 판정 ──────────────────────────────────────────
//
// 허용: admin, sub_admin, partner_admin.
//
// partner_member·partner_viewer 를 뺀 근거 — 메일을 보내는 화면 경로가 셋뿐이고
// 전부 partner_admin 이상으로 막혀 있다:
//   · partner-issue-license/index.ts:69-70 — 파트너는 partner_admin 만 발급 가능
//     (발급 직후의 유료 영어 메일이 partner-licenses.ts:117 에서 나간다)
//   · AuthContext.tsx:237 — canManageLicenses = can_issue_licenses && role==='partner_admin'
//     (주석: 발급/재발송/무효화/코드열람)
//   · PartnerPortal.tsx:837·867·1162 — 재발송 버튼이 canManageLicenses 로 게이팅.
//     PartnerPortal.tsx:894 주석도 "viewer 에겐 이미 숨김" 이라고 적고 있다.
// 즉 member·viewer 는 오늘도 메일 경로에 닿지 못한다 → 막아도 화면 동작이 안 바뀐다.
//
// user_metadata 는 보지 않는다. 사용자가 스스로 고칠 수 있는 값이라
// role=admin 을 적어 넣으면 통과하게 된다(021-6b).

export const ALLOWED_ROLES = ['admin', 'sub_admin', 'partner_admin'] as const;
export type AllowedRole = typeof ALLOWED_ROLES[number];

export type RoleVerdict =
  | { ok: true; role: AllowedRole }
  | { ok: false; status: 403; error: string };

export function roleVerdict(profileRole: string | null | undefined): RoleVerdict {
  const role = (profileRole ?? '').trim();
  if (!(ALLOWED_ROLES as readonly string[]).includes(role)) {
    return { ok: false, status: 403, error: 'Not allowed' };
  }
  return { ok: true, role: role as AllowedRole };
}

// ── 3) 본문 검증 ──────────────────────────────────────────
//
// 상한은 CRM-022 의 실측값을 통과해야 한다:
//   en 7개 2.82MB · ja 7개 약 4.60MB · ko 6개 약 4.58MB (원본 바이트)
//   첨부는 base64 라 약 1.34배 → ja 기준 약 6.3MB.
// 그래서 전체 12MB, 첨부 1개 9MB, 첨부 12개까지 허용한다.

export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 9 * 1024 * 1024;
export const MAX_ATTACHMENTS = 12;
export const MAX_RECIPIENTS = 10;
export const MAX_CC = 10;
export const MAX_SUBJECT = 300;

/** send-email 이 읽는 필드. 이 목록에 없는 키는 거절한다. */
export const ALLOWED_FIELDS = ['to', 'subject', 'html', 'text', 'reply_to', 'cc', 'attachments'] as const;

export type MailBody = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  /** 있는 그대로 넘긴다 — null·'' 은 send-email 의 RESEND_DEFAULT_CC 를 **끄는 신호**다. */
  cc?: string | string[] | null;
  attachments?: Array<{ filename: string; content: string }>;
};

export type BodyVerdict =
  | { ok: true; value: MailBody }
  | { ok: false; status: 400 | 413; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emails(v: unknown): string[] | null {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : null;
  if (Array.isArray(v)) {
    const out = v.filter(x => typeof x === 'string').map(x => (x as string).trim()).filter(Boolean);
    return out.length > 0 ? out : null;
  }
  return null;
}

export function validateBody(raw: unknown): BodyVerdict {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: '본문이 올바르지 않습니다.' };
  }
  const body = raw as Record<string, unknown>;

  // 모르는 필드는 거절한다 — send-email 에 그대로 흘려보내지 않는다.
  const unknown = Object.keys(body).filter(k => !(ALLOWED_FIELDS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return { ok: false, status: 400, error: `허용되지 않은 필드: ${unknown.join(', ')}` };
  }

  // 원본 send-email 과 같은 필수값 규칙
  const to = emails(body.to);
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const html = typeof body.html === 'string' ? body.html : '';
  if (!to || !subject || !html) {
    return { ok: false, status: 400, error: '필수 파라미터 누락' };
  }
  if (to.length > MAX_RECIPIENTS) {
    return { ok: false, status: 400, error: `수신자가 너무 많습니다 (최대 ${MAX_RECIPIENTS})` };
  }
  if (to.some(a => !EMAIL_RE.test(a))) {
    return { ok: false, status: 400, error: '수신자 이메일이 올바르지 않습니다.' };
  }
  if (subject.length > MAX_SUBJECT) {
    return { ok: false, status: 400, error: '제목이 너무 깁니다.' };
  }

  const out: MailBody = { to: body.to as string | string[], subject, html };

  if (body.text !== undefined) {
    if (typeof body.text !== 'string') return { ok: false, status: 400, error: 'text 가 올바르지 않습니다.' };
    out.text = body.text;
  }
  if (body.reply_to !== undefined) {
    if (typeof body.reply_to !== 'string' || !EMAIL_RE.test(body.reply_to.trim())) {
      return { ok: false, status: 400, error: 'reply_to 가 올바르지 않습니다.' };
    }
    out.reply_to = body.reply_to.trim();
  }

  // cc — **값을 바꾸지 않는다.** null·'' 도 그대로 넘겨야 CRM-002 의 cc_sales 토글이 산다.
  if ('cc' in body) {
    const cc = body.cc;
    if (cc === null || cc === '') {
      out.cc = cc as null | '';
    } else {
      const list = emails(cc);
      if (!list) return { ok: false, status: 400, error: 'cc 가 올바르지 않습니다.' };
      if (list.length > MAX_CC) return { ok: false, status: 400, error: `참조가 너무 많습니다 (최대 ${MAX_CC})` };
      if (list.some(a => !EMAIL_RE.test(a))) return { ok: false, status: 400, error: '참조 이메일이 올바르지 않습니다.' };
      out.cc = cc as string | string[];
    }
  }

  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) {
      return { ok: false, status: 400, error: '첨부가 올바르지 않습니다.' };
    }
    if (body.attachments.length > MAX_ATTACHMENTS) {
      return { ok: false, status: 400, error: `첨부가 너무 많습니다 (최대 ${MAX_ATTACHMENTS})` };
    }
    const atts: Array<{ filename: string; content: string }> = [];
    for (const a of body.attachments) {
      if (!a || typeof a !== 'object') return { ok: false, status: 400, error: '첨부가 올바르지 않습니다.' };
      const { filename, content } = a as Record<string, unknown>;
      if (typeof filename !== 'string' || !filename.trim()) {
        return { ok: false, status: 400, error: '첨부 파일명이 없습니다.' };
      }
      if (typeof content !== 'string' || !content) {
        return { ok: false, status: 400, error: '첨부 내용이 없습니다.' };
      }
      if (content.length > MAX_ATTACHMENT_BYTES) {
        return { ok: false, status: 413, error: '첨부 파일이 너무 큽니다.' };
      }
      atts.push({ filename, content });
    }
    out.attachments = atts;
  }

  const total = JSON.stringify(out).length;
  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, status: 413, error: '메일 용량이 너무 큽니다.' };
  }
  return { ok: true, value: out };
}

/**
 * send-email 에 넘길 본문을 만든다.
 *
 * **값을 하나도 바꾸지 않는다.** 특히 cc 는 "없음(키 자체가 없음)" 과
 * "null·''(기본 참조 끄기)" 가 서로 다른 뜻이라, 있는 그대로 옮긴다.
 */
export function buildForwardBody(v: MailBody): Record<string, unknown> {
  const body: Record<string, unknown> = { to: v.to, subject: v.subject, html: v.html };
  if (v.text !== undefined) body.text = v.text;
  if (v.reply_to !== undefined) body.reply_to = v.reply_to;
  if (v.attachments !== undefined) body.attachments = v.attachments;
  if ('cc' in v) body.cc = v.cc;
  return body;
}
