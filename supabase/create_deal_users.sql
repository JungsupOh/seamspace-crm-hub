-- 딜 사용자 테이블 (딜당 복수 사용자 = 이용권 수신자)
CREATE TABLE IF NOT EXISTS deal_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id TEXT NOT NULL,               -- Airtable record ID
  user_name TEXT,
  user_phone TEXT,
  user_email TEXT,
  student_count INT DEFAULT 40,
  month_count INT,
  plan_name TEXT DEFAULT '학급별',
  is_primary BOOLEAN DEFAULT false,    -- 담당자=대표사용자
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_du_deal_id ON deal_users(deal_id);

ALTER TABLE deal_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_users_all" ON deal_users
  FOR ALL USING (true) WITH CHECK (true);
