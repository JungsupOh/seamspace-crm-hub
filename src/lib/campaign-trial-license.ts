// 캠페인 체험 이용권 — 자동/수동 발급 (중복 방지 포함)
// auto_issue=true 인 캠페인에서 리드 등록 시:
// 0) phone_normalized로 기존 체험권 조회 → 미사용이면 재발송, 사용중/만료면 차단
// 1) (신규일 때만) mDiary 쿠폰 생성 (apiCreateCoupon)
// 2) 발송: delivery_channel='alimtalk'(기본) → 카카오 알림톡 / 'email' → 일본어 이메일 (해외 캠페인)
// 3) campaign_licenses INSERT (재발송 시는 skip)
// 4) lead.status='체험발송' / '체험중복' UPDATE
// 실패해도 lead 등록 자체는 성공 처리 (각 단계 try/catch)

import { apiCreateCoupon, apiSendCoupon } from '@/lib/coupons';
import { sendTrialLicenseEmailJP } from '@/lib/email';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export type TrialPlanId = 'classroom' | 'grade';
export type TrialDeliveryChannel = 'alimtalk' | 'email';

export interface TrialLicenseSettings {
  enabled: boolean;
  plan: TrialPlanId;            // 'classroom'(학급40) / 'grade'(학년200)
  user_count: number;            // 40 | 200 (plan과 함께 보존)
  duration_months: number;       // 1 / 3 / 6 등
  auto_issue: boolean;           // 리드 등록 시 자동 발송 여부
  service_expire_at?: string;    // YYYY-MM-DD, 비우면 발급일+duration로 자동
  delivery_channel?: TrialDeliveryChannel;  // 'alimtalk' (한국, 기본) | 'email' (해외)
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
  lead: { id: string; name: string; phone: string; phone_normalized: string; email?: string | null; school_name?: string | null };
}

export type IssueOutcome = 'new' | 'resent' | 'blocked_used' | 'blocked_expired';

interface IssueResult {
  code: string;
  outcome: IssueOutcome;
  alimtokSent: boolean;
  emailSent: boolean;
  licenseSaved: boolean;
  channel: TrialDeliveryChannel;
  priorIssuedAt?: string;       // 기존 체험권 발급일 (재발송/차단 시)
  priorCampaignName?: string;   // 기존 체험권이 발급된 캠페인명 (재발송/차단 시)
}

// 발급일 기준 만기일 (YYYY-MM-DD)
function expiresAtFromDuration(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// 같은 phone_normalized 또는 동일 email로 이미 발급된 체험권 조회 (모든 캠페인 통합)
// 해외 캠페인은 phone이 없거나 부정확할 수 있어 email도 키로 사용해 1인 1회 정책 보장.
async function findPriorTrial(
  phoneNormalized: string,
  email: string | null | undefined,
  currentLeadId: string,
): Promise<{
  coupon_code: string;
  status: string;
  created_at: string;
  campaign_name: string;
} | null> {
  const phoneOk = !!phoneNormalized;
  const emailOk = !!(email && email.trim());
  if (!phoneOk && !emailOk) return null;
  // 1) 같은 phone 또는 같은 email의 다른 lead들 조회 — PostgREST or() 필터
  const conditions: string[] = [];
  if (phoneOk) conditions.push(`phone_normalized.eq.${phoneNormalized}`);
  if (emailOk) conditions.push(`email.ilike.${email!.trim()}`);
  const orFilter = conditions.length === 1 ? conditions[0] : `or=(${conditions.join(',')})`;
  const leadsUrl = conditions.length === 1
    ? `${SUPABASE_URL}/rest/v1/campaign_leads?${conditions[0]}&select=id&id=neq.${currentLeadId}`
    : `${SUPABASE_URL}/rest/v1/campaign_leads?${orFilter}&select=id&id=neq.${currentLeadId}`;
  const leadsRes = await fetch(leadsUrl, { headers: HEADERS });
  if (!leadsRes.ok) return null;
  const otherLeads = await leadsRes.json() as { id: string }[];
  if (otherLeads.length === 0) return null;
  const inFilter = `(${otherLeads.map(l => l.id).join(',')})`;
  // 2) 해당 lead들의 campaign_licenses 조회 — 가장 최근 1건
  const licRes = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_licenses?lead_id=in.${inFilter}&select=coupon_code,status,created_at,campaign_id&order=created_at.desc&limit=1`,
    { headers: HEADERS },
  );
  if (!licRes.ok) return null;
  const lics = await licRes.json() as { coupon_code: string; status: string; created_at: string; campaign_id: string }[];
  if (lics.length === 0) return null;
  const lic = lics[0];
  // 3) 캠페인명 조회
  let campaignName = '';
  try {
    const cRes = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${lic.campaign_id}&select=name`, { headers: HEADERS });
    if (cRes.ok) {
      const c = await cRes.json() as { name: string }[];
      campaignName = c[0]?.name ?? '';
    }
  } catch { /* ignore */ }
  return { coupon_code: lic.coupon_code, status: lic.status, created_at: lic.created_at, campaign_name: campaignName };
}

