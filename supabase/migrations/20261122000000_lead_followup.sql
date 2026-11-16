-- ⚠️ 미적용. LEAD-4 (CRM-013) — 팔로업 단계·활동 기록 (James 최우선)
-- ============================================================================
-- 롤백   : audit/rollback_lead4.sql
-- 드라이런: audit/dryrun_lead4.sql
-- 선행   : 20261120000000_lead_market_mode.sql · 20261121000000_lead_intl_fields.sql
--          20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 브리프 G항. 리드마다 "누가 언제 무엇을 했고, 다음에 무엇을 언제 해야 하는지"를 남긴다.
--
-- 두 부분
--   ① campaign_leads 에 **현재 상태** 칸 (단계·마지막 접촉·다음 행동·기한·담당자·종료 사유)
--   ② 새 테이블 lead_activities — **지우지 않고 쌓는 원장**
--
-- ⚠️ 보안 (명령서 지시): 새 테이블은 RLS 를 켜고 **authenticated 정책만** 둔다.
--    anon 정책·anon GRANT 를 만들지 않고, 명시적 REVOKE 도 쓴다.
--    파트너 접근은 이번 체인에서 만들지 않는다(필요해지면 정책을 **더하면** 된다).
--
-- ⚠️ followup_stage 에 CHECK 를 걸지 않는다. CRM-015 가 유형별 단계 목록을 더할 예정이라
--    (브리프 H항) DB 에 값을 못 박으면 그때 ALTER 가 필요해진다. 허용값은 코드 상수
--    (src/lib/leadFollowup.ts)로 고정하고 테스트로 지킨다.
-- ============================================================================

-- ── ① 현재 상태 칸 ──
alter table public.campaign_leads
  add column if not exists followup_stage text,

  -- 마지막 접촉일. 활동 기록에서 **파생**되는 값이지만 칸으로 둔다 —
  -- "7일 넘게 접촉 없음" 목록을 매번 원장 전체를 훑어 계산하면 느리다.
  -- 활동 기록을 넣을 때 앱이 같이 갱신한다(src/lib/leadFollowup.ts 한 곳).
  add column if not exists last_contact_at timestamptz,

  add column if not exists next_action text,
  add column if not exists next_action_due date,

  -- 담당자는 사용자 FK 가 아니라 **표시 이름**이다. 제시카·외부 직원도 담당이 될 수 있고
  -- (브리프 G항 "James/제시카/직원"), FK 를 걸면 계정 없는 사람을 적을 수 없다.
  add column if not exists owner text,

  -- 종료 사유. 단계가 '종료'일 때 필수라는 규칙은 앱이 지킨다(DB CHECK 로 걸면
  -- 기존 행과 단계 목록 확장에 걸린다).
  add column if not exists close_reason text;

-- "오늘 할 팔로업"·"7일 넘게 접촉 없음" 목록용
create index if not exists idx_campaign_leads_next_due
  on public.campaign_leads (next_action_due) where next_action_due is not null;
create index if not exists idx_campaign_leads_last_contact
  on public.campaign_leads (last_contact_at);
create index if not exists idx_campaign_leads_stage
  on public.campaign_leads (followup_stage);
create index if not exists idx_campaign_leads_owner
  on public.campaign_leads (owner);

-- ── ② 활동 기록 원장 ──
create table if not exists public.lead_activities (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.campaign_leads(id) on delete cascade,

  occurred_at   timestamptz not null default now(),
  channel       text not null,          -- email | whatsapp | linkedin | phone | meeting | other
  direction     text not null,          -- out(보냄) | in(받음)
  summary       text not null,          -- 한 줄 요약

  stage_after   text,                   -- 이 기록으로 바뀐 단계(안 바꾸면 null)

  -- 기록한 사람. 표시 이름과 로그인 id 를 따로 둔다 — 제시카·직원이 대신 적을 수 있다.
  actor         text,
  actor_user_id uuid,

  -- 지우지 않는다. 잘못 적었으면 이 두 칸으로 **표시만** 한다
  -- (partner_licenses 의 revoked_at 과 같은 원칙).
  voided_at     timestamptz,
  void_reason   text,

  -- 가져오기로 만든 기록 식별(되돌리기)
  import_batch_id uuid,

  created_at    timestamptz not null default now()
);

alter table public.lead_activities drop constraint if exists lead_activities_channel_check;
alter table public.lead_activities
  add constraint lead_activities_channel_check
  check (channel in ('email', 'whatsapp', 'linkedin', 'phone', 'meeting', 'other'));

alter table public.lead_activities drop constraint if exists lead_activities_direction_check;
alter table public.lead_activities
  add constraint lead_activities_direction_check
  check (direction in ('out', 'in'));

create index if not exists idx_lead_activities_lead
  on public.lead_activities (lead_id, occurred_at desc);
create index if not exists idx_lead_activities_batch
  on public.lead_activities (import_batch_id) where import_batch_id is not null;

-- ── ③ 보안: RLS + authenticated 전용 정책 + anon REVOKE ──
alter table public.lead_activities enable row level security;

-- 관리자·부관리자만. app_is_admin() 은 ('admin','sub_admin') 을 본다(B1, 운영 적용됨).
drop policy if exists "lead_activities_admin" on public.lead_activities;
create policy "lead_activities_admin"
  on public.lead_activities for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );

-- **원장은 지우지 않는다.** DELETE 를 막는 RESTRICTIVE 정책을 둔다.
-- (PERMISSIVE 정책이 여러 개면 OR 로 합쳐지지만, RESTRICTIVE 는 AND 로 걸리므로
--  나중에 누가 PERMISSIVE 정책을 더해도 DELETE 는 계속 막힌다.)
-- 리드가 지워지면 ON DELETE CASCADE 로 함께 사라지는 것은 DB 수준 동작이라
-- 이 정책의 영향을 받지 않는다.
drop policy if exists "lead_activities_no_delete" on public.lead_activities;
create policy "lead_activities_no_delete"
  on public.lead_activities as restrictive for delete to authenticated
  using ( false );

-- anon 에게는 아무 권한도 주지 않는다 (명령서 지시: 명시적 REVOKE)
revoke all on public.lead_activities from anon;
revoke all on public.lead_activities from public;

-- authenticated 는 RLS 아래에서만 동작한다
grant select, insert, update on public.lead_activities to authenticated;
