-- Shop 할인쿠폰 테이블 (개별 일련번호, 1회용)
-- 기존 테이블이 있으면 DROP 후 재생성
DROP TABLE IF EXISTS shop_coupons;

CREATE TABLE shop_coupons (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,              -- 고유 일련번호 (예: SPRING-001)
  batch_name     TEXT NOT NULL,                     -- 배치 이름 (같은 배치 쿠폰 그룹)
  campaign_id    UUID REFERENCES campaigns(id) ON DELETE SET NULL,  -- 캠페인 연동
  -- 할인 규칙
  discount_type  TEXT NOT NULL DEFAULT 'amount',    -- 'amount' (정액) / 'percent' (정률)
  discount_value INTEGER NOT NULL DEFAULT 0,        -- 정액: 원, 정률: %
  min_order      INTEGER NOT NULL DEFAULT 0,        -- 최소 주문금액
  -- 유효기간
  expires_at     TIMESTAMPTZ NOT NULL,              -- 만료일 (기본 생성 후 1개월)
  -- 사용 추적
  is_used        BOOLEAN NOT NULL DEFAULT false,
  used_at        TIMESTAMPTZ,
  used_order_id  TEXT,                              -- shop_orders.order_id
  used_by_phone  TEXT,                              -- 사용자 전화번호
  -- 메타
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shop_coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_shop_coupons" ON shop_coupons FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_shop_coupons_code ON shop_coupons (code);
CREATE INDEX IF NOT EXISTS idx_shop_coupons_batch ON shop_coupons (batch_name);
CREATE INDEX IF NOT EXISTS idx_shop_coupons_campaign ON shop_coupons (campaign_id);

-- 쿠폰 사용 처리 함수 (코드로 사용 표시 + 주문/전화번호 기록)
CREATE OR REPLACE FUNCTION use_shop_coupon(
  p_code TEXT,
  p_order_id TEXT,
  p_phone TEXT
) RETURNS void AS $$
BEGIN
  UPDATE shop_coupons
  SET is_used = true, used_at = now(), used_order_id = p_order_id, used_by_phone = p_phone
  WHERE code = p_code AND is_used = false;
END;
$$ LANGUAGE plpgsql;
