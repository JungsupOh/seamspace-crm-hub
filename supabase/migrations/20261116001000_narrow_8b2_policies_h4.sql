-- ⚠️ 미적용. **파트너 포털 전환이 배포되고 동작을 확인한 뒤** 적용 (HARD-A H-4)
-- ============================================================
-- 021-8b-2 에서 넣은 "로그인한 아무나" 정책을 관리자·파트너 범위로 좁힌다
-- ============================================================
-- 근거   : audit/h4_partner_portal.md §D
-- 롤백   : audit/rollback_h4_narrow_8b2.sql
-- 드라이런: audit/dryrun_h4_narrow_8b2.sql
-- 선행   : 20261116000000_partner_scoped_policies_h4.sql 이 **먼저** 적용돼 있어야 한다.
--
-- 무엇이 문제인가
--   021-8b-2 는 관리자 화면을 로그인 토큰으로 전환하려고 아래 정책을 넣었다:
--       deal_files        ALL  to authenticated  using(true)
--       partner_licenses  ALL  to authenticated  using(true)
--       partners          INSERT/UPDATE/DELETE to authenticated  using(true)
--   그때는 CRM 에 로그인하는 계정이 admin 2 · sub_admin 3 뿐이었다(guest 0).
--   그런데 HARD-A H-4 로 **외부 파트너 계정도 로그인 토큰을 쓰게** 된다.
--   `to authenticated using(true)` 는 그 파트너에게도 그대로 열린다 —
--   파트너가 REST 를 직접 불러 **남의 이용권을 고치거나 파트너를 지울 수** 있다.
--
-- 무엇을 바꾸나
--   · deal_files        → admin·sub_admin 전용 (포털은 이 테이블을 쓰지 않는다)
--   · partners  I/U/D   → admin·sub_admin 전용 (포털은 partners 를 쓰지 않는다. 읽기는
--                          기존 authenticated_read_own_partner 가 그대로 담당)
--   · partner_licenses  → 021-8b-2 의 넓은 정책을 제거한다. 포털에 필요한 접근은
--                          partner_scoped_partner_licenses(선행 마이그레이션)가 준다.
--
--   기존 anon 정책은 **건드리지 않는다**(제거는 021-8i). 그래서 이 파일을 적용해도
--   공개 키로 도는 경로는 그대로이고, 줄어드는 것은 "로그인한 파트너의 과잉 권한"뿐이다.
--
-- ⚠️ 적용 순서를 틀리면 관리자 화면이 깨진다
--   이 파일은 관리자 화면이 **이미 로그인 토큰으로 배포된 뒤**에 적용해야 한다
--   (021-8b-4 는 커밋됐지만 배포 상태를 확인할 것). admin·sub_admin 은 계속 통과한다.
-- ============================================================

-- ── deal_files: 관리자 전용으로 교체 ───────────────────────
drop policy if exists "authenticated_all_deal_files" on public.deal_files;

create policy "admin_all_deal_files"
  on public.deal_files
  for all
  to authenticated
  using (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- ── partners 쓰기: 관리자 전용으로 교체 ────────────────────
drop policy if exists "authenticated_insert_partners" on public.partners;
drop policy if exists "authenticated_update_partners" on public.partners;
drop policy if exists "authenticated_delete_partners" on public.partners;

create policy "admin_insert_partners"
  on public.partners
  for insert
  to authenticated
  with check (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

create policy "admin_update_partners"
  on public.partners
  for update
  to authenticated
  using (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

create policy "admin_delete_partners"
  on public.partners
  for delete
  to authenticated
  using (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- ── partner_licenses: 넓은 정책 제거 (파트너 범위 정책이 대신한다) ──
-- 선행 마이그레이션의 partner_scoped_partner_licenses 가 없으면 포털과 관리자 화면이
-- 모두 막힌다. 적용 전에 그 정책이 있는지 반드시 확인할 것.
drop policy if exists "authenticated_all_partner_licenses" on public.partner_licenses;
