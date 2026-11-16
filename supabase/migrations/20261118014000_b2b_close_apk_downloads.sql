-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- apk_downloads — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_apk_downloads.sql
-- 드라이런: audit/dryrun_b2b_apk_downloads.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 조회가 apk-lookup 으로 옮겨졌다. INSERT 는 apk-download-verify 경로라 남긴다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "apk_downloads_select_anon_self"  SELECT / {anon}
--      USING      = true
--      WITH CHECK = (없음)
--
-- 대체 정책을 새로 만들지 않는다(남아 있는 정책이 이미 올바른 범위다).
-- ==========================================================

drop policy if exists "apk_downloads_select_anon_self" on public.apk_downloads;
