// Supabase Edge Function: confirm-payment
// 1. Toss 결제 승인 (공통 헬퍼)
// 2. mDiary 이용권 생성 (create-coupon 재사용)
// 3. AlimTok 이용권 발송 (send-coupon 재사용)
// 4. order_payments 저장

import { CORS, confirmTossPayment, buildReceiptFields, jsonResponse } from "../_shared/toss.ts";
import { notifyWebPaymentTG } from "../_shared/telegram.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOSS_SECRET  = Deno.env.get("TOSS_SECRET_KEY")!;

// 플랜 → 인원수. 키 변형 대응 (예: "학급 플랜", "학급플랜", "학급", "학년 플랜" 등)
const PLAN_CAPACITY: Record<string, number> = {
  "소수학급": 10,
  "학급":     40,
  "학년":    200,
  "학교(소)": 500,
  "학교(중)": 1000,
  "학교(대)": 99999,
};

// "학급 플랜" / "학급플랜" / "학급" → "학급" 등 정규화
function resolvePlanCapacity(plan?: string): { capacity: number; key: string } {
  const raw = (plan ?? "").trim();
  if (!raw) return { capacity: 40, key: "학급" };
  // " 플랜" / "플랜" 접미사 제거 후 trim
  const normalized = raw.replace(/\s*플랜\s*$/, "").trim();
  if (PLAN_CAPACITY[normalized] != null) return { capacity: PLAN_CAPACITY[normalized], key: normalized };
  // 부분 매칭 (예: "소수학급 플랜 (10명)" 등 변형)
  for (const key of Object.keys(PLAN_CAPACITY)) {
    if (normalized.includes(key)) return { capacity: PLAN_CAPACITY[key], key };
  }
  console.warn(`[confirm-payment] 알 수 없는 플랜 라벨, 학급(40) fallback:`, plan);
  return { capacity: 40, key: "학급" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const {
      paymentKey,
      orderId,
      amount,
      customerName,
      customerPhone,
      customerEmail,
      orgName,
      plan,
      qty = 1,
      duration = 12,
      quoteNumber,
    } = await req.json() as {
      paymentKey: string;
      orderId: string;
      amount: number;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      orgName?: string;
      plan?: string;
      qty?: number;
      duration?: number;
      quoteNumber?: string;
    };

    // ── Step 1: Toss 결제 승인 ────────────────────────
    const toss = await confirmTossPayment({ paymentKey, orderId, amount, secret: TOSS_SECRET });
    if (!toss.ok) {
      console.error("[confirm-payment] Toss 승인 실패:", toss.data);
      return jsonResponse({ error: toss.data?.message ?? "Toss 결제 승인 실패" }, 400);
    }
    const tossData = toss.data;
    console.log("[confirm-payment] Toss 승인 성공:", tossData.paymentKey);

    // ── Step 2: mDiary 이용권 생성 ────────────────────
    const planResolved = resolvePlanCapacity(plan);
    const userLimit = String(planResolved.capacity);
    console.log(`[confirm-payment] 플랜 매칭: '${plan}' → '${planResolved.key}' (${userLimit}명)`);
    const description = [orgName, plan, `${duration}개월`].filter(Boolean).join(" - ");

    const couponRes = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        description,
        duration: String(duration),
        user_limit: userLimit,
      }),
    });

    const couponData = await couponRes.json() as { coupon_code?: string; error?: string };
    if (!couponRes.ok || couponData.error) {
      console.error("[confirm-payment] 쿠폰 생성 실패:", couponData.error);
      // 결제는 됐으므로 에러 반환하되 paymentKey 포함
      return jsonResponse({ error: "이용권 생성 실패. 고객센터에 문의해 주세요.", paymentKey }, 500);
    }

    const couponCode = couponData.coupon_code!;
    console.log("[confirm-payment] 쿠폰 생성:", couponCode);

    // ── Step 3: AlimTok 발송 — iptime 직접 호출 (Edge → Edge inner call 이슈 회피) ─
    try {
      const sendBody = {
        first_name: customerName,
        phone: customerPhone.replace(/\D/g, ""),
        coupon_code: couponCode,
        user_limit: userLimit,
        duration: String(duration),
        tpl_code: "TS_6206",  // 구매이용권 (이전 send_type='buyer'에 매핑)
      };
      console.log("[confirm-payment] 알림톡 요청:", JSON.stringify(sendBody));
      const sendRes = await fetch("http://tebahsoft.iptime.org:8310/main/alimtok_coupon/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendBody),
      });
      const sendText = await sendRes.text();
      console.log(`[confirm-payment] 알림톡 응답 ${sendRes.status}:`, sendText);
    } catch (e) {
      console.error("[confirm-payment] 알림톡 예외:", e);
    }

    // ── Step 4: order_payments 먼저 저장 ─────────
    // (deals 매칭 실패해도 issue-license 재발송이 fallback할 수 있도록 우선 저장)
    let orderPaymentSaved = false;
    {
      const opRes = await fetch(`${SUPABASE_URL}/rest/v1/order_payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          payment_key:    paymentKey,
          order_id:       orderId,
          amount,
          customer_name:  customerName,
          customer_phone: customerPhone.replace(/\D/g, ""),
          customer_email: customerEmail ?? null,
          org_name:       orgName ?? null,
          plan:           plan ?? null,
          qty,
          duration,
          quote_number:   quoteNumber ?? null,
          coupon_code:    couponCode,
          toss_method:    tossData.method ?? null,
          approved_at:    tossData.approvedAt ?? null,
        }),
      }).catch(e => { console.error("[confirm-payment] order_payments 예외:", e); return null; });
      if (opRes?.ok) {
        orderPaymentSaved = true;
        console.log("[confirm-payment] order_payments 저장 성공");
      } else if (opRes) {
        const txt = await opRes.text().catch(() => "(read failed)");
        console.error(`[confirm-payment] order_payments 저장 실패 ${opRes.status}:`, txt);
      }
    }

    // ── Step 5: deals 매칭 + deal_licenses INSERT ──
    // 견적서 생성 시 saveWebQuote가 만든 deals 행을 quote_number로 매칭
    // orderId 패턴 'WEB-{quote_number}-{nanoid}' 에서 fallback 추출
    const todayDate = new Date().toISOString().slice(0, 10);
    const orderIdMatch = orderId?.match(/^WEB-(.+)-[a-zA-Z0-9_-]+$/);
    const orderIdQuote = orderIdMatch?.[1];
    const candidates = [quoteNumber, orderIdQuote, orderId].filter(Boolean) as string[];
    let dealId: string | null = null;
    let licenseSaved = false;

    // 매칭한 deal의 org_name 도 회수 — deal_licenses.org_name NOT NULL 제약 회피용 fallback
    let dealOrgName: string | null = null;
    for (const cand of candidates) {
      try {
        const dealRes = await fetch(
          `${SUPABASE_URL}/rest/v1/deals?quote_number=eq.${encodeURIComponent(cand)}&select=id,org_name&limit=1`,
          { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
        );
        if (dealRes.ok) {
          const rows = await dealRes.json() as { id: string; org_name: string | null }[];
          if (rows[0]?.id) {
            dealId = rows[0].id;
            dealOrgName = rows[0].org_name;
            console.log(`[confirm-payment] deals 매칭(${cand}):`, dealId);
            break;
          }
        } else {
          const txt = await dealRes.text().catch(() => "(read failed)");
          console.error(`[confirm-payment] deals 조회 실패 ${dealRes.status}:`, txt);
        }
      } catch (e) { console.error("[confirm-payment] deals 조회 예외:", e); }
    }

    if (!dealId) {
      console.warn(`[confirm-payment] deals 매칭 실패 — 시도값:`, candidates);
    }

    if (dealId) {
      try {
        // 1) deals PATCH
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${dealId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            license_send_date: todayDate,
            receipt_date:      todayDate,   // 영수증발급일 = 카드결제일(자동). 입금일(payment_date)=카드사 정산일은 수동 입력
            deal_stage:        "이용권 발송완료",
          }),
        });
        if (!patchRes.ok) {
          const txt = await patchRes.text().catch(() => "(read failed)");
          console.error(`[confirm-payment] deals PATCH 실패 ${patchRes.status}:`, txt);
        }

        // 2) deal_licenses INSERT — /이용권관리에 노출 (중복 코드 skip)
        const checkRes = await fetch(
          `${SUPABASE_URL}/rest/v1/deal_licenses?coupon_code=eq.${encodeURIComponent(couponCode)}&select=id&limit=1`,
          { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
        );
        const dupRows = checkRes.ok ? (await checkRes.json() as { id: string }[]) : [];
        if (dupRows.length === 0) {
          const insRes = await fetch(`${SUPABASE_URL}/rest/v1/deal_licenses`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SUPABASE_KEY}`,
              apikey: SUPABASE_KEY,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              deal_id:        dealId,
              coupon_code:    couponCode,
              contact_name:   customerName,
              contact_phone:  customerPhone,
              // org_name NOT NULL — sessionStorage 누락 시 deals.org_name 으로 fallback
              org_name:       orgName ?? dealOrgName ?? "(미입력)",
              duration:       String(duration),
              user_count:     userLimit,
              status:         "대기",
            }),
          });
          if (insRes.ok) {
            licenseSaved = true;
            console.log("[confirm-payment] deal_licenses 저장 성공");
          } else {
            const txt = await insRes.text().catch(() => "(read failed)");
            console.error(`[confirm-payment] deal_licenses 저장 실패 ${insRes.status}:`, txt);
          }
        } else {
          // 이미 동일 coupon_code의 row 존재 → 저장된 것으로 간주
          licenseSaved = true;
          console.log("[confirm-payment] deal_licenses 이미 존재(중복 skip)");
        }
      } catch (e) { console.error("[confirm-payment] deal/deal_licenses 업데이트 예외:", e); }
    }

    // ── Step 5-b: deal_quotes 결제 메타 갱신 — quote_number 매칭 ──
    // 다이얼로그/리포트에서 "결제완료" 상태와 paid_at, payment_method 노출용.
    // dealId 매칭 여부와 무관 — quote_number만 있으면 갱신 가능.
    let dealQuoteUpdated = false;
    if (quoteNumber) {
      try {
        const dqRes = await fetch(
          `${SUPABASE_URL}/rest/v1/deal_quotes?quote_number=eq.${encodeURIComponent(quoteNumber)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${SUPABASE_KEY}`,
              apikey: SUPABASE_KEY,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              order_status:   "결제완료",
              payment_method: (tossData.method === "카드" || tossData.method === "card") ? "card" : "bank",
              payment_key:    paymentKey,
              paid_at:        tossData.approvedAt ?? new Date().toISOString(),
            }),
          },
        );
        if (dqRes.ok) {
          dealQuoteUpdated = true;
          console.log("[confirm-payment] deal_quotes 결제 메타 갱신 성공");
        } else {
          const txt = await dqRes.text().catch(() => "(read failed)");
          console.error(`[confirm-payment] deal_quotes PATCH 실패 ${dqRes.status}:`, txt);
        }
      } catch (e) {
        console.error("[confirm-payment] deal_quotes PATCH 예외:", e);
      }
    }

    // ── Step 6: 텔레그램 알림 (서버사이드, 신뢰성↑) ─────
    await notifyWebPaymentTG({
      quoteNumber: quoteNumber ?? orderId,
      orgName,
      buyerName: customerName,
      amount,
      method: tossData.method ?? "card",
      couponCode,
    });

    return jsonResponse({
      ok: true,
      coupon_code:        couponCode,
      customerEmail:      customerEmail ?? null,
      customerName:       customerName ?? null,
      // 진단용 — 프론트가 실패 시 경고 표시 가능
      deal_id:            dealId,
      license_saved:      licenseSaved,
      deal_quote_updated: dealQuoteUpdated,
      order_payment_saved: orderPaymentSaved,
      ...buildReceiptFields(tossData, amount),
    });

  } catch (e) {
    console.error("[confirm-payment] 오류:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
