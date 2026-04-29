// 견적서 번호 lookup 페이지 — /order
// 입력 → /order/pay/{견적번호}로 이동 (이메일 검증은 다음 페이지)
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Order() {
  const navigate = useNavigate();
  const [quoteNumber, setQuoteNumber] = useState('');

  const submit = () => {
    const q = quoteNumber.trim();
    if (!q) return;
    navigate(`/order/pay/${encodeURIComponent(q)}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 shadow-lg ring-1 ring-border">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <FileText className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-center mb-2">견적서 결제</h1>
        <p className="text-sm text-muted-foreground text-center mb-6 leading-relaxed">
          이메일로 받으신 견적서 번호를 입력하시면 결제 페이지로 안내해 드립니다.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">견적서 번호 <span className="text-destructive">*</span></Label>
            <Input
              value={quoteNumber}
              onChange={(e) => setQuoteNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="예: 2026-01-0042"
              className="h-11 text-sm font-mono"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground">PDF/이메일 상단에 표시된 번호 (예: NO. 2026 01 0042)</p>
          </div>

          <Button onClick={submit} disabled={!quoteNumber.trim()} className="w-full h-11">
            결제 페이지로 이동 <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>

        <div className="mt-6 pt-4 border-t border-border text-xs text-muted-foreground text-center space-y-0.5">
          <p>견적서를 못 받으셨거나 번호를 모르시면</p>
          <p>
            <a href="mailto:sales@tebahsoft.com" className="text-primary hover:underline">sales@tebahsoft.com</a>
            {' · '}
            <a href="tel:042-864-5566" className="text-primary hover:underline">042-864-5566</a>
          </p>
        </div>
      </div>
    </div>
  );
}
