-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- apk_subscribers — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_apk_subscribers.sql
-- 드라이런: audit/dryrun_b2b_apk_subscribers.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /apk/info 조회와 /apk/unsubscribe 해지가 서버 함수 apk-lookup 으로 옮겨졌다.
--   **INSERT 는 남긴다** — /apk/subscribe 가 apk-subscribe 엣지 함수를 쓰지만,
--   그 함수가 anon 키로 도는 경로가 있어 이번에 함께 끊지 않는다(021-8d 에서 확인).
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "apk_subscribers_select_anon"  SELECT / {anon}
--      USING      = true
--      WITH CHECK = (없음)
--   "apk_subscribers_update_anon_unsubscribe"  UPDATE / {anon}
--      USING      = true
--      WITH CHECK = (status = 'unsubscribed'::text)
--
-- 대체 정책을 새로 만들지 않는다(남아 있는 정책이 이미 올바른 범위다).
-- ==========================================================

drop policy if exists "apk_subscribers_select_anon" on public.apk_subscribers;
drop policy if exists "apk_subscribers_update_anon_unsubscribe" on public.apk_subscribers;
