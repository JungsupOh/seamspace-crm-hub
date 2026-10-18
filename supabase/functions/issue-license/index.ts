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
//
// **알림톡은 코드 장수만큼 보낸다.** 템플릿(TS_6206)이 코드 하나만 담을 수 있어
// 2장이면 2건이다. 예전에는 coupons[0] 하나만 보내서, 코드는 2장 만들어지고
// deal_licenses 에도 2행이 남는데 고객은 1장만 받는 사고가 있었다.
//
// **장수는 licenseQty 로만 센다.** qty 는 총인원(40·200)이 섞여 들어오므로
// 폴백으로 쓰면 이용권 200장이 발급된다. 없으면 1장으로 본다.
//
// 세 값을 절대 섞지 않는다 — "40명 2개월 2장" 과 "160명 1개월 1장" 은 다른 주문이다.
//   장수   licenseQty        (몇 장을 발급/발송할지)
//   인원   플랜 정원          (학급=40, 학년=200 … resolvePlanCapacity)
//   기간   duration          (개월)
// qty(총인원)로 장수를 세면 160명 1장짜리가 160장이 된다.

import { notifyWebLicenseTG } from "../_shared/telegram.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "https://seamspace-crm-hub.vercel.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 한 건으로 발급 가능한 이용권 장수 상한 (실사용 최대 37장).
// 총인원이 장수 자리로 잘못 들어오는 사고를 여기서 끊는다.
const MAX_LICENSE_QTY = 100;

const ALIMTOK_COUPON_URL = "http://tebahsoft.iptime.org:8310/main/alimtok_coupon/";

/**
 * 이용권 코드마다 알림톡을 한 건씩 보낸다. 성공 건수를 돌려준다.
 * 한 건이 실패해도 나머지는 계속 보낸다 — 일부라도 전달되는 편이 낫다.
 */
async function sendCouponAlimtalks(opts: {
  codes: string[];
  customerName: string;
  customerPhone: string;
  userLimit: string;
  duration: number | string;
}): Promise<number> {
  let sent = 0;
  for (const code of opts.codes) {
    try {
      const res = await fetch(ALIMTOK_COUPON_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name:  opts.customerName,
          phone:       opts.customerPhone.replace(/\D/g, ""),
          coupon_code: code,
          user_limit:  opts.userLimit,
          duration:    String(opts.duration),
          tpl_code:    "TS_6206",
        }),
      });
      const text = await res.text().catch(() => "");
      console.log(`[issue-license] 알림톡 ${res.status} (${code}):`, text.slice(0, 200));
      if (res.ok) sent++;
    } catch (e) {
      console.warn(`[issue-license] 알림톡 발송 실패 (${code}):`, e);
    }
  }
  console.log(`[issue-license] 알림톡 ${sent}/${opts.codes.length}건 발송`);
  return sent;
}

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

    // 장수는 licenseQty 만 신뢰한다 (qty 는 총인원 — 상단 주석 참고)
    const count = Math.min(Math.max(1, Math.floor(licenseQty ?? 1)), MAX_LICENSE_QTY);
    if (licenseQty != null && licenseQty > MAX_LICENSE_QTY) {
      console.error(`[issue-license] licenseQty=${licenseQty} 가 상한(${MAX_LICENSE_QTY}) 초과 — ${count}장으로 제한`);
    }
    const planResolved = resolvePlanCapacity(plan);
    const userLimit = String(planResolved.capacity);
    const description = [orgName, plan, `${duration}개월`].filter(Boolean).join(" - ");

    // ── 중복 발급 방지: 이미 발급된 경우 기존 코드 반환 ──
    // 우선순위: 1) deal_licenses (canonical) 2) order_payments (legacy fallback)
    let dealLookupId: string | null = null;
    // 수동 입금완료(계좌이체) 결제 확인 — order_payments/deal_licenses가 없어도
    // 어드민이 deals.payment_date/deal_stage='입금완료'로 표시했으면 결제로 인정.
    let paymentConfirmed = false;
    if (quoteNumber) {
      // 1) deal_licenses via deals.quote_number
      const dealRes = await fetch(
        `${SUPABASE_URL}/rest/v1/deals?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=id,payment_date,deal_stage&limit=1`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      if (dealRes.ok) {
        const deals: { id: string; payment_date?: string | null; deal_stage?: string | null }[] = await dealRes.json();
        if (deals.length > 0) {
          dealLookupId = deals[0].id;
          paymentConfirmed = !!deals[0].payment_date
            || deals[0].deal_stage === "입금완료"
            || deals[0].deal_stage === "이용권 발송완료";
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

                // 알림톡 재발송 — 보유한 코드 전부 (장수만큼)
                const resent = await sendCouponAlimtalks({
                  codes, customerName, customerPhone, userLimit, duration,
                });

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
                  JSON.stringify({
                    ok: true, coupon_codes: codes, already_issued: true, alimtalk_sent: resent,
                  }),
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

        // 알림톡 재발송 — 보유한 코드 전부 (장수만큼)
        const resent = await sendCouponAlimtalks({
          codes, customerName, customerPhone, userLimit, duration,
        });

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
          JSON.stringify({
            ok: true, coupon_codes: codes, already_issued: true, alimtalk_sent: resent,
          }),
          { headers: { "Content-Type": "application/json", ...CORS } }
        );
      }
    }

    // ── 신규 발급 차단 게이트 ────────────────────────
    // quoteNumber 있는데 결제 미확인(order_payments/deal_licenses 없음 + deals.payment_date/입금완료 없음)
    // → allowNewIssue=true(어드민 수동발급)일 때만 신규 생성 허용
    // paymentConfirmed: 수동 입금완료(계좌이체) 딜의 payment_date/입금완료 단계 인정
    if (quoteNumber && !allowNewIssue && !paymentConfirmed) {
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

    // ── AlimTok 발송 — 발급한 코드 전부 (장수만큼) ─────
    const alimtalkSent = await sendCouponAlimtalks({
      codes: coupons, customerName, customerPhone, userLimit, duration,
    });

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
      JSON.stringify({ ok: true, coupon_codes: coupons, alimtalk_sent: alimtalkSent }),
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
