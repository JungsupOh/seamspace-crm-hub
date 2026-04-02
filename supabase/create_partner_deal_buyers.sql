-- 파트너 딜 구매자 테이블 (딜당 복수 구매자)
CREATE TABLE IF NOT EXISTS partner_deal_buyers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_deal_id UUID NOT NULL REFERENCES partner_deals(id) ON DELETE CASCADE,
  buyer_name TEXT,
  buyer_phone TEXT,
  buyer_email TEXT,
  student_count INT DEFAULT 40,
  class_count INT DEFAULT 1,
  month_count INT,
  plan_name TEXT DEFAULT '학급별',
  quantity INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_pdb_deal_id ON partner_deal_buyers(partner_deal_id);

-- RLS
ALTER TABLE partner_deal_buyers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_deal_buyers_all" ON partner_deal_buyers
  FOR ALL USING (true) WITH CHECK (true);
