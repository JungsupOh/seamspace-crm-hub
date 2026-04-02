// ── 파트너 딜 CRUD ──────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BASE_URL = `${SUPABASE_URL}/rest/v1/partner_deals`;
const HEADERS: Record<string, string> = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

export interface PartnerDealBuyer {
  id: string;
  partner_deal_id: string;
  buyer_name?: string;
  buyer_phone?: string;
  buyer_email?: string;
  student_count?: number;
  class_count?: number;
  month_count?: number;
  plan_name?: string;
  quantity?: number;
  created_at: string;
  updated_at: string;
}

export interface PartnerDeal {
  id: string;
  partner_id: string;
  seq_number?: number;
  contract_date?: string;
  school_name?: string;
  buyer_name?: string;
  buyer_phone?: string;
  buyer_email?: string;
  student_count?: number;
  class_count?: number;
  month_count?: number;
  plan_name?: string;
  quantity?: number;
  payment_amount?: number;
  commission_amount?: number;
  settlement_amount?: number;
  license_issue_date?: string;
  tax_invoice_date?: string;
  deposit_date?: string;
  remarks?: string;
  linked_deal_id?: string;
  created_at: string;
  updated_at: string;
}

export async function getPartnerDeals(partnerId: string): Promise<PartnerDeal[]> {
  const res = await fetch(
    `${BASE_URL}?partner_id=eq.${encodeURIComponent(partnerId)}&order=seq_number.asc.nullslast,created_at.asc`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`파트너 딜 조회 실패: ${res.status}`);
  return res.json();
}

export async function getAllPartnerDeals(): Promise<PartnerDeal[]> {
  const res = await fetch(
    `${BASE_URL}?order=created_at.desc&limit=5000`,
    { headers: HEADERS }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function createPartnerDeal(
  record: Omit<PartnerDeal, 'id' | 'created_at' | 'updated_at'>
): Promise<PartnerDeal> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `파트너 딜 생성 실패: ${res.status}`);
  }
  const [row] = await res.json();
  return row;
}

export async function updatePartnerDeal(
  id: string,
  updates: Partial<Omit<PartnerDeal, 'id' | 'created_at'>>
): Promise<void> {
  const res = await fetch(`${BASE_URL}?id=eq.${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`파트너 딜 업데이트 실패: ${res.status}`);
}

export async function deletePartnerDeal(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}?id=eq.${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`파트너 딜 삭제 실패: ${res.status}`);
}

// ── 파트너 딜 구매자 CRUD ────────────────────────────
const BUYERS_URL = `${SUPABASE_URL}/rest/v1/partner_deal_buyers`;

export async function getDealBuyers(dealId: string): Promise<PartnerDealBuyer[]> {
  const res = await fetch(
    `${BUYERS_URL}?partner_deal_id=eq.${encodeURIComponent(dealId)}&order=created_at.asc`,
    { headers: HEADERS }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function getBuyersByPartner(partnerId: string): Promise<PartnerDealBuyer[]> {
  // partner_deal_buyers 테이블에서 해당 파트너의 모든 구매자 조회
  const deals = await getPartnerDeals(partnerId);
  if (deals.length === 0) return [];
  const dealIds = deals.map(d => d.id);
  const filter = dealIds.map(id => `"${id}"`).join(',');
  const res = await fetch(
    `${BUYERS_URL}?partner_deal_id=in.(${filter})&order=created_at.asc`,
    { headers: HEADERS }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function createDealBuyers(
  dealId: string,
  buyers: Array<Omit<PartnerDealBuyer, 'id' | 'partner_deal_id' | 'created_at' | 'updated_at'>>
): Promise<PartnerDealBuyer[]> {
  if (buyers.length === 0) return [];
  const rows = buyers.map(b => ({ ...b, partner_deal_id: dealId }));
  const res = await fetch(BUYERS_URL, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `구매자 생성 실패: ${res.status}`);
  }
  return res.json();
}

export async function deleteDealBuyers(dealId: string): Promise<void> {
  const res = await fetch(`${BUYERS_URL}?partner_deal_id=eq.${dealId}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`구매자 삭제 실패: ${res.status}`);
}

// ── 수수료 자동 계산 ─────────────────────────────────
export function calcCommission(paymentAmount: number, commissionRate: number) {
  const commission = Math.round(paymentAmount * commissionRate / 100);
  return { commission, settlement: paymentAmount - commission };
}

// ── 전화번호 정규화 (매칭용) ──────────────────────────
function normalizePhone(raw: string): string {
  if (!raw) return '';
  return raw.replace(/\D/g, '').replace(/^82/, '0');
}

// ── CRM 딜과 자동 매칭 ──────────────────────────────
export function autoLinkPartnerDeals(
  partnerDeals: PartnerDeal[],
  crmDeals: Array<{ id: string; fields: { Org_Name?: string; Contact_Phone?: string; License_Send_Date?: string; Receipt_Date?: string; Payment_Date?: string } }>
): Map<string, { dealId: string; licenseDate?: string; invoiceDate?: string; depositDate?: string }> {
  const matches = new Map<string, { dealId: string; licenseDate?: string; invoiceDate?: string; depositDate?: string }>();

  for (const pd of partnerDeals) {
    if (pd.linked_deal_id) continue; // 이미 연결됨
    const pdPhone = normalizePhone(pd.buyer_phone ?? '');
    const pdSchool = (pd.school_name ?? '').trim().toLowerCase();
    if (!pdSchool && !pdPhone) continue;

    for (const crm of crmDeals) {
      const crmPhone = normalizePhone(crm.fields.Contact_Phone ?? '');
      const crmSchool = (crm.fields.Org_Name ?? '').trim().toLowerCase();

      // 학교명 + 전화번호 매칭
      if (pdSchool && crmSchool && pdSchool === crmSchool && pdPhone && crmPhone && pdPhone === crmPhone) {
        matches.set(pd.id, {
          dealId: crm.id,
          licenseDate: crm.fields.License_Send_Date,
          invoiceDate: crm.fields.Receipt_Date,
          depositDate: crm.fields.Payment_Date,
        });
        break;
      }
    }
  }
  return matches;
}
