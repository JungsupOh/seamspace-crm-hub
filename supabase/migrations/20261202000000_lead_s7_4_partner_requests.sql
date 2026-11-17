-- ⚠️ 미적용. LEAD-S7-4 — 파트너가 우리에게 보내는 요청(추가 구매·무효화)
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_4_requests.sql
-- 드라이런: audit/dryrun_lead_s7_4_requests.sql
-- 선행   : 20261129000000(partner_contracts) · 20261201000000(licenses.contract_id)
--
-- 왜 **한 표**인가 (요구사항이 근거를 묻는 항목)
--   후보는 둘이었다:
--     ① partner_purchase_requests + partner_revoke_requests — 외래키가 각각 NOT NULL 로
--        깔끔하다. 대신 **정책·권한·삭제 금지·with check 를 두 벌** 써야 한다.
--     ② 한 표에 `kind` 칸 — 외래키 둘이 NULL 허용이 되고 CHECK 로 짝을 맞춰야 한다.
--        대신 **정책이 한 벌**이고, 관리자 화면·엣지 함수도 한 곳이다.
--   ②를 골랐다. 이 프로그램에서 **버그가 난 자리는 전부 정책이었다**
--   (S7-1 fix1: FOR ALL 로 파트너가 금액을 고칠 수 있었다 /
--    S7-3 fix1·fix2: 트리거가 아무것도 막지 않았다).
--   정책 면을 둘로 늘리면 둘 다 맞게 쓸 확률이 낮아진다. 짝 맞춤은 CHECK 가 **DB 에서**
--   보장하므로 사람이 잊을 일이 없다.
--
-- 이 표가 하는 일
--   · 파트너는 **자기 요청만** 넣고 본다. 넣은 뒤에는 **고치지도 지우지도 못한다.**
--   · 처리 상태(`status`)는 **우리만** 바꾼다.
--   · 요청은 감사 기록이다 — 지우지 않는다(요구사항 7: 별도 감사 표를 만들지 않는다).
--
-- ⚠️ 무효화는 **요청까지만**이다. 쿠폰을 실제로 끄는 API 가 없어서
--    (브리프 5항) "껐다"고 오해하지 않게 화면 문구를 분명히 한다.
-- ============================================================================

create table if not exists public.partner_requests (
  id            uuid primary key default gen_random_uuid(),

  -- 어떤 요청인가. 'purchase' = 추가 구매, 'revoke' = 이용권 사용 불가 처리 요청
  kind          text not null,

  partner_id    uuid not null references public.partners(id) on delete restrict,

  -- kind 에 따라 하나만 채운다(아래 CHECK 가 강제).
  contract_id   uuid references public.partner_contracts(id) on delete restrict,
  license_id    uuid references public.partner_licenses(id) on delete restrict,

  -- 추가 구매에서 희망 수량(선택). 인원·개월.
  seat_months   bigint,

  reason        text,
  memo          text,

  status        text not null default 'open',

  -- 누가 보냈는가(계정 단위 기록). auth.users 를 직접 참조하지 않는다 —
  -- 계정을 비활성화해도 이력은 남아야 한다(공통 규칙).
  requested_by  uuid not null,
  requested_at  timestamptz not null default now(),

  handled_by    uuid,
  handled_at    timestamptz,
  handled_note  text
);

-- ── 값의 범위 ──

alter table public.partner_requests drop constraint if exists partner_requests_kind_check;
alter table public.partner_requests
  add constraint partner_requests_kind_check check (kind in ('purchase', 'revoke'));

alter table public.partner_requests drop constraint if exists partner_requests_status_check;
alter table public.partner_requests
  add constraint partner_requests_status_check
  check (status in ('open', 'handled', 'dismissed'));

-- 종류마다 **가리키는 것이 하나씩** 있어야 한다. 사람이 잊어도 DB 가 막는다.
alter table public.partner_requests drop constraint if exists partner_requests_target_check;
alter table public.partner_requests
  add constraint partner_requests_target_check
  check (
    (kind = 'purchase' and contract_id is not null and license_id is null)
    or (kind = 'revoke' and license_id is not null)
  );

