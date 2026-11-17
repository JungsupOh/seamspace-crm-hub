-- ⚠️ 미적용. LEAD-S7-3 — 발급을 계약에 잇는 칸
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_3_issue.sql
-- 드라이런: audit/dryrun_lead_s7_3_issue.sql
-- 선행   : 20261129000000(partner_contracts) · 20261130000000(partner_purchases)
--
-- 왜 필요한가
--   지금은 발급 기록이 **어느 계약에서 나간 것인지 저장되지 않는다.** 그래서
--   계약별 잔량(= 구매 − 발급)을 셀 수 없고, S7-2b 화면이 "발급·잔량"을 비워 뒀다.
--
-- **기존 2건은 채우지 않는다**(요구사항 1).
--   NULL = "계약 도입 전 발급". 어느 계약에 붙일지는 James 가 정한다.
--   추측으로 채우면 그 계약의 잔량이 틀리고, 틀린 잔량은 발급을 잘못 막거나 열어 준다.
--
-- RLS·권한은 건드리지 않는다. partner_licenses 의 기존 정책(partner_scoped_*)이 그대로다.
-- 테이블을 다시 쓰지 않는다: 기본값이 없는 칸을 더하는 것이라 메타데이터만 바뀐다.
-- ============================================================================

alter table public.partner_licenses
  add column if not exists contract_id uuid references public.partner_contracts(id) on delete restrict;

create index if not exists idx_partner_licenses_contract
  on public.partner_licenses (contract_id) where contract_id is not null;

-- 잔량을 셀 때 "그 계약의, 수량이 잡히는 발급"만 빠르게 모으려는 인덱스.
create index if not exists idx_partner_licenses_contract_status
  on public.partner_licenses (contract_id, status) where contract_id is not null;

comment on column public.partner_licenses.contract_id is
  'LEAD-S7-3. 이 발급이 빠져나간 계약. NULL = 계약 도입 전 발급(기존 건) 또는 계약이 없는 파트너.';
