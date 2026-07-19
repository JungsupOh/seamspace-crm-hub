-- 이용권 무효화 이력 컬럼
-- status는 기존 'issued'에 더해 'revoked'를 갖는다.
-- 원장은 정산 근거이므로 행을 삭제하지 않고 상태로만 표시한다.
-- ※ 현재 무효화는 CRM 원장 표시까지만이다. mDiary 쪽 쿠폰 무효화 API가 없어
--    실제 코드 사용 차단은 불가하며, 백엔드팀 API 제공 후 연동 예정.

ALTER TABLE partner_licenses
  ADD COLUMN IF NOT EXISTS revoked_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by    UUID,
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
