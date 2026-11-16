// 공개 경로의 contacts 등록 — /order(OrderTest.tsx) 전용 (HARD-B2a 에서 분리)
//
// 원래 src/lib/luckySeven.ts 의 upsertLeadContact 하나를 공개 `/order` 와
// 관리자 /campaigns 가 **함께** 쓰고 있었다. 그래서 contacts 의 공개 키 정책을
// 닫을 수 없었다(hard_b1_policy_close.md §E).
//
// 구현은 **한 벌**만 둔다 — 아래 코어를 쓰고, 누구 이름으로 보낼지만 transport 로 가른다.
// 관리자용 래퍼는 luckySeven.ts 의 upsertLeadContact 다(transport: 'authed').
//
// HARD-B2b 에서 /order 접수를 서버 함수로 옮기면 이 파일은 통째로 사라진다.

import { authedFetch } from '@/lib/authedFetch';
import { normalizePhone as normalizePhoneI18n, type PhoneCountry } from '@/lib/phone';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** 'public' = 공개 키(로그인 안 한 방문자) / 'authed' = 로그인 세션 토큰 */
export type ContactTransport = 'public' | 'authed';

const PUBLIC_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};
const AUTHED_HEADERS = {
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

/** transport 에 따라 fetch 와 헤더를 고른다. 세션 유무로 자동 판단하지 않는다(조용한 폴백 금지). */
function pick(transport: ContactTransport) {
  return transport === 'authed'
    ? { call: authedFetch, headers: AUTHED_HEADERS }
    : { call: fetch, headers: PUBLIC_HEADERS };
}

export interface UpsertLeadContactOptions {
  country?: PhoneCountry;
  contactType?: string;
  leadSource?: string;
  leadStage?: string;
  activityNote?: string;
}

export interface UpsertLeadContactResult {
  contactId: string;
  isExisting: boolean;
  activityAppended: boolean;
}

/**
 * contacts 를 전화번호로 찾아 보완하거나 새로 만든다.
 *
 * ⚠️ 동작은 원본(luckySeven.ts)과 **글자 단위로 같다.** 바뀐 것은 "누구 이름으로
 *    서버에 요청하는지"뿐이다. 필드·조건·활동이력 중복 방지 규칙을 그대로 옮겼다.
 */
export async function upsertLeadContactCore(
  member: { name: string; phone: string; email: string; orgName: string },
  options: UpsertLeadContactOptions = {},
  transport: ContactTransport = 'public',
): Promise<UpsertLeadContactResult> {
  const { call, headers } = pick(transport);
  const country = options.country ?? 'kr';
  const phoneNorm = normalizePhoneI18n(member.phone, country);

  const findRes = await call(
    `${SUPABASE_URL}/rest/v1/contacts?phone_normalized=eq.${encodeURIComponent(phoneNorm)}&select=id,name,email,org_name,contact_type,notes`,
    { headers },
  );
  const found = findRes.ok ? await findRes.json() : [];

  if (Array.isArray(found) && found.length > 0) {
    const existing = found[0];
    const patch: Record<string, unknown> = {};
    if (!existing.name && member.name) patch.name = member.name;
    if (!existing.email && member.email) patch.email = member.email;
    if (!existing.org_name && member.orgName) patch.org_name = member.orgName;
    let activityAppended = false;
    if (options.activityNote && options.activityNote.trim()) {
      const prevNotes = (existing.notes ?? '').toString();
      // 같은 라인 중복 방지 (오늘 같은 캠페인 재신청 등)
      if (!prevNotes.includes(options.activityNote.trim())) {
        patch.notes = [options.activityNote.trim(), prevNotes].filter(Boolean).join('\n');
        activityAppended = true;
      }
    }
    if (Object.keys(patch).length > 0) {
      await call(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
    }
    return { contactId: existing.id as string, isExisting: true, activityAppended };
  }

  // 신규 insert
  const insertRes = await call(`${SUPABASE_URL}/rest/v1/contacts`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: member.name,
      phone: member.phone,
      phone_normalized: phoneNorm,
      email: member.email,
      org_name: member.orgName,
      contact_type: options.contactType ?? '리드',
      lead_source: options.leadSource ?? '럭키세븐 5월',
      // 스테이지는 넘어온 경우에만 기록한다. 비워두면 normalizeStage가 빈 문자열을
      // 돌려줘서 고객 화면의 리드 퍼널 집계에서 아예 빠진다.
      ...(options.leadStage ? { lead_stage: options.leadStage } : {}),
      // 신규 contact도 첫 활동이력으로 기록 (있을 때만)
      ...(options.activityNote && options.activityNote.trim()
        ? { notes: options.activityNote.trim() }
        : {}),
    }),
  });
  if (!insertRes.ok) throw new Error('contacts insert 실패');
  const created = await insertRes.json();
  const newId = (Array.isArray(created) ? created[0]?.id : created.id) as string;
  return { contactId: newId, isExisting: false, activityAppended: !!options.activityNote };
}

/** 공개 `/order` 가 쓰는 입구. 공개 키로 나간다 — HARD-B2b 에서 서버 함수로 옮긴다. */
export function publicUpsertLeadContact(
  member: { name: string; phone: string; email: string; orgName: string },
  options: UpsertLeadContactOptions = {},
): Promise<UpsertLeadContactResult> {
  return upsertLeadContactCore(member, options, 'public');
}
