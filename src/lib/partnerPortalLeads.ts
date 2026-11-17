// 파트너 포털의 "내 리드" (LEAD-S7-7b)
//
// **`campaign_leads` 를 직접 부르지 않는다.** 정책은 admin 전용이라 불러도 0건이고,
// 설령 열려 있다 해도 **칸을 고를 수 없다**(RLS 는 행을 막지 칸을 막지 못한다).
// 모든 길이 엣지 함수 `partner-lead` 를 지난다 — 거기서 허용 칸만 골라 준다.

import { supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const FN_URL = `${SUPABASE_URL}/functions/v1/partner-lead`;

/** 함수가 돌려주는 리드. **여기에 없는 칸은 화면에 그릴 수 없다.** */
export interface PortalLead {
  id: string;
  school_name?: string | null;
  school_kind?: string | null;
  position?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  contact_owner?: 'end_user' | 'partner' | null;
  partner_claimed_at?: string | null;
  last_contact_at?: string | null;
  created_at?: string | null;
  /** 서버가 계산해서 준다 — 화면이 다시 세지 않는다 */
  protection_days_left?: number;
}

export interface LeadFormInput {
  schoolName: string;
  schoolKind: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  country: string;
  contactOwner: 'end_user' | 'partner' | '';
  consented: boolean;
}

export function emptyLeadForm(country: string): LeadFormInput {
  return {
    schoolName: '', schoolKind: '', name: '', email: '', phone: '', position: '',
    country, contactOwner: '', consented: false,
  };
}

export interface LeadResult {
  ok: boolean;
  /** `none` · `own` · `other` — **상대를 식별할 수 있는 것은 없다** */
  notice?: 'none' | 'own' | 'other';
  message: string;
  field?: string;
  lead?: PortalLead;
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...data, __status: res.status, __ok: res.ok };
}

export async function getMyLeads(): Promise<PortalLead[]> {
  const d = await call({ action: 'list' });
  if (!d.__ok) throw new Error(String(d.message ?? d.error ?? 'Could not load leads.'));
  return (d.leads as PortalLead[]) ?? [];
}

export async function getLeadDetail(id: string): Promise<PortalLead | null> {
  const d = await call({ action: 'detail', id });
  if (!d.__ok) return null;
  return (d.lead as PortalLead) ?? null;
}

/**
 * 접촉을 기록한다 (7a fix1).
 *
 * **날짜를 보내지 않는다.** 서버가 자기 시각으로 적는다 — 파트너가 날짜를 정할 수
 * 있으면 보호 기간을 마음대로 늘릴 수 있다.
 */
export async function recordContact(id: string): Promise<LeadResult> {
  const d = await call({ action: 'contact', id });
  if (!d.__ok) {
    return { ok: false, message: String(d.message ?? d.error ?? 'Could not record the contact.') };
  }
  return {
    ok: true,
    message: String(d.message ?? ''),
    lead: d.lead as PortalLead,
  };
}

export async function createLead(input: LeadFormInput): Promise<LeadResult> {
  const d = await call({
    action: 'create',
    schoolName: input.schoolName,
    schoolKind: input.schoolKind || null,
    name: input.name || null,
    email: input.email,
    phone: input.phone || null,
    position: input.position || null,
    country: input.country || null,
    contactOwner: input.contactOwner,
    consented: input.consented,
  });
  if (!d.__ok) {
    return {
      ok: false,
      message: String(d.message ?? d.error ?? 'Could not register the lead.'),
      field: typeof d.field === 'string' ? d.field : undefined,
    };
  }
  return {
    ok: true,
    notice: (d.notice as LeadResult['notice']) ?? 'none',
    message: String(d.message ?? ''),
    lead: d.lead as PortalLead,
  };
}

// ───────────────────────── 화면이 쓰는 순수 규칙 ─────────────────────────

/**
 * 보내기 전에 **화면에서도** 본다. 서버가 다시 판단하므로 이건 **편의**일 뿐이다 —
 * 여기서 막혀도, 안 막혀도 진실은 서버에 있다.
 */
export function formProblem(f: LeadFormInput): string | null {
  if (!f.schoolName.trim()) return 'schoolName';
  if (!f.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'email';
  if (f.contactOwner !== 'end_user' && f.contactOwner !== 'partner') return 'contactOwner';
  // **최종 사용자의 정보라면 동의 확인이 있어야 한다**
  if (f.contactOwner === 'end_user' && !f.consented) return 'consented';
  if (f.country.trim() && !/^[A-Za-z]{2}$/.test(f.country.trim())) return 'country';
  return null;
}

export function canSubmit(f: LeadFormInput): boolean {
  return formProblem(f) === null;
}

/** 보호 기간 띠의 색. 서버가 준 일수를 **그대로** 쓴다. */
export type ProtectionTone = 'safe' | 'soon' | 'ended';

export function protectionTone(daysLeft: unknown): ProtectionTone {
  const n = typeof daysLeft === 'number' && Number.isFinite(daysLeft) ? daysLeft : 0;
  if (n <= 0) return 'ended';
  if (n <= 14) return 'soon';
  return 'safe';
}

/** 접촉 기록이 있나 — 없으면 "아직 접촉 없음"이라고 분명히 말한다. */
export function hasContact(lead: PortalLead): boolean {
  return typeof lead.last_contact_at === 'string' && lead.last_contact_at.trim() !== '';
}

/**
 * 보기 전용 계정에게 **보여 줄 것이 남아 있나**.
 * 함수가 이미 칸을 뺐으므로 화면은 "없으면 안 그린다"만 하면 된다.
 */
export function hasDetailFields(lead: PortalLead): boolean {
  return Boolean(lead.name || lead.email || lead.phone || lead.position);
}

/** 목록 요약 — 몇 건이 보호 중인가. */
export function leadSummary(leads: readonly PortalLead[]): {
  total: number; protectedNow: number; ending: number; noContact: number;
} {
  let protectedNow = 0, ending = 0, noContact = 0;
  for (const l of leads) {
    const tone = protectionTone(l.protection_days_left);
    if (tone !== 'ended') protectedNow += 1;
    if (tone === 'soon') ending += 1;
    if (!hasContact(l)) noContact += 1;
  }
  return { total: leads.length, protectedNow, ending, noContact };
}
