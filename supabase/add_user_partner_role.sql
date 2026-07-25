-- 파트너 내부 역할 (user_profiles.partner_role)
-- role='partner' 사용자에게만 의미. admin/sub_admin/guest는 NULL.
--   manager: 이용권 발급 + 딜 등록/수정 + 코드 열람
--   member : 딜 등록/수정 (이용권 코드 마스킹, 발급/재발송/무효화 불가)
--   viewer : 보기 전용
-- 발급 실제 권한 = partners.can_issue_licenses(업체 스위치) AND partner_role='manager'

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS partner_role TEXT
    CHECK (partner_role IN ('manager', 'member', 'viewer'));

-- 기존 파트너 사용자는 전권 보유 상태였으므로 manager로 승격 (회귀 방지)
UPDATE user_profiles SET partner_role = 'manager'
WHERE role = 'partner' AND partner_role IS NULL;
