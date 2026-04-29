// Supabase Edge Function: confirm-shop-payment
// /shop 결제 완료 처리 (실물 + 디지털 혼합 카트 지원)
// 1) Toss 결제 승인 (공통 헬퍼)
// 2) shop_orders + shop_order_items INSERT
// 3) 디지털 상품(minddiary 등) per-qty 처리:
//    - mDiary 쿠폰 생성 (create-coupon)
//    - 알림톡 발송 (send-coupon)
//    - deals 행 INSERT (딜관리 가시화)
//    - deal_licenses 행 INSERT (이용권 추적)
// 4) 영수증 응답 (receiptUrl, orderName, …) — ShopComplete가 영수증 이메일 발송

import { CORS, confirmTossPayment, buildReceiptFields, jsonResponse } from "../_shared/toss.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOSS_SECRET  = Deno.env.get("TOSS_SECRET_KEY")!;

const DB_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

// 디지털 상품 정의 (productId → 발급 메타)
const DIGITAL_PRODUCTS: Record<string, { duration: number; userLimit: number; planName: string }> = {
  // AI 마음일기: 1학급 1개월
  minddiary: { duration: 1, userLimit: 40, planName: "학급플랜" },
};

interface ShopItem {
  productId: string;
  productName: string;
  option?: string | null;
  qty: number;
  unitPrice: number;
}

interface Customer { name: string; phone: string; email: string }
interface Shipping {
  zipcode?: string; address?: string; addressDetail?: string; memo?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json() as {
      paymentKey: string;
      orderId:    string;
      amount:     number;
      customer:   Customer;
      shipping:   Shipping | null;
      items:      ShopItem[];
      subtotal:   number;
      shippingFee: number;
      discount:   number;
      couponCode: string | null;
    };

    const { paymentKey, orderId, amount, customer, shipping, items, subtotal, shippingFee, discount, couponCode } = body;

    if (!paymentKey || !orderId || !amount || !items?.length) {
      return jsonResponse({ error: "필수 파라미터 누락" }, 400);
    }

    // 멱등성 — 이미 처리된 주문이면 스킵
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_orders?order_id=eq.${encodeURIComponent(orderId)}&select=id,status`,
      { headers: DB_HEADERS },
    );
    const existRows = existRes.ok ? await existRes.json() as { id: number; status: string }[] : [];
    if (existRows.length > 0) {
      return jsonResponse({ ok: true, alreadyProcessed: true });
    }

    // ── Step 1: Toss 결제 승인 ────────────────────────
    const toss = await confirmTossPayment({ paymentKey, orderId, amount, secret: TOSS_SECRET });
    if (!toss.ok) {
      console.error("[confirm-shop-payment] Toss 승인 실패:", toss.data);
      return jsonResponse({ error: toss.data?.message ?? "Toss 결제 승인 실패" }, 400);
    }
    const tossData = toss.data;
    const phoneNorm = customer.phone.replace(/\D/g, "");
    const today = new Date().toISOString().slice(0, 10);

    // ── Step 2: shop_orders INSERT ────────────────────
    const orderInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/shop_orders`, {
      method: "POST",
      headers: { ...DB_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify({
        order_id:        orderId,
        status:          "결제완료",
        customer_name:   customer.name,
        customer_phone:  phoneNorm,
        customer_email:  customer.email || null,
        zipcode:         shipping?.zipcode || "",
        address:         shipping?.address || "디지털 상품 (배송 없음)",
        address_detail:  shipping?.addressDetail || null,
        delivery_memo:   shipping?.memo || null,
        subtotal,
        shipping_fee:    shippingFee,
        discount:        discount ?? 0,
        coupon_code:     couponCode ?? null,
        total_amount:    amount,
        payment_key:     paymentKey,
        toss_method:     tossData.method ?? "카드",
        approved_at:     tossData.approvedAt ?? new Date().toISOString(),
      }),
    });
    if (!orderInsertRes.ok) {
      const err = await orderInsertRes.json().catch(() => ({}));
      console.error("[confirm-shop-payment] shop_orders INSERT 실패:", err);
      return jsonResponse({ error: "주문 저장 실패" }, 500);
    }

