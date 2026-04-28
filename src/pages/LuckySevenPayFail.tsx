// 럭키세븐 결제 실패 — Toss fail URL
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LuckySevenPayFail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const message = params.get('message') || '결제가 취소되거나 실패했습니다.';
  const orderId = params.get('orderId');

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
        <h1 className="text-xl font-semibold mb-2">결제가 완료되지 않았습니다</h1>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="space-y-2">
          {orderId && (
            <Button onClick={() => navigate(`/event/lucky-seven/pay/${orderId}`)} className="w-full">
              다시 결제 시도
            </Button>
          )}
          <Link to="/event/lucky-seven/status">
            <Button variant="outline" className="w-full">결제 진행 상황 조회</Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-4">문의: sales@tebahsoft.com</p>
      </div>
    </div>
  );
}
