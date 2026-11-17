// 파트너 요청(추가 구매·무효화)의 **순수 부분** — LEAD-S7-4
//
// 판정과 문구만 여기 둔다. DB·네트워크는 index.ts 가 한다.
// 순수하게 떼어 두면 vitest 로 돌려 볼 수 있다(엣지 함수는 돌려 보기 어렵다).

export const REQUEST_KINDS = ['purchase', 'revoke'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export function toKind(v: unknown): RequestKind | null {
  return typeof v === 'string' && (REQUEST_KINDS as readonly string[]).includes(v)
    ? (v as RequestKind) : null;
}

export type Locale = 'en' | 'ko' | 'ja';

export function pickLocale(v: unknown): Locale {
  if (typeof v !== 'string') return 'en';
  const s = v.toLowerCase();
  if (s.startsWith('ko')) return 'ko';
  if (s.startsWith('ja')) return 'ja';
  return 'en';
}

export type RequestError =
  | 'BAD_KIND' | 'TARGET_REQUIRED' | 'BAD_SEAT_MONTHS'
  | 'ALREADY_OPEN' | 'TOO_MANY' | 'NOT_YOURS' | 'NOT_ALLOWED';

/** 분당 몇 건까지 받는가. 사람이 누르는 버튼이라 넉넉해도 폭주는 막힌다. */
export const RATE_LIMIT_PER_MINUTE = 5;

export interface ParsedRequest {
  kind: RequestKind;
  contractId: string | null;
  licenseId: string | null;
  seatMonths: number | null;
  reason: string | null;
}

/** 요청 수량. 비면 null(얼마가 필요한지 모를 수 있다). 0·소수·음수는 거부. */
function seatsOrNull(v: unknown): number | null | 'bad' {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return 'bad';
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 'bad';
}

function textOrNull(v: unknown, max = 500): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s.slice(0, max);
}

/**
 * 들어온 본문을 다듬는다.
 *
 * ⚠️ **`partner_id` 는 읽지 않는다.** 호출자 프로필에서 서버가 정한다 —
 *    본문에서 받으면 남의 파트너 이름으로 요청을 만들 수 있다.
 */
export function parseRequest(body: unknown): { ok: true; value: ParsedRequest }
  | { ok: false; error: RequestError } {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = toKind(b.kind);
  if (!kind) return { ok: false, error: 'BAD_KIND' };

  const contractId = typeof b.contractId === 'string' && b.contractId ? b.contractId : null;
  const licenseId = typeof b.licenseId === 'string' && b.licenseId ? b.licenseId : null;

  if (kind === 'purchase' && !contractId) return { ok: false, error: 'TARGET_REQUIRED' };
  if (kind === 'revoke' && !licenseId) return { ok: false, error: 'TARGET_REQUIRED' };

  const seats = seatsOrNull(b.seatMonths);
  if (seats === 'bad') return { ok: false, error: 'BAD_SEAT_MONTHS' };

  return {
    ok: true,
    value: {
      kind,
      // 종류에 맞는 것만 들고 간다 — 반대쪽이 섞여 들어오면 CHECK 가 막지만
      // 애초에 보내지 않는 쪽이 낫다.
      contractId: kind === 'purchase' ? contractId : null,
      licenseId: kind === 'revoke' ? licenseId : null,
      seatMonths: kind === 'purchase' ? seats : null,
      reason: textOrNull(b.reason),
    },
  };
}

/** 누가 요청을 보낼 수 있나. 게스트(viewer)는 보지만 **보내지는 못한다**. */
export function canRequest(role: unknown): boolean {
  return role === 'partner_admin' || role === 'partner_member'
    || role === 'admin' || role === 'sub_admin';
}

// ───────────────────────── 문구 ─────────────────────────

