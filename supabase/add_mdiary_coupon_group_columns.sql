-- mdiary_coupons에 그룹명 + 교육청 컬럼 추가
ALTER TABLE mdiary_coupons
  ADD COLUMN IF NOT EXISTS group_name      TEXT,
  ADD COLUMN IF NOT EXISTS edu_office_name TEXT;
