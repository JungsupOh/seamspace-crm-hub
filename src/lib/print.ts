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
  pages: number;
  price: number | null;
}

export interface Quote {
  printable: boolean;
  reason?: string;
  totalPages: number;
  volumes: Volume[];
  productTotal: number;
  shippingFee: number;
  grandTotal: number;
  warnings: string[];
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
  quote: Quote;
}

export interface GeneratedFile {
  name: string;
  url: string;
  pages: number;
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

export function fetchStats(token: string, username: string) {
  return post<DiaryStats>('stats', { token, username });
}

/** 인쇄 구간이나 분책 경계가 바뀔 때 견적만 다시 계산한다(일기 재조회 없음). */
export function requote(monthly: MonthCount[], from: string, to: string, splits?: string[]) {
  return post<Quote>('quote', { monthly, from, to, splits });
}

/** 한 번에 한 권씩 만든다. 여러 권이면 화면이 순서대로 호출한다. */
export function generateVolume(token: string, username: string, from: string, to: string) {
  return post<GeneratedFile>('generate', { token, username, from, to });
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
