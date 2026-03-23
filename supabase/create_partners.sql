-- 파트너 관리 테이블 생성
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS partners (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name             TEXT NOT NULL,
  business_number  TEXT,           -- 사업자등록번호
  representative   TEXT,           -- 대표자
  address          TEXT,           -- 사업장 소재지
  business_type    TEXT,           -- 업태/종목
  bank_name        TEXT,           -- 은행명
  bank_account     TEXT,           -- 계좌번호
  account_holder   TEXT,           -- 예금주
  contact_phone    TEXT,
  contact_email    TEXT,
  notes            TEXT,
  status           TEXT DEFAULT 'active',  -- active | inactive
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_files (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id  UUID REFERENCES partners(id) ON DELETE CASCADE,
  file_type   TEXT NOT NULL,   -- 'business_reg' | 'bank_account' | 'contract'
  file_name   TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE partners      ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_partners"      ON partners      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_partner_files" ON partner_files FOR ALL TO anon USING (true) WITH CHECK (true);

-- Storage 버킷 (Dashboard > Storage > New bucket: "partner-files", Public)

-- 초기 파트너 데이터
INSERT INTO partners (name) VALUES
  ('아이스림몰'),
  ('G마켓'),
  ('나이스쿨'),
  ('교육의정석'),
  ('IT존'),
  ('채더스')
ON CONFLICT DO NOTHING;
