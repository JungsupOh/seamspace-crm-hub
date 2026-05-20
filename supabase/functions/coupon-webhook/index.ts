// Supabase Edge Function: coupon-webhook
// 외부(mDiary 백엔드)에서 쿠폰 상태 변경 시 호출하는 webhook 수신기.
// 멱등성: 같은 event 가 N 번 들어와도 안전 (UPSERT 패턴).
//
// 명세:
//   POST /functions/v1/coupon-webhook
//   Headers:
//     Content-Type: application/json
//     X-Webhook-Secret: {COUPON_WEBHOOK_SECRET 환경변수와 일치해야 함}
//   Body:
//     {
//       event: 'coupon.activated' | 'coupon.expired' | 'coupon.deleted',
//       coupon_code: 'XB9H25',
//       is_used?: boolean,
//       used_group_id?: number | string,
//       service_expire_at?: string,        // YYYY-MM-DD
//       group_name?: string,
//       edu_office_name?: string,
//       member_count?: number,
//       timestamp?: string
//     }
//
// 응답:
//   2xx — 정상 처리
//   400 — payload 형식 오류 (재시도 불필요)
//   401 — secret 불일치 (재시도 불필요)
//   5xx — 일시적 오류 (백엔드 재시도 권장)

import { sendTelegram } from "../_shared/telegram.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("COUPON_WEBHOOK_SECRET") ?? "";

const DB_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

interface CouponPayload {
  event: "coupon.activated" | "coupon.expired" | "coupon.deleted";
  coupon_code: string;
  is_used?: boolean;
  used_group_id?: number | string | null;
  service_expire_at?: string | null;
  group_name?: string | null;
  edu_office_name?: string | null;
  member_count?: number | null;
  timestamp?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // 1) Secret 검증
    if (!WEBHOOK_SECRET) {
      console.error("[coupon-webhook] COUPON_WEBHOOK_SECRET 미설정 — 모든 호출 거부");
      return json({ ok: false, error: "Server misconfigured" }, 500);
    }
    const secret = req.headers.get("X-Webhook-Secret") ?? "";
    if (secret !== WEBHOOK_SECRET) {
      return json({ ok: false, error: "Invalid secret" }, 401);
    }

    // 2) Payload 파싱 + 검증
    let p: CouponPayload;
    try {
      p = await req.json() as CouponPayload;
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }
    if (!p.event || !p.coupon_code) {
      return json({ ok: false, error: "event/coupon_code required" }, 400);
    }
    const validEvents = ["coupon.activated", "coupon.expired", "coupon.deleted"];
    if (!validEvents.includes(p.event)) {
      return json({ ok: false, error: `Unknown event: ${p.event}` }, 400);
    }

    // 3) 이벤트별 처리
    // 공통: deal_licenses + campaign_licenses + mdiary_coupons 3 테이블 동기화
    const today = new Date().toISOString().slice(0, 10);
    const status =
      p.event === "coupon.deleted"   ? "삭제" :
      p.event === "coupon.expired"   ? "만료" :
      // coupon.activated
      (p.service_expire_at && p.service_expire_at < today) ? "만료" : "사용중";

    // 3-a) deal_licenses 갱신 (해당 코드 row 가 있을 때만)
    const dealRes = await fetch(
      `${SUPABASE_URL}/rest/v1/deal_licenses?coupon_code=eq.${encodeURIComponent(p.coupon_code)}`,
      {
        method: "PATCH",
        headers: { ...DB_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify({
          status,
          service_expire_at: p.service_expire_at ?? null,
        }),
      },
    );
    const dealOk = dealRes.ok;

    // 3-b) campaign_licenses 갱신
    const campaignRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaign_licenses?coupon_code=eq.${encodeURIComponent(p.coupon_code)}`,
      {
        method: "PATCH",
        headers: { ...DB_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify({
          status,
          service_expire_at: p.service_expire_at ?? null,
        }),
      },
    );
    const campaignOk = campaignRes.ok;

    // 3-c) mdiary_coupons UPSERT (mDiary 운영DB 미러 — coupon_code unique)
    // 기존 row 가 있으면 PATCH, 없으면 INSERT.
    let mdiaryAction: "updated" | "inserted" | "skipped" = "skipped";
    const findRes = await fetch(
      `${SUPABASE_URL}/rest/v1/mdiary_coupons?coupon_code=eq.${encodeURIComponent(p.coupon_code)}&select=id&limit=1`,
      { headers: DB_HEADERS },
    );
    const existing = findRes.ok ? (await findRes.json() as { id: number }[]) : [];

    if (existing.length > 0) {
      // PATCH — 매칭되는 컬럼만 갱신
      const updRes = await fetch(
        `${SUPABASE_URL}/rest/v1/mdiary_coupons?id=eq.${existing[0].id}`,
        {
          method: "PATCH",
          headers: { ...DB_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({
            is_used:           p.is_used ?? (p.event === "coupon.activated"),
            service_expire_at: p.service_expire_at ?? null,
            member_count:      p.member_count ?? null,
            group_name:        p.group_name ?? null,
            edu_office_name:   p.edu_office_name ?? null,
            used_group_id:     p.used_group_id ? String(p.used_group_id) : null,
          }),
        },
      );
      if (updRes.ok) mdiaryAction = "updated";
    } else if (p.event === "coupon.activated") {
      // INSERT — 백엔드가 새 쿠폰을 보낸 경우 (이론상 sync-new-coupons 가 먼저 INSERT 해야 하지만 안전망)
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons`, {
        method: "POST",
        headers: { ...DB_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify({
          coupon_code:       p.coupon_code,
          is_used:           p.is_used ?? true,
          service_expire_at: p.service_expire_at ?? null,
          member_count:      p.member_count ?? 0,
          group_name:        p.group_name ?? null,
          edu_office_name:   p.edu_office_name ?? null,
          used_group_id:     p.used_group_id ? String(p.used_group_id) : null,
        }),
      });
      if (insRes.ok) mdiaryAction = "inserted";
    }