    // ── Step 3: shop_order_items INSERT ───────────────
    const itemRows = items.map((it) => ({
      order_id:     orderId,
      product_id:   it.productId,
      product_name: it.productName,
      option:       it.option ?? null,
      qty:          it.qty,
      unit_price:   it.unitPrice,
      subtotal:     it.unitPrice * it.qty,
    }));
    await fetch(`${SUPABASE_URL}/rest/v1/shop_order_items`, {
      method: "POST",
      headers: { ...DB_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify(itemRows),
    }).catch((e) => console.warn("[confirm-shop-payment] shop_order_items 실패:", e));

    // ── Step 4: 디지털 상품 자동 발급 ─────────────────
    const issuedCoupons: Array<{ productName: string; couponCode: string; alimtokOk: boolean }> = [];

    for (const item of items) {
      const meta = DIGITAL_PRODUCTS[item.productId];
      if (!meta) continue;

      for (let n = 0; n < item.qty; n++) {
        const seq = item.qty > 1 ? `-${n + 1}` : "";
        const description = `(Shop) ${item.productName} - ${customer.name}${seq}`;

        // 4-1) 쿠폰 생성
        let couponCodeIssued = "";
        try {
          const couponRes = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              description,
              duration:   String(meta.duration),
              user_limit: String(meta.userLimit),
            }),
          });
          const couponData = await couponRes.json();
          couponCodeIssued = couponData.coupon_code ?? "";
          if (!couponRes.ok || !couponCodeIssued) {
            console.error("[confirm-shop-payment] 쿠폰 생성 실패:", couponData);
            continue;
          }
        } catch (e) {
          console.error("[confirm-shop-payment] 쿠폰 생성 예외:", e);
          continue;
        }

        // 4-2) 알림톡 발송 (실패해도 흐름 계속, 상세 로그 남김)
        let alimtokOk = false;
        try {
          const sendBody = {
            first_name: customer.name,
            phone:      phoneNorm,
            coupon_code: couponCodeIssued,
            user_limit: String(meta.userLimit),
            duration:   String(meta.duration),
            send_type:  "buyer",
          };
          console.log("[confirm-shop-payment] 알림톡 요청:", JSON.stringify(sendBody));
          const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-coupon`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(sendBody),
          });
          const sendText = await sendRes.text();
          console.log(`[confirm-shop-payment] 알림톡 응답 ${sendRes.status}:`, sendText);
          alimtokOk = sendRes.ok;
        } catch (e) {
          console.error("[confirm-shop-payment] 알림톡 예외:", e);
        }

        issuedCoupons.push({ productName: item.productName, couponCode: couponCodeIssued, alimtokOk });

        // 4-3) deals INSERT — 딜관리 가시화 (한 쿠폰 = 한 딜 행)
        const supplyPrice = Math.round(item.unitPrice / 1.1);
        const taxAmount   = item.unitPrice - supplyPrice;
        const dealQuoteNumber = `${orderId}${seq}`;

        let createdDealId: string | null = null;
        try {
          const dealRes = await fetch(`${SUPABASE_URL}/rest/v1/deals`, {
            method: "POST",
            headers: { ...DB_HEADERS, Prefer: "return=representation" },
            body: JSON.stringify({
              deal_name:           `(Shop) ${item.productName} ${customer.name}${seq}`,
              deal_stage:          "거래종료",
              deal_type:           "New",
              contact_name:        customer.name,
              contact_phone:       phoneNorm,
              contact_email:       customer.email || null,
              org_name:            "(개인)",
              quote_date:          today,
              quote_qty:           1,
              quote_plan:          meta.planName,
              quote_number:        dealQuoteNumber,
              license_duration:    meta.duration,
              unit_price:          item.unitPrice,
              supply_price:        supplyPrice,
              tax_amount:          taxAmount,
              final_contract_value: item.unitPrice,
              license_send_date:   today,
              lead_source:         "Shop",
              order_date:          today,
              contract_date:       today,
              payment_date:        today,
              created_date:        today,
              notes:               `Shop 주문 ${orderId} 자동 발급\n쿠폰: ${couponCodeIssued}`,
            }),
          });
          if (dealRes.ok) {
            const dealRows = await dealRes.json() as Array<{ id: string }>;
            createdDealId = dealRows[0]?.id ?? null;
          } else {
            const e = await dealRes.json().catch(() => ({}));
            console.warn("[confirm-shop-payment] deals INSERT 실패:", e);
          }
        } catch (e) {
          console.warn("[confirm-shop-payment] deals INSERT 예외:", e);
        }

        // 4-4) deal_licenses INSERT — 이용권 추적 (deal_id 있을 때만)
        if (createdDealId) {
          await fetch(`${SUPABASE_URL}/rest/v1/deal_licenses`, {
            method: "POST",
            headers: { ...DB_HEADERS, Prefer: "return=minimal" },
            body: JSON.stringify({
              deal_id:        createdDealId,
              coupon_code:    couponCodeIssued,
              contact_name:   customer.name,
              contact_phone:  phoneNorm,
              org_name:       "(개인)",
              duration:       String(meta.duration),
              user_count:     String(meta.userLimit),
              status:         "대기",
            }),
          }).catch((e) => console.warn("[confirm-shop-payment] deal_licenses 실패:", e));
        }
      }
    }

    // ── Step 5: 영수증 응답 ────────────────────────────
    return jsonResponse({
      ok: true,
      issuedCoupons,
      customerEmail: customer.email,
      customerName:  customer.name,
      ...buildReceiptFields(tossData, amount),
    });

  } catch (e) {
    console.error("[confirm-shop-payment] 오류:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
