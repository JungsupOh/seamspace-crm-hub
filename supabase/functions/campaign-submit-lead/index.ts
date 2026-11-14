// Supabase Edge Function: campaign-submit-lead
//
// 공개 캠페인 폼(/c/:slug)의 신청 처리를 **서버로 옮긴 것**. 설계는
// audit/021-4_browser_callers_plan.md §2-1. 지금은 브라우저가 anon 키로
// campaign_leads·campaign_licenses 에 직접 쓰고 create-coupon·send-email 을
// 직접 부르는데, 그 때문에 009-3·009-5 의 전면 허용 정책을 닫을 수 없다.
//
// **이 함수는 아직 아무도 호출하지 않는다.** 브라우저 연결은 021-6 에서 한다.
// 그래서 배포해도 운영 동작이 바뀌지 않는다.
//
// 공개 함수라 JWT 가 없다. 대신 아래로 막는다:
//   1) 수신자·본문을 **서버가 만든다** — 요청 본문의 주소로는 보내지 않는다.
//      이게 "임의 메일 발송" 악용을 막는 실질적인 최대 방어다.
//   2) 멱등 — 같은 submissionId 는 한 번만 처리한다(더블클릭/재시도 보호).
//   3) 발송 상한 — 같은 연락처로 하루 N건까지.
//
// 순수 로직은 logic.ts, 메일 템플릿은 templates.ts 에 있고 vitest 가 검증한다.

import {
  validate,
  decideFromPrior,
  isExistingCustomer,
  exceedsSendCap,
  couponDescription,
  expiresAtFromDuration,
  MAX_SUBMISSIONS_PER_DAY,
  type CleanLead,
  type PriorTrial,
} from "./logic.ts";
import { buildTrialEmail } from "./templates.ts";
import { internalHeaders } from "../_shared/internal.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Edge→Edge 호출은 SERVICE_ROLE_KEY 를 Bearer 로 쓰면 401 이 난다(apk-subscribe:14).
// 그래서 내부 호출의 Authorization 은 anon 키로 두고, 인증은 internalHeaders 가 맡는다.
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const DB: Record<string, string> = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const q = (v: string) => encodeURIComponent(v);

// ── 멱등 ────────────────────────────────────────────
// 전용 컬럼이 없고 이번 단위는 스키마를 바꾸지 않으므로(021 원칙),
// submissionId 를 campaign_leads.custom_fields 안에 넣고 그걸로 찾는다.
const SUBMISSION_KEY = "submission_id";

async function findBySubmissionId(submissionId: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads` +
      `?custom_fields->>${SUBMISSION_KEY}=eq.${q(submissionId)}` +
      `&select=id,status&limit=1`,
    { headers: DB },
  );
  if (!r.ok) return null;
  const rows = await r.json() as Array<{ id: string; status: string }>;
  return rows[0] ?? null;
}

// ── 발송 상한 ───────────────────────────────────────
async function recentSubmissionCount(lead: CleanLead): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const conds: string[] = [];
  if (lead.phoneNormalized) conds.push(`phone_normalized.eq.${lead.phoneNormalized}`);
  if (lead.email) conds.push(`email.ilike.${lead.email}`);
  if (conds.length === 0) return 0;
  const filter = conds.length === 1 ? conds[0] : `or=(${conds.join(",")})`;
  const url = `${SUPABASE_URL}/rest/v1/campaign_leads?${filter}` +
    `&created_at=gte.${q(since)}&select=id`;
  const r = await fetch(url, { headers: { ...DB, Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) return 0;
  const range = r.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

// ── 기존 체험권 조회 — campaign-trial-license.ts:72-117 과 같은 3단 조회 ──
async function findPriorTrial(
  phoneNormalized: string,
  email: string | null,
  currentLeadId: string,
): Promise<PriorTrial | null> {
  const phoneOk = !!phoneNormalized;
  const emailOk = !!(email && email.trim());
  if (!phoneOk && !emailOk) return null;

  const conditions: string[] = [];
  if (phoneOk) conditions.push(`phone_normalized.eq.${phoneNormalized}`);
  if (emailOk) conditions.push(`email.ilike.${email!.trim()}`);
  const filter = conditions.length === 1 ? conditions[0] : `or=(${conditions.join(",")})`;

  const leadsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?${filter}&select=id&id=neq.${q(currentLeadId)}`,
    { headers: DB },
  );
  if (!leadsRes.ok) return null;
  const otherLeads = await leadsRes.json() as Array<{ id: string }>;
  if (otherLeads.length === 0) return null;

  const inFilter = `(${otherLeads.map((l) => l.id).join(",")})`;
  const licRes = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_licenses?lead_id=in.${inFilter}` +
      `&select=coupon_code,status,created_at,campaign_id&order=created_at.desc&limit=1`,
    { headers: DB },
  );
  if (!licRes.ok) return null;
  const lics = await licRes.json() as Array<
    { coupon_code: string; status: string; created_at: string; campaign_id: string }
  >;
  if (lics.length === 0) return null;
  const lic = lics[0];

  let campaignName = "";
  try {
    const cRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaigns?id=eq.${q(lic.campaign_id)}&select=name`,
      { headers: DB },
    );
    if (cRes.ok) {
      const c = await cRes.json() as Array<{ name: string }>;
      campaignName = c[0]?.name ?? "";
    }
  } catch { /* ignore */ }

  return {
    coupon_code: lic.coupon_code,
    status: lic.status,
    created_at: lic.created_at,
    campaign_name: campaignName,
  };
}

