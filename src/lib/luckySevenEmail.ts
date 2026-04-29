// 럭키세븐 견적서 이메일 — 결제 링크를 /event/lucky-seven/pay/:quoteNumber 로 두는 변형
// (기존 sendQuoteEmail은 그대로 두고 별도 헬퍼로 분리)

import { generateQuotePdfBlob } from '@/lib/generateQuotePdf';
import { LS_UNIT_PRICE, LS_DURATION_MONTHS } from '@/lib/luckySeven';
import type { LSPaymentGroupRow, LSLeadRow, LSGroupRow } from '@/lib/luckySeven';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const APP_URL = window.location.origin;

const HEADERS_FILE = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
};

// Blob → base64 (Resend attachments 형식)
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// PDF Storage 업로드 → public URL 반환
// 파일명에 timestamp 붙여 항상 신규 INSERT (Storage RLS는 INSERT만 허용 → upsert 회피).
// quote_pdf_url을 새 path로 update하면 기존 stale 파일은 자연스럽게 무시됨.
async function uploadQuotePdf(quoteNumber: string, blob: Blob): Promise<string> {
  const ts = Date.now();
  const path = `${quoteNumber}-${ts}.pdf`;
  const upRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/lucky_seven_quote_pdfs/${encodeURIComponent(path)}`,
    {
      method: 'POST',
      headers: { ...HEADERS_FILE, 'Content-Type': 'application/pdf' },
      body: blob,
    },
  );
  if (!upRes.ok) {
    const err = await upRes.json().catch(() => ({}));
    throw new Error(err.message || `PDF 업로드 실패 (${upRes.status})`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/lucky_seven_quote_pdfs/${encodeURIComponent(path)}`;
}

