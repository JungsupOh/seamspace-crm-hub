-- ⚠️ 미적용. LEAD-6 (CRM-014) — 가져온 묶음 식별(취소용)
-- ============================================================================
-- 롤백   : audit/rollback_lead6.sql
-- 드라이런: audit/dryrun_lead6.sql
-- 선행   : 20261120000000 · 20261121000000 · 20261122000000
--
-- 가져오기를 **되돌릴 수 있게** 묶음 식별자를 남긴다(CRM-014 요구).
-- 이 값이 없으면 "방금 가져온 93건만" 골라낼 방법이 없어, 잘못 가져왔을 때
-- 손으로 하나씩 지워야 한다.
--
-- lead_activities.import_batch_id 는 20261122000000 에서 이미 만들었다.
-- ============================================================================

alter table public.campaign_leads
  add column if not exists import_batch_id uuid;

-- 묶음 되돌리기용. 가져오기로 들어온 행만 인덱스에 담는다(대부분의 행은 null).
create index if not exists idx_campaign_leads_import_batch
  on public.campaign_leads (import_batch_id) where import_batch_id is not null;