const MSG: Record<RequestError, Record<Locale, string>> = {
  BAD_KIND: {
    ko: '요청 종류를 알 수 없습니다.',
    ja: 'リクエストの種類が不明です。',
    en: 'Unknown request type.',
  },
  TARGET_REQUIRED: {
    ko: '어떤 계약(또는 이용권)에 대한 요청인지 알 수 없습니다.',
    ja: 'どの契約（またはライセンス）に対する依頼か不明です。',
    en: 'We could not tell which contract (or license) this request is about.',
  },
  BAD_SEAT_MONTHS: {
    ko: '희망 수량은 1 이상 정수여야 합니다.',
    ja: '希望数量は1以上の整数で入力してください。',
    en: 'The requested amount must be a whole number of 1 or more.',
  },
  ALREADY_OPEN: {
    ko: '이미 접수된 요청이 있습니다. 확인하는 대로 연락드리겠습니다.',
    ja: 'すでに受付済みの依頼があります。確認のうえご連絡します。',
    en: 'We already have an open request for this. We will get back to you shortly.',
  },
  TOO_MANY: {
    ko: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
    ja: 'リクエストが多すぎます。しばらくしてからお試しください。',
    en: 'Too many requests. Please try again in a moment.',
  },
  NOT_YOURS: {
    ko: '이 요청을 보낼 수 없습니다.',
    ja: 'この依頼は送信できません。',
    en: 'You cannot send this request.',
  },
  NOT_ALLOWED: {
    ko: '요청을 보낼 권한이 없습니다. 파트너 관리자에게 문의해 주세요.',
    ja: '依頼を送信する権限がありません。パートナー管理者にお問い合わせください。',
    en: 'You do not have permission to send requests. Please ask your partner administrator.',
  },
};

export function errorMessage(code: RequestError, locale: Locale): string {
  return MSG[code][locale] ?? MSG[code].en;
}

const OK_MSG: Record<RequestKind, Record<Locale, string>> = {
  purchase: {
    ko: '추가 구매 요청을 보냈습니다. 확인하고 연락드리겠습니다.',
    ja: '追加購入のご依頼を受け付けました。確認のうえご連絡します。',
    en: 'Your request for an additional purchase has been sent. We will get back to you.',
  },
  revoke: {
    // ⚠️ "껐다"고 오해하지 않게 — 쿠폰이 즉시 꺼지지 않는다는 것을 문구에 담는다.
    ko: '사용 불가 처리 요청을 보냈습니다. 이미 발급된 쿠폰이 즉시 꺼지지는 않으며, 처리 후 안내드립니다.',
    ja: '利用停止のご依頼を受け付けました。発行済みのクーポンがすぐに無効になるわけではありません。処理後にご連絡します。',
    en: 'Your request has been sent. The coupon that was already issued does not stop working immediately — we will confirm once it is handled.',
  },
};

export function okMessage(kind: RequestKind, locale: Locale): string {
  return OK_MSG[kind][locale] ?? OK_MSG[kind].en;
}

/** 텔레그램 한 줄. **개인정보를 넣지 않는다** — 파트너 이름·수량·식별자 앞자리만. */
export function telegramText(args: {
  kind: RequestKind;
  partnerName: string;
  targetId: string;
  seatMonths: number | null;
  reason: string | null;
}): string {
  const head = args.kind === 'purchase' ? '🛒 <b>추가 구매 요청</b>' : '🚫 <b>사용 불가 처리 요청</b>';
  const target = args.kind === 'purchase' ? '계약' : '이용권';
  const seats = args.seatMonths !== null
    ? `\n📦 희망 수량 ${args.seatMonths.toLocaleString('ko-KR')} 인원·개월` : '';
  // 사유는 파트너가 적은 글이라 **개인정보가 섞일 수 있다** → 넣지 않고 "있음"만 알린다.
  const reason = args.reason ? '\n📝 사유 있음 (CRM 에서 확인)' : '';
  return `${head}\n\n🤝 ${args.partnerName}\n🔖 ${target} ${args.targetId.slice(0, 8)}${seats}${reason}`;
}
