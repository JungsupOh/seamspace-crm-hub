-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- shop_products — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_shop_products.sql
-- 드라이런: audit/dryrun_b2b_shop_products.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /shop 의 상품 조회가 서버 함수 shop-catalog 로 옮겨졌다. 관리자 화면은 이 테이블을 쓰지 않는다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_shop_products"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "all_shop_products" on public.shop_products;

create policy "b2b_shop_products_admin"
  on public.shop_products for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
