-- ⚠️ 미적용. LEAD-S7-6 — 해외 파트너 등록 진행 상태
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_6_onboarding.sql
-- 드라이런: audit/dryrun_lead_s7_6_onboarding.sql
--
-- 왜 필요한가 (브리프 K항)
--   튀르키예는 **등록하다가 중간에 멈췄다.** 한 번에 다 입력해야 하는 구조라서다.
--   한 단계씩 저장하려면 "어디까지 했는지"를 둘 자리가 필요하다.
--
-- **기존 15곳은 그대로다.**
--   `onboarding_status` 가 NULL 이면 **완료로 본다**(옛 행은 다 들어와 있다).
--   초안을 새로 만들 때만 'draft' 를 넣는다. 그래서 백필이 필요 없다.
--
-- 초안은 **발급 권한·포털 로그인이 켜지지 않는다.**
--   그 판정은 `can_issue_licenses`(기존 칸)와 계정 유무로 이미 갈린다 —
--   여기서 새로 막는 것이 아니라, 마법사가 **완료 전까지 그 칸들을 켜지 않는다.**
--   (칸을 하나 더 만들어 두 군데서 막으면 어느 쪽이 참인지 알 수 없게 된다.)
--
-- 테이블을 다시 쓰지 않는다: 기본값 없는 칸을 더하는 것이라 메타데이터만 바뀐다.
-- ============================================================================

alter table public.partners
  add column if not exists onboarding_status text,
  add column if not exists onboarding_steps jsonb;

alter table public.partners drop constraint if exists partners_onboarding_status_check;
alter table public.partners
  add constraint partners_onboarding_status_check
  check (onboarding_status is null or onboarding_status in ('draft', 'done'));

-- 중간에 멈춘 파트너를 한눈에 — 목록이 이 인덱스로 찾는다.
create index if not exists idx_partners_onboarding
  on public.partners (onboarding_status) where onboarding_status = 'draft';

comment on column public.partners.onboarding_status is
  'LEAD-S7-6. NULL = 등록 마법사 이전에 들어온 기존 파트너(완료로 본다). draft = 작성 중. done = 마법사로 끝냄.';
comment on column public.partners.onboarding_steps is
  'LEAD-S7-6. 단계별로 끝낸 표시 {"1":true,...}. 화면이 "몇 단계 중 몇"을 보여 주는 데 쓴다. 개인정보는 넣지 않는다.';
