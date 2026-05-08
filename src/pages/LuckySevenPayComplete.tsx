// 럭키세븐 결제 완료 콜백 — Toss success URL
// /event/lucky-seven/pay/complete?paymentKey=...&orderId=...&amount=...
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchPaymentGroupByQuoteNumber, refreshGroupStatus } from '@/lib/luckySeven';
// 텔레그램 알림은 confirm-lucky-seven-pay 서버사이드에서 발송 (브라우저 의존 X)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export default function LuckySevenPayComplete() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [groupCode, setGroupCode] = useState<string>('');

  useEffect(() => {
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = Number(params.get('amount') || '0');

    if (!paymentKey || !orderId || !amount) {
      setStatus('error');
      setErrorMsg('결제 정보가 올바르지 않습니다.');
      return;
    }

    (async () => {
      try {
        // 1) 서버에 결제 승인 요청
        const res = await fetch(`${SUPABASE_URL}/functions/v1/confirm-lucky-seven-pay`, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ paymentKey, orderId, amount, quoteNumber: orderId }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || '결제 승인 실패');

        // 영수증 이메일은 Toss가 자동 발송 — 중복 방지를 위해 우리 발송 X

        // 2) 그룹 상태 갱신 + group_code UI 표시 (텔레그램은 서버사이드에서 발송)
        const detail = await fetchPaymentGroupByQuoteNumber(orderId);
        if (detail) {
          const { group } = detail;
          await refreshGroupStatus(group.id);
          setGroupCode(group.group_code);
        }

        sessionStorage.removeItem('ls_pay');
        setStatus('success');
      } catch (e) {
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : '결제 처리 중 오류가 발생했습니다.');
      }
    })();
  }, [params]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">결제 승인 처리 중...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">결제 처리에 문제가 생겼습니다</h1>
          <p className="text-sm text-muted-foreground mb-4">{errorMsg}</p>
          <p className="text-xs text-muted-foreground">문의: sales@tebahsoft.com</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
        <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2">결제가 완료되었습니다 🎉</h1>
        {groupCode && <p className="text-sm text-muted-foreground mb-4">그룹 코드 <strong className="font-mono text-foreground">{groupCode}</strong></p>}
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          그룹 내 모든 결제가 완료되면<br />
          멤버 휴대폰으로 이용권이 발송됩니다.
        </p>
        <Link to="/event/lucky-seven/status">
          <Button className="w-full">결제 진행 상황 조회</Button>
        </Link>
      </div>
    </div>
  );
}
