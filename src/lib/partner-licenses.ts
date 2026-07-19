// ── 파트너 발급 이용권 (해외 파트너 셀프 발급) ──────────
// 발급: partner-issue-license 엣지 함수(세션 JWT) → 쿠폰 생성/원장 기록/텔레그램
//       → 클라이언트에서 유료 영어 이메일 발송 → email_sent 갱신
// 조회: partner_licenses 원장 (파트너 포털/관리자 열람)

import { supabase } from '@/lib/supabase';
import { sendPurchaseLicenseEmail } from '@/lib/email';
import { makeT, type PartnerLocale } from '@/lib/partner-i18n';
import { notifyPartnerLicenseEmailFailed, notifyPartnerLicenseRevoked } from '@/lib/telegram';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BASE_URL = `${SUPABASE_URL}/rest/v1/partner_licenses`;
const HEADERS: Record<string, string> = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

export interface PartnerLicense {
  id: string;
  partner_id: string;
  partner_deal_id?: string | null;
  coupon_code: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  org_name?: string | null;
  plan?: string | null;
  duration?: string | null;
  user_count?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  delivery_channel?: string | null;
  email_sent?: boolean | null;
  service_expire_at?: string | null;
  issued_by?: string | null;
  created_at: string;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoke_reason?: string | null;
}

export interface IssueLicenseInput {
  partnerId?: string;          // admin이 대신 발급 시. partner 본인은 서버가 강제.
  partnerDealId?: string | null;
  customerName: string;
  contactEmail: string;
  contactPhone?: string;
  orgName?: string;
  plan?: string;
  duration: string;            // 개월수
  userCount: string;           // 인원
  amount?: number | null;
  partnerName?: string;        // 이메일 서명 표기용
  locale?: string;             // 파트너 설정 언어 — 고객 메일/오류 메시지 언어
}

export async function getPartnerLicenses(partnerId: string): Promise<PartnerLicense[]> {
  const res = await fetch(
    `${BASE_URL}?partner_id=eq.${encodeURIComponent(partnerId)}&order=created_at.desc`,
    { headers: HEADERS },
  );
  if (!res.ok) return [];
  return res.json();
}

/** 이용권 발급: 엣지 함수 호출 → 쿠폰 획득 → 유료 이메일 발송 → email_sent 갱신 */
export async function issueLicense(input: IssueLicenseInput): Promise<{ coupon_code: string; license_id: string | null; email_sent: boolean }> {
  // 오류 메시지도 파트너 언어로 — 포털이 e.message를 그대로 토스트에 붙이기 때문
  const t = makeT((input.locale ?? 'ko') as PartnerLocale);
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error(t({
    ko: '로그인 세션이 없습니다. 다시 로그인해 주세요.',
    ja: 'ログインセッションがありません。再度ログインしてください。',
    en: 'Your session has expired. Please sign in again.',
  }));

  const res = await fetch(`${SUPABASE_URL}/functions/v1/partner-issue-license`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      partnerId:     input.partnerId,
      partnerDealId: input.partnerDealId ?? null,
      customerName:  input.customerName,
      contactEmail:  input.contactEmail,
      contactPhone:  input.contactPhone ?? '',
      orgName:       input.orgName ?? '',
      plan:          input.plan ?? '',
      duration:      input.duration,
      userCount:     input.userCount,
      amount:        input.amount ?? null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.coupon_code) {
    throw new Error(data.error || t({
      ko: `이용권 발급 실패 (${res.status})`,
      ja: `ライセンス発行に失敗しました (${res.status})`,
      en: `Failed to issue license (${res.status})`,
    }));
  }

  // 유료 영어 이메일 발송 (실패해도 코드는 이미 발급됨)
  let emailSent = false;
  try {
    await sendPurchaseLicenseEmail({
      to:             input.contactEmail,
      contactName:    input.customerName || input.contactEmail,
      orgName:        input.orgName,
      couponCode:     data.coupon_code,
      durationMonths: Number(input.duration) || 12,
      userLimit:      Number(input.userCount) || 40,
      partnerName:    input.partnerName,
      locale:         input.locale,
    });
    emailSent = true;
    if (data.license_id) {
      await fetch(`${BASE_URL}?id=eq.${data.license_id}`, {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ email_sent: true }),
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[issueLicense] 이메일 발송 실패 (코드는 발급됨):', e);
    // 발급 통보는 엣지 함수가 이미 보냈으므로, 실패했을 때만 관리자에게 추가 통보
    notifyPartnerLicenseEmailFailed({
      partnerName:  input.partnerName,
      orgName:      input.orgName,
      contactName:  input.customerName,
      contactEmail: input.contactEmail,
      couponCode:   data.coupon_code,
      reason:       e instanceof Error ? e.message : String(e),
    });
  }

  return { coupon_code: data.coupon_code, license_id: data.license_id ?? null, email_sent: emailSent };
}

/**
 * 이용권 무효화.
 *
 * ⚠️ 현재는 CRM 원장에만 무효 표시가 된다. mDiary 쪽에 쿠폰 무효화 API가 아직 없어
 * 실제 코드 사용 차단은 불가하다(백엔드팀 요청 대기 중). API가 생기면 이 함수에서
 * 해당 엔드포인트를 호출하는 단계만 추가하면 된다.
 * 원장 행은 지우지 않는다 — 정산 근거와 발급 이력을 보존해야 하기 때문.
 */
export async function revokeLicense(lic: PartnerLicense, reason?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const res = await fetch(`${BASE_URL}?id=eq.${lic.id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: user?.id ?? null,
      revoke_reason: reason || null,
    }),
  });
  if (!res.ok) throw new Error(`무효화 실패 (${res.status})`);

  notifyPartnerLicenseRevoked({
    orgName:      lic.org_name ?? undefined,
    contactName:  lic.contact_name ?? undefined,
    contactEmail: lic.contact_email ?? '',
    couponCode:   lic.coupon_code,
    reason,
  });
}

/** 발급된 이용권 이메일 재발송 */
export async function resendLicenseEmail(lic: PartnerLicense, partnerName?: string, locale?: string): Promise<void> {
  const t = makeT((locale ?? 'ko') as PartnerLocale);
  if (!lic.contact_email) throw new Error(t({
    ko: '발송할 이메일이 없습니다',
    ja: '送信先のメールアドレスがありません',
    en: 'No email address to send to',
  }));
  await sendPurchaseLicenseEmail({
    to:             lic.contact_email,
    contactName:    lic.contact_name || lic.contact_email,
    orgName:        lic.org_name ?? undefined,
    couponCode:     lic.coupon_code,
    durationMonths: Number(lic.duration) || 12,
    userLimit:      Number(lic.user_count) || 40,
    partnerName,
    locale,
  });
  await fetch(`${BASE_URL}?id=eq.${lic.id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ email_sent: true }),
  }).catch(() => {});
}
