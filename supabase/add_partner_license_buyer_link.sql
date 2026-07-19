-- 이용권을 딜의 특정 구매자에 연결
-- 한 딜에 구매자가 여러 명이고 각자 이용권을 받으므로, 딜 단위만으로는
-- 어느 구매자의 이용권인지 알 수 없었다. 구매자 정보에 이용권이 남도록 연결한다.

ALTER TABLE partner_licenses
  ADD COLUMN IF NOT EXISTS partner_deal_buyer_id UUID
    REFERENCES partner_deal_buyers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partner_licenses_buyer
  ON partner_licenses (partner_deal_buyer_id);
