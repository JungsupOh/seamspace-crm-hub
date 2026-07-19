// Telegram 채널 알림 (Edge Function 공용)
// 클라이언트(브라우저) 호출이 sessionStorage/redirect 영향으로 누락되는 이슈 회피용 — 서버사이드에서 발송.

// 토큰/채널은 Supabase 시크릿에서만 읽는다 (소스에 하드코딩 금지).
// 설정: npx supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

export async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN/CHAT_ID 시크릿 미설정 — 알림 생략");
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "(read failed)");
      console.warn(`[telegram] 발송 실패 ${r.status}:`, t);
    }
  } catch (e) {
    console.warn("[telegram] 발송 예외:", e);
  }
}

// ── 웹 결제 완료 알림 ──────────────────────────────
export function notifyWebPaymentTG(params: {
  quoteNumber: string;
  orgName?: string | null;
  buyerName?: string | null;
  amount: number;
  method?: string | null;
  couponCode?: string;
}): Promise<void> {
  const { quoteNumber, orgName, buyerName, amount, method, couponCode } = params;
  const methodLabel = method === "CARD" || method === "card" ? "카드결제"
    : method === "TRANSFER" || method === "bank" ? "계좌이체"
    : (method ?? "결제");
  const couponLine = couponCode ? `\n🎟 ${couponCode}` : "";
  return sendTelegram(
    `💳 <b>웹 결제 완료</b>\n\n` +
    `📌 ${quoteNumber}\n` +
    `🏫 ${orgName || "(미입력)"}\n` +
    `👤 ${buyerName || "(미입력)"}\n` +
    `💰 ${amount.toLocaleString()}원 (${methodLabel})${couponLine}`
  );
}

// ── /shop 주문 알림 ──────────────────────────────────
export function notifyShopOrderTG(params: {
  orderId: string;
  customerName: string;
  customerPhone: string;
  items: string;          // "보드게임 × 1, 키링 × 2" 형식
  totalAmount: number;
  address?: string | null;
}): Promise<void> {
  const { orderId, customerName, customerPhone, items, totalAmount, address } = params;
  const addrLine = address ? `\n📦 ${address}` : "";
  return sendTelegram(
    `🛒 <b>스토어 주문 완료</b>\n\n` +
    `🆔 ${orderId}\n` +
    `👤 ${customerName} / ${customerPhone}\n` +
    `🎁 ${items}\n` +
    `💰 ${totalAmount.toLocaleString()}원${addrLine}`
  );
}

// ── 럭키세븐 결제 완료 알림 ──────────────────────────
export function notifyLuckySevenPaymentTG(params: {
  groupCode?: string;
  campaignName?: string;
  payerName?: string | null;
  payerOrgName?: string | null;
  amount: number;
  paidCount?: number;
  totalCount?: number;
}): Promise<void> {
  const { groupCode, campaignName, payerName, payerOrgName, amount, paidCount, totalCount } = params;
  const grpLine = groupCode ? `🆔 ${groupCode}\n` : "";
  const cLine = campaignName ? `📋 ${campaignName}\n` : "";
  const orgStr = payerOrgName ? ` (${payerOrgName})` : "";
  const progressLine = (paidCount != null && totalCount != null) ? `\n📊 ${paidCount}/${totalCount} 결제완료` : "";
  return sendTelegram(
    `🎯 <b>럭키세븐 결제 완료</b>\n\n` +
    cLine + grpLine +
    `💰 ${amount.toLocaleString()}원\n` +
    `👤 ${payerName ?? "(미입력)"}${orgStr}${progressLine}`
  );
}

// ── 웹 이용권 발송 알림 ──────────────────────────────
export function notifyWebLicenseTG(params: {
  quoteNumber: string;
  orgName?: string | null;
  buyerName?: string | null;
  couponCodes: string[];
  reused: boolean;       // 기존 코드 재사용 / 신규 발급
  channel?: string;      // 'alimtalk' | 'email'
}): Promise<void> {
  const { quoteNumber, orgName, buyerName, couponCodes, reused, channel } = params;
  const tag = reused ? "재발송" : "신규발급";
  const codes = couponCodes.length > 0 ? `\n🎟 ${couponCodes.join(", ")}` : "";
  const ch = channel ? ` (${channel})` : "";
  return sendTelegram(
    `🎟 <b>웹 이용권 ${tag}${ch}</b>\n\n` +
    `📌 ${quoteNumber}\n` +
    `🏫 ${orgName || "(미입력)"}\n` +
    `👤 ${buyerName || "(미입력)"}${codes}`
  );
}
