-- ⚠️ 미적용. HARD-B1 1순위. 선행: 20261117000000_b1_role_helper.sql
-- ============================================================
-- user_profiles — "로그인한 모두에게 전부" 를 닫는다
-- ============================================================
-- 롤백   : audit/rollback_b1_user_profiles.sql
-- 드라이런: audit/dryrun_b1_user_profiles.sql
--
-- 지금 상태 (운영본)
--   "Allow all for authenticated"  ALL / {authenticated} / USING(true) / WITH CHECK(true)
--   → **로그인한 누구나 전 계정의 프로필을 읽고 쓴다.** 외부 파트너 계정도 포함된다
--     (2026-11-16 제시카가 partner_member 토큰으로 전 계정이 보이는 것을 확인).
--     이메일·역할·partner_id 가 그대로 노출되고, 남의 role 을 바꿀 수도 있다.
--
-- 바꾸는 것
--   SELECT  : 본인 행 + admin·sub_admin 전체
--   INSERT  : admin·sub_admin 만      (브라우저 직접 INSERT 는 0건 — admin-auth 경유)
--   DELETE  : admin·sub_admin 만      (〃)
--   UPDATE  : **본인 행 + admin·sub_admin**  ← 아래 "남는 구멍" 참고
--
-- 코드로 확인한 것 (브라우저에서 user_profiles 를 건드리는 곳 전부)
--   · AuthContext.tsx:64   select('*').eq('id', userId).single()   → **본인 읽기**  ✅ 허용됨
--   · AuthContext.tsx:212  update({is_first_login,status}).eq('id', currentUser.id)
--                                                          → **본인 쓰기**  ✅ 허용됨
--   · Users.tsx:165        select('*') 목록                 → admin 화면     ✅ admin 허용
--   · Partners.tsx:412     select(...).eq('partner_id', …)  → admin 화면     ✅ admin 허용
--   · Users.tsx:254·Partners.tsx:480 의 **쓰기는 admin-auth(service_role) 경유**로
--     이미 전환됐다(021-8b-1). service_role 은 RLS 를 우회하므로 영향 없다.
--   · 엣지 함수 5개(admin-auth·admin-issue-coupon·partner-issue-license·
--     partner-revoke-license·send-email-authed)는 전부 SERVICE_ROLE → 영향 없음.
--
-- ⚠️ 남는 구멍 (2차에서 닫는다)
--   UPDATE 를 "본인 행" 까지 허용하므로, 로그인한 사용자가 REST 로 **자기 role 을
--   admin 으로 바꿀 수** 있다. 지금도 가능한 일이고(오히려 지금은 **남의** role 도 바꾼다),
--   이번 변경으로 "남의 계정 수정" 은 막히지만 "자기 승격" 은 남는다.
--   완전히 닫으려면 둘 중 하나가 필요하다 —
--     (가) AuthContext.tsx:212 의 자가 UPDATE 를 admin-auth 경유로 옮긴 뒤
--          UPDATE 도 admin 전용으로 좁힌다  ← **추천**(021-8b-1 과 같은 방식, 코드 변경 필요)
--     (나) BEFORE UPDATE 트리거로 role·partner_id 변경을 막는다
--          (service_role 예외 처리를 반드시 넣어야 admin-auth 가 안 깨진다)
--   이 단위는 코드를 바꾸지 않으므로 (가)를 2차 선행 조건으로 남긴다.
-- ============================================================

drop policy if exists "Allow all for authenticated" on public.user_profiles;

create policy "b1_user_profiles_select"
  on public.user_profiles for select to authenticated
  using ( id = auth.uid() or public.app_is_admin() );

create policy "b1_user_profiles_insert"
  on public.user_profiles for insert to authenticated
  with check ( public.app_is_admin() );

create policy "b1_user_profiles_update"
  on public.user_profiles for update to authenticated
  using      ( id = auth.uid() or public.app_is_admin() )
  with check ( id = auth.uid() or public.app_is_admin() );

create policy "b1_user_profiles_delete"
  on public.user_profiles for delete to authenticated
  using ( public.app_is_admin() );
