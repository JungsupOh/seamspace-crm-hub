-- ⚠️ 미적용. LEAD-S1 ①② — 관심 신호 · 조사 메모
-- ============================================================================
-- 롤백   : audit/rollback_lead_s1_signals_research.sql
-- 드라이런: audit/dryrun_lead_s1_signals_research.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 둘 다 **이력성 표(원장)** 다. 전략을 세운 근거이므로 지우면 전략을 읽을 수 없다.
--   · 삭제 불가(restrictive delete 정책 using(false), authenticated 에 DELETE 권한 없음)
--   · 정정은 **새 줄 + 이전 줄 취소 표시**(voided_at·void_reason)
--   · FK 는 `on delete restrict` — 리드를 지우려 하면 **막힌다**(이력 보호).
--     기존 lead_activities 의 cascade 는 건드리지 않는다(공통 규칙).
-- ============================================================================

-- ── ① 관심 신호 ──
create table if not exists public.lead_signals (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.campaign_leads(id) on delete restrict,

  -- 현장에서 들은 말·행동의 종류. 규칙이 아니라 **기록**이다.
  signal_type  text not null,
  note         text,                      -- 한 줄 메모(자유)
  source       text not null default 'field',
  observed_at  date not null default current_date,

  created_by   uuid,
  created_at   timestamptz not null default now(),

  voided_at    timestamptz,
  void_reason  text
);

alter table public.lead_signals drop constraint if exists lead_signals_type_check;
alter table public.lead_signals
  add constraint lead_signals_type_check check (signal_type in (
    'board_game', 'pricing', 'lms', 'special_ed', 'language',
    'pilot', 'partnership', 'trial', 'demo', 'other'));

alter table public.lead_signals drop constraint if exists lead_signals_source_check;
alter table public.lead_signals
  add constraint lead_signals_source_check check (source in (
    'field', 'badge', 'trial', 'email', 'research', 'other'));

create index if not exists idx_lead_signals_lead
  on public.lead_signals (lead_id, observed_at desc);

-- ── ② 조사 메모 ──
create table if not exists public.lead_research_notes (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.campaign_leads(id) on delete restrict,

  title         text not null,
  body          text,
  source_label  text,                     -- 출처 이름(기관 홈페이지 · 뉴스 등)
  source_url    text,                     -- 근거 링크
  -- 누가 찾았는지(표시용). 제시카처럼 로그인 계정이 없을 수도 있어 FK 가 아니다.
  collected_by  text,

  created_by    uuid,
  created_at    timestamptz not null default now(),

  voided_at     timestamptz,
  void_reason   text
);

create index if not exists idx_lead_research_lead
  on public.lead_research_notes (lead_id, created_at desc);

-- ── 보안 (두 표 같은 규칙) ──
alter table public.lead_signals        enable row level security;
alter table public.lead_research_notes enable row level security;

drop policy if exists "lead_signals_admin" on public.lead_signals;
create policy "lead_signals_admin"
  on public.lead_signals for all to authenticated
  using ( public.app_is_admin() ) with check ( public.app_is_admin() );

drop policy if exists "lead_research_notes_admin" on public.lead_research_notes;
create policy "lead_research_notes_admin"
  on public.lead_research_notes for all to authenticated
  using ( public.app_is_admin() ) with check ( public.app_is_admin() );

-- 원장이라 지울 수 없다. RESTRICTIVE 라 나중에 PERMISSIVE 정책을 더해도 계속 막힌다.
drop policy if exists "lead_signals_no_delete" on public.lead_signals;
create policy "lead_signals_no_delete"
  on public.lead_signals as restrictive for delete to authenticated using ( false );

drop policy if exists "lead_research_notes_no_delete" on public.lead_research_notes;
create policy "lead_research_notes_no_delete"
  on public.lead_research_notes as restrictive for delete to authenticated using ( false );

revoke all on public.lead_signals        from anon;
revoke all on public.lead_signals        from public;
revoke all on public.lead_research_notes from anon;
revoke all on public.lead_research_notes from public;

-- UPDATE 는 **취소 표시(voided_at·void_reason)** 를 쓰기 위해서만 필요하다.
grant select, insert, update on public.lead_signals        to authenticated;
grant select, insert, update on public.lead_research_notes to authenticated;
