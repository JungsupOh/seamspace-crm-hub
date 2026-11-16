-- ⚠️ 미적용. LEAD-UI2 R8 — 리드 보관(archive)
-- ============================================================================
-- 롤백   : audit/rollback_lead_ui2_archive.sql
-- 드라이런: audit/dryrun_lead_ui2_archive.sql
--
-- 왜 필요한가
--   내부 시험 리드(럭키세븐·테스트 이름 등)가 "오늘 할 팔로업"·"7일 넘게 접촉 없음"
--   목록에 섞여 매일 아침 화면을 지저분하게 만든다. 그렇다고 **지우면 안 된다** —
--   리드를 하드 삭제하면 `lead_activities` 가 ON DELETE CASCADE 로 함께 사라져
--   "원장은 지우지 않는다"는 원칙이 깨진다.
--   그래서 **보관**(숨김)으로 해결한다. 행은 남고 목록에서만 빠진다.
--
-- 화면에는 리드를 하드 삭제하는 길을 만들지 않는다(현재 /leads 에 삭제 UI 없음).
--
-- 안전장치: ADD COLUMN(NULL 허용) 하나뿐. 기존 데이터·제약·정책을 건드리지 않는다.
-- ============================================================================

alter table public.campaign_leads
  add column if not exists archived_at timestamptz;

-- 보관본을 빼고 보는 것이 기본이므로, 보관된 행만 인덱스에 담는다(대부분 null).
create index if not exists idx_campaign_leads_archived
  on public.campaign_leads (archived_at) where archived_at is not null;
