// 고객용 일기책 주문 API (/api/print/customer/*)
//
// 관리자용 print.ts 와 엔드포인트가 다르다. 가장 큰 차이는 **조회 대상을 서버가 정한다**는 것 —
// 로그인할 때 받은 session 문자열에 username 이 서명돼 있어서, 화면이 다른 아이디를
// 보내도 서버가 무시한다. 그래서 여기 함수들에는 username 인자가 없다.
//
// 타입 중 Quote·Volume·MonthCount·VendorInfo·ShippingInput 은 관리자용과 같으므로
// print.ts 에서 가져다 쓴다(견적 계산은 /api/print/quote 공용 엔드포인트다).

import type {
  MonthCount, Quote, ShippingInput, SplitMode, VendorInfo, Volume,
} from './print';

const SESSION_KEY = 'print_customer_session';

export interface CustomerSession {
  session: string;          // 서명된 세션. mDiary 토큰은 이 안에 있고 밖으로 안 나온다
  username: string;
  name: string;
}

export interface CustomerStats {
  username: string;
  name: string;
  total: number;
  renderable: number;
  skippedCount: number;
  firstDate: string | null;
  lastDate: string | null;
  monthly: MonthCount[];
  monthlyPublic: MonthCount[] | null;
  secret: { detectable: boolean; count: number; unknown: number };
  vendor: VendorInfo;
  quote: Quote;
}

/** 미리보기 — 표지 앞면과 내지 앞 2페이지. 나머지는 내려오지 않는다. */
export interface PreviewResult {
  cover: string | null;     // data:image/png;base64,...
  pages: string[];
  shownPages: number;
  totalPages: number;
  truncated: boolean;       // true 면 "3페이지부터 생략" 안내를 띄운다
}

export interface PreparedBook {
  volume: number;
  from: string;
  to: string;
  pages: number;
  blanks: number;
}

export interface PreparedOrder {
  books: PreparedBook[];
  totalPages: number;
  bookTicket: string;       // 주문 권한. 금액이 묶여 있어 화면에서 못 바꾼다
  items: { volume: number; pages: number; price: number | null }[];
  productAmount: number;
  shippingFee: number;
  totalAmount: number;
  /** false 면 Sandbox — 서버가 결제를 거부하므로 결제창을 띄우지 않는다. */
  paymentEnabled: boolean;
}

export interface CustomerOrderResult {
  ok: true;
  orderRef: string;
  volumes: { volume: number; from: string; to: string; pages: number }[];
  totalAmount: number;
  saved: boolean;
  paid: boolean;
  receiptUrl: string | null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/print/customer/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(`서버 응답을 읽지 못했습니다 (HTTP ${res.status})`);
  }
  const err = (data as { error?: string })?.error;
  if (!res.ok || err) throw new Error(err || `요청에 실패했습니다 (HTTP ${res.status})`);
  return data as T;
}

export function customerLogin(username: string, password: string) {
  return post<CustomerSession>('login', { username, password });
}

export function fetchCustomerStats(session: string, mode?: SplitMode) {
  return post<CustomerStats>('stats', { session, mode });
}

export function fetchPreview(
  session: string, from: string, to: string,
  includeSecret: boolean, volume = 1, volumeCount = 1,
) {
  return post<PreviewResult>('preview', { session, from, to, includeSecret, volume, volumeCount });
}

/** 권별 PDF 생성 + 스위트북 등록. 여기까지는 결제 전이라 과금되지 않는다. */
export function prepareBooks(
  session: string,
  volumes: Pick<Volume, 'volume' | 'from' | 'to'>[],
  includeSecret: boolean,
) {
  return post<PreparedOrder>('generate', {
    session,
    volumes: volumes.map(v => ({ volume: v.volume, from: v.from, to: v.to })),
    includeSecret,
  });
}

export function placeCustomerOrder(params: {
  session: string;
  bookTicket: string;
  shipping: ShippingInput;
  includeSecret: boolean;
  // Sandbox 에서는 서버가 결제를 거부한다
  paymentKey?: string;
  orderId?: string;
  amount?: number;
}) {
  return post<CustomerOrderResult>('order', params);
}

// ── 세션 보관 ────────────────────────────────────────
// sessionStorage 를 쓴다. 탭을 닫으면 사라지는 쪽이 공용 PC 에서 안전하고,
// 세션 자체도 2시간이면 만료된다.
export function loadCustomerSession(): CustomerSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as CustomerSession) : null;
  } catch {
    return null;
  }
}

export function saveCustomerSession(s: CustomerSession | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 시크릿 창 등에서 막혀 있어도 화면은 계속 동작해야 한다.
  }
}
