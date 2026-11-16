-- ⚠️ 미적용. LEAD-S1 ④ — 쓸 수 있는 사실 + 변경 로그
-- ============================================================================
-- 롤백   : audit/rollback_lead_s1_outreach_facts.sql
-- 드라이런: audit/dryrun_lead_s1_outreach_facts.sql
-- 시드   : audit/seed_outreach_facts.sql  (마이그레이션이 아니다 — 제시카가 적용)
--
-- 왜 표로 두나
--   회사가 메일에서 말할 수 있는 사실은 **확정과 미정이 섞여 있다**
--   (보드게임 가격은 확정이지만 재고·배송은 미정, EdLink 는 "준비 중"까지만 가능).
--   코드에 상수로 박으면 바뀌었을 때 **이미 나간 메일을 되돌릴 수 없다.**
--
-- facts 는 **고칠 수 있다**(문장·주의·상태). 대신 상태가 바뀌면 log 에 한 줄 남는다.
-- log 는 이력이라 **INSERT 만** 허용한다.
-- ============================================================================

create table if not exists public.outreach_facts (
  id            uuid primary key default gen_random_uuid(),
  -- 코드에서 가리킬 이름(board_game_sale 등). 사람이 읽는 label 과 따로 둔다.
  fact_key      text not null,
  label_ko      text not null,

  -- 영어 메일에 **그대로 붙여 쓸 수 있는** 문장. 번역하지 않고 쓰도록 완성형으로 둔다.
  statement_en  text,
  statement_ko  text,

  status        text not null default 'pending',
  -- ⚠️ 말하면 안 되는 범위. 이것이 이 표의 핵심이다 —
  --    "확정" 사실에도 넘지 말아야 할 선이 있다(예: EdLink 는 '준비 중'까지만).
  caveat        text,
  source        text,          -- 출처('James 2026-11-17' 등)

  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create unique index if not exists uq_outreach_facts_key
  on public.outreach_facts (fact_key);

alter table public.outreach_facts drop constraint if exists outreach_facts_status_check;
alter table public.outreach_facts
  add constraint outreach_facts_status_check
  check (status in ('confirmed', 'pending', 'retired'));

-- ── 상태 변경 로그 (INSERT 만) ──
create table if not exists public.outreach_fact_log (
  id          uuid primary key default gen_random_uuid(),
  fact_id     uuid not null references public.outreach_facts(id) on delete restrict,

  old_status  text,
  new_status  text,
  note        text,

  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create index if not exists idx_outreach_fact_log_fact
  on public.outreach_fact_log (fact_id, changed_at desc);

-- ── 보안 ──
alter table public.outreach_facts    enable row level security;
alter table public.outreach_fact_log enable row level security;

drop policy if exists "outreach_facts_admin" on public.outreach_facts;
create policy "outreach_facts_admin"
  on public.outreach_facts for all to authenticated
  using ( public.app_is_admin() ) with check ( public.app_is_admin() );

drop policy if exists "outreach_fact_log_admin" on public.outreach_fact_log;
create policy "outreach_fact_log_admin"
  on public.outreach_fact_log for all to authenticated
  using ( public.app_is_admin() ) with check ( public.app_is_admin() );

-- 사실은 지우지 않는다 — 쓰지 않게 되면 status='retired' 로 둔다.
-- (지우면 그 사실을 근거로 삼은 전략의 fact_ids 가 가리킬 곳을 잃는다.)
drop policy if exists "outreach_facts_no_delete" on public.outreach_facts;
create policy "outreach_facts_no_delete"
  on public.outreach_facts as restrictive for delete to authenticated using ( false );

drop policy if exists "outreach_fact_log_no_delete" on public.outreach_fact_log;
create policy "outreach_fact_log_no_delete"
  on public.outreach_fact_log as restrictive for delete to authenticated using ( false );

drop policy if exists "outreach_fact_log_no_update" on public.outreach_fact_log;
create policy "outreach_fact_log_no_update"
  on public.outreach_fact_log as restrictive for update to authenticated using ( false );

revoke all on public.outreach_facts    from anon;
revoke all on public.outreach_facts    from public;
revoke all on public.outreach_fact_log from anon;
revoke all on public.outreach_fact_log from public;

grant select, insert, update on public.outreach_facts    to authenticated;
grant select, insert         on public.outreach_fact_log to authenticated;
