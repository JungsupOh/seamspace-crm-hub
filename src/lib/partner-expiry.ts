// 파트너 만기 안내 메일 발송 내역 조회 (partner-expiry-notify 엣지 함수가 기록)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY };

export interface PartnerExpiryEmail {
  id: string;
  partner_id: string | null;
  partner_name: string | null;
  partner_email: string | null;
  org_name: string;
  soonest_expire_at: string;
  soonest_dday: number | null;
  license_count: number;
  subject: string | null;
  html: string | null;
  status: string;            // 'sent' | 'failed' | 'skipped'
  error: string | null;
  triggered_by: string | null;
  sent_at: string;
}

// 최근 발송 내역 (기본 50건)
export async function getPartnerExpiryEmails(limit = 50): Promise<PartnerExpiryEmail[]> {
  const url = `${SUPABASE_URL}/rest/v1/partner_expiry_emails`
    + `?select=id,partner_id,partner_name,partner_email,org_name,soonest_expire_at,soonest_dday,license_count,subject,html,status,error,triggered_by,sent_at`
    + `&order=sent_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  return res.json();
}
