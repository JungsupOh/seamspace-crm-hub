-- ⚠️ 미적용. LEAD-S7-5 — 파트너 계정 사건 기록
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_5_audit.sql
-- 드라이런: audit/dryrun_lead_s7_5_audit.sql
-- 선행   : 없음 (partners·user_profiles 는 이미 있다)
--
-- 무엇을 담나 — **계정 관련 사건만**
--   초대 · 비활성화 · 재활성화 · 역할 변경.
--   발급 이력은 `partner_licenses`, 요청은 `partner_requests` 가 이미 그 역할을 한다.
--   한 표에 다 넣으면 "무엇이 기록인가"가 흐려진다.
--
-- 개인정보를 최소로 담는다
--   이메일을 그대로 쓰지 않는다. `meta` 에 **마스킹한 꼴**(ab***@ex***.com)만 넣는다 —
--   누구인지 사람이 알아볼 정도면 충분하고, 기록은 오래 남는다.
--
-- 누가 쓰나
--   **서버(service_role)만 INSERT.** 파트너·관리자 화면은 **읽기만** 한다.
--   고치거나 지울 수 없다(restrictive) — 기록이기 때문이다.
-- ============================================================================

create table if not exists public.partner_audit_log (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete restrict,

  -- 누가 했는가. auth.users 를 참조하지 않는다 — 계정을 지워도 기록은 남아야 한다.
  actor_id      uuid not null,
  actor_role    text not null,

  action        text not null,
  target_user_id uuid,

  -- 개인정보 최소: 마스킹한 이메일·역할 이름 같은 것만.
  meta          jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now()
);

alter table public.partner_audit_log drop constraint if exists partner_audit_log_action_check;
alter table public.partner_audit_log
  add constraint partner_audit_log_action_check
  check (action in ('invite', 'invite_failed', 'deactivate', 'reactivate', 'role_change'));

create index if not exists idx_partner_audit_log_partner
  on public.partner_audit_log (partner_id, created_at desc);

-- ── 보안 ──
alter table public.partner_audit_log enable row level security;

-- 읽기: **파트너 관리자**는 자기 회사 것만, admin·sub_admin 은 전체.
--   partner_member·partner_viewer 에게는 보이지 않는다 — 계정 사건은 관리자 일이다.
drop policy if exists "partner_audit_log_select" on public.partner_audit_log;
create policy "partner_audit_log_select"
  on public.partner_audit_log
  for select
  to authenticated
  using (
    (
      partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
      and (select up.role from public.user_profiles up where up.id = auth.uid()) = 'partner_admin'
    )
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 쓰기: **아무에게도 주지 않는다.** service_role 이 RLS 를 지나가 넣는다.
--   PERMISSIVE INSERT 정책이 없으므로 authenticated 는 기본 거부다.
--   나중에 누가 정책을 하나 더해도 막히도록 restrictive 로 한 번 더 못 박는다.
drop policy if exists "partner_audit_log_no_write" on public.partner_audit_log;
create policy "partner_audit_log_no_write"
  on public.partner_audit_log as restrictive for update to public using ( false );

drop policy if exists "partner_audit_log_no_delete" on public.partner_audit_log;
create policy "partner_audit_log_no_delete"
  on public.partner_audit_log as restrictive for delete to public using ( false );

revoke all on public.partner_audit_log from anon;
revoke all on public.partner_audit_log from public;
-- 읽기만 준다. INSERT·UPDATE·DELETE 는 권한 자체가 없다(정책과 두 겹).
grant select on public.partner_audit_log to authenticated;

comment on table public.partner_audit_log is
  'LEAD-S7-5. 파트너 계정 사건(초대·비활성화·재활성화·역할 변경)만. 서버(service_role)만 넣고 아무도 고치거나 지울 수 없다. meta 의 이메일은 마스킹한다.';
