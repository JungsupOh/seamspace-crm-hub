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
  monthlyPublic: MonthCount[] | null;
  secret: SecretInfo;
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

export function fetchStats(token: string, username: string, mode?: SplitMode) {
  return post<DiaryStats>('stats', { token, username, mode });
}

/** 인쇄 구간·분책 경계·분권 방식이 바뀔 때 견적만 다시 계산한다(일기 재조회 없음). */
export function requote(
  monthly: MonthCount[], from: string, to: string, splits?: string[], mode?: SplitMode,
) {
  return post<Quote>('quote', { monthly, from, to, splits, mode });
}

export const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  cheapest: '최저가',
  balanced: '균등',
};

/** 한 번에 한 권씩 만든다. 여러 권이면 화면이 순서대로 호출한다. */
export function generateVolume(
  token: string, username: string, from: string, to: string, includeSecret = true,
) {
  return post<GeneratedFile>('generate', { token, username, from, to, includeSecret });
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
