-- partner_deals 테이블에 품목(items) JSONB 컬럼 추가
-- 각 item: { plan, duration, qty, unit_price, amount }
ALTER TABLE partner_deals
  ADD COLUMN IF NOT EXISTS items jsonb DEFAULT '[]'::jsonb;
