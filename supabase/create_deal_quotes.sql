-- deal_quotes: 딜별 복수 견적 관리
CREATE TABLE IF NOT EXISTS deal_quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id TEXT NOT NULL,
  quote_number TEXT,
  quote_date TEXT,
  plan TEXT,
  qty INTEGER,
  duration INTEGER,
  unit_price INTEGER,
  supply_price INTEGER,
  tax_amount INTEGER,
  final_value INTEGER,
  notes TEXT,
  is_selected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_quotes_deal_id ON deal_quotes(deal_id);

-- RLS
ALTER TABLE deal_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON deal_quotes FOR ALL USING (true) WITH CHECK (true);
