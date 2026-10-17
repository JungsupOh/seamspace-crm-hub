// Supabase Edge Function: sweetbook-webhook
// 스위트북 Book Print API 의 주문 상태 웹훅을 받아 카카오 알림톡을 보낸다.
//
//   POST /functions/v1/sweetbook-webhook
//   Headers: X-Webhook-Signature / X-Webhook-Timestamp / X-Webhook-Event / X-Webhook-Delivery
//   Body:    {event_uid, event_type, created_at, data:{order_uid, ...}}   (snake_case)
//
// 서명: "sha256=" + HMAC-SHA256(secretKey, `${timestamp}.${raw body}`)
//
// **타임스탬프 유효시간을 두지 않는다.** 재시도가 1분·5분·30분 뒤에 오는데
// 서명 타임스탬프가 최초 생성 시점 그대로일 가능성이 있어, 창을 좁히면 재시도를
// 전부 떨궈 버린다. 리플레이 방어는 delivery_id 멱등 처리로 한다.
//
// **빠르게 2xx 를 돌려줘야 한다** (30초 타임아웃, 초과하면 FAILED → 재시도).
// 알림톡 발송 실패는 200 으로 응답하고 로그에만 남긴다 — 재시도해 봐야
// 같은 이유로 또 실패하고, 그 사이 주문 상태 기록만 어긋난다.

import { sendAlimtalk, carrierName } from "../_shared/alimtalk.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENV_SECRET = Deno.env.get("SWEETBOOK_WEBHOOK_SECRET") ?? "";

const DB = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

const ok = (body: unknown = { received: true }) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

// ── 서명키 ──────────────────────────────────────────
// 함수 시크릿이 1순위, app_secrets 테이블이 폴백이다.
// 스위트북 secretKey 는 최초 등록 시에만 전체 값이 내려오므로, 받자마자
// 어딘가에 넣어 둬야 한다. 함수 시크릿을 넣으려면 PAT 가 필요해서 DB 경로를 열어 뒀다.
let cachedSecret: string | null = ENV_SECRET || null;

async function webhookSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  try {
    const rows = await dbGet("app_secrets?key=eq.sweetbook_webhook_secret&select=value&limit=1");
    cachedSecret = rows[0]?.value ?? "";
  } catch (e) {
    console.error("[sweetbook-webhook] 서명키 조회 실패:", e);
    cachedSecret = "";
  }
  return cachedSecret ?? "";
}