    console.log(`[coupon-webhook] ${p.event} ${p.coupon_code} → status=${status} deal=${dealOk} campaign=${campaignOk} mdiary=${mdiaryAction}`);

    // 4) 텔레그램 알림 — 사용자가 쿠폰을 사용 시작했을 때(activated) + 만료/삭제 시
    // 알림이 핵심 영업/지원 이벤트라 비동기 발송 (실패해도 webhook 응답엔 영향 X)
    notifyCouponEvent(p, status).catch(e => console.warn("[coupon-webhook] 텔레그램 알림 실패:", e));

    return json({
      ok: true,
      event: p.event,
      coupon_code: p.coupon_code,
      applied: { status, deal: dealOk, campaign: campaignOk, mdiary: mdiaryAction },
    }, 200);
  } catch (e) {
    console.error("[coupon-webhook] 오류:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── 텔레그램 알림 — 사용중 전환 / 만료 / 삭제 ──────────────────────
// 알림 본문에 영업팀이 즉시 follow-up 가능하도록 학교/그룹/멤버수 표시.
// 사용자 노출 텍스트는 '심스페이스' 만 사용 (mDiary 표기 금지).
async function notifyCouponEvent(p: CouponPayload, status: string): Promise<void> {
  // 누가/어디서 어떤 코드를 썼는지 보충 — DB 에서 contact_name/org_name 추가 회수
  let contactName = "";
  let orgName = p.group_name ?? "";
  let source: "deal" | "campaign" | "mdiary" | "" = "";

  // 우선 deal_licenses 매칭
  try {
    const dlRes = await fetch(
      `${SUPABASE_URL}/rest/v1/deal_licenses?coupon_code=eq.${encodeURIComponent(p.coupon_code)}&select=contact_name,org_name&limit=1`,
      { headers: DB_HEADERS },
    );
    if (dlRes.ok) {
      const rows = await dlRes.json() as { contact_name: string; org_name: string }[];
      if (rows[0]) {
        contactName = rows[0].contact_name ?? "";
        if (!orgName) orgName = rows[0].org_name ?? "";
        source = "deal";
      }
    }
  } catch { /* ignore */ }

  // 없으면 campaign_licenses 매칭
  if (!source) {
    try {
      const clRes = await fetch(
        `${SUPABASE_URL}/rest/v1/campaign_licenses?coupon_code=eq.${encodeURIComponent(p.coupon_code)}&select=contact_name,org_name&limit=1`,
        { headers: DB_HEADERS },
      );
      if (clRes.ok) {
        const rows = await clRes.json() as { contact_name: string; org_name: string }[];
        if (rows[0]) {
          contactName = rows[0].contact_name ?? "";
          if (!orgName) orgName = rows[0].org_name ?? "";
          source = "campaign";
        }
      }
    } catch { /* ignore */ }
  }

  // 그래도 없으면 mdiary_coupons
  if (!source) {
    try {
      const mcRes = await fetch(
        `${SUPABASE_URL}/rest/v1/mdiary_coupons?coupon_code=eq.${encodeURIComponent(p.coupon_code)}&select=extracted_name,descript&limit=1`,
        { headers: DB_HEADERS },
      );
      if (mcRes.ok) {
        const rows = await mcRes.json() as { extracted_name: string | null; descript: string | null }[];
        if (rows[0]) {
          contactName = rows[0].extracted_name ?? "";
          if (!orgName) orgName = rows[0].descript ?? "";
          source = "mdiary";
        }
      }
    } catch { /* ignore */ }
  }

  const sourceLabel = source === "deal" ? "딜이용권" : source === "campaign" ? "캠페인이용권" : source === "mdiary" ? "직접발급" : "미연동";
  const memberStr = p.member_count != null ? `\n👥 멤버 ${p.member_count}명` : "";
  const expireStr = p.service_expire_at ? `\n📅 만료 ${p.service_expire_at}` : "";
  const eduStr = p.edu_office_name ? `\n📍 ${p.edu_office_name}` : "";

  if (p.event === "coupon.activated") {
    await sendTelegram(
      `🎟 <b>이용권 사용 시작</b>\n\n` +
      `📌 ${p.coupon_code} · ${sourceLabel}\n` +
      `🏫 ${orgName || "(미입력)"}${contactName ? ` · ${contactName}` : ""}${eduStr}${memberStr}${expireStr}`,
    );
  } else if (p.event === "coupon.expired") {
    await sendTelegram(
      `⌛ <b>이용권 만료</b>\n\n` +
      `📌 ${p.coupon_code} · ${sourceLabel}\n` +
      `🏫 ${orgName || "(미입력)"}${contactName ? ` · ${contactName}` : ""}${eduStr}${memberStr}`,
    );
  } else if (p.event === "coupon.deleted") {
    await sendTelegram(
      `🗑 <b>이용권 삭제</b>\n\n` +
      `📌 ${p.coupon_code} · ${sourceLabel}\n` +
      `🏫 ${orgName || "(미입력)"}${contactName ? ` · ${contactName}` : ""}`,
    );
  }
}
