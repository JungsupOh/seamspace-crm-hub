// 파트너 계약·구매 원장 DB 접근 (LEAD-S7-2b)
//
// **쓰기 경로:** `Partners.tsx` 의 기존 방식과 **같다** — `authedFetch` 로 `rest/v1` 을
// 직접 부른다(`Authorization` 은 로그인 세션 토큰, `apikey` 헤더만 공개 키).
// `admin-auth` 엣지 함수를 쓰지 않는다: 그 함수는 **service_role 이 필요한 계정 작업**
// (사용자 만들기·비밀번호)용이고, 이 두 표는 RLS 정책이
// `user_profiles.role in ('admin','sub_admin')` 을 보므로 **로그인 토큰만으로 충분**하다.
// (파트너 계정으로 부르면 정책이 막는다 — S7-1 fix1 · S7-2a 의 음성 시험에서 확인.)
//
// 원장이라 **DELETE 를 만들지 않는다.** 취소는 `voided_at`·`void_reason` 이고,
// DB 쪽에도 restrictive delete 정책이 걸려 있어 어차피 거부된다.

import { authedFetch } from '@/lib/authedFetch';
import type { Contract } from '@/lib/partnerContract';
import type { PurchaseLine } from '@/lib/partnerLedger';
import type { ContractPayload, PurchasePayload, BillingPatch } from '@/lib/partnerContractForm';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const CONTRACT_URL = `${SUPABASE_URL}/rest/v1/partner_contracts`;
const PURCHASE_URL = `${SUPABASE_URL}/rest/v1/partner_purchases`;
const LICENSE_URL  = `${SUPABASE_URL}/rest/v1/partner_licenses`;

