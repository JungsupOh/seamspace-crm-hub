-- ⚠️ 미적용. HARD-B1. 선행: 20261117000000_b1_role_helper.sql
-- ==========================================================
-- partner_deal_buyers — 공개 키 전체 허용 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b1_partner_deal_buyers.sql
-- 드라이런: audit/dryrun_b1_partner_deal_buyers.sql
--
-- 왜 닫아도 되나
--   포털·관리자 모두 H-4 에서 전환됐다(partner-deals.ts).
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "partner_deal_buyers_all"  ALL / {public} / PERMISSIVE
--      USING      = true
--      WITH CHECK = true
--
-- 남는 정책: partner_scoped_partner_deal_buyers  (H-4 에서 적용됨)
--   자기 partner_id 것만 OR admin·sub_admin 전체 → 포털과 관리자 화면이 그대로 동작한다.
-- ==========================================================

drop policy if exists "partner_deal_buyers_all" on public.partner_deal_buyers;
