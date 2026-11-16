-- ⚠️ 미적용, James 승인 후, 파트너 포털 전환 배포보다 **먼저** 적용 (HARD-A H-4)
-- ============================================================
-- 파트너 포털용 "자기 것만" 정책 추가 — 기존 정책은 삭제·수정하지 않는다
-- ============================================================
-- 근거   : audit/h4_partner_portal.md §C
-- 롤백   : audit/rollback_h4_partner_scoped.sql
-- 드라이런: audit/dryrun_h4_partner_scoped.sql
--
-- 무엇이 문제인가
--   파트너 포털이 공개 키(anon)로 partner_deals·partner_deal_buyers·
--   partner_licenses 를 읽고 썼다. 공개 키는 번들에 있어 누구나 꺼낼 수 있으므로
--   **다른 파트너의 딜·이용권·구매자까지 전부 열려 있었다**(009-4).
--   HARD-A H-4 에서 포털을 로그인 토큰으로 바꾸는데, 지금 정책은
--   `ALL {public} USING(true)` 라 토큰을 쓴다고 범위가 좁아지지 않는다.
--
-- 무엇을 바꾸나
--   `partners` 에 이미 있는 **올바른 패턴**(009-4 의 authenticated_read_own_partner)을
--   포털이 쓰는 테이블마다 복제해 **추가**한다:
--       자기 partner_id 것만  OR  admin·sub_admin 은 전체
--   기존 anon·public 정책은 **그대로 둔다** — 그래서 적용해도 운영 동작이 바뀌지 않고,
--   되돌리기도 이 파일에서 추가한 정책만 DROP 하면 끝난다.
--   anon·public 정책 제거는 이 단위가 아니라 021-8i(HARD-B) 에서 한다.
--
-- 왜 PERMISSIVE 인데도 의미가 있나
--   PERMISSIVE 정책은 OR 로 합쳐지므로, 지금은 넓은 public 정책 때문에 효과가 없다.
--   하지만 021-8i 에서 public 정책을 지우는 순간 **이 정책만 남아** 범위가 좁아진다.
--   그 순서를 지키려고 미리 넣어 두는 것이다(먼저 넣지 않고 지우면 포털이 깨진다).
-- ============================================================

-- 공통 판정식을 함수로 두지 않고 정책마다 인라인으로 쓴다 —
-- partners.authenticated_read_own_partner 와 같은 모양을 유지해 비교하기 쉽게 한다.

-- ── partner_deals (partner_id 직결) ─────────────────────────
create policy "partner_scoped_partner_deals"
  on public.partner_deals
  for all
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- ── partner_deal_buyers (partner_deal_id → partner_deals.partner_id) ──
create policy "partner_scoped_partner_deal_buyers"
  on public.partner_deal_buyers
  for all
  to authenticated
  using (
    exists (
      select 1 from public.partner_deals pd
      where pd.id = partner_deal_buyers.partner_deal_id
        and pd.partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    )
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    exists (
      select 1 from public.partner_deals pd
      where pd.id = partner_deal_buyers.partner_deal_id
        and pd.partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    )
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- ── partner_licenses (partner_id 직결) ──────────────────────
create policy "partner_scoped_partner_licenses"
  on public.partner_licenses
  for all
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- ── partner_files (partner_id 직결) ─────────────────────────
create policy "partner_scoped_partner_files"
  on public.partner_files
  for all
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- ── partner_expiry_emails (partner_id 직결) ─────────────────
-- 조회 전용으로 쓰이지만(components/PartnerExpiryHistory), 다른 테이블과 같은 모양으로 둔다.
create policy "partner_scoped_partner_expiry_emails"
  on public.partner_expiry_emails
  for all
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- ── mdiary_coupons (파트너 소속 분) ─────────────────────────
-- 이 테이블에는 partner_id 가 없다. 포털은 **자기 파트너가 발급한 이용권의 쿠폰**만
-- 본다(partner-licenses.ts getCouponGroupInfo → coupon_code 로 1건 조회).
-- 그래서 partner_licenses 를 거쳐 연결한다.
--
-- SELECT 만 추가한다. UPDATE 는 기존 "authenticated update" 정책이 이미 있고,
-- 그걸 좁히는 일은 021-8i 에서 다룬다(지금 좁히면 관리자 화면이 깨진다).
create policy "partner_scoped_mdiary_coupons_select"
  on public.mdiary_coupons
  for select
  to authenticated
  using (
    exists (
      select 1 from public.partner_licenses pl
      where pl.coupon_code = mdiary_coupons.coupon_code
        and pl.partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    )
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );
