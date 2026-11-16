-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- deal_quotes — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_deal_quotes.sql
-- 드라이런: audit/dryrun_b2b_deal_quotes.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /order 의 견적 채번·INSERT·조회가 서버 함수로 옮겨졌다. 관리자는 B2a 에서 전환됨.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "Allow all"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "Allow all" on public.deal_quotes;

create policy "b2b_deal_quotes_admin"
  on public.deal_quotes for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
