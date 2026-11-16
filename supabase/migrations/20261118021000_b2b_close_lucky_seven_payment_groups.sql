-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- lucky_seven_payment_groups — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_lucky_seven_payment_groups.sql
-- 드라이런: audit/dryrun_b2b_lucky_seven_payment_groups.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   위와 같다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_ls_payment_groups"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "all_ls_payment_groups" on public.lucky_seven_payment_groups;

create policy "b2b_lucky_seven_payment_groups_admin"
  on public.lucky_seven_payment_groups for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
