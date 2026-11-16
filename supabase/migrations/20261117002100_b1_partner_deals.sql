-- ⚠️ 미적용. HARD-B1. 선행: 20261117000000_b1_role_helper.sql
-- ==========================================================
-- partner_deals — 공개 키 전체 허용 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b1_partner_deals.sql
-- 드라이런: audit/dryrun_b1_partner_deals.sql
--
-- 왜 닫아도 되나
--   포털·관리자 모두 H-4 에서 로그인 토큰으로 전환됐다(partner-deals.ts 12곳).
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_partner_deals"  ALL / {public} / PERMISSIVE
--      USING      = true
--      WITH CHECK = true
--
-- 남는 정책: partner_scoped_partner_deals  (H-4 에서 적용됨)
--   자기 partner_id 것만 OR admin·sub_admin 전체 → 포털과 관리자 화면이 그대로 동작한다.
-- ==========================================================

drop policy if exists "all_partner_deals" on public.partner_deals;
