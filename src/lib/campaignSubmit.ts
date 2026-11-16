// 공개 캠페인 신청 — 서버 함수 campaign-submit-lead 호출 (HARD-A H-2)
//
// 왜 서버로 옮겼나
//   공개 폼(/c/:slug)이 공개 키(anon)로 campaign_leads 에 직접 INSERT 하고,
//   contacts 를 읽고 쓰고, campaign_licenses·shop_coupons 까지 건드렸다.
//   공개 키는 번들에 들어 있어 누구나 꺼낼 수 있으므로 그 경로는 사실상 비인증이다.
//   서버 함수가 대신 하면 그 테이블들에 대한 **공개 쓰기가 필요 없어진다**
//   (정책을 닫는 SQL 은 HARD-B).
//
// 이 모듈은 요청을 만들어 보내고 응답을 그대로 돌려주는 얇은 껍데기다.
// 판정·발급·발송은 전부 서버가 한다 — 브라우저가 보내는 값을 서버가 믿지 않고
// 캠페인 설정을 DB 에서 다시 읽는다(campaign-submit-lead/index.ts 3번 단계).
//
// 로그인하지 않은 방문자가 쓰는 경로라 **공개 키로 호출한다**. 그게 맞다 —
// 여기서 막아야 할 것은 "누가 부르는가"가 아니라 "무엇을 할 수 있는가"이고,
// 그건 서버 함수가 입력 검증·멱등·발송 상한으로 좁힌다.

import type { IssueOutcome } from '@/lib/campaign-trial-license';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface CampaignLeadInput {
  name: string;
  phone: string;
  email: string;
  schoolName: string | null;
  schoolKind: string | null;
  position: string | null;
  source: string | null;
  sourceEtc: string | null;
  marketingConsent: boolean;
  customFields: Record<string, string> | null;
}

export interface SubmitCampaignLeadParams {
  campaignId: string;
  /** 신청 1건당 1개(UUID). 재시도해도 같은 값을 보내 중복 접수를 막는다. */
  submissionId: string;
  locale: 'ko' | 'ja' | 'en';
  lead: CampaignLeadInput;
}

/** 서버가 돌려주는 모양 — campaign-submit-lead/index.ts 의 json({...}) 과 같다. */
export interface SubmitCampaignLeadResult {
  ok: true;
  leadId?: string;
  /** 같은 submissionId 로 이미 처리된 신청 */
  deduplicated?: boolean;
  status?: string;
  isExistingCustomer?: boolean;
  coupon: { code: string; isNew: boolean; alimtokSent: boolean } | null;
  trial: {
    code: string;
    // 서버가 돌려주는 값은 'new' | 'resent' | 'blocked_used' | 'blocked_expired' 로
    // 브라우저 원본(campaign-trial-license.ts:50)과 같다.
    outcome: IssueOutcome;
    alimtokSent: boolean;
    emailSent: boolean;
    licenseSaved: boolean;
    channel: string;
    priorIssuedAt?: string | null;
    priorCampaignName?: string | null;
  } | null;
}

export async function submitCampaignLead(
  params: SubmitCampaignLeadParams,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitCampaignLeadResult> {
  const res = await fetchImpl(`${SUPABASE_URL}/functions/v1/campaign-submit-lead`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    // 화면은 이 오류를 잡아 기존 문구("제출 중 오류가 발생했습니다…")를 띄운다.
    throw new Error(data?.error ?? `제출 실패 (${res.status})`);
  }
  return data as SubmitCampaignLeadResult;
}
