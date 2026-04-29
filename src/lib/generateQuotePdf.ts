// 견적서 PDF 생성 (html2canvas + jsPDF)
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { QuoteLineItem } from './pricing';
import { S2B_MAP } from './pricing';

export interface QuotePdfData {
  quoteNumber: string;
  quoteDate: string;       // YYYY-MM-DD
  orgName: string;
  contactName: string;
  items?: QuoteLineItem[];
  discountAmount?: number;
  // 단일 상품 호환 (items 없을 때)
  plan: string;
  duration: number;
  unitPrice: number;
  licenseQty: number;
  finalValue: number;
  supplyPrice: number;
  taxAmount: number;
  notes?: string;
  paymentUrl?: string;     // 결제 페이지 URL (있으면 PDF에 QR + URL 표시)
}

function getS2BNumber(plan: string, duration: number): string {
  return S2B_MAP[plan]?.[duration] ?? '';
}

// 숫자 → 한글 금액 (만 단위)
function toKoreanAmount(n: number): string {
  if (!n) return '영 원整';
  const units = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const tens  = ['', '십', '이십', '삼십', '사십', '오십', '육십', '칠십', '팔십', '구십'];
  const large = ['', '만', '억', '조'];

  function chunk(n: number): string {
    if (n === 0) return '';
    const t = Math.floor(n / 1000); const h = Math.floor((n % 1000) / 100);
    const te = Math.floor((n % 100) / 10); const o = n % 10;
    let s = '';
    if (t) s += (t === 1 ? '천' : units[t] + '천');
    if (h) s += (h === 1 ? '백' : units[h] + '백');
    if (te) s += tens[te];
    if (o) s += units[o];
    return s;
  }

  let result = '';
  let v = n;
  for (let i = 3; i >= 0; i--) {
    const div = Math.pow(10000, i);
    const c = Math.floor(v / div);
    if (c > 0) { result += chunk(c) + large[i]; v %= div; }
  }
  return result + ' 원整';
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function fmt(n: number): string {
  return n ? n.toLocaleString('ko-KR') : '';
}

async function buildPdfBlob(data: QuotePdfData): Promise<{ blob: Blob; fileName: string }> {
  // 숨김 컨테이너 생성
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; top: -9999px; left: -9999px;
    width: 794px; background: white; font-family: 'Malgun Gothic', '맑은 고딕', sans-serif;
    font-size: 12px; color: #000; line-height: 1.4;
  `;
  document.body.appendChild(container);

  // 상품 행 생성 (items가 있으면 사용, 없으면 단일 상품 호환)
  const items = data.items && data.items.length > 0
    ? data.items
    : [{ plan: data.plan, duration: data.duration, qty: data.licenseQty, unit_price: data.unitPrice, amount: data.finalValue + (data.discountAmount ?? 0), s2b_number: getS2BNumber(data.plan, data.duration) }];
  const discount = data.discountAmount ?? 0;

  // 결제 URL이 있으면 QR 코드 생성 (dataURL)
  let qrDataUrl = '';
  if (data.paymentUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(data.paymentUrl, {
        width: 180,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {
      qrDataUrl = '';
    }
  }

  container.innerHTML = `
    <div style="padding: 48px 52px 96px; width: 794px; box-sizing: border-box;">
      <!-- 상단 — 좌측(번호+제목) / 우측(로고) — 동일 height로 정렬 -->
      <div style="display: flex; align-items: stretch; gap: 16px; margin-bottom: 24px; border-bottom: 2px solid #000; padding-bottom: 8px;">
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 80px;">
          <div style="font-size: 12px; text-decoration: underline;">
            NO. ${data.quoteNumber.replace(/-/g, '- ')}
          </div>
          <div style="text-align: center; font-size: 26px; font-weight: bold; letter-spacing: 12px;">
            견 적 서
          </div>
        </div>
        <img src="/social-enterprise-logo.png" style="height: 80px; object-fit: contain;" />
      </div>

      <!-- 수신처 + 공급자 -->
      <div style="display: flex; gap: 24px; margin-bottom: 0;">
        <!-- 좌측 수신처 -->
        <div style="flex: 1; padding-top: 8px;">
          <div style="font-size: 14px; font-weight: bold; margin-bottom: 6px;">${formatDate(data.quoteDate)}</div>
          <div style="font-size: 15px; font-weight: bold; margin-bottom: 4px;">${data.orgName}</div>
          <div style="font-size: 13px; margin-bottom: 12px;">${data.contactName} 선생님 귀하</div>
          <div style="font-size: 12px; color: #333;">아래와 같이 견적합니다.</div>
        </div>
        <!-- 우측 공급자 테이블 — 폭 확장으로 주소/종목을 1줄로 -->
        <div style="width: 420px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <tr>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; white-space: nowrap; text-align: center; vertical-align: middle; width: 90px;">사업자등록번호</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; vertical-align: middle;" colspan="3">440-87-02207</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; text-align: center; vertical-align: middle;">상 호</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; vertical-align: middle; width: 110px;">테바소프트㈜</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; text-align: center; vertical-align: middle; width: 40px;">성명</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; position: relative; vertical-align: middle; min-width: 80px;">
                오정섭
                <img src="/stamp.png" style="position: absolute; right: -14px; top: -24px; width: 80px; height: 80px; opacity: 0.85;" />
              </td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; text-align: center; vertical-align: middle; white-space: nowrap;">사업장 주소</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; font-size: 10px; vertical-align: middle; white-space: nowrap;" colspan="3">대전광역시 유성구 대학로99, 510호 (궁동, 대전팁스타운)</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; text-align: center; vertical-align: middle;">업 태</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; vertical-align: middle;">정보통신업</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; text-align: center; vertical-align: middle;">종목</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; font-size: 10px; vertical-align: middle; white-space: nowrap;">응용 소프트웨어 개발 및 공급업</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; text-align: center; vertical-align: middle;">전화번호</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; vertical-align: middle;" colspan="3">042-864-5566</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; background: #f8f8f8; text-align: center; vertical-align: middle;">담당자 이메일</td>
              <td style="border: 1px solid #000; padding: 5px 8px 10px; vertical-align: middle;" colspan="3">sales@tebahsoft.com</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- 합계금액 -->
      <div style="border: 1.5px solid #000; display: flex; align-items: center; padding: 10px 16px; margin: 20px 0 0 0; gap: 12px;">
        <div style="font-size: 11px; color: #333; white-space: nowrap;">
          <div style="font-weight: bold; font-size: 13px;">합계금액</div>
          <div style="font-size: 10px;">(공급가액+세액)</div>
        </div>
        <div style="font-size: 16px; font-weight: bold; flex: 1; text-align: center;">
          ${toKoreanAmount(data.finalValue)} &nbsp;&nbsp; ( ￦${fmt(data.finalValue)} )
        </div>
      </div>

      <!-- 품목 테이블 -->
      <table style="width: 100%; border-collapse: collapse; margin-top: 0; font-size: 12px;">
        <thead>
          <tr style="background: #f5f0e8;">
            <th style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle; width: 45%;">품 명</th>
            <th style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle; width: 12%;">기간</th>
            <th style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle; width: 15%;">단가</th>
            <th style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle; width: 12%;">수량(식)</th>
            <th style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle; width: 16%;">금액</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => {
            const label = it.plan ? `심스페이스(AI마음일기) ${it.plan.replace('플랜', '')} 플랜` : '심스페이스(AI마음일기)';
            return `<tr>
            <td style="border: 1px solid #000; padding: 6px 10px 12px; vertical-align: middle;">${label}</td>
            <td style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle;">${it.duration} 개월</td>
            <td style="border: 1px solid #000; padding: 6px 10px 12px 6px; text-align: right; vertical-align: middle;">${fmt(it.unit_price)}</td>
            <td style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle;">${it.qty}</td>
            <td style="border: 1px solid #000; padding: 6px 10px 12px 6px; text-align: right; vertical-align: middle;">${fmt(it.amount)}</td>
          </tr>` + (it.s2b_number ? `<tr>
            <td style="border: 1px solid #000; padding: 4px 10px 8px; font-size: 11px; color: #555; vertical-align: middle;" colspan="5">
              S2B 물품번호 : &nbsp; ${it.s2b_number}
            </td>
          </tr>` : '');
          }).join('')}
          ${(() => { const usedRows = items.length + items.filter(i => i.s2b_number).length + (discount > 0 ? 1 : 0); const empty = Math.max(10 - usedRows, 1); return [...Array(empty)].map(() => `
          <tr style="height: 28px;">
            <td style="border: 1px solid #000;"></td>
            <td style="border: 1px solid #000;"></td>
            <td style="border: 1px solid #000;"></td>
            <td style="border: 1px solid #000;"></td>
            <td style="border: 1px solid #000;"></td>
          </tr>`).join(''); })()}
          ${discount > 0 ? `<tr>
            <td style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle;" colspan="4">할 &nbsp;&nbsp;&nbsp; 인 &nbsp;&nbsp;&nbsp; 금 &nbsp;&nbsp;&nbsp; 액</td>
            <td style="border: 1px solid #000; padding: 6px 10px 12px 6px; text-align: right; vertical-align: middle; color: #c00;">-${fmt(discount)}</td>
          </tr>` : ''}
          <tr>
            <td style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle;" colspan="4">공 &nbsp;&nbsp;&nbsp; 급 &nbsp;&nbsp;&nbsp; 가</td>
            <td style="border: 1px solid #000; padding: 6px 10px 12px 6px; text-align: right; vertical-align: middle;">${fmt(data.supplyPrice)}</td>
          </tr>
          <tr>
            <td style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle;" colspan="4">부 &nbsp;&nbsp;&nbsp; 가 &nbsp;&nbsp;&nbsp; 세</td>
            <td style="border: 1px solid #000; padding: 6px 10px 12px 6px; text-align: right; vertical-align: middle;">${fmt(data.taxAmount)}</td>
          </tr>
          <tr style="font-weight: bold;">
            <td style="border: 1px solid #000; padding: 6px 6px 12px; text-align: center; vertical-align: middle;" colspan="4">합 &nbsp;&nbsp; 계 &nbsp;&nbsp; 금 &nbsp;&nbsp; 액</td>
            <td style="border: 1px solid #000; padding: 6px 10px 12px 6px; text-align: right; vertical-align: middle;">${fmt(data.finalValue)}</td>
          </tr>
        </tbody>
      </table>

      <!-- 특기사항 + 결제 QR (paymentUrl 있을 때 우측에 QR 표시) -->
      <div style="border: 1px solid #000; margin-top: 20px; padding: 12px 16px; font-size: 11px; display: flex; gap: 16px; align-items: stretch;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: bold; margin-bottom: 8px;">[특기사항]</div>
          <div style="color: #333; line-height: 1.8;">
            - 견적서 유효기간은 4주입니다.<br>
            - 위 견적내용은 외부 유출에 주의해 주시기 바랍니다.
            ${data.notes ? `<br>- ${data.notes}` : ''}
            ${data.paymentUrl ? `<br>- 직접 결재를 하시려면, 우측 QR이나 아래 링크에서 가능합니다.<div data-payment-url-target="1" style="margin-left: 10px; margin-top: 3px; font-family: 'Consolas', 'Menlo', 'Monaco', 'DejaVu Sans Mono', monospace; font-size: 11px; font-weight: 600; color: #0a3aa1; white-space: nowrap;">${data.paymentUrl}</div><div style="margin-left: 10px; margin-top: 2px; font-size: 10px; color: #666;">(결재 페이지 진입 시 본 견적서를 받으신 이메일 주소를 입력하셔야 합니다.)</div>` : ''}
          </div>
        </div>
        ${data.paymentUrl && qrDataUrl ? `
        <div style="width: 100px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
          <img src="${qrDataUrl}" style="width: 100px; height: 100px;" />
          <div style="font-size: 9px; color: #666; text-align: center;">결제 QR</div>
        </div>` : ''}
      </div>
    </div>
  `;

  try {
    // URL 텍스트의 컨테이너 내 위치를 캡처 전 미리 측정 (PDF hyperlink용 좌표)
    let urlRect: { top: number; left: number; width: number; height: number } | null = null;
    if (data.paymentUrl) {
      const urlEl = container.querySelector<HTMLElement>('[data-payment-url-target="1"]');
      if (urlEl) {
        const cRect = container.getBoundingClientRect();
        const r = urlEl.getBoundingClientRect();
        urlRect = {
          top: r.top - cRect.top,
          left: r.left - cRect.left,
          width: r.width,
          height: r.height,
        };
      }
    }

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width: 794,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);

    // URL 영역에 정확한 클릭 가능 hyperlink 추가
    // (이미지 안 텍스트의 OCR 인식 오류로 잘못된 URL로 이동하는 문제 방지)
    if (urlRect && data.paymentUrl) {
      const containerCssWidth = 794;        // CSS px (html2canvas width와 일치)
      const mmPerPx = pdfW / containerCssWidth;
      pdf.link(
        urlRect.left * mmPerPx,
        urlRect.top * mmPerPx,
        urlRect.width * mmPerPx,
        urlRect.height * mmPerPx,
        { url: data.paymentUrl },
      );
    }

    const datePart = data.quoteDate.replace(/-/g, '_');
    const fileName = `seamspace_AI_${data.quoteNumber.replace(/-/g, '_')}-${datePart}.pdf`;
    const blob = pdf.output('blob');
    return { blob, fileName };
  } finally {
    document.body.removeChild(container);
  }
}

export async function generateQuotePdf(data: QuotePdfData): Promise<void> {
  const { blob, fileName } = await buildPdfBlob(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function generateQuotePdfBlob(data: QuotePdfData): Promise<{ blob: Blob; fileName: string }> {
  return buildPdfBlob(data);
}
