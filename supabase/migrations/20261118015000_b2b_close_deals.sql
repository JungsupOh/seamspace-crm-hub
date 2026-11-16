-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- deals — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_deals.sql
-- 드라이런: audit/dryrun_b2b_deals.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /order 의 딜 생성·갱신이 order-submit-quote 로, 조회가 order-lookup-quote 로 옮겨졌다.
--   관리자는 lib/airtable.ts(세션 토큰)와 B2a 전환분을 쓴다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "anon_deals_all"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "anon_deals_all" on public.deals;

create policy "b2b_deals_admin"
  on public.deals for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
