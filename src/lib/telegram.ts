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

// ── 파트너 딜 등록/수정 알림 ─────────────────────────
// 관리자용이므로 본문은 항상 한국어. 금액만 파트너 통화 표기를 따른다.
export function notifyPartnerDeal(
  partnerName: string,
  schoolName: string,
  buyerName: string,
  amount?: number,
  opts?: { currency?: string; country?: string; edited?: boolean },
): void {
  const cur = opts?.currency ?? 'KRW';
  const amountStr = amount
    ? `\n💰 결제금액: ${cur === 'KRW' ? `${amount.toLocaleString()}원` : `${amount.toLocaleString()} ${cur}`}`
    : '';
  const partnerLine = `🏢 파트너: ${partnerName}${opts?.country && opts.country !== 'KR' ? ` (${opts.country})` : ''}`;
  sendTelegramNotification(
    `🤝 <b>파트너 딜 ${opts?.edited ? '수정' : '등록'}</b>\n\n` +
    `${partnerLine}\n` +
    `🏫 ${schoolName || '(미입력)'}\n` +
    `👤 ${buyerName || '(미입력)'}${amountStr}`
  );
}

// ── 파트너 이용권 이메일 발송 실패 알림 ─────────────────
// 발급 자체는 엣지 함수(partner-issue-license)가 통보한다.
// 이메일은 클라이언트에서 발송되므로 실패했을 때만 별도로 알려 후속 조치가 가능하게 한다.
export function notifyPartnerLicenseEmailFailed(params: {
  partnerName?: string;
  orgName?: string;
  contactName?: string;
  contactEmail: string;
  couponCode: string;
  reason?: string;
}): void {
  sendTelegramNotification(
    `⚠️ <b>파트너 이용권 이메일 발송 실패</b>\n\n` +
    `🤝 ${params.partnerName || '(파트너 미상)'}\n` +
    `🏫 ${params.orgName || '(미입력)'}\n` +
    `👤 ${params.contactName || '(미입력)'} / ${params.contactEmail}\n` +
    `🎟 ${params.couponCode}\n` +
    `❗ 코드는 발급되었으나 메일이 나가지 않았습니다. 재발송이 필요합니다.` +
    (params.reason ? `\n📄 ${params.reason}` : '')
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

// ── 웹 견적 조회 알림 (Step 2 미리보기 진입) ──────────
// 사용자가 견적 정보 입력 → 미리보기 단계 진입 시 발송.
// 아직 DB에 deal_quotes/deals 미생성 상태 — 영업팀이 follow-up 가능하도록 연락처 포함.
export function notifyWebQuoteInquiry(params: {
  orgName: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string;
  plan: string;
  duration: number;
  quantity: number;
  totalAmount: number;
}): void {
  const { orgName, buyerName, buyerPhone, buyerEmail, plan, duration, quantity, totalAmount } = params;
  const emailStr = buyerEmail ? `\n📧 ${buyerEmail}` : '';
  sendTelegramNotification(
    `🔍 <b>웹 견적 조회</b>\n\n` +
    `🏫 ${orgName || '(미입력)'}\n` +
    `👤 ${buyerName} / ${buyerPhone}${emailStr}\n` +
    `📦 ${plan} ${duration}개월 × ${quantity}건\n` +
    `💰 (예상) ${totalAmount.toLocaleString()}원\n` +
    `\n<i>※ 이메일 미발송 — 미리보기 단계</i>`
  );
}

// ── 웹 견적서 발송 알림 (Step 3 이메일 발송 완료) ──────
// 정식 견적 번호 발급 + DB 저장 + 이메일 발송 완료된 케이스만 알림.
// (이전 명 notifyWebQuote → notifyWebQuoteSent 로 의미 명확화)
export function notifyWebQuoteSent(params: {
  quoteNumber: string;
  orgName: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string;
  plan: string;
  duration: number;
  quantity: number;
  totalAmount: number;
}): void {
  const { quoteNumber, orgName, buyerName, buyerPhone, buyerEmail, plan, duration, quantity, totalAmount } = params;
  const emailStr = buyerEmail ? `\n📧 ${buyerEmail}` : '';
  sendTelegramNotification(
    `📨 <b>웹 견적서 발송 완료</b>\n\n` +
    `📌 ${quoteNumber}\n` +
    `🏫 ${orgName || '(미입력)'}\n` +
    `👤 ${buyerName} / ${buyerPhone}${emailStr}\n` +
    `📦 ${plan} ${duration}개월 × ${quantity}건\n` +
    `💰 ${totalAmount.toLocaleString()}원`
  );
}

// 하위 호환 — 기존 호출처(notifyWebQuote)는 그대로 동작하되 새 이름으로 위임.
export const notifyWebQuote = notifyWebQuoteSent;

// ── 웹 결제 완료 알림 ──────────────────────────────
export function notifyWebPayment(params: {
  quoteNumber: string;
  orgName: string;
  buyerName: string;
  amount: number;
  method: 'card' | 'bank';
}): void {
  const { quoteNumber, orgName, buyerName, amount, method } = params;
  const methodLabel = method === 'card' ? '카드결제' : '계좌이체';
  sendTelegramNotification(
    `💳 <b>웹 결제 완료</b>\n\n` +
    `📌 ${quoteNumber}\n` +
    `🏫 ${orgName || '(미입력)'}\n` +
    `👤 ${buyerName}\n` +
    `💰 ${amount.toLocaleString()}원 (${methodLabel})`
  );
}

// ── 웹 이용권 발송 알림 ──────────────────────────────
export function notifyWebLicenseIssued(params: {
  quoteNumber: string;
  orgName: string;
  recipientCount: number;
}): void {
  const { quoteNumber, orgName, recipientCount } = params;
  sendTelegramNotification(
    `🎟 <b>웹 이용권 발송</b>\n\n` +
    `📌 ${quoteNumber}\n` +
    `🏫 ${orgName || '(미입력)'}\n` +
    `📮 ${recipientCount}명에게 발송 완료`
  );
}

// ── 럭키세븐 그룹 신청 접수 알림 ──────────────────────────────
export function notifyLuckySevenGroup(params: {
  groupCode: string;
  campaignName: string;
  leaderName: string;
  leaderSchoolName: string;
  memberCount: number;
  paymentGroupCount: number;
  totalAmount: number;
}): void {
  const { groupCode, campaignName, leaderName, leaderSchoolName, memberCount, paymentGroupCount, totalAmount } = params;
  sendTelegramNotification(
    `🎯 <b>럭키세븐 그룹 신청</b>\n\n` +
    `📋 ${campaignName}\n` +
    `🆔 ${groupCode}\n` +
    `🏫 대표 ${leaderName} (${leaderSchoolName})\n` +
    `👥 멤버 ${memberCount}명 / 결제 묶음 ${paymentGroupCount}건\n` +
    `💰 ${totalAmount.toLocaleString()}원`
  );
}

// ── 럭키세븐 결제 완료 알림 ──────────────────────────────
export function notifyLuckySevenPayment(params: {
  groupCode: string;
  campaignName: string;
  leaderName: string;
  leaderSchoolName: string;
  payerName: string;
  payerOrgName?: string | null;
  amount: number;
  paidCount: number;
  totalCount: number;
  manual?: boolean;
}): void {
  const { groupCode, campaignName, leaderName, leaderSchoolName, payerName, payerOrgName, amount, paidCount, totalCount, manual } = params;
  const tag = manual ? ' (수동확인)' : '';
  const orgStr = payerOrgName ? ` (${payerOrgName})` : '';
  sendTelegramNotification(
    `💰 <b>럭키세븐 결제 완료${tag}</b>\n\n` +
    `📋 ${campaignName}\n` +
    `🆔 ${groupCode} / 대표 ${leaderName} (${leaderSchoolName})\n` +
    `🧾 결제자: ${payerName}${orgStr}\n` +
    `💳 ${amount.toLocaleString()}원\n` +
    `📊 진행: ${paidCount}/${totalCount} 묶음 완료`
  );
}

// ── 상품 주문 알림 ──────────────────────────────────
export function notifyShopOrder(params: {
  orderId: string;
  customerName: string;
  customerPhone: string;
  items: string;
  totalAmount: number;
  address: string;
}): void {
  const { orderId, customerName, customerPhone, items, totalAmount, address } = params;
  sendTelegramNotification(
    `🛒 <b>상품 주문 접수</b>\n\n` +
    `📌 ${orderId}\n` +
    `👤 ${customerName} / ${customerPhone}\n` +
    `📦 ${items}\n` +
    `💰 ${totalAmount.toLocaleString()}원\n` +
    `📍 ${address}`
  );
}
