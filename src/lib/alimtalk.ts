// 알림톡 발송 클라이언트 + 발송 이력 조회
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const HEADERS = {
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
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
    headers: HEADERS,
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
  const res = await fetch(url, { headers: HEADERS });
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