async function patchLeadStatus(leadId: string, status: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${q(leadId)}`, {
      method: "PATCH",
      headers: { ...DB, Prefer: "return=minimal" },
      body: JSON.stringify({ status, sent_at: new Date().toISOString() }),
    });
  } catch { /* 원본과 동일하게 무시 — 리드 등록 자체는 성공 처리 */ }
}

// ── 외부 호출 ───────────────────────────────────────
async function createCoupon(description: string, duration: string, userLimit: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      ...internalHeaders(),
    },
    body: JSON.stringify({ description, duration, user_limit: userLimit }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error || !data.coupon_code) {
    throw new Error(data.error ?? `쿠폰 생성 실패 (${r.status})`);
  }
  return data.coupon_code as string;
}

async function sendMail(built: ReturnType<typeof buildTrialEmail>): Promise<void> {
  const body: Record<string, unknown> = {
    to: built.to,
    subject: built.subject,
    html: built.html,
    text: built.text,
    reply_to: built.reply_to,
  };
  // cc 가 undefined 면 키를 넣지 않는다 — send-email 이 기본 참조(sales@)를 붙인다.
  // null 이면 참조를 끄겠다는 뜻이라 그대로 실어 보낸다. (email.ts:36,41 과 같은 규칙)
  if (built.cc !== undefined) body.cc = built.cc;

  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      ...internalHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error ?? `이메일 발송 실패 (${r.status})`);
  }
}

async function sendAlimtalk(p: {
  first_name: string; phone: string; coupon_code: string; user_limit: string; duration: string;
}): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-coupon`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ ...p, send_type: "trial" }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error ?? `발송 실패 (${r.status})`);
}

