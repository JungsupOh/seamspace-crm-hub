import { useSearchParams, Link } from 'react-router-dom';
import { XCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OrderFail() {
  const [params] = useSearchParams();
  const message = params.get('message') ?? '결제가 취소되었거나 오류가 발생했습니다.';
  const code    = params.get('code');

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <img src="/logo2.png" alt="Seamspace" className="h-8 w-auto" />
          <span className="font-semibold text-base">심스페이스</span>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto px-4 py-16 w-full">
        <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
              <XCircle className="h-10 w-10 text-red-400" />
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-bold mb-2">결제에 실패했습니다</h1>
            <p className="text-muted-foreground text-sm">{message}</p>
            {code && <p className="text-xs text-muted-foreground mt-1">오류 코드: {code}</p>}
          </div>

          <Button asChild className="w-full h-12 text-base">
            <Link to="/order">
              <ArrowLeft className="h-4 w-4 mr-2" />
              다시 시도하기
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
