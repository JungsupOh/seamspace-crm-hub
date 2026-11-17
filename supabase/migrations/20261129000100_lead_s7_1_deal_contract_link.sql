-- ⚠️ 미적용. LEAD-S7-1 — 판매 건에 계약 연결(추가만)
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_1_contracts.sql (같은 파일에서 함께 되돌린다)
-- 드라이런: audit/dryrun_lead_s7_1_contracts.sql
-- 선행   : 20261129000000_lead_s7_1_partner_contracts.sql
--
-- **기존 117건을 건드리지 않는다.** NULL 허용 칸 하나를 더할 뿐이고,
-- contract_id 가 NULL 이면 지금과 똑같이 동작한다(과거 커미션 딜은 NULL 로 둔다).
-- 과거 건을 계약에 붙이는 백필은 **하지 않는다** — 어느 판매가 어느 계약인지
-- 사람이 알아야 정할 수 있고, 추측으로 채우면 정산 숫자가 틀린다.
--
-- 테이블을 다시 쓰지 않는다: 기본값이 없는 칸을 더하는 것이라 메타데이터만 바뀐다.
-- ============================================================================

alter table public.partner_deals
  add column if not exists contract_id uuid references public.partner_contracts(id) on delete restrict;

create index if not exists idx_partner_deals_contract
  on public.partner_deals (contract_id) where contract_id is not null;

comment on column public.partner_deals.contract_id is
  'LEAD-S7-1. 이 판매가 속한 계약(선택). NULL = 계약 표 도입 이전 건 또는 아직 연결 안 함.';
