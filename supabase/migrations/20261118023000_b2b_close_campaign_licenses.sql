-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- campaign_licenses — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_campaign_licenses.sql
-- 드라이런: audit/dryrun_b2b_campaign_licenses.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 체험권 발급이 campaign-submit-lead 로 옮겨졌다(H-2). 관리자는 B2a 전환분.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_campaign_licenses"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "all_campaign_licenses" on public.campaign_licenses;

create policy "b2b_campaign_licenses_admin"
  on public.campaign_licenses for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
