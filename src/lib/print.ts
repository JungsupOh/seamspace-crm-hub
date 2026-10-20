// 일기 제본(/print) API 클라이언트.
//
// 백엔드는 Vercel Python 함수(api/print/*.py)다. PDF 렌더러가 reportlab이라
// Supabase Edge Function(Deno)에서 돌릴 수 없어서 이쪽만 Python으로 간다.
//
// 가격 계산을 여기 두지 않고 매번 /api/print/quote 를 부르는 건 의도적이다.
// 같은 계산이 TS와 Python 두 벌로 있으면 언젠가 어긋나고, 어긋나면
// 견적 금액과 실제 인쇄물이 달라진다.

export interface PrintSession {
  token: string;
  username: string;
  name: string;
}

export interface MonthCount {
  ym: string;      // '2026-03'
  count: number;
}

export interface Volume {
  volume: number;
  from: string;
  to: string;
  months: string[];
  diaries: number;      // 실제 일기 편수
  blanks: number;       // 판형 제약(짝수·최소 50p)을 맞추려고 들어간 빈 페이지
  pages: number;        // 인쇄 페이지 수 = diaries + blanks. 가격은 이 값으로 매긴다
  price: number | null;
}

/** 제작 업체. 페이지 규칙과 단가가 업체마다 다르다. */
export type Vendor = 'ddukddak' | 'sweetbook';

export interface PriceBand {
  from: number;
  to: number;
  price: number;
}

export interface VendorInfo {
  vendor: Vendor;
  label: string;
  spec: string | null;      // 스위트북 판형 코드 (뚝딱샵은 null)
  pageMin: number;
  pageMax: number;
  pageIncrement: number;    // 1이면 페이지 수 제약 없음
  minDiaries: number;
  frontPages: number;       // 맨 앞 간지 (1장 = 2면)
  naturalMin: number;       // 백지를 안 덧대고 찍을 수 있는 최소 편수
  shippingFee: number;
  trimWidthMm: number;    // 재단 크기. 인쇄 캔버스는 여기에 도련 3mm 를 더한다
  trimHeightMm: number;
  trimLabel: string;      // '신국판 152×225' 처럼 화면에 그대로 쓴다

  /** 가격 모델. 업체마다 다르다 — 둘 중 하나의 필드 묶음만 채워진다. */
  pricing: 'bands' | 'blocks';
  bands?: PriceBand[];        // pricing='bands' (뚝딱샵)
  basePrice?: number;         // pricing='blocks' (스위트북) — 1권째 기본료, VAT 포함
  extraBasePrice?: number;    // 2권째부터의 기본료
  blockPages?: number;        // 추가 단위 (10p)
  blockPrice?: number;        // 추가 단위당 가격, VAT 포함
}

/** 업체 카드에 쓸 한 줄 요약. 모델이 둘이라 분기가 필요하다. */
export function vendorPriceSummary(v: VendorInfo): string {
  if (v.pricing === 'blocks' && v.basePrice != null) {
    return `${v.basePrice.toLocaleString('ko-KR')}원 + ${v.blockPages}p당 `
      + `${(v.blockPrice ?? 0).toLocaleString('ko-KR')}원`;
  }
  const from = v.bands?.[0]?.price ?? 0;
  return `${from.toLocaleString('ko-KR')}원부터`;
}

/** 자동 분권 방식. 가격이 구간제라 균등이 최저가보다 비쌀 수 있다. */
export type SplitMode = 'cheapest' | 'balanced';

/** 두 분권 방식을 나란히 비교하기 위한 요약 (quote 응답에 함께 실려 온다) */
export interface SplitOption {
  mode: SplitMode;
  printable: boolean;
  reason?: string;
  volumeCount: number;
  totalPages: number;
  productTotal: number;
  grandTotal: number;
  pages: number[];
}

export interface Quote {
  printable: boolean;
  reason?: string;
  /** 편수가 최소에 모자라 뒤에 백지를 덧대야 하는 상태. 채울지는 사용자가 고른다. */
  needsPadding: boolean;
  padPages: number;         // 덧댈 백지 면 수
  padSheets: number;        // 그 면 수를 종이 장수로 (2면 = 1장)
  vendor: VendorInfo;
  mode?: SplitMode;
  options?: SplitOption[];
  totalDiaries: number;
  totalPages: number;
  volumes: Volume[];
  productTotal: number;
  shippingFee: number;
  grandTotal: number;
  warnings: string[];
}

/** 비밀글(isSecret) 현황. 판별이 안 되면 제외 옵션 자체를 막아야 한다. */
export interface SecretInfo {
  detectable: boolean;
  field: string | null;
  count: number;      // 확실한 비밀글 수
  unknown: number;    // 판별 불가(필드 없음) — 제외 시 같이 빠진다
  observedFields: string[];   // 서버 응답이 바뀌었을 때 원인 추적용 (값은 안 옴)
}

export interface SkippedEntry {
  id: number | null;
  date: string | null;
  traffic: string | null;
}

export interface DiaryStats {
  username: string;
  total: number;
  renderable: number;
  skipped: SkippedEntry[];
  skippedCount: number;
  firstDate: string | null;
  lastDate: string | null;
  monthly: MonthCount[];
  /** 비밀글을 뺀 월별 집계. 토글할 때 일기를 재조회하지 않으려고 같이 받는다. */
  /** 작성자 실제 이름 (diary 응답의 name). 표지에 들어간다. */
  name: string;
  monthlyPublic: MonthCount[] | null;
  secret: SecretInfo;
  vendors: VendorInfo[];
  quote: Quote;
}

