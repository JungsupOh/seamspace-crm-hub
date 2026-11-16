-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- shop_orders — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_shop_orders.sql
-- 드라이런: audit/dryrun_b2b_shop_orders.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 조회는 shop-lookup-orders, 주문 생성·결제는 confirm-shop-payment(service_role)가 한다.
--   관리자 /shop-orders 는 021-8b-4 에서 로그인 토큰으로 전환됐다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_shop_orders"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "all_shop_orders" on public.shop_orders;

create policy "b2b_shop_orders_admin"
  on public.shop_orders for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
