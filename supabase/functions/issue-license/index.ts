// Supabase Edge Function: issue-license
// 결제 후 이용권 발송 (재발송 우선).
// 정책:
// - quoteNumber가 있으면 반드시 결제 완료가 확인된 경우(order_payments 또는 deal_licenses 존재)에만 발송
// - 결제 미확인 + quoteNumber 있음 → 거부 (무료 이용권 발급 차단)
// - 'allowNewIssue' 플래그가 true면 결제 검증 없이 신규 발급 가능 (admin/manual bank transfer 전용)
// 흐름:
// 1. quoteNumber로 결제 검증 (order_payments OR deal_licenses)
// 2. 기존 코드 있으면 재사용 + 알림톡 재발송
// 3. allowNewIssue=true이고 신규일 때만 create-coupon 호출

import { notifyWebLicenseTG } from "../_shared/telegram.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "https://seamspace-crm-hub.vercel.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 플랜 → 인원수. 풀 라벨 ("학급 플랜" 등) 정규화 대응.
const PLAN_CAPACITY: Record<string, number> = {
  "소수학급": 10,
  "학급":     40,
  "학년":    200,
  "학교(소)": 500,
  "학교(중)": 1000,
  "학교(대)": 99999,
};

function resolvePlanCapacity(plan?: string): { capacity: number; key: string } {
  const raw = (plan ?? "").trim();
  if (!raw) return { capacity: 40, key: "학급" };
  const normalized = raw.replace(/\s*플랜\s*$/, "").trim();
  if (PLAN_CAPACITY[normalized] != null) return { capacity: PLAN_CAPACITY[normalized], key: normalized };
  for (const key of Object.keys(PLAN_CAPACITY)) {
    if (normalized.includes(key)) return { capacity: PLAN_CAPACITY[key], key };
  }
  console.warn(`[issue-license] 알 수 없는 플랜 라벨, 학급(40) fallback:`, plan);
  return { capacity: 40, key: "학급" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const {
      quoteNumber,
      customerName,
      customerPhone,
      customerEmail,
      orgName,
      plan,
      qty = 1,
      duration = 12,
      amount = 0,
      licenseQty,
      allowNewIssue = false,
    } = await req.json() as {
      quoteNumber?: string;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      orgName?: string;
      plan?: string;
      qty?: number;
      duration?: number;
      amount?: number;
      licenseQty?: number;
      allowNewIssue?: boolean;  // admin/계좌이체 수동발급 전용 (사용자 폼에서는 false)
    };

    const count = Math.max(1, licenseQty ?? qty);
    const planResolved = resolvePlanCapacity(plan);
    const userLimit = String(planResolved.capacity);
    const description = [orgName, plan, `${duration}개월`].filter(Boolean).join(" - ");

    // ── 중복 발급 방지: 이미 발급된 경우 기존 코드 반환 ──
    // 우선순위: 1) deal_licenses (canonical) 2) order_payments (legacy fallback)
    let dealLookupId: string | null = null;
    if (quoteNumber) {
      // 1) deal_licenses via deals.quote_number
      const dealRes = await fetch(
        `${SUPABASE_URL}/rest/v1/deals?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=id&limit=1`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      if (dealRes.ok) {
        const deals: { id: string }[] = await dealRes.json();
        if (deals.length > 0) {
          dealLookupId = deals[0].id;
          const licRes = await fetch(
            `${SUPABASE_URL}/rest/v1/deal_licenses?deal_id=eq.${dealLookupId}&select=coupon_code&order=created_at.asc`,
            { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
          );
          if (licRes.ok) {
            const lics: { coupon_code: string }[] = await licRes.json();
            if (lics.length > 0) {
              const codes = lics.map(l => l.coupon_code).filter(Boolean);
              if (codes.length > 0) {
                console.log("[issue-license] 기존 deal_licenses 재사용:", codes);

                // 알림톡만 재발송 (첫 코드)
                await fetch("http://tebahsoft.iptime.org:8310/main/alimtok_coupon/", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    first_name: customerName,
                    phone: customerPhone.replace(/\D/g, ""),
                    coupon_code: codes[0],
                    user_limit: userLimit,
                    duration: String(duration),
                    tpl_code: "TS_6206",
                  }),
                }).catch(e => console.warn("[issue-license] 알림톡 재발송 실패:", e));

                // 텔레그램 알림 — 재발송
                await notifyWebLicenseTG({
                  quoteNumber,
                  orgName,
                  buyerName: customerName,
                  couponCodes: codes,
                  reused: true,
                  channel: "alimtalk",
                });
                return new Response(
                  JSON.stringify({ ok: true, coupon_codes: codes, already_issued: true }),
                  { headers: { "Content-Type": "application/json", ...CORS } }
                );
              }
            }
          }
        }
      }

      // 2) order_payments (legacy + confirm-payment fallback)
      const existRes = await fetch(
        `${SUPABASE_URL}/rest/v1/order_payments?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=coupon_code&order=created_at.desc&limit=1`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      const existing: Array<{ coupon_code?: string }> = existRes.ok ? await existRes.json() : [];
      if (existing.length > 0 && existing[0].coupon_code) {
        console.log("[issue-license] order_payments 기존 코드 재사용:", existing[0].coupon_code);
        const codes = existing[0].coupon_code.split(",").map(s => s.trim()).filter(Boolean);

        // deal_licenses backfill — 다음 재발송 시 path 1로 빠르게 매칭되도록
        if (dealLookupId) {
          for (const code of codes) {
            const dupCheck = await fetch(
              `${SUPABASE_URL}/rest/v1/deal_licenses?coupon_code=eq.${encodeURIComponent(code)}&select=id&limit=1`,
              { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
            );
            const dups = dupCheck.ok ? (await dupCheck.json() as { id: string }[]) : [];
            if (dups.length === 0) {
              await fetch(`${SUPABASE_URL}/rest/v1/deal_licenses`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${SUPABASE_KEY}`,
                  apikey: SUPABASE_KEY,
                  "Content-Type": "application/json",
                  Prefer: "return=minimal",
                },
                body: JSON.stringify({
                  deal_id:        dealLookupId,
                  coupon_code:    code,
                  contact_name:   customerName,
                  contact_phone:  customerPhone,
                  org_name:       orgName ?? null,
                  duration:       String(duration),
                  user_count:     userLimit,
                  status:         "대기",
                }),
              }).catch(e => console.warn("[issue-license] deal_licenses backfill 실패:", e));
            }
          }
        }

        // 알림톡 재발송
        await fetch("http://tebahsoft.iptime.org:8310/main/alimtok_coupon/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_name: customerName,
            phone: customerPhone.replace(/\D/g, ""),
            coupon_code: codes[0],
            user_limit: userLimit,
            duration: String(duration),
            tpl_code: "TS_6206",
          }),
        }).catch(e => console.warn("[issue-license] 알림톡 재발송 실패:", e));

        // 텔레그램 알림 — 재발송
        await notifyWebLicenseTG({
          quoteNumber,
          orgName,
          buyerName: customerName,
          couponCodes: codes,
          reused: true,
          channel: "alimtalk",
        });

        return new Response(
          JSON.stringify({ ok: true, coupon_codes: codes, already_issued: true }),
          { headers: { "Content-Type": "application/json", ...CORS } }
        );
      }
    }

    // ── 신규 발급 차단 게이트 ────────────────────────
    // quoteNumber 있는데 위 path 1/2 모두 빈 결과 = 결제 미확인
    // → allowNewIssue=true가 명시된 경우(어드민 수동발급)에만 신규 생성 허용
    if (quoteNumber && !allowNewIssue) {
      console.warn(`[issue-license] 결제 미확인으로 신규 발급 거부: quoteNumber=${quoteNumber}`);
      return new Response(
        JSON.stringify({
          error: "결제 정보를 찾을 수 없습니다. 결제가 완료된 후 다시 시도해 주세요. (이미 결제하신 경우 고객센터 042-864-5566로 문의)",
          code: "PAYMENT_NOT_FOUND",
        }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // ── 이용권 생성 ───────────────────────────────────
    const coupons: string[] = [];
    for (let i = 0; i < count; i++) {
      const couponRes = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ description, duration: String(duration), user_limit: userLimit }),
      });
      const couponData = await couponRes.json() as { coupon_code?: string; error?: string };
      if (!couponRes.ok || couponData.error) {
        throw new Error(`이용권 생성 실패: ${couponData.error ?? couponRes.status}`);
      }
      coupons.push(couponData.coupon_code!);
    }

    console.log("[issue-license] 이용권 생성:", coupons);

    // ── AlimTok 발송 (첫 번째 이용권) — iptime 직접 호출 ─────
    await fetch("http://tebahsoft.iptime.org:8310/main/alimtok_coupon/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: customerName,
        phone: customerPhone.replace(/\D/g, ""),
        coupon_code: coupons[0],
        user_limit: userLimit,
        duration: String(duration),
        tpl_code: "TS_6206",
      }),
    }).catch(e => console.warn("[issue-license] AlimTok 발송 실패 (무시):", e));

    // 신규 발급 시에도 deal_licenses에 INSERT (재발송 시 중복 차단)
    if (quoteNumber) {
      try {
        const dealLookup = await fetch(
          `${SUPABASE_URL}/rest/v1/deals?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=id&limit=1`,
          { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
        );
        if (dealLookup.ok) {
          const dealRows: { id: string }[] = await dealLookup.json();
          if (dealRows.length > 0) {
            const dealId = dealRows[0].id;
            for (const code of coupons) {
              await fetch(`${SUPABASE_URL}/rest/v1/deal_licenses`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${SUPABASE_KEY}`,
                  apikey: SUPABASE_KEY,
                  "Content-Type": "application/json",
                  Prefer: "return=minimal",
                },
                body: JSON.stringify({
                  deal_id:        dealId,
                  coupon_code:    code,
                  contact_name:   customerName,
                  contact_phone:  customerPhone,
                  org_name:       orgName ?? null,
                  duration:       String(duration),
                  user_count:     userLimit,
                  status:         "대기",
                }),
              }).catch(() => {});
            }
            // deals 본 행에도 license_send_date 기록
            const today = new Date().toISOString().slice(0, 10);
            await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${dealId}`, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${SUPABASE_KEY}`,
                apikey: SUPABASE_KEY,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify({
                license_send_date: today,
                deal_stage:        "이용권 발송완료",
              }),
            }).catch(() => {});
          }
        }
      } catch (e) { console.warn("[issue-license] deal_licenses INSERT 실패", e); }
    }

    // ── order_payments 저장 ───────────────────────────
    const paymentKey = `manual_${quoteNumber ?? "noquote"}_${Date.now()}`;
    await fetch(`${SUPABASE_URL}/rest/v1/order_payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        payment_key:    paymentKey,
        order_id:       paymentKey,
        amount,
        customer_name:  customerName,
        customer_phone: customerPhone.replace(/\D/g, ""),
        customer_email: customerEmail ?? null,
        org_name:       orgName ?? null,
        plan:           plan ?? null,
        qty,
        duration,
        quote_number:   quoteNumber ?? null,
        coupon_code:    coupons.join(", "),
        toss_method:    "bank_transfer",
        approved_at:    new Date().toISOString(),
      }),
    }).catch(e => console.warn("[issue-license] order_payments 저장 실패:", e));

    // 텔레그램 알림 — 신규 발급
    await notifyWebLicenseTG({
      quoteNumber: quoteNumber ?? "(no quote)",
      orgName,
      buyerName: customerName,
      couponCodes: coupons,
      reused: false,
      channel: "alimtalk",
    });

    return new Response(
      JSON.stringify({ ok: true, coupon_codes: coupons }),
      { headers: { "Content-Type": "application/json", ...CORS } }
    );

  } catch (e) {
    console.error("[issue-license] 오류:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
