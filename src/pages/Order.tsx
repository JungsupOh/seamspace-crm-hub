// 결제 페이지 — 현재 준비 중 (실제 결제 기능 오픈 전)
import { Wrench } from 'lucide-react';

export default function Order() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center">
          <Wrench className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-2xl font-semibold mb-3">결제 시스템 준비 중</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          현재 결제 시스템을 준비하고 있습니다.<br />
          정식 오픈 전까지 결제는 담당자를 통해 진행해주세요.
        </p>
        <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">문의처</p>
          <p>이메일: <a href="mailto:contact@seamspace.co.kr" className="text-primary hover:underline">contact@seamspace.co.kr</a></p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-6">
          빠른 시일 내에 정식 오픈하겠습니다. 양해 부탁드립니다.
        </p>
      </div>
    </div>
  );
}