export async function issueTrialLicense(params: IssueParams): Promise<IssueResult | null> {
  const settings = params.campaign.trial_license_settings;
  if (!settings?.enabled || !settings?.auto_issue) return null;

  const { plan, duration_months } = settings;
  const channel: TrialDeliveryChannel = settings.delivery_channel ?? 'alimtalk';
  const userCount = settings.user_count ?? PLAN_USER_COUNT[plan] ?? 40;
  const description = `${params.campaign.name} ${params.lead.school_name ?? ''} ${params.lead.name} 체험이용권`.trim();
  const expireAt = settings.service_expire_at || expiresAtFromDuration(duration_months);

  // ── Step 0: 기존 체험권 보유 여부 확인 (phone OR email 기준) ──
  let prior: Awaited<ReturnType<typeof findPriorTrial>> = null;
  try {
    prior = await findPriorTrial(params.lead.phone_normalized, params.lead.email, params.lead.id);
  } catch (e) { console.warn('[trial-license] 기존 체험권 조회 실패 — 신규 발급으로 진행', e); }

  // 사용중/만료 → 차단
  if (prior && (prior.status === '사용중' || prior.status === '만료')) {
    const outcome: IssueOutcome = prior.status === '만료' ? 'blocked_expired' : 'blocked_used';
    console.log(`[trial-license] 기존 체험권 ${prior.status} → 발급 차단 (lead=${params.lead.id})`);
    // lead status 갱신
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${params.lead.id}`, {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: '체험중복', sent_at: new Date().toISOString() }),
      });
    } catch { /* ignore */ }
    return {
      code: prior.coupon_code,
      outcome,
      alimtokSent: false,
      emailSent: false,
      licenseSaved: false,
      channel,
      priorIssuedAt: prior.created_at,
      priorCampaignName: prior.campaign_name,
    };
  }

  // 미사용 (대기) → 기존 코드 재발송
  if (prior && prior.status === '대기') {
    console.log(`[trial-license] 기존 체험권 미사용 → 재발송 (코드=${prior.coupon_code})`);
    let alimtokSent = false;
    let emailSent = false;
    if (channel === 'email') {
      if (params.lead.email) {
        try {
          await sendTrialLicenseEmailJP({
            to:           params.lead.email,
            contactName:  params.lead.name,
            orgName:      params.lead.school_name ?? undefined,
            campaignName: params.campaign.name,
            couponCode:   prior.coupon_code,
            durationDays: duration_months * 30,
            userLimit:    userCount,
            serviceExpireAt: expireAt,
          });
          emailSent = true;
        } catch (e) { console.warn('[trial-license] 재발송(이메일) 실패', e); }
      }
    } else {
      try {
        await apiSendCoupon({
          first_name: params.lead.name,
          phone:      params.lead.phone,
          coupon_code: prior.coupon_code,
          user_limit: String(userCount),
          duration:   String(duration_months),
          send_type:  'trial',
        });
        alimtokSent = true;
      } catch (e) { console.warn('[trial-license] 재발송(알림톡) 실패', e); }
    }
    // lead status — '체험재발송'으로 표기
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${params.lead.id}`, {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: '체험재발송', sent_at: new Date().toISOString() }),
      });
    } catch { /* ignore */ }
    return {
      code: prior.coupon_code,
      outcome: 'resent',
      alimtokSent,
      emailSent,
      licenseSaved: false,  // 신규 INSERT는 안 함
      channel,
      priorIssuedAt: prior.created_at,
      priorCampaignName: prior.campaign_name,
    };
  }

  // ── 신규 발급 path ──
  // 1) 쿠폰 생성 — 실패 시 null
  let code = '';
  try {
    code = await apiCreateCoupon(description, String(duration_months), String(userCount));
  } catch (e) {
    console.warn('[trial-license] 쿠폰 생성 실패', e);
    return null;
  }

  // 2) 발송 — 채널별 분기. 발송 실패해도 license INSERT는 진행 (수동 재발송 가능)
  let alimtokSent = false;
  let emailSent = false;
  console.log(`[trial-license] 발급 시작: channel=${channel}, code=${code}, lead.email=${params.lead.email || '(없음)'}`);
  if (channel === 'email') {
    if (!params.lead.email) {
      console.error('[trial-license] email 채널이지만 lead.email 없음 — 발송 스킵, 어드민에서 수동 발송 필요');
    } else {
      try {
        await sendTrialLicenseEmailJP({
          to:           params.lead.email,
          contactName:  params.lead.name,
          orgName:      params.lead.school_name ?? undefined,
          campaignName: params.campaign.name,
          couponCode:   code,
          durationDays: duration_months * 30,  // 표시 일수 (실제 만기는 service_expire_at)
          userLimit:    userCount,
          serviceExpireAt: expireAt,
        });
        emailSent = true;
        console.log(`[trial-license] 일본어 이메일 발송 성공 → ${params.lead.email}`);
      } catch (e) {
        console.error('[trial-license] 일본어 이메일 발송 실패', e);
      }
    }
  } else {
    try {
      await apiSendCoupon({
        first_name: params.lead.name,
        phone:      params.lead.phone,
        coupon_code: code,
        user_limit: String(userCount),
        duration:   String(duration_months),
        send_type:  'trial',
      });
      alimtokSent = true;
    } catch (e) {
      console.error('[trial-license] 알림톡 발송 실패', e);
    }
  }

  // 3) campaign_licenses INSERT
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

  // 4) lead status='체험발송'
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${params.lead.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: '체험발송', sent_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.warn('[trial-license] lead status 갱신 실패', e);
  }

  return { code, outcome: 'new', alimtokSent, emailSent, licenseSaved, channel };
}
