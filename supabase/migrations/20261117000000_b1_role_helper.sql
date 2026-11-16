-- ⚠️ 미적용. HARD-B1 의 **가장 먼저** 적용할 파일 (모든 b1_* 정책이 이 함수를 쓴다)
-- ============================================================
-- 정책에서 쓸 역할 조회 헬퍼 — user_profiles 재귀를 피한다
-- ============================================================
-- 근거   : audit/hard_b1_policy_close.md §B-1
-- 롤백   : audit/rollback_b1_role_helper.sql
-- 드라이런: audit/dryrun_b1_role_helper.sql
--
-- 왜 함수가 필요한가
--   지금까지 쓰던 패턴은 정책 안에서 user_profiles 를 직접 조회한다:
--       (select up.role from public.user_profiles up where up.id = auth.uid())
--   다른 테이블(partners 등)의 정책에서는 문제가 없다. 그러나 **user_profiles 자신의
--   정책**에서 이걸 쓰면 그 조회가 다시 user_profiles 의 정책을 평가해 **무한 재귀**가 된다
--   (Postgres 가 "infinite recursion detected in policy for relation user_profiles" 로 막는다).
--
--   그래서 SECURITY DEFINER 함수로 한 겹 감싼다. 이 함수는 소유자(postgres) 권한으로 돌아
--   RLS 를 거치지 않으므로 재귀가 끊긴다. Supabase 가 권장하는 표준 패턴이다.
--
--   덤으로 성능도 좋아진다 — STABLE 이라 한 쿼리 안에서 한 번만 평가된다.
--   지금은 행마다 서브쿼리가 돌 수 있다(파트너 딜 117행·contacts 1,501행 규모에서 체감된다).
--
-- 안전장치
--   · search_path 를 public 으로 고정한다(SECURITY DEFINER 의 고전적 함정).
--   · 로그인하지 않았으면 auth.uid() 가 null → 함수가 null 을 돌려주고, 정책은 거짓이 된다.
--   · EXECUTE 는 authenticated 에게만 준다. anon 은 부를 이유가 없다.
-- ============================================================

create or replace function public.app_current_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select up.role from public.user_profiles up where up.id = auth.uid()
$$;

comment on function public.app_current_role() is
  'HARD-B1: RLS 정책용 현재 사용자 역할. user_profiles 정책의 재귀를 피하려고 SECURITY DEFINER.';

create or replace function public.app_is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(
    (select up.role from public.user_profiles up where up.id = auth.uid())
      in ('admin', 'sub_admin'),
    false)
$$;

comment on function public.app_is_admin() is
  'HARD-B1: 호출자가 admin 또는 sub_admin 인가. 021-6e 와 같은 기준.';

create or replace function public.app_current_partner_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select up.partner_id from public.user_profiles up where up.id = auth.uid()
$$;

comment on function public.app_current_partner_id() is
  'HARD-B1: 호출자의 소속 파트너 id. H-4 partner_scoped 정책과 같은 기준.';

revoke all on function public.app_current_role()       from public, anon;
revoke all on function public.app_is_admin()           from public, anon;
revoke all on function public.app_current_partner_id() from public, anon;
grant execute on function public.app_current_role()       to authenticated;
grant execute on function public.app_is_admin()           to authenticated;
grant execute on function public.app_current_partner_id() to authenticated;
