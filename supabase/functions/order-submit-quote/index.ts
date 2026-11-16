// Supabase Edge Function: order-submit-quote  (공개, HARD-B2b)
//
// 공개 /order 의 견적 접수를 대신한다 — 지금은 브라우저가 공개 키로
// deals·deal_quotes·deal_files 에 **직접 쓴다**. 그래서 그 세 테이블의 공개 정책을 닫을 수 없다.
//
// 옮기는 것 (원본 OrderTest.tsx saveWebQuote 와 같은 순서)
//   ① 견적번호 채번  ② 같은 전화의 딜 조회 → 재구매/머지 판정  ③ 딜 PATCH 또는 INSERT
//   ④ 머지면 기존 견적 is_selected=false  ⑤ deal_quotes INSERT
//   ⑥ (attach 액션) deal_files 중복 확인 후 INSERT
//
// 옮기지 않는 것과 이유
//   · **견적서 PDF 생성** — html2canvas·jsPDF 가 DOM 을 쓴다. Deno 로 옮길 수 없다(021-4 §B-1).
//     브라우저가 만들어 Storage 에 올리고, 그 URL 을 ⑥ 으로 보낸다.
//   · **Storage 업로드** — 021-8e 범위.
//   · **메일·텔레그램** — rest/v1 이 아니라 엣지 함수를 부르므로 정책 닫기를 막지 않는다.
//     옮기면 PDF 첨부를 서버가 다시 만들어야 해서 이번 범위를 넘는다.
//   · **결제 승인(confirm-payment)** — 건드리지 않는다.
//
// 중복 방지
//   · 원본의 savingQuoteRef(더블클릭 차단)는 브라우저에 그대로 둔다.
//   · ⑥ 은 (deal_id, slot_key) 중복을 서버가 확인하고 건너뛴다 — 원본과 같은 멱등 규칙.

import { CORS, DB, SUPABASE_URL, json, q } from '../_shared/public-fn.ts';
import {
  buildContactInsert, buildContactPatch, buildDealInsert, buildDealPatch, buildQuoteActivityNote,
  buildQuoteInsert, decideDeal, nextQuoteNumber, normalizeKrPhone, normalizePhoneDigits,
  validateInput, validateLead, type ContactRow, type DealRow, type LeadMember, type LeadOptions,
} from './logic.ts';
import { DEFAULT_TTL_SEC, signPayToken } from '../_shared/quote-token.ts';

const today = () => new Date().toISOString().slice(0, 10);

// HARD-B2c — 결제 링크 서명 토큰. 키가 없으면 빈 문자열을 돌려주고, 브라우저는
// 토큰 없이 옛 모양 그대로 링크를 만든다(경고 모드에서 그대로 열린다).
const LINK_SECRET = Deno.env.get('QUOTE_LINK_SECRET') ?? '';

async function issuePayToken(quoteNumber: string): Promise<string> {
  if (!LINK_SECRET) return '';
  try {
    return await signPayToken(quoteNumber, LINK_SECRET, Math.floor(Date.now() / 1000) + DEFAULT_TTL_SEC);
  } catch (e) {
    console.warn('[order-submit-quote] 결제 토큰 발급 실패 (링크는 토큰 없이 나간다)', e);
    return '';
  }
}

/**
 * contacts 를 전화번호로 찾아 보완하거나 새로 만든다 — HARD-B2c.
 *
 * 원본은 브라우저가 공개 키로 했다(lib/public/leadContact.ts). 동작은 그대로 옮겼고,
 * 읽는 열도 원본과 같다(id,name,email,org_name,contact_type,notes).
 *
 * **던지지 않는다.** 원본 호출부가 try/catch 로 감싸 "실패해도 주문은 계속"이었다.
 * 견적 접수가 contacts 때문에 실패하면 안 된다.
 */
