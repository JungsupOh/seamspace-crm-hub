-- ⚠️ 미적용. LEAD-S1 ③⑤ — 접근 전략 버전 + 활동 기록에 n차·전략·결과 연결
-- ============================================================================
-- 롤백   : audit/rollback_lead_s1_strategies.sql
-- 드라이런: audit/dryrun_lead_s1_strategies.sql
-- 선행   : 20261126000000_lead_s1_signals_research.sql · b1_role_helper
--
-- 전략은 **덮어쓰지 않고 쌓는다.** 1판·2판·3판이 그대로 남아야
-- "2판으로 3차 접촉했더니 이런 결과였다"를 읽을 수 있다.
--   · **INSERT 만 허용한다** — UPDATE·DELETE 권한을 주지 않는다.
--     고치려면 새 판을 쓴다. 그래서 voided_at 도 없다(취소 대신 새 판).
--   · "현재 전략" = 그 리드의 **가장 큰 version**.
--
-- 같은 파일에 lead_activities 칸 추가를 둔 이유: strategy_id 가 이 표를 가리키는
-- FK 라서 **순서가 보장되어야** 한다. 파일을 나누면 적용 순서를 사람이 지켜야 한다.
-- ============================================================================

create table if not exists public.lead_strategies (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.campaign_leads(id) on delete restrict,

  version     int  not null,

  goal        text,          -- 이번 접촉의 목표 한 줄
  angle       text,          -- 접근 각도
  key_points  text,          -- 핵심 포인트(줄바꿈 목록)
  -- 이 전략이 **써도 되는 사실**(outreach_facts.id 목록).
  -- jsonb 로 둔 이유: uuid[] 는 PostgREST 에서 다루기 번거롭고, 나중에 사실마다
  -- 메모를 붙이게 될 수 있다. FK 를 걸지 않는 대신 앱이 확정 사실만 고르게 막는다.
  fact_ids    jsonb not null default '[]'::jsonb,
  avoid_text  text,          -- 하지 않을 말
  next_contact_plan text,    -- 다음 접촉 계획(채널·시기)
  rationale   text,          -- 왜 이렇게 / 이전 판에서 무엇을 왜 바꿨나

  -- 이 판을 쓰게 만든 접촉 기록(선택).
  -- ⚠️ lead_activities 는 리드 삭제 시 cascade 로 사라지는 기존 표다. 여기서 restrict 를
  --    걸면 그 cascade 가 막혀 기존 동작이 바뀐다. 그래서 이 FK 만 **set null** 이다
  --    (전략 자체는 남고 "무엇 때문에 썼는지" 연결만 끊어진다).
  based_on_activity_id uuid references public.lead_activities(id) on delete set null,

  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- 같은 판이 두 번 생기지 않게. "현재 전략 = 최대 version" 이 흔들리면 안 된다.
create unique index if not exists uq_lead_strategies_version
  on public.lead_strategies (lead_id, version);

alter table public.lead_strategies drop constraint if exists lead_strategies_version_check;
alter table public.lead_strategies
  add constraint lead_strategies_version_check check (version >= 1);

create index if not exists idx_lead_strategies_lead
  on public.lead_strategies (lead_id, version desc);

-- ── 보안 ──
alter table public.lead_strategies enable row level security;

drop policy if exists "lead_strategies_admin" on public.lead_strategies;
create policy "lead_strategies_admin"
  on public.lead_strategies for all to authenticated
  using ( public.app_is_admin() ) with check ( public.app_is_admin() );

-- 쌓기만 한다. UPDATE·DELETE 를 둘 다 막는다(RESTRICTIVE 라 나중에 뚫리지 않는다).
drop policy if exists "lead_strategies_no_delete" on public.lead_strategies;
create policy "lead_strategies_no_delete"
  on public.lead_strategies as restrictive for delete to authenticated using ( false );

drop policy if exists "lead_strategies_no_update" on public.lead_strategies;
create policy "lead_strategies_no_update"
  on public.lead_strategies as restrictive for update to authenticated using ( false );

revoke all on public.lead_strategies from anon;
revoke all on public.lead_strategies from public;

-- UPDATE·DELETE 권한을 **주지 않는다**.
grant select, insert on public.lead_strategies to authenticated;

-- ── ⑤ lead_activities 칸 추가 (추가만) ──
alter table public.lead_activities
  -- 몇 차 접촉인가. 보낸 기록(direction='out')이고 시스템 변경이 아닐 때만 뜻이 있다.
  add column if not exists attempt_no int,
  -- 그때 어느 전략 판으로 보냈는가. 전략은 지울 수 없으므로 restrict 가 안전하다.
  add column if not exists strategy_id uuid references public.lead_strategies(id) on delete restrict,
  add column if not exists outcome text,
  -- 이번에 알게 된 것 — **다음 판의 근거가 된다**.
  add column if not exists learning text;

alter table public.lead_activities drop constraint if exists lead_activities_outcome_check;
alter table public.lead_activities
  add constraint lead_activities_outcome_check check (outcome is null or outcome in (
    'no_reply', 'replied', 'bounced', 'meeting', 'trial_started', 'declined', 'other'));

create index if not exists idx_lead_activities_strategy
  on public.lead_activities (strategy_id) where strategy_id is not null;
