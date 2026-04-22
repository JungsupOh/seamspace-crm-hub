import { Link, useSearchParams } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ShopFail() {
  const [params] = useSearchParams();
  const message = params.get('message') || '결제가 취소되었거나 오류가 발생했습니다.';
  const code = params.get('code');

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
        <XCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2">결제 실패</h1>
        <p className="text-sm text-muted-foreground mb-2">{message}</p>
        {code && <p className="text-xs text-muted-foreground mb-6">오류 코드: {code}</p>}
        <div className="flex gap-3">
          <Link to="/shop" className="flex-1">
            <Button variant="outline" className="w-full">스토어</Button>
          </Link>
          <Link to="/shop/cart" className="flex-1">
            <Button className="w-full">다시 시도</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
