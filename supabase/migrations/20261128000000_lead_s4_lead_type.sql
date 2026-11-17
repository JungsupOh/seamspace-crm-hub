-- ⚠️ 미적용. LEAD-S4 (CRM-015) — 리드 유형
-- ============================================================================
-- 롤백   : audit/rollback_lead_s4_lead_type.sql
-- 드라이런: audit/dryrun_lead_s4_lead_type.sql
--
-- 브리프 H항: 전시회에서 만나는 사람은 고객만이 아니다 — 세일즈 파트너(유통·리셀러),
-- 연구 파트너(대학·연구기관), 기술·연동 파트너(LMS), 투자·후원, 정부·기관, 미디어가 섞여 있다.
-- 싱가포르 EDUtech 에서도 LMS 연동을 문의한 기관이 5곳 있었다.
--
-- **유형별로 다른 것은 단계 목록과 기본 다음 행동뿐이다**(브리프 H항).
-- 사람·기관 기록, 활동 기록, 지역, 전략은 유형과 무관하게 같은 것을 쓴다.
--
-- ⚠️ CHECK 를 걸지 않는다.
--    유형은 쓰면서 늘어난다(브리프가 적은 7가지로 시작하지만 James 가 고칠 전제다).
--    DB 에 못 박으면 그때마다 ALTER 가 필요하다. 허용값은 코드 상수
--    (src/lib/leadType.ts)로 고정하고 테스트로 지킨다 — followup_stage 와 같은 방식이다.
--
-- 보조 태그를 jsonb 로 둔 이유: 한 사람이 고객이면서 연구 파트너일 수 있다(브리프 H항).
-- text[] 는 PostgREST 에서 다루기 번거롭고, 나중에 태그마다 메모를 붙이게 될 수 있다.
-- 정렬·필터는 주 유형(lead_type)으로 하므로 태그가 jsonb 라도 느려지지 않는다.
--
-- 안전장치: ADD COLUMN 둘뿐(NULL 허용 / 기본값 있음). 기존 데이터·제약·정책 그대로.
-- ============================================================================

alter table public.campaign_leads
  -- 주 유형 하나. NULL = 아직 정하지 않았다(기존 270건이 전부 여기 해당).
  add column if not exists lead_type text,
  -- 보조 태그 여러 개(문자열 배열).
  add column if not exists lead_tags jsonb not null default '[]'::jsonb;

-- 유형별로 묶어 보기 위한 인덱스(값이 있는 행만 담는다 — 지금은 전부 NULL).
create index if not exists idx_campaign_leads_lead_type
  on public.campaign_leads (lead_type) where lead_type is not null;
