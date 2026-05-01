-- 캠페인 연동 쿠폰 시스템 — 마이그레이션
-- 1) campaigns에 coupon_settings JSONB 추가 (캠페인별 쿠폰 발급 설정)
-- 2) shop_coupons에 lead_id + applicable_products 추가

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS coupon_settings JSONB;

COMMENT ON COLUMN campaigns.coupon_settings IS
'캠페인 쿠폰 자동 발급 설정.
{
  "enabled": true,
  "code_prefix": "EXPO2026",
  "discount_type": "percent" | "amount",
  "discount_value": 30,
  "applicable_products": ["boardgame", "keyring"],
  "expires_in_days": 60,
  "max_count": 100,
  "alimtok_tpl_code": "UH_XXXX"
}';

ALTER TABLE shop_coupons
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES campaign_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applicable_products TEXT[];

COMMENT ON COLUMN shop_coupons.applicable_products IS
'적용 가능한 product_id 배열 (예: ["boardgame","keyring"]). NULL/빈배열이면 전체 적용.';

CREATE INDEX IF NOT EXISTS idx_shop_coupons_lead     ON shop_coupons(lead_id);
CREATE INDEX IF NOT EXISTS idx_shop_coupons_campaign ON shop_coupons(campaign_id);

-- 동일 phone+캠페인 중복 발급 차단용 (함수에서 lookup)
CREATE INDEX IF NOT EXISTS idx_shop_coupons_phone_campaign
  ON shop_coupons(used_by_phone, campaign_id) WHERE used_by_phone IS NOT NULL;
