-- ⚠️ 미적용. LEAD-UI2 R7 — 메일 참조(CC) 결정 저장
-- ============================================================================
-- 롤백   : audit/rollback_lead_ui2_cc.sql
-- 드라이런: audit/dryrun_lead_ui2_cc.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 무엇인가
--   "이 리드에게 메일을 보낼 때 같은 기관의 누구를 참조(CC)에 넣을지"를 리드마다 저장한다.
--   **발송 기능은 만들지 않는다** — 다음 단위(아웃리치 작업 화면)가 이 결정을 읽어 쓴다.
--
-- 기본값은 **없음**이다. 행이 없으면 CC 하지 않는다 —
-- CC 는 받는 사람끼리 서로의 이메일이 보이는 일이라 자동으로 하면 안 된다.
--
-- ⚠️ 보안(명령서 지시): RLS ON, **admin 전용 정책만**(app_is_admin()),
--    anon·public 에 명시적 REVOKE, anon 에 GRANT 없음.
-- ============================================================================

create table if not exists public.lead_cc_links (
  id          uuid primary key default gen_random_uuid(),

  -- 메일을 받을 사람
  lead_id     uuid not null references public.campaign_leads(id) on delete cascade,
  -- 참조에 넣을 사람
  cc_lead_id  uuid not null references public.campaign_leads(id) on delete cascade,

  decided_at  timestamptz not null default now(),
  decided_by  uuid,                       -- 로그인 사용자 id (actor_user_id 와 같은 뜻)
  note        text,

  created_at  timestamptz not null default now()
);

-- 같은 짝을 두 번 넣지 않는다. 체크를 껐다 켤 때 행을 지우고 다시 넣으므로
-- 중복이 쌓이면 CC 목록에 같은 사람이 두 번 들어간다.
create unique index if not exists uq_lead_cc_links_pair
  on public.lead_cc_links (lead_id, cc_lead_id);

-- 자기 자신을 CC 할 수 없다.
alter table public.lead_cc_links drop constraint if exists lead_cc_links_not_self;
alter table public.lead_cc_links
  add constraint lead_cc_links_not_self check (lead_id <> cc_lead_id);

create index if not exists idx_lead_cc_links_lead
  on public.lead_cc_links (lead_id);

-- ── 보안 ──
alter table public.lead_cc_links enable row level security;

drop policy if exists "lead_cc_links_admin" on public.lead_cc_links;
create policy "lead_cc_links_admin"
  on public.lead_cc_links for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );

-- anon 에게는 아무 권한도 주지 않는다
revoke all on public.lead_cc_links from anon;
revoke all on public.lead_cc_links from public;

-- 이 표는 결정을 **바꿀 수 있어야** 하므로 DELETE 를 허용한다
-- (lead_activities 와 다르다 — 거기는 원장이라 DELETE 를 막았다).
-- 변경 자체는 활동 기록에 "[변경] CC 대상: …" 으로 남으므로 이력은 보존된다.
grant select, insert, update, delete on public.lead_cc_links to authenticated;
