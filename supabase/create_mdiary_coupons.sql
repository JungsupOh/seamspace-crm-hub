-- mDiary 운영DB 쿠폰 이력 테이블
CREATE TABLE IF NOT EXISTS mdiary_coupons (
  id             bigserial PRIMARY KEY,
  mdiary_id      bigint UNIQUE NOT NULL,   -- 운영DB id (중복방지)
  coupon_code    text NOT NULL,
  created_at     timestamptz NOT NULL,
  duration       integer,
  user_limit     integer,
  is_used        boolean DEFAULT false,
  descript       text,
  extracted_name text,                     -- descript에서 추출한 이름
  used_group_id  text
);

CREATE INDEX IF NOT EXISTS idx_mdiary_coupons_name    ON mdiary_coupons (extracted_name);
CREATE INDEX IF NOT EXISTS idx_mdiary_coupons_created ON mdiary_coupons (created_at);
CREATE INDEX IF NOT EXISTS idx_mdiary_coupons_code    ON mdiary_coupons (coupon_code);

-- anon key로 읽기 허용 (로그인한 사용자)
ALTER TABLE mdiary_coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read" ON mdiary_coupons
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service insert" ON mdiary_coupons
  FOR INSERT TO service_role WITH CHECK (true);