/** 스위트북에 만들어진 책 한 권 (generate 응답에 실려 온다) */
export interface SweetbookBook {
  bookUid: string;
  spec: string;
  env: 'sandbox' | 'live';
  title: string;
  externalRef: string;
}

/** 표지 PDF. 업체마다 형태가 다르다 — 스위트북은 펼침면 1장, 뚝딱샵은 앞/뒤 낱장 2장. */
export interface CoverFile {
  name: string;
  url: string;
  bytes: number;
  layout: 'spread' | 'pages';
  widthMm: number;
  heightMm: number;
  spineWidthMm: number | null;
  spineText: string | null;
}

export interface ShippingInput {
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  address1: string;
  address2?: string;
  memo?: string;
}

/** 스위트북 충전금 차감 예정액. 우리 판매가와는 별개다(원가). */
export interface SweetbookEstimate {
  env: 'sandbox' | 'live';
  productAmount: number;
  shippingFee: number;
  boxCount: number;
  packagingFee: number;
  totalAmount: number;
  paidCreditAmount: number;
  creditBalance: number;
  creditSufficient: boolean;
}

export interface PlacedOrder {
  ok: true;
  env: 'sandbox' | 'live';
  orderRef: string;     // 우리 주문번호. 알림톡·CS 에서 쓰는 값이다
  saved: boolean;       // 주문 내역을 DB 에 남겼는지 (실패해도 주문 자체는 성립한다)
  order: { orderUid: string; orderStatus: string; orderStatusDisplay: string; totalAmount: number };
  payment: { orderId: string; method: string | null; approvedAt: string | null;
             receiptUrl: string | null; totalAmount: number };
}

export interface GeneratedFile {
  name: string;
  url: string;
  vendor?: Vendor;
  pages: number;
  blanks?: number;      // 업체 페이지 규칙을 맞추려고 채운 빈 페이지
  cover?: CoverFile;    // 표지 PDF — 업체 무관하게 항상 만들어진다
  book?: SweetbookBook; // 스위트북 모드일 때만. 이미 FINALIZED 상태다
  bytes: number;
  skipped: { id: number | null; date: string | null; reason: string }[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/print/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // Python 함수가 죽으면 Vercel이 HTML 에러 페이지를 준다 — JSON이 아니다.
    throw new Error(`서버 응답을 읽지 못했습니다 (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const message = (data as { error?: string })?.error;
    throw new Error(message || `요청이 실패했습니다 (HTTP ${res.status})`);
  }
  return data as T;
}

export function login(username: string, password: string) {
  return post<PrintSession>('login', { username, password });
}

export function fetchStats(
  token: string, username: string, mode?: SplitMode, vendor?: Vendor,
) {
  return post<DiaryStats>('stats', { token, username, mode, vendor });
}

/** 인쇄 구간·분책 경계·분권 방식이 바뀔 때 견적만 다시 계산한다(일기 재조회 없음). */
export function requote(
  monthly: MonthCount[], from: string, to: string,
  splits?: string[], mode?: SplitMode, vendor?: Vendor,
  allowPadding?: boolean,
) {
  return post<Quote>('quote', { monthly, from, to, splits, mode, vendor, allowPadding });
}

export const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  cheapest: '최저가',
  balanced: '균등',
};

/** 한 번에 한 권씩 만든다. 여러 권이면 화면이 순서대로 호출한다. */
export function generateVolume(
  token: string, username: string, from: string, to: string,
  includeSecret = true, vendor?: Vendor,
  opts?: { volume?: number; volumeCount?: number; name?: string },
) {
  return post<GeneratedFile>('generate', {
    token, username, from, to, includeSecret, vendor, ...opts,
  });
}

/** 스위트북 충전금 차감 예정액. 결제창을 띄우기 전에 보여준다. */
export function estimateOrder(bookUids: string[]) {
  return post<SweetbookEstimate>('order', { action: 'estimate', bookUids });
}

/**
 * 주문과 함께 저장할 맥락.
 *
 * 스위트북 웹훅은 orderUid 만 알려 주므로, 이 값들을 남겨 두지 않으면
 * 나중에 "이게 누구 주문인지" 를 되짚을 수 없어 알림톡을 보낼 수 없다.
 */
export interface OrderContext {
  username: string;
  name?: string;
  vendor: Vendor;
  includeSecret: boolean;
  volumes: { volume: number; from: string; to: string; pages: number; price: number | null }[];
  productAmount: number;
  shippingFee: number;
  totalAmount: number;
}

/** 결제 승인 → 제작 주문. 순서가 바뀌면 안 된다(order.py 주석 참고). */
export function placeOrder(params: {
  bookUids: string[]; shipping: ShippingInput; context: OrderContext;
  // Sandbox 에서는 결제를 받지 않는다(order.py 가 서버에서도 막는다)
  paymentKey?: string; orderId?: string; amount?: number;
}) {
  return post<PlacedOrder>('order', { action: 'place', ...params });
}

const SESSION_KEY = 'print_session';

export function loadSession(): PrintSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as PrintSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: PrintSession | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 시크릿 창 등에서 sessionStorage가 막혀 있어도 화면은 계속 동작해야 한다.
  }
}

export function formatWon(n: number) {
  return `${n.toLocaleString('ko-KR')}원`;
}

/** '2026-03' -> '2026년 3월' */
export function formatYm(ym: string) {
  const [y, m] = ym.split('-');
  return `${y}년 ${Number(m)}월`;
}
