-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- campaigns — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_campaigns.sql
-- 드라이런: audit/dryrun_b2b_campaigns.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /c 의 캠페인 조회가 campaign-public-detail 로 옮겨졌다.
--   그 함수는 폼을 그리는 8개 열만 돌려준다(budget·actual_cost 제외).
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_campaigns"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
--   "public_read_campaigns"  SELECT / {public}
--      USING      = true
--      WITH CHECK = (없음)
-- ==========================================================

drop policy if exists "all_campaigns" on public.campaigns;
drop policy if exists "public_read_campaigns" on public.campaigns;

create policy "b2b_campaigns_admin"
  on public.campaigns for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
