-- ⚠️ 미적용. LEAD-S7-3 fix1 — 파트너가 발급 원장을 고치지 못하게 막는다
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_3_fix1_licenses.sql
-- 드라이런: audit/dryrun_lead_s7_3_fix1_licenses.sql
-- 선행   : 없음 (이 파일을 **S7-3 마이그레이션보다 먼저** 적용한다 — 아래 참고)
--
-- 무엇이 잘못됐나 (제시카 검토, 2026-11-17)
--   `partner_licenses` 의 정책은 `partner_scoped_partner_licenses` **FOR ALL** 하나뿐이고,
--   테이블 권한은 `authenticated` 에 **arwdDxtm(전권)**, 게다가 **anon 에도 전권**이 남아 있다.
--   그래서 파트너 계정이 자기 로그인 토큰으로 자기 발급 줄을 마음대로 고칠 수 있다.
--
--   S7-3 이후 이 표가 **발급 한도(잔량)를 정한다**. 그러면 이렇게 뚫린다:
--     · 자기 줄을 DELETE → 잔량이 되살아난다
--     · seat_months 를 0 으로, status 를 'failed' 로 UPDATE → 잔량이 되살아난다
--     · contract_id 를 바꿔 다른 계약의 잔량을 먹이거나 피한다
--     · 자기 줄을 INSERT 해 다른 계약에 가짜 소비를 만든다
--   **S7-3 함수를 배포하기 전에 이것을 먼저 적용해야 한다.**
--
-- 포털이 정당하게 쓰는 것 (깨면 안 된다 — src 전체를 뒤져 확인했다)
--   src/lib/partner-licenses.ts 의 PATCH 세 군데, 칸은 **둘뿐**이다:
--     ① issueLicense        → email_sent
--     ② resendLicenseEmail  → email_sent
--     ③ setLicenseBuyer     → partner_deal_buyer_id
--   POST·DELETE 는 **한 군데도 없다.** 발급·회수·만료는 전부 엣지 함수(service_role)다.
--
-- 왜 정책만으로 안 되고 트리거가 필요한가
--   RLS 는 "어느 **행**을 고칠 수 있는가"만 정한다. "어느 **칸**을 고칠 수 있는가"는
--   정하지 못한다. 파트너가 자기 행을 고칠 수 있어야 하므로(email_sent),
--   칸 단위 보호는 트리거로만 가능하다.
--
--   허용 목록 방식이다 — **새 칸이 생기면 기본이 "막힘"** 이다. 거부 목록이면
--   칸을 더할 때마다 여기도 고쳐야 하고, 잊으면 그게 구멍이 된다.
-- ============================================================================

-- ── 1) 넓은 FOR ALL 정책을 넷으로 나눈다 ──
--
-- partners 표가 이미 쓰는 올바른 모양을 따른다(authenticated_read_own_partner +
-- admin_insert/update/delete_partners). S7-1 fix1 에서 베껴야 했던 그 모양이다.

alter table public.partner_licenses enable row level security;

-- 읽기: 자기 것 또는 admin·sub_admin (지금과 같다 — 포털이 자기 발급을 본다)
drop policy if exists "partner_licenses_select" on public.partner_licenses;
create policy "partner_licenses_select"
  on public.partner_licenses
  for select
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 넣기: **admin·sub_admin 만.** 파트너가 직접 발급 줄을 만들 길은 없다
--       (진짜 발급은 엣지 함수가 service_role 로 넣는다 — RLS 를 지나간다).
drop policy if exists "partner_licenses_admin_insert" on public.partner_licenses;
create policy "partner_licenses_admin_insert"
  on public.partner_licenses
  for insert
  to authenticated
  with check (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 고치기: 자기 것 또는 admin. **어느 칸을 고칠 수 있는지는 아래 트리거가 정한다.**
drop policy if exists "partner_licenses_update" on public.partner_licenses;
create policy "partner_licenses_update"
  on public.partner_licenses
  for update
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 지우기: **아무도 못 한다.** 원장이고, 지우면 그만큼 잔량이 되살아난다.
--   화면·엣지 함수 어디에도 DELETE 가 없다(전수 확인). 회수는 revoked_at 표시다.
--   `to public` 이라 anon 까지 덮는다 — 나중에 누가 권한을 다시 줘도 막힌다.
--   service_role·postgres 는 RLS 를 지나가므로 비상시 SQL 로는 여전히 가능하다.
drop policy if exists "partner_licenses_no_delete" on public.partner_licenses;
create policy "partner_licenses_no_delete"
  on public.partner_licenses as restrictive for delete to public using ( false );

-- 옛 FOR ALL 정책을 **마지막에** 지운다.
--   PERMISSIVE 정책은 OR 로 합쳐지므로, 새 정책을 먼저 만들어 두면
--   이 줄을 돌리는 순간에도 접근이 끊기지 않는다.
drop policy if exists "partner_scoped_partner_licenses" on public.partner_licenses;

-- ── 2) 칸 단위 보호 트리거 ──

