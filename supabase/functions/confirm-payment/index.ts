// Supabase Edge Function: confirm-payment
// 1. Toss 결제 승인 (공통 헬퍼)
// 2. mDiary 이용권 생성 (create-coupon 재사용) — 구매 장수만큼
// 3. AlimTok 이용권 발송 — 장수만큼 (코드 1개당 1건)
// 4. order_payments 저장
//
// **장수는 licenseQty 로만 센다.** deal_quotes.qty 는 총인원(40·80·200)과
// 장수(1·2·3)가 섞여 들어와 있어 장수로 쓸 수 없다. qty 로 루프를 돌리면
// 200명짜리 견적 하나로 이용권 200장이 발급되고 알림톡이 200건 나간다.
// licenseQty 가 없으면 1장으로 본다 — qty 로 폴백하지 않는다.
//
// 세 값을 절대 섞지 않는다 — "40명 2개월 2장" 과 "160명 1개월 1장" 은 다른 주문이다.
//   장수   licenseQty        (몇 장을 발급/발송할지)
//   인원   플랜 정원          (학급=40, 학년=200 … resolvePlanCapacity)
//   기간   duration          (개월)
// qty(총인원)로 장수를 세면 160명 1장짜리가 160장이 된다.

import { CORS, confirmTossPayment, buildReceiptFields, jsonResponse } from "../_shared/toss.ts";
import { notifyWebPaymentTG } from "../_shared/telegram.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOSS_SECRET  = Deno.env.get("TOSS_SECRET_KEY")!;

// 한 결제로 발급 가능한 이용권 장수 상한. 실사용 최대가 37장이라 100이면 넉넉하고,
// 총인원이 장수 자리로 잘못 들어오는 사고(200·500·1000)는 여기서 걸린다.
const MAX_LICENSE_QTY = 100;

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
      licenseQty,
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
      qty?: number;          // 총인원(명) — 장수로 쓰면 안 된다
      licenseQty?: number;    // 이용권 장수
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

    // 장수. licenseQty 만 신뢰한다 (qty 는 총인원이 섞여 있어 위험 — 상단 주석 참고)
    const codeCount = Math.min(Math.max(1, Math.floor(licenseQty ?? 1)), MAX_LICENSE_QTY);
    if (licenseQty != null && licenseQty > MAX_LICENSE_QTY) {
      console.error(`[confirm-payment] licenseQty=${licenseQty} 가 상한(${MAX_LICENSE_QTY}) 초과 — ${codeCount}장으로 제한`);
    }
    console.log(`[confirm-payment] 이용권 ${codeCount}장 발급 예정 (licenseQty=${licenseQty}, qty=${qty})`);

    const coupons: string[] = [];
    for (let i = 0; i < codeCount; i++) {
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
      if (!couponRes.ok || couponData.error || !couponData.coupon_code) {
        console.error(`[confirm-payment] 쿠폰 생성 실패 (${i + 1}/${codeCount}):`, couponData.error);
        // 일부라도 만들어졌으면 그건 살려서 발송한다 — 결제는 이미 끝났으므로
        // 전부 버리면 고객이 아무것도 못 받는다. 모자란 장수는 로그/응답으로 드러낸다.
        if (coupons.length === 0) {
          return jsonResponse({ error: "이용권 생성 실패. 고객센터에 문의해 주세요.", paymentKey }, 500);
        }
        break;
      }
      coupons.push(couponData.coupon_code);
    }

    const couponCode = coupons[0];   // 단건 호환용 (응답·텔레그램 등)
    const couponsShort = coupons.length < codeCount;
    console.log(`[confirm-payment] 쿠폰 생성 ${coupons.length}/${codeCount}:`, coupons);

    // ── Step 3: AlimTok 발송 — iptime 직접 호출 (Edge → Edge inner call 이슈 회피) ─
    // 코드 1장당 1건. 템플릿(TS_6206)이 코드 하나만 담을 수 있어 묶어 보낼 수 없다.
    let alimtokSent = 0;
    for (const code of coupons) {
      try {
        const sendBody = {
          first_name: customerName,
          phone: customerPhone.replace(/\D/g, ""),
          coupon_code: code,
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
        if (sendRes.ok) alimtokSent++;
      } catch (e) {
        console.error(`[confirm-payment] 알림톡 예외 (${code}):`, e);
      }
    }
    console.log(`[confirm-payment] 알림톡 ${alimtokSent}/${coupons.length}건 발송`);

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
          coupon_code:    coupons.join(", "),
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
            contract_date:     todayDate,   // 웹 카드 셀프결제 — 계약일도 결제일로 설정
            receipt_date:      todayDate,   // 영수증발급일 = 카드결제일(자동). 입금일(payment_date)=카드사 정산일은 수동 입력
            deal_stage:        "이용권 발송완료",
          }),
        });
        if (!patchRes.ok) {
          const txt = await patchRes.text().catch(() => "(read failed)");
          console.error(`[confirm-payment] deals PATCH 실패 ${patchRes.status}:`, txt);
        }

        // 2) deal_licenses INSERT — 코드마다 1행. /이용권관리에 노출 (중복 코드 skip)
        let savedRows = 0;
        for (const code of coupons) {
          const checkRes = await fetch(
            `${SUPABASE_URL}/rest/v1/deal_licenses?coupon_code=eq.${encodeURIComponent(code)}&select=id&limit=1`,
            { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
          );
          const dupRows = checkRes.ok ? (await checkRes.json() as { id: string }[]) : [];
          if (dupRows.length > 0) {
            // 이미 동일 coupon_code의 row 존재 → 저장된 것으로 간주
            savedRows++;
            console.log(`[confirm-payment] deal_licenses 이미 존재(중복 skip): ${code}`);
            continue;
          }
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
              coupon_code:    code,
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
            savedRows++;
          } else {
            const txt = await insRes.text().catch(() => "(read failed)");
            console.error(`[confirm-payment] deal_licenses 저장 실패 ${insRes.status} (${code}):`, txt);
          }
        }
        // 전부 저장돼야 성공으로 본다 — 한 장이라도 빠지면 /이용권관리에서 누락된다
        licenseSaved = savedRows === coupons.length;
        console.log(`[confirm-payment] deal_licenses ${savedRows}/${coupons.length}행 저장`);
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
      couponCode: coupons.join(", "),
    });

    return jsonResponse({
      ok: true,
      coupon_code:        couponCode,     // 단건 호환 (구버전 화면)
      coupon_codes:       coupons,
      license_qty:        codeCount,
      coupons_short:      couponsShort,   // 요청 장수보다 적게 발급된 경우 true
      alimtalk_sent:      alimtokSent,
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
