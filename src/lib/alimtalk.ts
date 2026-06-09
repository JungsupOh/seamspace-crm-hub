// 알림톡 발송 클라이언트 + 발송 이력 조회
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// REST API 조회용 (apikey + Authorization)
const REST_HEADERS = {
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

// Edge Function 호출용 (Authorization만 — send-coupon과 동일 패턴)
const FN_HEADERS = {
  Authorization:  `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

export type LicenseSource = 'deal' | 'mdiary' | 'campaign';
export type AlimtalkTpl   = 'UD_5369' | 'UH_2821';

export interface AlimtalkRecipient {
  license_id:     string;
  license_source: LicenseSource;
  name:           string;
  phone:          string;
  group_name?:    string | null;
  user_limit:     string;
  duration:       string;
  expiry_date?:   string | null;
  coupon_code?:   string | null;
  partner_name?:  string | null;   // 파트너 경유 딜이면 파트너명 (발송창 표시용 — 직접 발송 주의)
}

export interface SendResult {
  sent:    number;
  skipped: number;
  failed:  number;
  details: Array<{ license_id: string; status: 'sent' | 'skipped' | 'failed'; error?: string }>;
}

export async function apiSendAlimtalk(params: {
  recipients: AlimtalkRecipient[];
  tpl_code:   AlimtalkTpl;
  stage:      string;
  sent_by?:   string;
}): Promise<SendResult> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-alimtalk`, {
    method:  'POST',
    headers: FN_HEADERS,
    body:    JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '알림톡 발송 실패');
  return data as SendResult;
}

// ── 발송 이력 ───────────────────────────────────────
export interface SendLogEntry {
  id:             string;
  license_id:     string;
  license_source: LicenseSource;
  tpl_code:       string;
  stage:          string;
  sent_at:        string;
  success:        boolean;
}

// 최근 60일 이내 성공 발송 이력 조회 (만기 알림 D-7 stage는 충분히 추적 가능)
export async function getRecentSendLogs(): Promise<SendLogEntry[]> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/alimtalk_send_logs`
    + `?success=eq.true&sent_at=gte.${since}`
    + `&select=id,license_id,license_source,tpl_code,stage,sent_at,success`
    + `&order=sent_at.desc`;
  const res = await fetch(url, { headers: REST_HEADERS });
  if (!res.ok) return [];
  return await res.json();
}

// 특정 라이선스의 stage별 발송 여부 맵
// key 형식: `${license_source}:${license_id}:${tpl_code}:${stage}`
export function buildSentMap(logs: SendLogEntry[]): Set<string> {
  return new Set(logs.map(l => `${l.license_source}:${l.license_id}:${l.tpl_code}:${l.stage}`));
}

export function isAlreadySent(
  sentMap: Set<string>,
  source: LicenseSource,
  license_id: string,
  tpl_code: string,
  stage: string,
): boolean {
  return sentMap.has(`${source}:${license_id}:${tpl_code}:${stage}`);
}

// ── UH_2821 (미등록 알림) 재발송 정책 ─────────────────
// 첫 발송 후, 마지막 발송 다음 날부터 오늘 사이에 월요일 또는 매월 1일이
// 한 번이라도 끼어 있으면 다시 발송 가능. (수동 발송 트리거 정책)

// 특정 라이선스의 가장 최근 UH_2821 성공 발송일
export function lastUH2821SentAt(
  logs: SendLogEntry[],
  source: LicenseSource,
  license_id: string,
): Date | null {
  let max: string | null = null;
  for (const l of logs) {
    if (l.license_source !== source || l.license_id !== license_id) continue;
    if (l.tpl_code !== 'UH_2821' || !l.success) continue;
    if (max === null || l.sent_at > max) max = l.sent_at;
  }
  return max ? new Date(max) : null;
}

// 마지막 발송 이후 월요일 또는 매월 1일이 지났는지 (또는 첫 발송이면 항상 가능)
export function canSendUH2821(
  logs: SendLogEntry[],
  source: LicenseSource,
  license_id: string,
  now: Date = new Date(),
): boolean {
  const last = lastUH2821SentAt(logs, source, license_id);
  if (!last) return true;

  // last 다음 날 자정부터 오늘 자정까지 순회 (최대 100일)
  const start = new Date(last);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  // 100일 초과는 D+100 정책상 종료
  const maxIter = 100;
  let iter = 0;
  for (let d = new Date(start); d.getTime() <= end.getTime() && iter < maxIter; d.setDate(d.getDate() + 1), iter++) {
    if (d.getDay() === 1 || d.getDate() === 1) return true;
  }
  return false;
}

// 다음 발송 가능 시점 (월요일 또는 1일 중 더 가까운 것)
export function nextUH2821ResendAt(lastSent: Date): Date {
  const start = new Date(lastSent);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);

  // 다음 월요일 (오늘이 월요일이면 오늘)
  const dayOfWeek = start.getDay();
  const daysUntilMonday = dayOfWeek === 1 ? 0 : (1 - dayOfWeek + 7) % 7;
  const nextMonday = new Date(start);
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);

  // 다음 매월 1일 (오늘이 1일이면 오늘)
  const nextFirst = start.getDate() === 1
    ? new Date(start)
    : new Date(start.getFullYear(), start.getMonth() + 1, 1);

  return nextMonday.getTime() < nextFirst.getTime() ? nextMonday : nextFirst;
}

// 오늘 날짜 기준 UH_2821 stage (YYYY-MM-DD) — 발송 시 사용
export function todayUHStage(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `UH_${yyyy}-${mm}-${dd}`;
}
