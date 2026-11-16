-- ⚠️ 미적용. LEAD-3 (CRM-012) — 해외 리드 칸
-- ============================================================================
-- 롤백   : audit/rollback_lead3.sql
-- 드라이런: audit/dryrun_lead3.sql
-- 선행   : 20261120000000_lead_market_mode.sql (market 칸)
--
-- 브리프 B항이 요구한 칸을 campaign_leads 에 더한다.
-- custom_fields(JSONB) 가 아니라 **열**로 두는 이유: CRM-012 완료 기준이
--   "가능성순 정렬 + 국가·행사 필터" 라서다. JSONB 안은 정렬·필터가 느리고 타입이 없다.
--   (원본 보존용으로 custom_fields 는 계속 쓴다 — 가져온 엑셀의 알 수 없는 열은 거기에 남긴다.)
--
-- region(지역)은 **칸을 만들지 않는다.** country 에서 코드의 순수 함수로 파생한다
--   (src/lib/leadRegion.ts). 칸을 두면 운영 백필이 필요해지고, "나라를 고치면 지역이
--   따라 바뀐다"는 CRM-008 요구에도 파생이 맞다.
--
-- 안전장치
--   · 전부 ADD COLUMN(NULL 허용) — 기존 행·기존 INSERT 가 그대로 동작한다.
--   · CHECK 는 **값이 있을 때만** 검사한다(`col is null or col in (...)`).
--     그래야 기존 행과 "아직 모르는" 해외 리드가 막히지 않는다.
--   · followup_stage 에는 CHECK 를 **걸지 않는다** — CRM-015 가 유형별 단계 목록을
--     더할 예정이라(브리프 H항) DB 에 값을 못 박으면 그때 ALTER 가 필요해진다.
--     허용값은 코드 상수(src/lib/leadFollowup.ts)로 고정하고 테스트로 지킨다.
-- ============================================================================

alter table public.campaign_leads
  -- 국가. ISO 2자 코드를 **권장**하지만 강제하지 않는다 — 운영 contacts.country 가
  -- 'Korea' 같은 자유 텍스트라(009-1) 가져오기 원본도 섞여 들어올 수 있다.
  -- 정규화는 코드(normalizeCountry)가 하고, 원본은 그대로 남긴다.
  add column if not exists country text,

  -- 세그먼트 A~E. 이름(정의)은 James 확정 전이라 코드만 둔다(브리프 B항).
  add column if not exists segment text,

  -- 가능성 1~5 (5가 가장 높다). 정렬의 1순위 키다.
  add column if not exists probability smallint,

  -- 행사명. campaign_id 와 별개다 — 엑셀 가져오기는 캠페인 없이도 들어오고,
  -- 한 캠페인에 여러 행사가 섞일 수 있다(브리프 B항 '행사명').
  add column if not exists event_name text,

  -- 출처 유형: 전시회 / 콜드메일 / 파트너 소개 / QR / 기타
  -- 기존 source(소개받으신 경로, 공개 폼의 자유 입력)와 **다른 축**이라 새 칸으로 둔다.
  add column if not exists source_type text,

  -- 이메일 신뢰도 1~5 (손글씨 판독·추측 여부). 낮으면 발송 보류 판단에 쓴다.
  add column if not exists email_quality smallint,

  -- 이메일 검증 상태: unverified / valid / invalid / bounced / hold
  -- 'hold' = 발송 보류(브리프 L항 '[확인 필요]', LEAD-6 가져오기가 표시한다)
  add column if not exists email_status text,

  -- 내부 메모(자유). 활동 기록(lead_activities)과 다르다 — 메모는 현재 상태 요약,
  -- 활동 기록은 지우지 않는 원장이다.
  add column if not exists notes text;

-- 값이 있을 때만 검사하는 CHECK (기존 행을 막지 않는다)
alter table public.campaign_leads drop constraint if exists campaign_leads_segment_check;
alter table public.campaign_leads
  add constraint campaign_leads_segment_check
  check (segment is null or segment in ('A', 'B', 'C', 'D', 'E'));

alter table public.campaign_leads drop constraint if exists campaign_leads_probability_check;
alter table public.campaign_leads
  add constraint campaign_leads_probability_check
  check (probability is null or (probability >= 1 and probability <= 5));

alter table public.campaign_leads drop constraint if exists campaign_leads_email_quality_check;
alter table public.campaign_leads
  add constraint campaign_leads_email_quality_check
  check (email_quality is null or (email_quality >= 1 and email_quality <= 5));

alter table public.campaign_leads drop constraint if exists campaign_leads_email_status_check;
alter table public.campaign_leads
  add constraint campaign_leads_email_status_check
  check (email_status is null or email_status in ('unverified', 'valid', 'invalid', 'bounced', 'hold'));

alter table public.campaign_leads drop constraint if exists campaign_leads_source_type_check;
alter table public.campaign_leads
  add constraint campaign_leads_source_type_check
  check (source_type is null or source_type in ('exhibition', 'coldmail', 'partner', 'qr', 'other'));

-- 목록 정렬·필터용
create index if not exists idx_campaign_leads_probability
  on public.campaign_leads (probability desc nulls last);
create index if not exists idx_campaign_leads_country
  on public.campaign_leads (country);
create index if not exists idx_campaign_leads_event
  on public.campaign_leads (event_name);
