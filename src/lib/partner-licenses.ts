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
  partner_deal_buyer_id?: string | null;
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
  partnerDealBuyerId?: string | null;   // 딜 내 특정 구매자에 귀속
  customerName: string;
  contactEmail: string;
  contactPhone?: string;
  orgName?: string;
  plan?: string;
  duration: string;            // 개월수
  userCount: string;           // 인원
  amount?: number | null;
  partnerName?: string;        // 이메일 서명 표기용
  partnerEmail?: string;       // 고객 메일의 문의처/회신처/참조 (파트너 직접 발급)
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
      partnerDealBuyerId: input.partnerDealBuyerId ?? null,
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
      partnerEmail:   input.partnerEmail,
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

async function callRevokeFn(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('로그인 세션이 없습니다. 다시 로그인해 주세요.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/partner-revoke-license`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data as { result?: string; used_group?: string | null; group_name?: string; service_expire_at?: string };
}

export type RevokeResult =
  | { result: 'revoked' }
  | { result: 'in_use'; used_group: string | null }
  | { result: 'not_found' };

/**
 * 이용권 회수 (미사용 쿠폰).
 * mDiary coupon_revoke를 서버(엣지 함수)에서 호출하고 원장을 갱신한다.
 * - revoked: 실제로 회수됨
 * - in_use : 사용 중 → 그룹을 만료시켜야 함 (expireLicenseGroup으로 에스컬레이션)
 * - not_found: mDiary에 코드 없음
 */
export async function revokeLicense(lic: PartnerLicense, reason?: string): Promise<RevokeResult> {
  const data = await callRevokeFn({ licenseId: lic.id, action: 'revoke', reason });
  if (data.result === 'revoked') {
    notifyPartnerLicenseRevoked({
      orgName: lic.org_name ?? undefined, contactName: lic.contact_name ?? undefined,
      contactEmail: lic.contact_email ?? '', couponCode: lic.coupon_code, reason,
    });
  }
  return data as RevokeResult;
}

/** 사용 중 이용권 회수 — 연결된 그룹을 만료(expireDate=어제)시킨다. */
export async function expireLicenseGroup(lic: PartnerLicense, groupId: string, expireDate: string, reason?: string): Promise<{ group_name?: string; service_expire_at?: string }> {
  const data = await callRevokeFn({ licenseId: lic.id, action: 'expire', groupId, expireDate, reason });
  notifyPartnerLicenseRevoked({
    orgName: lic.org_name ?? undefined, contactName: lic.contact_name ?? undefined,
    contactEmail: lic.contact_email ?? '', couponCode: lic.coupon_code,
    reason: `그룹 만료(${data.group_name ?? groupId})${reason ? ' · ' + reason : ''}`,
  });
  return data;
}

/** 쿠폰의 그룹 정보 조회 (사용 중 회수 시 확인용). get-coupon-status로 최신화 후 원장 읽기. */
export interface CouponGroupInfo {
  used_group_id: string | null;
  group_name: string | null;
  member_count: number | null;
  service_expire_at: string | null;
  admin_name: string | null;
}
export async function getCouponGroupInfo(couponCode: string): Promise<CouponGroupInfo | null> {
  // 최신 그룹 정보로 동기화
  await fetch(`${SUPABASE_URL}/functions/v1/get-coupon-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ codes: [couponCode] }),
  }).catch(() => {});
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mdiary_coupons?coupon_code=eq.${encodeURIComponent(couponCode)}&select=used_group_id,group_name,member_count,service_expire_at,admin_name`,
    { headers: HEADERS },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

/** 이용권을 특정 구매자에 귀속 (구매자 지정 이전에 발급된 건 정리용) */
export async function setLicenseBuyer(licenseId: string, buyerId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}?id=eq.${licenseId}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ partner_deal_buyer_id: buyerId }),
  });
  if (!res.ok) throw new Error(`구매자 연결 실패 (${res.status})`);
}

/** 발급된 이용권 이메일 재발송 */
export async function resendLicenseEmail(lic: PartnerLicense, partnerName?: string, locale?: string, partnerEmail?: string): Promise<void> {
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
    partnerEmail,
    locale,
  });
  await fetch(`${BASE_URL}?id=eq.${lic.id}`, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ email_sent: true }),
  }).catch(() => {});
}
