// 캠페인 체험 이용권 — 자동/수동 발급
// auto_issue=true 인 캠페인에서 리드 등록 시 자동 발급:
// 1) mDiary 쿠폰 생성 (apiCreateCoupon)
// 2) 알림톡 발송 (apiSendCoupon, send_type='trial', TS_6205)
// 3) campaign_licenses INSERT
// 4) lead.status='체험발송' UPDATE
// 실패해도 lead 등록 자체는 성공 처리 (각 단계 try/catch)

import { apiCreateCoupon, apiSendCoupon } from '@/lib/coupons';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export type TrialPlanId = 'classroom' | 'grade';

export interface TrialLicenseSettings {
  enabled: boolean;
  plan: TrialPlanId;            // 'classroom'(학급40) / 'grade'(학년200)
  user_count: number;            // 40 | 200 (plan과 함께 보존)
  duration_months: number;       // 1 / 3 / 6 등
  auto_issue: boolean;           // 리드 등록 시 자동 발송 여부
  service_expire_at?: string;    // YYYY-MM-DD, 비우면 발급일+duration로 자동
}

export const PLAN_LABEL: Record<TrialPlanId, string> = {
  classroom: '학급플랜 (40명)',
  grade:     '학년플랜 (200명)',
};

export const PLAN_USER_COUNT: Record<TrialPlanId, number> = {
  classroom: 40,
  grade:     200,
};

interface IssueParams {
  campaign: { id: string; name: string; trial_license_settings?: TrialLicenseSettings | null };
  lead: { id: string; name: string; phone: string; phone_normalized: string; school_name?: string | null };
}

interface IssueResult {
  code: string;
  alimtokSent: boolean;
  licenseSaved: boolean;
}

// 발급일 기준 만기일 (YYYY-MM-DD)
function expiresAtFromDuration(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function issueTrialLicense(params: IssueParams): Promise<IssueResult | null> {
  const settings = params.campaign.trial_license_settings;
  if (!settings?.enabled || !settings?.auto_issue) return null;

  const { plan, duration_months } = settings;
  const userCount = settings.user_count ?? PLAN_USER_COUNT[plan] ?? 40;
  const description = `${params.campaign.name} ${params.lead.school_name ?? ''} ${params.lead.name} 체험이용권`.trim();

  // 1) 쿠폰 생성 + 알림톡 — 실패 시 null
  let code = '';
  try {
    code = await apiCreateCoupon(description, String(duration_months), String(userCount));
    await apiSendCoupon({
      first_name: params.lead.name,
      phone:      params.lead.phone,
      coupon_code: code,
      user_limit: String(userCount),
      duration:   String(duration_months),
      send_type:  'trial',
    });
  } catch (e) {
    console.warn('[trial-license] 쿠폰/알림톡 실패', e);
    return null;
  }

  const expireAt = settings.service_expire_at || expiresAtFromDuration(duration_months);

  // 2) campaign_licenses INSERT
  let licenseSaved = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        campaign_id:       params.campaign.id,
        lead_id:           params.lead.id,
        coupon_code:       code,
        contact_name:      params.lead.name,
        contact_phone:     params.lead.phone,
        org_name:          params.lead.school_name ?? null,
        duration:          String(duration_months),
        user_count:        String(userCount),
        status:            '대기',
        service_expire_at: expireAt,
      }),
    });
    licenseSaved = r.ok;
  } catch (e) {
    console.warn('[trial-license] campaign_licenses 저장 실패', e);
  }

  // 3) lead status='체험발송'
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${params.lead.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: '체험발송', sent_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.warn('[trial-license] lead status 갱신 실패', e);
  }

  return { code, alimtokSent: true, licenseSaved };
}
