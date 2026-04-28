// 럭키세븐 결제 페이지 — /event/lucky-seven/pay/:quoteNumber
// 견적서 번호로 결제묶음을 조회하고 Toss 결제 호출
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchPaymentGroupByQuoteNumber, type LSGroupRow, type LSPaymentGroupRow, type LSLeadRow } from '@/lib/luckySeven';

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? '';

declare global { interface Window { TossPayments?: any } }

export default function LuckySevenPay() {
  const { quoteNumber } = useParams<{ quoteNumber: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ paymentGroup: LSPaymentGroupRow; group: LSGroupRow; members: LSLeadRow[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quoteNumber) { setLoading(false); return; }
    fetchPaymentGroupByQuoteNumber(quoteNumber)
      .then(setData)
      .finally(() => setLoading(false));
  }, [quoteNumber]);

  const handlePay = async () => {
    if (!data) return;
    const { paymentGroup, group } = data;
    setSubmitting(true);
    setError(null);
    try {
      if (!window.TossPayments) {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1';
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Toss SDK 로드 실패'));
          document.head.appendChild(script);
        });
      }
      const toss = window.TossPayments(TOSS_CLIENT_KEY);
      const orderName = `[럭키세븐] ${group.group_code} ${data.members.length}명`;

      // sessionStorage에 콜백 처리에 필요한 정보 저장
      sessionStorage.setItem('ls_pay', JSON.stringify({
        quoteNumber: paymentGroup.quote_number,
        amount: paymentGroup.amount,
        groupId: paymentGroup.group_id,
        paymentGroupId: paymentGroup.id,
      }));

      await toss.requestPayment('카드', {
        amount: paymentGroup.amount,
        orderId: paymentGroup.quote_number,
        orderName,
        customerName: paymentGroup.payer_name,
        customerMobilePhone: paymentGroup.payer_phone.replace(/\D/g, ''),
        customerEmail: paymentGroup.payer_email || undefined,
        successUrl: `${window.location.origin}/event/lucky-seven/pay/complete`,
        failUrl: `${window.location.origin}/event/lucky-seven/pay/fail`,
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'USER_CANCEL') {
        setError(e instanceof Error ? e.message : '결제 오류가 발생했습니다');
        console.error(e);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">견적서를 찾을 수 없습니다</h1>
          <p className="text-sm text-muted-foreground">URL을 다시 확인해주세요.</p>
        </div>
      </div>
    );
  }

  const { paymentGroup, group, members } = data;

  if (paymentGroup.status === '결제완료') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">이미 결제 완료된 견적입니다</h1>
          <p className="text-sm text-muted-foreground mb-4">{paymentGroup.quote_number}</p>
          <Link to={`/event/lucky-seven/status`}>
            <Button variant="outline" className="w-full">결제 진행 상황 조회</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 py-6 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <h1 className="text-base font-semibold">럭키세븐 결제</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{paymentGroup.quote_number}</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-muted/30 rounded-lg p-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">그룹 코드</span><span className="font-mono">{group.group_code}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">결제자</span><span>{paymentGroup.payer_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">학급플랜 7개월권</span><span>{members.length}장</span></div>
            <div className="border-t border-border pt-1.5 flex justify-between font-bold">
              <span>결제 금액</span><span className="text-primary">{paymentGroup.amount.toLocaleString()}원</span>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold mb-2">포함 멤버 ({members.length}명)</p>
            <ul className="text-xs space-y-1">
              {members.map((m) => (
                <li key={m.id} className="flex justify-between">
                  <span>{m.name}</span>
                  <span className="text-muted-foreground">{m.school_name}</span>
                </li>
              ))}
            </ul>
          </div>

          {paymentGroup.quote_pdf_url && (
            <a href={paymentGroup.quote_pdf_url} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline" className="w-full">
                <FileText className="h-4 w-4 mr-2" /> 견적서 PDF 다운로드
              </Button>
            </a>
          )}

          {error && <div className="bg-destructive/10 text-destructive text-xs rounded p-2">{error}</div>}

          <Button onClick={handlePay} disabled={submitting} className="w-full h-11">
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />결제 진행 중...</> : `${paymentGroup.amount.toLocaleString()}원 결제하기`}
          </Button>

          <Link to="/event/lucky-seven/status" className="block text-center text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3 inline mr-1" /> 결제 진행 상황 조회
          </Link>
        </div>
      </div>
    </div>
  );
}
