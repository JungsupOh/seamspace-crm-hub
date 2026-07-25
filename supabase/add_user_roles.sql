-- 사용자 역할 체계 (user_profiles.role) — 단일 축
--   admin          시스템 관리자 (CRM 전체)
--   sub_admin      서브 관리자 (CRM 전체)
--   partner_admin  파트너 관리자 (이용권 발급 + 딜 등록/수정 + 코드 열람)
--   partner_member 파트너 참여자 (딜 등록/수정, 이용권은 발급여부만 확인 · 코드 마스킹)
--   partner_viewer 파트너 게스트 (보기 전용)
--   guest          미지정/게스트
--
-- 발급 실제 권한 = partners.can_issue_licenses(업체 스위치) AND role='partner_admin'
--
-- ※ 이력: 초기엔 role='partner' + 별도 partner_role(manager/member/viewer) 이중 축이었으나
--   partner_admin/member/viewer로 통합하고 partner_role 컬럼 제거.

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['admin','sub_admin','partner_admin','partner_member','partner_viewer','guest']));

-- (이관 완료됨) 기존 partner_role → role 통합 후 partner_role 컬럼 제거
ALTER TABLE user_profiles DROP COLUMN IF EXISTS partner_role;