async function upsertLeadContact(member: LeadMember, options: LeadOptions) {
  try {
    const phoneNorm = normalizeKrPhone(member.phone);
    if (phoneNorm.length < 9) return { ok: false as const, reason: 'phone' };

    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/contacts?phone_normalized=eq.${q(phoneNorm)}` +
        `&select=id,name,email,org_name,contact_type,notes&limit=1`,
      { headers: DB },
    );
    const found = findRes.ok ? await findRes.json() : [];

    if (Array.isArray(found) && found.length > 0) {
      const existing = found[0] as ContactRow;
      const { patch, activityAppended } = buildContactPatch(existing, member, options);
      if (Object.keys(patch).length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${q(String(existing.id))}`, {
          method: 'PATCH',
          headers: { ...DB, Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
      }
      return { ok: true as const, isExisting: true, activityAppended };
    }

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
      method: 'POST',
      headers: { ...DB, Prefer: 'return=representation' },
      body: JSON.stringify(buildContactInsert(member, options, phoneNorm)),
    });
    if (!insertRes.ok) return { ok: false as const, reason: 'insert' };
    return { ok: true as const, isExisting: false, activityAppended: !!options.activityNote };
  } catch (e) {
    console.warn('[order-submit-quote] contacts upsert 실패 (무시)', e);
    return { ok: false as const, reason: 'error' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const raw = await req.json().catch(() => null) as Record<string, unknown> | null;

    // ── ⑦ 리드 등록만 (견적 **미리보기** 단계 — 아직 접수가 아니다) ──
    //    원본 OrderTest.tsx previewQuote(:608)가 공개 키로 contacts 를 직접 썼다.
    //    접수(①~⑤)와는 다른 흐름이라 액션을 따로 둔다 — 접수 안에서 부르면
    //    미리보기만 하고 떠난 사람의 활동이력이 남지 않는다(원본은 남겼다).
    if (raw && raw.action === 'lead') {
      const lv = validateLead(raw);
      if (!lv.ok) return json({ error: lv.error }, lv.status);
      const r = await upsertLeadContact(lv.member, lv.options);
      // 원본은 실패를 삼켰다(화면에 영향 없음). 같은 동작을 유지한다.
      return json({ ok: true, saved: r.ok });
    }

    // ── ⑥ 첨부 등록 (PDF 를 브라우저가 올린 뒤 부른다) ──
    if (raw && raw.action === 'attach') {
      const dealId = typeof raw.dealId === 'string' ? raw.dealId.trim() : '';
      const slotKey = typeof raw.slotKey === 'string' ? raw.slotKey.trim().slice(0, 120) : '';
      const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 120) : '';
      const fileName = typeof raw.fileName === 'string' ? raw.fileName.trim().slice(0, 200) : '';
      const fileUrl = typeof raw.fileUrl === 'string' ? raw.fileUrl.trim() : '';
      if (!dealId || !slotKey || !fileName || !fileUrl) {
        return json({ error: '첨부 정보가 올바르지 않습니다.' }, 400);
      }
      // 우리 Storage 주소만 받는다 — 임의 URL 을 딜에 붙이지 못하게.
      if (!fileUrl.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`)) {
        return json({ error: '첨부 주소가 올바르지 않습니다.' }, 400);
      }

      const exist = await fetch(
        `${SUPABASE_URL}/rest/v1/deal_files?deal_id=eq.${q(dealId)}&slot_key=eq.${q(slotKey)}&select=id&limit=1`,
        { headers: DB },
      );
      const rows = exist.ok ? await exist.json() : [];
      if (Array.isArray(rows) && rows.length > 0) return json({ ok: true, skipped: true });

      const ins = await fetch(`${SUPABASE_URL}/rest/v1/deal_files`, {
        method: 'POST',
        headers: { ...DB, Prefer: 'return=minimal' },
        body: JSON.stringify({ deal_id: dealId, slot_key: slotKey, label, file_name: fileName, file_url: fileUrl }),
      });
      if (!ins.ok) return json({ error: '첨부 저장에 실패했습니다.' }, 502);
      return json({ ok: true, skipped: false });
    }

    // ── ①~⑤ 견적 접수 ──
    const v = validateInput(raw);
    if (!v.ok) return json({ error: v.error }, v.status);
    const input = v.value;
    const d = today();
    const prefix = `${d.slice(0, 4)}-${input.productCode}-`;
    const phoneNorm = normalizePhoneDigits(input.phone);

    // ① 견적번호
    const seqRes = await fetch(
      `${SUPABASE_URL}/rest/v1/deal_quotes?quote_number=like.${q(prefix + '%')}` +
        `&select=quote_number&order=quote_number.desc&limit=1`,
      { headers: DB },
    );
    const seqRows = seqRes.ok ? await seqRes.json() : [];
    const qNum = nextQuoteNumber(prefix, Array.isArray(seqRows) && seqRows[0] ? seqRows[0].quote_number : null);

    // ② 같은 전화의 딜
    let dealId = 'web';
    let merged = false;
    let dealType: 'New' | 'Renewal' = 'New';
    try {
      const allRes = await fetch(
        `${SUPABASE_URL}/rest/v1/deals?contact_phone=eq.${q(input.phone)}` +
          `&select=id,deal_stage,created_date,quote_number&order=created_date.desc&limit=20`,
        { headers: DB },
      );
      const all = allRes.ok ? await allRes.json() as DealRow[] : [];
      const decision = decideDeal(all, d);
      dealType = decision.dealType;
      if (decision.mergeDealId) {
        dealId = decision.mergeDealId;
        merged = true;
        // ③-a 기존 딜 갱신
        await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${q(dealId)}`, {
          method: 'PATCH',
          headers: { ...DB, Prefer: 'return=minimal' },
          body: JSON.stringify(buildDealPatch(input, d, qNum)),
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[order-submit-quote] 기존 딜 검색 예외', e);
    }

    // ③-b 신규 딜
    if (!merged) {
      try {
        const dealRes = await fetch(`${SUPABASE_URL}/rest/v1/deals`, {
          method: 'POST',
          headers: { ...DB, Prefer: 'return=representation' },
          body: JSON.stringify(buildDealInsert(input, d, qNum, dealType)),
        });
        if (dealRes.ok) {
          const inserted = await dealRes.json();
          if (Array.isArray(inserted) && inserted[0]?.id) dealId = inserted[0].id;
        } else {
          console.warn('[order-submit-quote] deals INSERT 실패 — deal_quotes만 저장', dealRes.status);
        }
      } catch (e) {
        console.warn('[order-submit-quote] deals INSERT 예외', e);
      }
    }

    // ④ 머지면 기존 견적 비활성
    if (merged && dealId !== 'web') {
      await fetch(`${SUPABASE_URL}/rest/v1/deal_quotes?deal_id=eq.${q(dealId)}&is_selected=is.true`, {
        method: 'PATCH',
        headers: { ...DB, Prefer: 'return=minimal' },
        body: JSON.stringify({ is_selected: false }),
      }).catch(() => {});
    }

    // ⑤ 견적 INSERT
    const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/deal_quotes`, {
      method: 'POST',
      headers: { ...DB, Prefer: 'return=representation' },
      body: JSON.stringify(buildQuoteInsert(input, d, qNum, dealId, phoneNorm)),
    });
    if (!saveRes.ok) return json({ error: '견적서 저장에 실패했습니다.' }, 502);
    const created = await saveRes.json();
    const quoteId = Array.isArray(created) && created[0]?.id ? String(created[0].id) : null;

    // ⑥ contacts 등록 — **같은 요청 안에서** 한다(HARD-B2c).
    //    원본은 접수가 끝난 뒤 브라우저가 따로 한 번 더 불렀다(OrderTest.tsx:738).
    //    같은 요청 안으로 넣으면 왕복이 한 번 줄고, 접수는 성공했는데 contacts 만
    //    빠지는 창(브라우저가 중간에 닫히는 경우)도 없어진다.
    const contact = await upsertLeadContact(
      { name: input.contactName, phone: input.phone, email: input.email, orgName: input.orgName },
      {
        leadSource: input.leadSource || 'Web 견적',
        // 활동이력은 **서버가 만든다** — 견적번호·머지·재구매가 응답으로만 정해지기 때문이다.
        activityNote: buildQuoteActivityNote({
          today: d, quoteNumber: qNum, planLabel: input.planLabel,
          months: input.months, qty: input.qty, total: input.total, merged, dealType,
        }),
      },
    );

    return json({
      ok: true, quoteNumber: qNum, dealId, quoteId, merged, dealType,
      contactSaved: contact.ok,
      // 메일 본문의 결제 링크에 붙인다. 키가 없으면 빈 문자열 — 링크는 옛 모양 그대로.
      payToken: await issuePayToken(qNum),
    });
  } catch (e) {
    console.error('[order-submit-quote]', e);
    return json({ error: '처리 중 오류가 발생했습니다.' }, 500);
  }
});
