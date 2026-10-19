// 결제 실패 (/shop/print/student/fail) — 토스가 failUrl 로 보낸다.
// 책은 이미 만들어 두었지만 결제가 안 됐으므로 주문은 들어가지 않았다.

import { Link, useSearchParams } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrintStudentFail() {
  const [params] = useSearchParams();
  const message = params.get('message') || '결제가 취소되었거나 완료되지 않았습니다.';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      <main className="flex-1 max-w-md mx-auto px-4 py-20 w-full">
        <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-5">
          <XCircle className="h-14 w-14 mx-auto text-red-400" />
          <h1 className="text-xl font-bold">결제가 완료되지 않았습니다</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground">
            결제되지 않았으므로 주문은 들어가지 않았습니다. 다시 시도해 주세요.
          </p>
          <div className="flex gap-2 justify-center pt-1">
            <Button asChild variant="outline"><Link to="/shop/diary">상품 설명</Link></Button>
            <Button asChild><Link to="/shop/print/student">다시 주문하기</Link></Button>
          </div>
        </div>
      </main>
    </div>
  );
}
