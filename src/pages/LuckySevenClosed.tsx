// 럭키세븐 이벤트 종료 안내 — /event/lucky-seven 계열 5개 라우트 공용 (HARD-A H-1)
//
// 왜 이 페이지가 있나
//   럭키세븐 이벤트는 끝났다(캠페인 상태 ended, 마지막 활동 2026-06-01).
//   그런데 공개 폼·결제·조회 화면이 **로그인 없이** lucky_seven_groups,
//   lucky_seven_payment_groups, campaign_leads, contacts, deals, deal_quotes,
//   deal_users, deal_licenses 를 공개 키로 읽고 **쓰고** 있었다.
//   이벤트가 끝났으므로 그 경로를 열어 둘 이유가 없다 — 라우트 주소는 그대로 두고
//   화면만 이 안내로 바꿔서, 공개 쓰기 경로를 닫는다.
//
//   기존 페이지 파일(LuckySevenForm/Pay/PayComplete/PayFail/Status)은 **지우지 않았다**.
//   감사와 되돌리기를 쉽게 하려고 라우트에서만 분리했다(App.tsx).

import { Link } from 'react-router-dom';
import { CalendarX2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LuckySevenClosed() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
        <CalendarX2 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <h1 className="text-xl font-semibold mb-2">종료된 이벤트입니다</h1>
        <p className="text-sm text-muted-foreground mb-6">
          럭키세븐 이벤트 신청과 결제는 종료되었습니다.
          <br />
          이미 신청하신 내용은 담당자에게 문의해 주세요.
        </p>
        <div className="space-y-2">
          <Link to="/shop">
            <Button className="w-full">마음일기 스토어 보기</Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-4">문의: sales@tebahsoft.com</p>
      </div>
    </div>
  );
}
