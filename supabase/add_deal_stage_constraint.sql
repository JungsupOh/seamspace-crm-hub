-- deals.deal_stage 무결성 — 파이프라인에 없는 값이 들어가지 못하게 막는다.
--
-- 배경: /shop 결제가 만든 딜이 '거래종료'(존재하지 않는 값)로 기록되어 스테이지 필터·
-- 집계 어디에도 잡히지 않았다(#45). 컬럼에 제약이 없어 임의 문자열이 그대로 들어갔다.
--
-- Airtable 레거시 값(Lead/Proposal/Contract/Closed_Won/Active_User)은 실데이터에 0건임을
-- 확인하고 허용 목록에서 제외했다. 코드 쪽 유일한 위반 지점이던 Deals.tsx autoStage() 의
-- 'Lead' 폴백도 같은 커밋에서 '체험권' 으로 고쳤다.
--
-- 값 목록의 정본은 src/lib/grades.ts 의 ALL_DEAL_STAGES 다. 한쪽만 고치면 안 된다.

-- STEP 1) NULL 정리 — 딜 생성 폼이 스테이지를 안 보내면 NULL 로 들어갔다.
--         (해당 1건은 이용권만 발급된 해외 체험 건으로 확인)
update deals set deal_stage = '체험권' where deal_stage is null;

-- STEP 2) 기본값 — 스테이지를 안 보내는 생성 경로가 다시 NULL 을 만들지 않도록.
alter table deals alter column deal_stage set default '체험권';

-- STEP 3) NOT NULL
alter table deals alter column deal_stage set not null;

-- STEP 4) 허용 값 고정
alter table deals drop constraint if exists deals_deal_stage_check;
alter table deals add constraint deals_deal_stage_check check (
  deal_stage in (
    '체험권', '견적', '계약체결/구매', '템플릿 회신대기',
    '이용권 발송완료', '결제예정', '입금대기', '입금완료',
    '딜취소', '계약파기'
  )
);