const H: Record<string, string> = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export interface ContractRow extends Contract {
  id: string;
  partner_id: string;
  starts_on: string;
  ends_on: string | null;
  renews_on: string | null;
  contracted_seat_months: number | null;
  unit_price_per_seat_year: number | null;
  currency: string | null;
  commission_rate: number | null;
  is_grant: boolean;
  status: string;
  contract_file_id: string | null;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface PurchaseRowFull extends PurchaseLine {
  id: string;
  contract_id: string;
  purchased_on: string;
  seat_months: number;
  created_at: string;
}

const CONTRACT_COLS = [
  'id', 'partner_id', 'settlement_method', 'starts_on', 'ends_on', 'renews_on',
  'contracted_seat_months', 'unit_price_per_seat_year', 'currency', 'commission_rate',
  'is_grant', 'status', 'contract_file_id', 'notes', 'voided_at', 'void_reason', 'created_at',
].join(',');

const PURCHASE_COLS = [
  'id', 'contract_id', 'purchased_on', 'seat_months', 'unit_price_per_seat_year', 'currency',
  'amount', 'invoice_no', 'billing_status', 'invoiced_on', 'paid_on', 'paid_amount', 'memo',
  'voided_at', 'void_reason', 'created_at',
].join(',');

async function ok(res: Response, what: string) {
  if (res.ok) return;
  const err = await res.json().catch(() => ({} as { message?: string }));
  throw new Error(err.message || `${what} 실패: ${res.status}`);
}

// ───────────────────────── 계약 ─────────────────────────

export async function getContracts(partnerId: string): Promise<ContractRow[]> {
  const res = await authedFetch(
    `${CONTRACT_URL}?select=${CONTRACT_COLS}&partner_id=eq.${encodeURIComponent(partnerId)}&order=starts_on.desc`,
    { headers: H },
  );
  await ok(res, '계약 조회');
  return res.json();
}

/** 미수금 요약용 — 모든 파트너의 계약(관리자만 전부 보인다). */
export async function getAllContracts(): Promise<ContractRow[]> {
  const res = await authedFetch(
    `${CONTRACT_URL}?select=${CONTRACT_COLS}&order=starts_on.desc&limit=5000`, { headers: H });
  await ok(res, '계약 전체 조회');
  return res.json();
}

export async function createContract(payload: ContractPayload): Promise<ContractRow> {
  const res = await authedFetch(CONTRACT_URL, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  await ok(res, '계약 등록');
  const [row] = await res.json();
  return row;
}

/**
 * 계약 수정. **`settlement_method` 를 보내지 않는다** — 만든 뒤에는 바꾸지 않는다.
 * (화면도 칸을 잠그지만, 보내는 쪽에서도 빼서 두 겹으로 막는다.)
 */
export async function updateContract(
  id: string, payload: Omit<ContractPayload, 'partner_id' | 'settlement_method'>,
): Promise<void> {
  const res = await authedFetch(`${CONTRACT_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(payload),
  });
  await ok(res, '계약 수정');
}

/** 계약 무효 처리. 지우지 않는다 — 사유와 함께 표시만 한다. */
export async function voidContract(id: string, reason: string): Promise<void> {
  const res = await authedFetch(`${CONTRACT_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({
      voided_at: new Date().toISOString(), void_reason: reason.trim(), status: 'cancelled',
    }),
  });
  await ok(res, '계약 무효 처리');
}

// ───────────────────────── 구매 원장 ─────────────────────────

export async function getPurchases(contractId: string): Promise<PurchaseRowFull[]> {
  const res = await authedFetch(
    `${PURCHASE_URL}?select=${PURCHASE_COLS}&contract_id=eq.${encodeURIComponent(contractId)}&order=purchased_on.desc`,
    { headers: H },
  );
  await ok(res, '구매 조회');
  return res.json();
}

/** 여러 계약의 구매를 한 번에(미수금 요약용). */
export async function getPurchasesForContracts(ids: readonly string[]): Promise<PurchaseRowFull[]> {
  if (ids.length === 0) return [];
  const list = ids.map(encodeURIComponent).join(',');
  const res = await authedFetch(
    `${PURCHASE_URL}?select=${PURCHASE_COLS}&contract_id=in.(${list})&order=purchased_on.desc&limit=5000`,
    { headers: H },
  );
  await ok(res, '구매 조회');
  return res.json();
}

export async function createPurchase(payload: PurchasePayload): Promise<PurchaseRowFull> {
  const res = await authedFetch(PURCHASE_URL, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  await ok(res, '구매 등록');
  const [row] = await res.json();
  return row;
}

/** 청구·입금 처리(상태 변화만). 금액·수량·날짜는 여기로 고치지 않는다. */
export async function patchBilling(id: string, patch: BillingPatch): Promise<void> {
  const res = await authedFetch(`${PURCHASE_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(patch),
  });
  await ok(res, '청구·입금 처리');
}

/**
 * 메모·청구서 번호만 고친다. 금액·수량·날짜는 **무효 후 재등록**이다(원장 취지).
 * 보내는 쪽에서 칸을 두 개로 묶어, 실수로 금액이 섞여 들어가지 않게 한다.
 */
export async function patchPurchaseNote(
  id: string, note: { memo?: string | null; invoice_no?: string | null },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if ('memo' in note) body.memo = note.memo;
  if ('invoice_no' in note) body.invoice_no = note.invoice_no;
  const res = await authedFetch(`${PURCHASE_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(body),
  });
  await ok(res, '메모 수정');
}

export async function voidPurchase(id: string, reason: string): Promise<void> {
  const res = await authedFetch(`${PURCHASE_URL}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ voided_at: new Date().toISOString(), void_reason: reason.trim() }),
  });
  await ok(res, '구매 무효 처리');
}

// ───────────────────────── 발급 원장 (읽기만) ─────────────────────────

export interface LicenseSeatRow {
  id: string;
  partner_id: string;
  seat_months: number | null;
  user_count: number | null;
  duration: number | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * 잔량의 반대편(발급 합계)을 세기 위해 읽는다.
 *
 * ⚠️ **`partner_licenses` 에는 `contract_id` 가 없다**(운영에서 확인).
 *    그래서 "이 계약으로 몇 개를 발급했는지"를 **알 수 없다.** 이 함수는 파트너 전체의
 *    발급을 돌려주고, 화면은 그것을 계약별 잔량으로 쓰지 않는다 —
 *    요구사항대로 "발급 연결은 S7-3" 으로 표시한다.
 */
export async function getPartnerLicenseSeats(partnerId: string): Promise<LicenseSeatRow[]> {
  const res = await authedFetch(
    `${LICENSE_URL}?select=id,partner_id,seat_months,user_count,duration,revoked_at,created_at`
    + `&partner_id=eq.${encodeURIComponent(partnerId)}&order=created_at.desc&limit=5000`,
    { headers: H },
  );
  await ok(res, '발급 조회');
  return res.json();
}
