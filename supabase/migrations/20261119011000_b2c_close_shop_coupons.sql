-- ⚠️ 미적용. HARD-B2c. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ============================================================
-- shop_coupons — 공개 키 정책을 닫는다
-- ============================================================
-- 롤백   : audit/rollback_b2c_shop_coupons.sql
-- 드라이런: audit/dryrun_b2c_shop_coupons.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /shop 의 쿠폰 검증은 B2b 에서 shop-validate-coupon 으로, 사용 처리는
--   이번에 shop-use-coupon 으로 옮겼다(둘 다 service_role).
--   쿠폰 생성·집계(createCouponBatch·issueCampaignCoupon·countCampaignCoupons·
--   findExistingCoupon)는 **호출자가 0인 죽은 코드**다 — 캠페인 발급은 엣지 함수
--   campaign-submit-lead 가 service_role 로 한다(H-2).
--
-- ⚠️ RPC use_shop_coupon 은 **지우지 않는다.** SECURITY DEFINER 가 아니므로
--    이 정책을 닫으면 anon 이 불러도 대상 행이 보이지 않아 **아무 일도 하지 않는다**.
--    (EXECUTE 권한 회수는 REVOKE 라 이번 범위 밖이다.)
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_shop_coupons"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ============================================================

drop policy if exists "all_shop_coupons" on public.shop_coupons;

create policy "b2c_shop_coupons_admin"
  on public.shop_coupons for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