-- 희망 수량은 적는다면 1 이상이어야 한다. 비워 둘 수 있다(얼마가 필요한지 모를 수 있다).
alter table public.partner_requests drop constraint if exists partner_requests_seat_check;
alter table public.partner_requests
  add constraint partner_requests_seat_check
  check (seat_months is null or seat_months > 0);

-- 처리했다면 **누가·언제**가 같이 있어야 한다.
alter table public.partner_requests drop constraint if exists partner_requests_handled_check;
alter table public.partner_requests
  add constraint partner_requests_handled_check
  check (
    (status = 'open' and handled_at is null and handled_by is null)
    or (status <> 'open' and handled_at is not null and handled_by is not null)
  );

create index if not exists idx_partner_requests_partner
  on public.partner_requests (partner_id, requested_at desc);

-- 열린 요청을 빨리 찾는다(관리자 배지 · 중복 방지).
create index if not exists idx_partner_requests_open
  on public.partner_requests (status, kind, requested_at desc)
  where status = 'open';

-- 같은 계약에 **열린 추가 구매 요청은 하나만**. 중복 폭주를 DB 가 막는다
-- (엣지 함수도 막지만, 두 요청이 동시에 와도 여기서 걸린다).
create unique index if not exists uniq_partner_requests_open_purchase
  on public.partner_requests (contract_id)
  where kind = 'purchase' and status = 'open';

-- 같은 이용권에 **열린 무효화 요청도 하나만**.
create unique index if not exists uniq_partner_requests_open_revoke
  on public.partner_requests (license_id)
  where kind = 'revoke' and status = 'open';

-- ── 보안 (S7-1 fix1 · S7-2a 와 같은 4개 구조) ──

alter table public.partner_requests enable row level security;

-- 읽기: 자기 파트너의 요청 또는 admin·sub_admin
drop policy if exists "partner_requests_select" on public.partner_requests;
create policy "partner_requests_select"
  on public.partner_requests
  for select
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 넣기: 파트너는 **자기 partner_id 로, 자기 이름으로, open 상태로만** 넣을 수 있다.
--   ⚠️ `requested_by = auth.uid()` 를 강제한다 — 남의 이름으로 요청을 만들 수 없다.
--   ⚠️ `status = 'open'` 을 강제한다 — 스스로 '처리됨'을 만들 수 없다.
--   (엣지 함수는 service_role 이라 이 정책을 지나가지만, 포털이 직접 넣어도 안전하게 둔다.)
drop policy if exists "partner_requests_insert" on public.partner_requests;
create policy "partner_requests_insert"
  on public.partner_requests
  for insert
  to authenticated
  with check (
    (
      partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
      and requested_by = auth.uid()
      and status = 'open'
      and handled_by is null
      and handled_at is null
    )
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 고치기: **admin·sub_admin 만.** 파트너는 보낸 요청을 고칠 수 없다(기록이다).
drop policy if exists "partner_requests_admin_update" on public.partner_requests;
create policy "partner_requests_admin_update"
  on public.partner_requests
  for update
  to authenticated
  using (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 지우기: **아무도 못 한다.** 요청은 감사 기록이다.
--   `to public` 이라 anon 까지 덮는다. service_role·postgres 는 RLS 를 지나간다.
drop policy if exists "partner_requests_no_delete" on public.partner_requests;
create policy "partner_requests_no_delete"
  on public.partner_requests as restrictive for delete to public using ( false );

revoke all on public.partner_requests from anon;
revoke all on public.partner_requests from public;
grant select, insert, update on public.partner_requests to authenticated;

comment on table public.partner_requests is
  'LEAD-S7-4. 파트너가 우리에게 보내는 요청(추가 구매·이용권 사용 불가 처리). 파트너는 자기 것만 넣고 보며 고치거나 지울 수 없다. 종류를 한 표에 둔 이유는 정책 면을 하나로 줄이려는 것이다(이 프로그램의 버그는 모두 정책에서 났다).';
comment on column public.partner_requests.kind is
  'purchase = 추가 구매 요청(contract_id 필요), revoke = 이용권 사용 불가 처리 요청(license_id 필요).';
comment on column public.partner_requests.status is
  'open|handled|dismissed. 파트너는 바꿀 수 없다 — admin 만 바꾼다.';