// ── 본체 ────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const raw = await req.json().catch(() => ({}));

    // 1) 입력 검증 — 브라우저 검사는 우회된다는 전제로 서버가 다시 본다
    const v = validate(raw);
    if (!v.ok) return json({ error: v.error }, 400);
    const lead = v.value;

    // 2) 멱등 — 같은 신청을 두 번 처리하지 않는다
    const already = await findBySubmissionId(lead.submissionId);
    if (already) {
      return json({ ok: true, deduplicated: true, leadId: already.id, status: already.status });
    }

    // 3) 캠페인 조회 — 설정은 **서버가 DB 에서 읽는다**(요청 본문을 믿지 않는다)
    const cRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaigns?id=eq.${q(lead.campaignId)}` +
        `&select=id,name,title,status,trial_license_settings&limit=1`,
      { headers: DB },
    );
    if (!cRes.ok) return json({ error: "캠페인을 불러오지 못했습니다." }, 502);
    const campaigns = await cRes.json() as Array<{
      id: string; name: string; title?: string | null; status?: string;
      trial_license_settings?: Record<string, unknown> | null;
    }>;
    const campaign = campaigns[0];
    if (!campaign) return json({ error: "캠페인을 찾을 수 없습니다." }, 404);
    if (campaign.status && campaign.status !== "active") {
      return json({ error: "종료된 캠페인입니다." }, 400);
    }

    // 4) 발송 상한
    if (exceedsSendCap(await recentSubmissionCount(lead))) {
      console.warn(`[campaign-submit-lead] 발송 상한 초과 campaign=${lead.campaignId}`);
      return json(
        { error: "신청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMITED" },
        429,
      );
    }

    // 5) 기존 고객 판별 — CampaignForm.tsx:178-191 과 같은 두 갈래 조회
    let existing = false;
    try {
      const [contactsRes, licsRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/contacts?phone_normalized=eq.${q(lead.phoneNormalized)}&select=contact_type`,
          { headers: DB },
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/campaign_licenses?contact_phone=ilike.*${q(lead.phoneNormalized)}*&select=id`,
          { headers: DB },
        ),
      ]);
      existing = isExistingCustomer(
        contactsRes.ok ? await contactsRes.json() : [],
        licsRes.ok ? await licsRes.json() : [],
      );
    } catch { /* 판별 실패는 '신규'로 — 원본과 동일 */ }

    // 6) campaign_leads INSERT — CampaignForm.tsx:243-265 과 같은 모양
    //    멱등 키를 custom_fields 에 함께 넣는다(스키마 변경 없이 중복을 찾기 위해)
    const customFields = { ...(lead.customFields ?? {}), [SUBMISSION_KEY]: lead.submissionId };
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads`, {
      method: "POST",
      headers: { ...DB, Prefer: "return=representation" },
      body: JSON.stringify({
        campaign_id: lead.campaignId,
        school_name: lead.schoolName,
        school_code: null,
        school_kind: lead.schoolKind,
        position: lead.position,
        name: lead.name,
        phone: lead.phone,
        phone_normalized: lead.phoneNormalized,
        email: lead.email,
        source: lead.source,
        source_etc: lead.sourceEtc,
        marketing_consent: lead.marketingConsent,
        status: "신규",
        is_existing_customer: existing,
        custom_fields: customFields,
      }),
    });
    if (!insRes.ok) {
      const err = await insRes.text().catch(() => "");
      console.error(`[campaign-submit-lead] 리드 등록 실패 ${insRes.status} ${err.slice(0, 200)}`);
      return json({ error: "제출에 실패했습니다. 잠시 후 다시 시도해 주세요." }, 502);
    }
    const insertedRows = await insRes.json().catch(() => []);
    const leadId: string | undefined = Array.isArray(insertedRows) ? insertedRows[0]?.id : undefined;
    if (!leadId) return json({ error: "제출에 실패했습니다." }, 502);

    // ── 여기까지가 '신청 접수'. 아래 체험권 발급은 실패해도 접수는 성공이다
    //    (campaign-trial-license.ts:8 과 같은 원칙)

    const settings = (campaign.trial_license_settings ?? null) as {
      enabled?: boolean; auto_issue?: boolean; plan?: string; user_count?: number;
      duration_months?: number; service_expire_at?: string;
      delivery_channel?: string; cc_email?: string; cc_sales?: boolean;
    } | null;

    if (!settings?.enabled || !settings?.auto_issue) {
      return json({ ok: true, leadId, isExistingCustomer: existing, trial: null });
    }

    const PLAN_USER_COUNT: Record<string, number> = { classroom: 40, grade: 200 };
    const durationMonths = Number(settings.duration_months ?? 1);
    const userCount = settings.user_count ?? PLAN_USER_COUNT[settings.plan ?? ""] ?? 40;
    const channel = settings.delivery_channel === "email" ? "email" : "alimtalk";
    // 메일에 노출할 캠페인명 — 폼 제목(title) 우선, 없으면 내부명(name)
    const campaignDisplay = campaign.title?.trim() || campaign.name;
    const description = couponDescription(campaign.name, lead.schoolName, lead.name);
    const expireAt = settings.service_expire_at || expiresAtFromDuration(durationMonths);

    // 7) 기존 체험권 판정
    let prior: PriorTrial | null = null;
    try {
      prior = await findPriorTrial(lead.phoneNormalized, lead.email, leadId);
    } catch (e) {
      console.warn("[campaign-submit-lead] 기존 체험권 조회 실패 — 신규 발급으로 진행", e);
    }
    const decision = decideFromPrior(prior);

    const mailFor = (code: string, resend: boolean) =>
      buildTrialEmail(lead.locale, {
        to: lead.email,
        contactName: lead.name,
        orgName: lead.schoolName ?? undefined,
        campaignName: campaignDisplay,
        couponCode: code,
        durationDays: durationMonths * 30,
        userLimit: userCount,
        serviceExpireAt: expireAt,
        cc: settings.cc_email,
        ccSales: settings.cc_sales !== false,
        resend,
      });

    // 7-a) 차단 — 발급도 발송도 하지 않는다
    if (decision.action === "block") {
      await patchLeadStatus(leadId, decision.leadStatus);
      return json({
        ok: true, leadId, isExistingCustomer: existing,
        trial: {
          code: decision.code, outcome: decision.outcome,
          alimtokSent: false, emailSent: false, licenseSaved: false, channel,
          priorIssuedAt: prior?.created_at, priorCampaignName: prior?.campaign_name,
        },
      });
    }

    // 7-b) 재발송 — 기존 코드를 다시 보낸다. 새 INSERT 는 하지 않는다
    if (decision.action === "resend") {
      let alimtokSent = false, emailSent = false;
      if (channel === "email") {
        try { await sendMail(mailFor(decision.code, true)); emailSent = true; }
        catch (e) { console.warn("[campaign-submit-lead] 재발송(이메일) 실패", e); }
      } else {
        try {
          await sendAlimtalk({
            first_name: lead.name, phone: lead.phone, coupon_code: decision.code,
            user_limit: String(userCount), duration: String(durationMonths),
          });
          alimtokSent = true;
        } catch (e) { console.warn("[campaign-submit-lead] 재발송(알림톡) 실패", e); }
      }
      await patchLeadStatus(leadId, decision.leadStatus);
      return json({
        ok: true, leadId, isExistingCustomer: existing,
        trial: {
          code: decision.code, outcome: decision.outcome,
          alimtokSent, emailSent, licenseSaved: false, channel,
          priorIssuedAt: prior?.created_at, priorCampaignName: prior?.campaign_name,
        },
      });
    }

    // 7-c) 신규 발급
    let code = "";
    try {
      code = await createCoupon(description, String(durationMonths), String(userCount));
    } catch (e) {
      console.error("[campaign-submit-lead] 쿠폰 생성 실패", e);
      // 원본과 같이 리드 등록은 성공으로 둔다
      return json({ ok: true, leadId, isExistingCustomer: existing, trial: null });
    }

    let alimtokSent = false, emailSent = false;
    if (channel === "email") {
      try { await sendMail(mailFor(code, false)); emailSent = true; }
      catch (e) { console.error("[campaign-submit-lead] 이메일 발송 실패", e); }
    } else {
      try {
        await sendAlimtalk({
          first_name: lead.name, phone: lead.phone, coupon_code: code,
          user_limit: String(userCount), duration: String(durationMonths),
        });
        alimtokSent = true;
      } catch (e) { console.error("[campaign-submit-lead] 알림톡 발송 실패", e); }
    }

    // 8) campaign_licenses INSERT — 발송 실패해도 기록은 남긴다(수동 재발송용)
    let licenseSaved = false;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses`, {
        method: "POST",
        headers: { ...DB, Prefer: "return=minimal" },
        body: JSON.stringify({
          campaign_id: lead.campaignId,
          lead_id: leadId,
          coupon_code: code,
          contact_name: lead.name,
          contact_phone: lead.phone,
          org_name: lead.schoolName,
          duration: String(durationMonths),
          user_count: String(userCount),
          status: "대기",
          service_expire_at: expireAt,
        }),
      });
      licenseSaved = r.ok;
    } catch (e) {
      console.warn("[campaign-submit-lead] campaign_licenses 저장 실패", e);
    }

    await patchLeadStatus(leadId, "체험발송");

    return json({
      ok: true, leadId, isExistingCustomer: existing,
      trial: { code, outcome: "new", alimtokSent, emailSent, licenseSaved, channel },
    });
  } catch (e) {
    console.error("[campaign-submit-lead]", e);
    return json({ error: "처리 중 오류가 발생했습니다." }, 500);
  }
});

// 상한값을 밖에서도 읽을 수 있게(운영 문서/테스트용)
export { MAX_SUBMISSIONS_PER_DAY };
