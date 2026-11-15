-- ⚠️ 미적용 — admin-auth 수정과 **같은 배포**로, James 확인 후 적용할 것 (021-6d)
-- ============================================================
-- handle_new_user() 하드닝 — 가입 메타데이터로 권한이 정해지지 않게 한다
-- ============================================================
-- 근거   : audit/021-6c_signup_exposure.md §B-2 (안 1)
-- 백업   : audit/backup_handle_new_user_20261115.sql  ← 롤백 원본
-- 롤백   : audit/rollback_handle_new_user_20261115.sql
--
-- 무엇이 문제였나
--   기존 함수는 NEW.raw_user_meta_data->>'role' / ->>'partner_id' 를 그대로
--   user_profiles 에 넣었다. raw_user_meta_data 는 **가입 요청자가 직접 담아 보내는
--   값**이라, 가입만으로 role='admin' 계정이 만들어질 수 있었다.
--   ON CONFLICT DO UPDATE 가 role 까지 덮어써서, 기존 계정의 권한도 바뀔 수 있었다.
--
-- 무엇을 바꾸나
--   1) role 은 **항상 'guest'**. 메타데이터를 읽지 않는다.
--   2) partner_id 는 트리거가 넣지 않는다(NULL).
--   3) ON CONFLICT 에서 role·partner_id 를 **덮지 않는다**. name 만 보완한다.
--   → 권한 부여는 admin-auth 가 호출자 역할을 검사한 뒤에만 한다.
--
-- 기존 계정 영향: 없음. AFTER INSERT ON auth.users 라 **새 가입 때만** 동작한다.
--
-- ⚠️ 단독 적용 금지
--   이 파일만 적용하면 새로 만든 계정이 'guest' 로 남는다.
--   admin-auth 의 createUser 가 생성 직후 프로필에 역할을 넣어 주어야 한다.
--   (021-6d 에서 코드는 준비돼 있으나 역시 미배포)
--
--   참고: 현재 호출부 두 곳은 생성 후 역할을 **이미 따로 기록**한다
--         - src/pages/Users.tsx:255     user_profiles.upsert(... role ...)
--         - src/pages/Partners.tsx:480  admin-auth updateProfile(... role ...)
--         그래서 이 마이그레이션만 적용돼도 화면은 대체로 동작한다. 다만
--         Users.tsx 쪽은 브라우저 anon 키 + 느슨한 RLS 에 기대고 있어
--         (009-10: user_profiles = authenticated ALL true/true),
--         CRM-021 의 RLS 정리 뒤에는 깨진다. 서버 쪽 부여가 정답이다.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public      -- SECURITY DEFINER 함수의 search_path 고정(권고 사항)
AS $function$
BEGIN
  INSERT INTO public.user_profiles (id, email, name, role, is_first_login, status)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name',   -- 이름은 표시용이라 그대로 받는다
    'guest',                           -- ★ 항상 guest. 메타데이터를 믿지 않는다
    TRUE,
    'invited'
  )
  ON CONFLICT (id) DO UPDATE SET
    -- ★ role·partner_id 는 건드리지 않는다. 기존 권한 덮어쓰기 차단.
    name = COALESCE(EXCLUDED.name, user_profiles.name);
  RETURN NEW;
END;
$function$;

-- 트리거 자체는 그대로 둔다(함수 본문만 교체되므로 재생성 불필요).
-- 확인용:
--   select tgenabled from pg_trigger where tgname = 'on_auth_user_created';
--   select pg_get_functiondef(oid) from pg_proc where proname = 'handle_new_user';