// 럭키세븐 견적서 이메일 본문 (기존 sendQuoteEmail 본문에서 결제 링크만 럭키세븐 경로로 교체)
function buildHtml(params: {
  payerName: string;
  groupCode: string;
  paymentLinkUrl: string;
  amount: number;
  memberCount: number;
}): string {
  const fmtAmount = params.amount.toLocaleString('ko-KR');
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
<tr><td style="background:#0f172a;padding:24px 40px;text-align:center;">
<img src="https://awosikecivzhwisqzlds.supabase.co/storage/v1/object/public/assets/logo.png" alt="Seamspace" width="200" style="display:inline-block;height:auto;max-width:200px;"/>
</td></tr>
<tr><td style="background:#6366f1;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:36px 40px 32px;">

<h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b;">럭키세븐 이벤트 견적서를 보내드립니다 🎉</h2>
<p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
안녕하세요. ${params.payerName} 선생님,<br/>
심스페이스 럭키세븐 이벤트(5월 한정)에 함께해 주셔서 감사합니다.
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px;">
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;">그룹 코드</td>
      <td style="padding:6px 0;font-size:13px;color:#18181b;font-weight:600;text-align:right;">${params.groupCode}</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;">학급플랜 7개월권</td>
      <td style="padding:6px 0;font-size:13px;color:#18181b;font-weight:600;text-align:right;">${params.memberCount}장</td></tr>
  <tr><td style="padding:6px 0;font-size:13px;color:#64748b;">결제 금액</td>
      <td style="padding:6px 0;font-size:15px;color:#0f172a;font-weight:700;text-align:right;">${fmtAmount}원</td></tr>
</table>

<p style="margin:0 0 20px;font-size:14px;color:#18181b;line-height:1.8;">
첨부된 견적서를 확인하시고, 아래 버튼으로 바로 결제하실 수 있습니다.<br/>
견적서 번호 하나로 묶음 결제가 진행됩니다.
</p>

<p style="margin:0 0 24px;text-align:center;">
  <a href="${params.paymentLinkUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">결제하러 가기</a>
  &nbsp;&nbsp;
  <a href="http://pf.kakao.com/_FvrSG" style="display:inline-block;background:#FEE500;color:#3C1E1E;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:13px;font-weight:600;">카카오채널 문의</a>
</p>

<p style="margin:0 0 4px;font-size:13px;color:#64748b;line-height:1.7;">
이용 기간: 결제 완료 후 ~ 2026년 12월 31일 (학기말까지)<br/>
문의: <a href="mailto:sales@tebahsoft.com" style="color:#6366f1;text-decoration:none;">sales@tebahsoft.com</a>
</p>

<p style="margin:24px 0 0;font-size:14px;color:#18181b;line-height:1.8;">
감사합니다.<br/>테바소프트 담당자 드림.
</p>

</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid #e4e4e7;background:#fafafa;">
<p style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.6;">
이 이메일은 Seamspace CRM 시스템에서 자동 발송되었습니다.<br/>
문의: <a href="mailto:sales@tebahsoft.com" style="color:#6366f1;text-decoration:none;">sales@tebahsoft.com</a>
</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// 견적서 PDF 생성 + Storage 업로드 + 이메일 발송 (cc 자동)
export async function issueQuoteForPaymentGroup(params: {
  group: LSGroupRow;
  paymentGroup: LSPaymentGroupRow;
  members: LSLeadRow[];
  leaderName: string;     // 견적서 contactName용
  leaderSchoolName: string;
  skipEmail?: boolean;    // true이면 PDF 재생성/업로드만 (이메일 발송 X, 사용자에게 noisy하지 않게)
}): Promise<void> {
  const { group, paymentGroup, members, skipEmail = false } = params;
  const memberCount = members.length;
  const today = new Date().toISOString().slice(0, 10);

  // 1) 견적서 PDF 생성 — 럭키세븐이벤트플랜 (7개월, 1장 10만원, 학급수 × 단가)
  const items = [
    {
      plan: '럭키세븐이벤트플랜',
      duration: LS_DURATION_MONTHS,
      qty: memberCount,
      unit_price: LS_UNIT_PRICE,
      amount: LS_UNIT_PRICE * memberCount,
      s2b_number: '',
    },
  ];
  const finalValue = LS_UNIT_PRICE * memberCount;
  const supplyPrice = Math.round(finalValue / 1.1);
  const taxAmount = finalValue - supplyPrice;

  const paymentLinkUrl = `${APP_URL}/event/lucky-seven/pay/${encodeURIComponent(paymentGroup.quote_number)}`;

  const { blob, fileName } = await generateQuotePdfBlob({
    quoteNumber: paymentGroup.quote_number,
    quoteDate: today,
    orgName: paymentGroup.buyer_org_name || params.leaderSchoolName,
    contactName: paymentGroup.payer_name,
    items,
    discountAmount: 0,
    plan: '럭키세븐이벤트플랜',
    duration: LS_DURATION_MONTHS,
    unitPrice: LS_UNIT_PRICE,
    licenseQty: memberCount,
    finalValue,
    supplyPrice,
    taxAmount,
    paymentUrl: paymentLinkUrl,
  });

  // 2) Storage 업로드 (PDF 파일 교체)
  const pdfUrl = await uploadQuotePdf(paymentGroup.quote_number, blob);

  // 3) 이메일 발송 — skipEmail=false 일 때만 (sendEmail 헬퍼 사용 — sales@tebahsoft.com cc 자동 적용)
  if (!skipEmail) {
    const base64 = await blobToBase64(blob);
    const html = buildHtml({
      payerName: paymentGroup.payer_name,
      groupCode: group.group_code,
      paymentLinkUrl,
      amount: paymentGroup.amount,
      memberCount,
    });

    const subject = `(테바소프트) 심스페이스 럭키세븐 견적서_${group.group_code}_${paymentGroup.payer_name}`;

    const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        to: paymentGroup.payer_email,
        subject,
        html,
        reply_to: 'sales@tebahsoft.com',
        attachments: [{ filename: fileName, content: base64 }],
        // cc 미지정 → Edge Function이 RESEND_DEFAULT_CC(sales@tebahsoft.com)을 자동 주입
      }),
    });
    if (!emailRes.ok) {
      const err = await emailRes.json().catch(() => ({}));
      throw new Error(err.error || '견적서 이메일 발송 실패');
    }
  }

  // 4) payment_groups 업데이트
  // skipEmail=true 면 PDF URL만 갱신, 이메일/status는 그대로 (단순 재생성)
  // skipEmail=false 면 email_sent_at + status='견적발송'까지 갱신
  await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?id=eq.${paymentGroup.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(
      skipEmail
        ? { quote_pdf_url: pdfUrl }
        : { quote_pdf_url: pdfUrl, email_sent_at: new Date().toISOString(), status: '견적발송' },
    ),
  });
}