// ── 서명 검증 ────────────────────────────────────────
async function verify(raw: string, timestamp: string, signature: string): Promise<boolean> {
  const secret = await webhookSecret();
  if (!secret || !signature || !timestamp) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = `sha256=${hex}`;
  // 타이밍 공격 방어 — 길이가 다르면 바로 false, 같으면 전부 비교
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ── DB ──────────────────────────────────────────────
async function dbGet(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: DB });
  if (!r.ok) throw new Error(`DB 조회 실패 ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function dbPatch(path: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH", headers: DB, body: JSON.stringify(body),
  });
  if (!r.ok) console.error(`[sweetbook-webhook] DB 갱신 실패 ${r.status}:`, await r.text());
}

/** 이벤트를 기록한다. 이미 받은 delivery 면 null 을 돌려준다(중복). */
async function recordEvent(row: Record<string, unknown>): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/print_order_events`, {
    method: "POST",
    headers: { ...DB, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (r.status === 409) return null;            // delivery_id unique 충돌 = 재전송
  if (!r.ok) throw new Error(`이벤트 기록 실패 ${r.status}: ${await r.text()}`);
  const [created] = await r.json();
  return created.id as string;
}

// ── 이벤트 → 알림톡 템플릿 ────────────────────────────
// 값이 null 이면 알림톡을 보내지 않는다(주문 상태만 갱신).
const TEMPLATES: Record<string, string | null> = {
  "order.created":        "UM_4108",  // 일기책 제작접수
  "production.confirmed": "UM_4109",  // 일기책 제작확정
  "production.started":   "UM_4110",  // 일기책 진행상태 안내
  "production.completed": "UM_4110",
  "shipping.departed":    "UM_4111",  // 일기책 배송시작
  "order.cancelled":      "UM_4123",  // 일기책 주문취소
  "shipping.delivered":   null,       // 등록된 템플릿 없음
  "order.item_cancelled": null,       // 부분 취소는 전체 취소 때 order.cancelled 가 따로 온다
  "order.restored":       null,
};

const PROGRESS: Record<string, string> = {
  "production.started":   "인쇄중",
  "production.completed": "제작완료",
};

function productName(order: any): string {
  const n = Array.isArray(order.volumes) ? order.volumes.length : 0;
  const who = order.diary_name || order.diary_username || "";
  const vols = n > 1 ? ` 전${n}권` : "";
  return `마음일기 일기책${who ? ` (${who}님)` : ""}${vols}`;
}

/** 이벤트별 주문 상태 갱신값 */
function statusPatch(event: string, d: Record<string, any>): Record<string, unknown> | null {
  switch (event) {
    case "order.created":
      return { status: d.order_status || "PAID", ordered_at: d.ordered_at ?? null };
    case "order.cancelled":
      return { status: d.order_status || "CANCELLED", cancelled_at: d.cancelled_at ?? null };
    case "order.restored":
      return { status: d.order_status || "PAID", cancelled_at: null };
    case "production.confirmed":
      return { status: d.order_status || "CONFIRMED" };
    case "production.started":
      return { status: d.order_status || "IN_PRODUCTION" };
    case "production.completed":
      return { status: d.order_status || "PRODUCTION_COMPLETE" };
    case "shipping.departed":
      return {
        status: "SHIPPED",
        tracking_carrier: d.tracking_carrier ?? null,
        tracking_number: d.tracking_number ?? null,
        shipped_at: d.shipped_at ?? null,
      };
    case "shipping.delivered":
      return { status: d.order_status || "DELIVERED", delivered_at: d.changed_at ?? null };
    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return fail(405, "POST only");

  const raw = await req.text();
  const sig = req.headers.get("X-Webhook-Signature") ?? "";
  const ts = req.headers.get("X-Webhook-Timestamp") ?? "";
  const delivery = req.headers.get("X-Webhook-Delivery") ?? "";
  const headerEvent = req.headers.get("X-Webhook-Event") ?? "";

  if (!await webhookSecret()) {
    console.error("[sweetbook-webhook] 서명키 미설정 (SWEETBOOK_WEBHOOK_SECRET / app_secrets)");
    return fail(503, "webhook secret not configured");
  }
  if (!await verify(raw, ts, sig)) {
    console.warn(`[sweetbook-webhook] 서명 불일치 delivery=${delivery} event=${headerEvent}`);
    return fail(401, "invalid signature");
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return fail(400, "invalid json"); }

  const event: string = body.event_type || headerEvent;
  const data: Record<string, any> = body.data ?? {};
  const orderUid: string = data.order_uid ?? "";
  // 테스트 전송(POST /webhooks/test)은 delivery 헤더가 비어 올 수 있다
  const deliveryId = delivery || `evt_${body.event_uid ?? crypto.randomUUID()}`;

  console.log(`[sweetbook-webhook] ${event} order=${orderUid} delivery=${deliveryId} isTest=${body.isTest}`);

  // ① 멱등 — 같은 전송은 한 번만 처리한다
  let eventRowId: string | null;
  try {
    eventRowId = await recordEvent({
      delivery_id: deliveryId,
      event_uid: body.event_uid ?? null,
      event_type: event,
      vendor_order_uid: orderUid || null,
      is_test: body.isTest ?? null,
      payload: body,
    });
  } catch (e) {
    console.error("[sweetbook-webhook] 이벤트 기록 예외:", e);
    return fail(500, String(e));   // DB 가 잠깐 죽은 경우라 재시도가 의미 있다
  }
  if (eventRowId === null) {
    console.log(`[sweetbook-webhook] 중복 전송 무시 delivery=${deliveryId}`);
    return ok({ received: true, duplicate: true });
  }

  // ② 주문 찾기
  let order: any = null;
  if (orderUid) {
    try {
      const rows = await dbGet(`print_orders?vendor_order_uid=eq.${encodeURIComponent(orderUid)}&limit=1`);
      order = rows[0] ?? null;
    } catch (e) {
      console.error("[sweetbook-webhook] 주문 조회 실패:", e);
    }
  }

  // ③ 주문 상태 갱신 (알림톡보다 먼저 — 발송이 실패해도 상태는 남아야 한다)
  if (order) {
    const patch = statusPatch(event, data);
    if (patch) await dbPatch(`print_orders?id=eq.${order.id}`, { ...patch, updated_at: new Date().toISOString() });
  }

  // ④ 알림톡
  const tpl = TEMPLATES[event];
  let sent = false;
  let err: string | null = null;

  if (!tpl) {
    err = order ? null : "주문을 찾지 못했습니다";
  } else if (!order) {
    // 우리가 넣지 않은 주문(관리자 콘솔에서 직접 넣은 건 등)이면 보낼 곳을 모른다
    err = `print_orders 에 ${orderUid} 가 없어 수신자를 알 수 없습니다`;
    console.warn(`[sweetbook-webhook] ${err}`);
  } else {
    // shipping.departed 는 항목(권)마다 한 건씩 온다 — 같은 운송장이면 한 번만 보낸다
    let skip = false;
    if (event === "shipping.departed" && data.tracking_number) {
      try {
        const dup = await dbGet(
          `print_order_events?event_type=eq.shipping.departed` +
          `&vendor_order_uid=eq.${encodeURIComponent(orderUid)}` +
          `&alimtalk_sent=is.true&payload->data->>tracking_number=eq.${encodeURIComponent(data.tracking_number)}` +
          `&limit=1`,
        );
        skip = dup.length > 0;
      } catch (e) {
        console.error("[sweetbook-webhook] 운송장 중복 확인 실패:", e);
      }
    }

    if (skip) {
      err = "같은 운송장으로 이미 발송함";
      console.log(`[sweetbook-webhook] ${err} order=${orderUid}`);
    } else {
      const payload: Record<string, string | undefined> = {
        tpl_code: tpl,
        name: order.recipient_name,
        phone: order.recipient_phone,
        order_number: order.order_ref,
        product_name: productName(order),
      };
      if (event === "production.confirmed") payload.printing_schedule = data.print_day ?? "";
      if (PROGRESS[event]) payload.progress_status = PROGRESS[event];
      if (event === "shipping.departed") {
        payload.delivery_address = [order.address1, order.address2].filter(Boolean).join(" ");
        payload.delivery_company = carrierName(data.tracking_carrier);
        payload.invoice_number = data.tracking_number ?? "";
      }

      try {
        const res = await sendAlimtalk(payload as any);
        sent = res.ok;
        if (!res.ok) err = `알림톡 ${res.status}: ${res.body.slice(0, 300)}`;
      } catch (e) {
        err = String(e);
        console.error("[sweetbook-webhook] 알림톡 예외:", e);
      }
    }
  }

  await dbPatch(`print_order_events?id=eq.${eventRowId}`, {
    alimtalk_tpl: tpl, alimtalk_sent: sent, alimtalk_error: err,
  });

  // 알림톡이 실패해도 200 — 재시도해도 같은 이유로 또 실패한다
  return ok({ received: true, event, alimtalk: tpl ?? null, sent, error: err });
});
