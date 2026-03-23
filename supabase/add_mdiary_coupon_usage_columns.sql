-- mdiary_coupons에 사용 정보 컬럼 추가
ALTER TABLE mdiary_coupons
  ADD COLUMN IF NOT EXISTS service_expire_at DATE,
  ADD COLUMN IF NOT EXISTS member_count      INTEGER;
