-- ⚠️ 미적용. HARD-B1. 선행: 20261117000000_b1_role_helper.sql
-- ==========================================================
-- prior_year_revenue — 공개 키 전체 허용 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b1_prior_year_revenue.sql
-- 드라이런: audit/dryrun_b1_prior_year_revenue.sql
--
-- 왜 닫아도 되나
--   대시보드(Index.tsx:137)만 읽고 021-8b-4 에서 전환됐다. 공개 경로·엣지 함수 접근 0건.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_prior_year_revenue"  ALL / {public} / PERMISSIVE
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "all_prior_year_revenue" on public.prior_year_revenue;

create policy "b1_prior_year_revenue_admin"
  on public.prior_year_revenue for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
