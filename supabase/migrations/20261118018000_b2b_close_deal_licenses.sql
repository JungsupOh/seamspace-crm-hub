-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- deal_licenses — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_deal_licenses.sql
-- 드라이런: audit/dryrun_b2b_deal_licenses.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 경로 접근 0건(호출 그래프). 관리자·파트너는 B2a 에서 로그인 토큰으로 전환됐다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "allow_all"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "allow_all" on public.deal_licenses;

create policy "b2b_deal_licenses_admin"
  on public.deal_licenses for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