-- ⚠️ fix2: **`security definer` 를 쓰지 않는다.**
--
--    처음에는 `security definer` + `if current_user <> 'authenticated'` 로 썼다.
--    그런데 **security definer 함수 안에서 `current_user` 는 호출자가 아니라
--    함수 소유자(postgres)** 다. 그래서 그 분기에 **항상** 걸려 무조건 통과했고,
--    트리거가 아무것도 막지 못했다(제시카가 운영 드라이런으로 잡았다 —
--    문자열 시험은 구문만 보므로 이것을 잡지 못한다).
--
--    고치는 길은 둘이었다:
--      ① `security definer` 를 두고 `current_setting('role', true)` 로 호출자를 본다
--      ② `security definer` 를 **없앤다**(기본 invoker) → `current_user` 가 진짜 호출자다
--    ②를 골랐다. 이유:
--      · 더 단순하다. 판별 값이 하나뿐이고, "소유자 권한으로 돈다"는 위험 자체가 없다.
--      · 읽어야 하는 것은 **자기 프로필 한 줄**뿐이고, `user_profiles` 의 SELECT 정책이
--        `(id = auth.uid()) or app_is_admin()` 이라 **파트너도 admin 도 자기 행을 읽는다**
--        (운영에서 확인). definer 권한이 필요 없다.
--      · service_role 은 RLS 를 지나가므로 그쪽도 문제없다 —
--        애초에 `current_user <> 'authenticated'` 에서 먼저 통과한다.
--
--    `set search_path` 는 definer 가 아니어도 남겨 둔다(스키마를 명시해도 습관으로 둔다).
create or replace function public.partner_licenses_guard_partner_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid;
  v_role text;
begin
  -- 로그인한 사람이 아니면 통과한다.
  --   · PostgREST 는 키에 따라 역할을 바꾼다: anon / authenticated / service_role.
  --   · 엣지 함수는 service_role, SQL 편집기는 postgres 다.
  --   **invoker 라서** 여기의 current_user 가 진짜 호출자다(definer 면 소유자가 된다).
  if current_user <> 'authenticated' then
    return new;
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    return new;
  end if;

  select up.role into v_role
    from public.user_profiles up
   where up.id = v_uid;

  if v_role = any (array['admin', 'sub_admin']) then
    return new;
  end if;

  -- 여기부터는 파트너 계정이다. **허용 칸 말고 바뀐 것이 있으면 거절한다.**
  --   jsonb 로 통째로 견주되, 허용 칸만 빼고 비교한다 →
  --   나중에 칸이 더해져도 **자동으로 막힌다**(허용 목록 방식).
  if (to_jsonb(new) - 'email_sent' - 'partner_deal_buyer_id')
       is distinct from
     (to_jsonb(old) - 'email_sent' - 'partner_deal_buyer_id')
  then
    raise exception
      '발급 기록에서 고칠 수 있는 것은 이메일 발송 표시와 구매자 연결뿐입니다.'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  return new;
end;
$$;

revoke all on function public.partner_licenses_guard_partner_update() from public;
revoke all on function public.partner_licenses_guard_partner_update() from anon;
revoke all on function public.partner_licenses_guard_partner_update() from authenticated;

drop trigger if exists trg_partner_licenses_guard_update on public.partner_licenses;
create trigger trg_partner_licenses_guard_update
  before update on public.partner_licenses
  for each row
  execute function public.partner_licenses_guard_partner_update();

-- ── 3) 권한 정리 ──
--
-- ⚠️ 운영 ACL 을 읽어 보니 **anon 에 전권(arwdDxtm)** 이 남아 있었다.
--    지금은 RLS 가 막고 있지만(정책이 to authenticated 뿐), 권한이 남아 있으면
--    나중에 anon 정책이 하나라도 생기는 순간 전부 열린다.
revoke all on public.partner_licenses from anon;
revoke all on public.partner_licenses from public;

-- authenticated 에는 DELETE 를 주지 않는다. 정책(restrictive)과 **두 겹**으로 막는다.
revoke delete on public.partner_licenses from authenticated;
grant select, insert, update on public.partner_licenses to authenticated;

comment on function public.partner_licenses_guard_partner_update() is
  'LEAD-S7-3 fix1/fix2. 파트너 계정은 email_sent·partner_deal_buyer_id 만 고칠 수 있다. 허용 목록 방식이라 새 칸은 기본이 막힘. service_role·admin 은 통과. security invoker 다 — definer 로 바꾸면 current_user 가 소유자가 되어 아무것도 막지 못한다.';
