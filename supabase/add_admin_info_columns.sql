-- mdiary_coupons에 admin 정보 컬럼 추가
ALTER TABLE mdiary_coupons
  ADD COLUMN IF NOT EXISTS admin_name  TEXT,
  ADD COLUMN IF NOT EXISTS admin_phone TEXT;
