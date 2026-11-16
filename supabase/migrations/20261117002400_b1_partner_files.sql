-- ⚠️ 미적용. HARD-B1. 선행: 20261117000000_b1_role_helper.sql
-- ==========================================================
-- partner_files — 공개 키 전체 허용 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b1_partner_files.sql
-- 드라이런: audit/dryrun_b1_partner_files.sql
--
-- 왜 닫아도 되나
--   관리자 /partners 가 021-8b-4 에서 전환됐다(Partners.tsx 3곳). 포털은 이 테이블을 쓰지 않는다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_partner_files"  ALL / {public} / PERMISSIVE
--      USING      = true
--      WITH CHECK = true
--
-- 남는 정책: partner_scoped_partner_files  (H-4 에서 적용됨)
--   자기 partner_id 것만 OR admin·sub_admin 전체 → 포털과 관리자 화면이 그대로 동작한다.
-- ==========================================================

drop policy if exists "all_partner_files" on public.partner_files;
