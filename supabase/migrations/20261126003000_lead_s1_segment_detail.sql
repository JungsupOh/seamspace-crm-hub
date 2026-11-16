-- ⚠️ 미적용. LEAD-S1 S1-4 — 세그먼트 상세 칸
-- ============================================================================
-- 롤백   : audit/rollback_lead_s1_segment_detail.sql
-- 드라이런: audit/dryrun_lead_s1_segment_detail.sql
--
-- 왜 필요한가
--   가져오기가 엑셀의 등급(`B-교육`·`B-기업`·`C2`·`D`)을 세그먼트 A~E 로 **줄여** 저장한다
--   (DB CHECK 가 A~E 만 받기 때문). 그래서 B-교육과 B-기업이 둘 다 'B' 가 되어
--   **구분이 사라졌다**(제시카 운영 확인, 2026-11-17).
--   원본은 `custom_fields.등급_원본` 에 남아 있지만 JSONB 안이라 정렬·필터가 안 된다.
--
--   이 칸은 그 구분을 **열로** 되살린다. 값은 제시카가 SQL 로 채운다 —
--   이 단위의 코드는 **표시와 편집만** 한다(요구 S1-4).
--
-- CHECK 를 걸지 않는다: 등급 표기는 행사마다 늘어난다(C2 처럼). 막아 두면
-- 다음 행사에서 ALTER 가 필요해진다.
-- ============================================================================

alter table public.campaign_leads
  add column if not exists segment_detail text;

-- 등급별로 묶어 보기 위한 인덱스(값이 있는 행만 담는다).
create index if not exists idx_campaign_leads_segment_detail
  on public.campaign_leads (segment_detail) where segment_detail is not null;
