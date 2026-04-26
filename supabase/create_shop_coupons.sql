-- Shop 할인쿠폰 테이블
CREATE TABLE IF NOT EXISTS shop_coupons (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,              -- 쿠폰 코드 (예: SPRING2026)
  campaign_id    UUID REFERENCES campaigns(id) ON DELETE SET NULL,  -- 캠페인 연동
  name           TEXT,                              -- 관리용 이름
  discount_type  TEXT NOT NULL DEFAULT 'amount',    -- 'amount' (정액) / 'percent' (정률)
  discount_value INTEGER NOT NULL DEFAULT 0,        -- 정액: 원, 정률: %
  min_order      INTEGER NOT NULL DEFAULT 0,        -- 최소 주문금액
  max_uses       INTEGER,                           -- 총 사용 가능 횟수 (null=무제한)
  used_count     INTEGER NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ,                       -- 만료일 (null=무기한)
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shop_coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_shop_coupons" ON shop_coupons FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_shop_coupons_code ON shop_coupons (code);
CREATE INDEX IF NOT EXISTS idx_shop_coupons_campaign ON shop_coupons (campaign_id);

-- 쿠폰 사용 횟수 증가 RPC
CREATE OR REPLACE FUNCTION increment_coupon_usage(coupon_code TEXT)
RETURNS void AS $$
BEGIN
  UPDATE shop_coupons SET used_count = used_count + 1 WHERE code = coupon_code;
END;
$$ LANGUAGE plpgsql;
