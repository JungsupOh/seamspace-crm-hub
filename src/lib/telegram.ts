// ── Telegram 채널 알림 ──────────────────────────────

const BOT_TOKEN = '8680036281:AAG465JPrhfYBuYCpDyuNkfUr0UgaOutn2c';
const CHAT_ID = '-1003754735570';

export async function sendTelegramNotification(text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // 알림 실패는 무시 (핵심 기능 차단하지 않도록)
    console.warn('Telegram 알림 발송 실패');
  }
}

// ── 딜 추가 알림 ─────────────────────────────────
export function notifyNewDeal(dealName: string, orgName: string, contactName: string, amount?: number): void {
  const amountStr = amount ? `\n💰 금액: ${amount.toLocaleString()}원` : '';
  sendTelegramNotification(
    `📋 <b>새 딜 등록</b>\n\n` +
    `🏫 ${orgName || '(미입력)'}\n` +
    `👤 ${contactName || '(미입력)'}${amountStr}\n` +
    `📌 ${dealName || '(이름없음)'}`
  );
}

// ── 파트너 딜 등록 알림 ──────────────────────────────
export function notifyPartnerDeal(partnerName: string, schoolName: string, buyerName: string, amount?: number): void {
  const amountStr = amount ? `\n💰 결제금액: ${amount.toLocaleString()}원` : '';
  sendTelegramNotification(
    `🤝 <b>파트너 딜 등록</b>\n\n` +
    `🏢 파트너: ${partnerName}\n` +
    `🏫 ${schoolName || '(미입력)'}\n` +
    `👤 ${buyerName || '(미입력)'}${amountStr}`
  );
}

// ── 캠페인 리드 유입 알림 ──────────────────────────────
export function notifyCampaignLead(params: {
  campaignName: string;
  schoolName?: string;
  name: string;
  phone: string;
  position?: string;
  source?: string;
  isExistingCustomer?: boolean;
}): void {
  const { campaignName, schoolName, name, phone, position, source, isExistingCustomer } = params;
  const existingTag = isExistingCustomer ? `\n⚠️ 기존 고객` : '';
  const positionStr = position ? `\n💼 ${position}` : '';
  const sourceStr = source ? `\n📍 경로: ${source}` : '';
  sendTelegramNotification(
    `🎯 <b>캠페인 리드 유입</b>\n\n` +
    `📋 ${campaignName}\n` +
    `🏫 ${schoolName || '(미입력)'}\n` +
    `👤 ${name} / ${phone}${positionStr}${sourceStr}${existingTag}`
  );
}
