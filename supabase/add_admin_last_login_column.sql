-- mdiary_coupons에 admin_last_login 컬럼 추가
ALTER TABLE mdiary_coupons
  ADD COLUMN IF NOT EXISTS admin_last_login DATE;
