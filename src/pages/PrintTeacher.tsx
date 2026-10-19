// 교사 일괄 주문 (/shop/print/teacher) — 준비 중.
//
// 경로를 먼저 잡아 둔다. 교사용 앱에서 이 주소로 링크가 걸릴 예정이고,
// 상세 페이지의 두 갈래 안내도 지금부터 보여야 하기 때문이다.
//
// 실제 구현은 개발팀에서 gmember_diary_list 스펙(경로·파라미터·응답 형식)과
// 그룹 구성원 목록 조회 수단을 받은 뒤에 붙인다. 지금 API 로는 학생 일기를
// 교사 토큰으로 가져올 수 없다.

import { Link } from 'react-router-dom';
import { Users, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrintTeacher() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <Link to="/shop/diary" className="flex items-center gap-2.5">
            <img src="/logo2.png" alt="Seamspace" className="h-7 w-auto" />
            <span className="font-semibold text-sm">나의 이야기 출력</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto px-4 py-16 w-full">
        <div className="bg-white rounded-2xl border shadow-sm p-8 text-center space-y-5">
          <Users className="h-14 w-14 mx-auto text-primary/60" />
          <h1 className="text-2xl font-bold">선생님 일괄 주문은 준비 중입니다</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            같은 반 학생들의 일기책을 한 번에 신청하고,
            한 곳으로 받아 보실 수 있게 준비하고 있습니다.
            <span className="block mt-2">
              준비되는 대로 선생님용 화면에서 안내해 드리겠습니다.
            </span>
          </p>

          <div className="rounded-xl bg-muted/40 p-4 text-left text-sm space-y-1.5">
            <p className="font-medium">먼저 이용하고 싶으시다면</p>
            <p className="text-muted-foreground">
              학생이 각자 자기 계정으로 주문할 수 있습니다.
              문의는 고객센터 <b>042-864-5566</b> 으로 연락해 주세요.
            </p>
          </div>

          <div className="flex gap-2 justify-center pt-1">
            <Button asChild variant="outline">
              <Link to="/shop/diary"><ArrowLeft className="h-4 w-4 mr-1" />상품 설명으로</Link>
            </Button>
            <Button asChild>
              <Link to="/shop/print/student">내 일기 출력하기</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
