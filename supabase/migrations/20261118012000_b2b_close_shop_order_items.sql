-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- shop_order_items — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_shop_order_items.sql
-- 드라이런: audit/dryrun_b2b_shop_order_items.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   위와 같다(주문 품목).
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_shop_order_items"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "all_shop_order_items" on public.shop_order_items;

create policy "b2b_shop_order_items_admin"
  on public.shop_order_items for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
