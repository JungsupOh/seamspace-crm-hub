// 파트너 포털의 "내 계약" 데이터 (LEAD-S7-4)
//
// **읽기는 RLS 가 거른다** — 파트너는 자기 계약·구매·요청만 보인다(S7-1·S7-2a·S7-4 정책).
// 쓰기는 하나뿐이고 그것도 **엣지 함수**로 간다(요청). 포털은 계약·구매를 고치지 못한다.
//
// 계산은 `partnerContract.ts`·`partnerLedger.ts` 를 **그대로** 쓴다 —
// 서버(예약 RPC)·관리자 화면과 **같은 숫자**여야 한다.

import { authedFetch } from '@/lib/authedFetch';
import { supabase } from '@/lib/supabase';
import type { Contract } from '@/lib/partnerContract';
import type { PurchaseLine } from '@/lib/partnerLedger';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const H: Record<string, string> = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

const CONTRACT_URL = `${SUPABASE_URL}/rest/v1/partner_contracts`;
const PURCHASE_URL = `${SUPABASE_URL}/rest/v1/partner_purchases`;
const REQUEST_URL  = `${SUPABASE_URL}/rest/v1/partner_requests`;

export interface PortalContract extends Contract {
  id: string;
  partner_id: string;
  starts_on: string;
  ends_on: string | null;
  renews_on: string | null;
  contracted_seat_months: number | null;
  unit_price_per_seat_year: number | null;
  currency: string | null;
  is_grant: boolean;
  status: string;
  voided_at: string | null;
}

export interface PortalPurchase extends PurchaseLine {
  id: string;
  contract_id: string;
  purchased_on: string;
  seat_months: number;
}

export interface PortalRequest {
  id: string;
  kind: 'purchase' | 'revoke';
  contract_id: string | null;
  license_id: string | null;
  seat_months: number | null;
  status: 'open' | 'handled' | 'dismissed';
  requested_at: string;
  handled_at: string | null;
}

async function ok(res: Response, what: string) {
  if (res.ok) return;
  const err = await res.json().catch(() => ({} as { message?: string }));
  throw new Error(err.message || `${what} (${res.status})`);
}

/**
 * 내 계약. **계약서 파일은 가져오지 않는다** — 열람은 관리자만이다(설계 2-1).
 * `contract_file_id` 도 빼서 파일 id 가 화면에 흘러가지 않게 한다.
 */
export async function getMyContracts(partnerId: string): Promise<PortalContract[]> {
  const cols = [
    'id', 'partner_id', 'settlement_method', 'starts_on', 'ends_on', 'renews_on',
    'contracted_seat_months', 'unit_price_per_seat_year', 'currency', 'is_grant',
    'status', 'voided_at',
  ].join(',');
  const res = await authedFetch(
    `${CONTRACT_URL}?select=${cols}&partner_id=eq.${encodeURIComponent(partnerId)}&order=starts_on.desc`,
    { headers: H },
  );
  await ok(res, '계약 조회 실패');
  return res.json();
}

/** 내 계약들의 구매 내역. 금액은 **읽기만** 한다(DB 가 쓰기를 막는다). */
export async function getMyPurchases(contractIds: readonly string[]): Promise<PortalPurchase[]> {
  if (contractIds.length === 0) return [];
  const cols = [
    'id', 'contract_id', 'purchased_on', 'seat_months', 'unit_price_per_seat_year',
    'currency', 'amount', 'invoice_no', 'billing_status', 'invoiced_on',
    'paid_on', 'paid_amount', 'voided_at',
  ].join(',');
  const list = contractIds.map(encodeURIComponent).join(',');
  const res = await authedFetch(
    `${PURCHASE_URL}?select=${cols}&contract_id=in.(${list})&order=purchased_on.desc&limit=2000`,
    { headers: H },
  );
  await ok(res, '구매 내역 조회 실패');
  return res.json();
}

/** 내가 보낸 요청(열린 것 위주). 같은 대상에 또 보내지 않게 화면이 쓴다. */
export async function getMyRequests(partnerId: string): Promise<PortalRequest[]> {
  const cols = 'id,kind,contract_id,license_id,seat_months,status,requested_at,handled_at';
  const res = await authedFetch(
    `${REQUEST_URL}?select=${cols}&partner_id=eq.${encodeURIComponent(partnerId)}`
    + `&order=requested_at.desc&limit=200`,
    { headers: H },
  );
  await ok(res, '요청 조회 실패');
  return res.json();
}

// ───────────────────────── 요청 보내기 ─────────────────────────

export interface SendRequestInput {
  kind: 'purchase' | 'revoke';
  contractId?: string | null;
  licenseId?: string | null;
  seatMonths?: number | null;
  reason?: string | null;
}

/**
 * 요청을 보낸다. **엣지 함수로만** 간다 —
 * 본문의 partner_id 를 서버가 호출자 프로필에서 강제하기 때문이다.
 * (`partnerId` 를 아예 보내지 않는다. 보내도 서버가 무시한다.)
 */
export async function sendPartnerRequest(
  input: SendRequestInput,
): Promise<{ ok: boolean; message: string; code?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/partner-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      kind: input.kind,
      contractId: input.contractId ?? null,
      licenseId: input.licenseId ?? null,
      seatMonths: input.seatMonths ?? null,
      reason: input.reason ?? null,
    }),
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    return { ok: false, message: String(data.error ?? `Request failed (${res.status})`),
             code: typeof data.code === 'string' ? data.code : undefined };
  }
  return { ok: true, message: String(data.message ?? '') };
}
