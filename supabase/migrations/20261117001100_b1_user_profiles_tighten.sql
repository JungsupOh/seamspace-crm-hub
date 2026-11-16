-- ⚠️ 미적용 (제시카 작성, 2026-11-16). 20261117001000_b1_user_profiles.sql 적용 직후에 적용한다.
-- ============================================================
-- user_profiles 보강: "자기 role·partner_id 승격" 구멍을 정책만으로 닫는다
-- ============================================================
-- 근거   : audit/hard_b1_policy_close.md §B-4 (남는 구멍), 코드 확인:
--          · AuthContext.tsx:212 의 본인 UPDATE 는 is_first_login·status 만 바꾼다(role·partner_id 불변).
--          · Users.tsx / Partners.tsx 의 다른 사람 프로필 변경은 전부 admin-auth(service_role) 경유(021-8b-1, H-4).
--          → 브라우저에서 직접 쓰는 정상 경로는 "본인 행의 is_first_login·status" 뿐이다.
-- 변경   : · INSERT / DELETE / 타인 행 UPDATE 는 admin 만 (sub_admin 의 직접 REST 쓰기도 막힌다.
--            sub_admin 의 정상 작업은 admin-auth 가 service_role 로 처리하고 거기서 021-6e 규칙을 지킨다)
--          · 본인 행 UPDATE 는 role·partner_id 가 **바뀌지 않을 때만** 허용
--            (app_current_role()/app_current_partner_id() 는 같은 문장의 시작 시점 스냅샷, 곧 갱신 전 값을 읽는다)
-- 롤백   : audit/rollback_b1_user_profiles_tighten.sql  (B1 원안 정책으로 되돌림)
-- 드라이런: audit/dryrun_b1_user_profiles_tighten.sql
-- 선행   : 20261117000000_b1_role_helper.sql, 20261117001000_b1_user_profiles.sql
-- ============================================================

drop policy if exists "b1_user_profiles_insert" on public.user_profiles;
drop policy if exists "b1_user_profiles_update" on public.user_profiles;
drop policy if exists "b1_user_profiles_delete" on public.user_profiles;

create policy "b1_user_profiles_insert"
  on public.user_profiles for insert to authenticated
  with check ( public.app_current_role() = 'admin' );

create policy "b1_user_profiles_update"
  on public.user_profiles for update to authenticated
  using ( id = auth.uid() or public.app_current_role() = 'admin' )
  with check (
    public.app_current_role() = 'admin'
    or (
      id = auth.uid()
      and role is not distinct from public.app_current_role()
      and partner_id is not distinct from public.app_current_partner_id()
    )
  );

create policy "b1_user_profiles_delete"
  on public.user_profiles for delete to authenticated
  using ( public.app_current_role() = 'admin' );
