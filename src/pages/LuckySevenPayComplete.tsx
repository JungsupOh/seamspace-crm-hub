// 럭키세븐 결제 완료 콜백 — Toss success URL
// /event/lucky-seven/pay/complete?paymentKey=...&orderId=...&amount=...
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchPaymentGroupByQuoteNumber, refreshGroupStatus } from '@/lib/luckySeven';
import { notifyLuckySevenPayment } from '@/lib/telegram';
import { sendPaymentReceiptEmail } from '@/lib/email';

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

        // 영수증 이메일 발송 (실패해도 UI 진행)
        if (data.payerEmail) {
          sendPaymentReceiptEmail({
            to: data.payerEmail,
            customerName: data.payerName ?? '',
            orderName: data.orderName ?? '심스페이스 이용권',
            amount: data.amount ?? amount,
            paidAt: data.approvedAt ?? undefined,
            receiptUrl: data.receiptUrl ?? undefined,
            orderId: orderId,
            method: data.method ?? '카드',
          }).catch((err) => console.warn('[LuckySevenPayComplete] 영수증 이메일 실패:', err));
        }

        // 2) 그룹 상태 갱신 + 텔레그램 알림 + 캠페인 정보 조회
        const detail = await fetchPaymentGroupByQuoteNumber(orderId);
        if (detail) {
          const { group, paymentGroup } = detail;
          await refreshGroupStatus(group.id);

          // 캠페인명 + 대표자 정보 조회
          const [campaignRes, leaderRes, pgsRes] = await Promise.all([
            fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${group.campaign_id}&select=name`, { headers: HEADERS }),
            group.leader_lead_id
              ? fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${group.leader_lead_id}&select=name,school_name`, { headers: HEADERS })
              : Promise.resolve(null),
            fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?group_id=eq.${group.id}&select=status`, { headers: HEADERS }),
          ]);
          const campaign = campaignRes.ok ? (await campaignRes.json())[0] : null;
          const leader = leaderRes && leaderRes.ok ? (await leaderRes.json())[0] : null;
          const pgs = pgsRes.ok ? (await pgsRes.json()) as { status: string }[] : [];
          const paidCount = pgs.filter((p) => p.status === '결제완료').length;

          notifyLuckySevenPayment({
            groupCode: group.group_code,
            campaignName: campaign?.name ?? '럭키세븐',
            leaderName: leader?.name ?? '(대표자)',
            leaderSchoolName: leader?.school_name ?? '',
            payerName: paymentGroup.payer_name,
            payerOrgName: paymentGroup.buyer_org_name,
            amount: paymentGroup.amount,
            paidCount,
            totalCount: pgs.length,
          });

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
