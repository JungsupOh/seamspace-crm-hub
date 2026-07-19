-- 파트너 발급 이용권 원장 (append-only 감사 기록)
-- 해외 파트너가 셀프 발급한 mDiary 이용권을 partner_id로 스코프하여 기록
-- 쓰기는 partner-issue-license 엣지 함수(service-role)만. 조회는 파트너 포털/관리자.
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS partner_licenses (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id        UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  partner_deal_id   UUID REFERENCES partner_deals(id) ON DELETE SET NULL,
  coupon_code       TEXT NOT NULL,
  contact_name      TEXT,
  contact_email     TEXT,          -- 이메일 발송 대상
  contact_phone     TEXT,
  org_name          TEXT,
  plan              TEXT,          -- 자유입력 플랜명
  duration          TEXT,          -- 개월수
  user_count        TEXT,          -- 이용 인원(capacity)
  amount            NUMERIC,       -- 판매 금액 (currency 기준)
  currency          TEXT DEFAULT 'USD',
  status            TEXT DEFAULT 'issued',   -- issued | active | expired
  delivery_channel  TEXT DEFAULT 'email',
  email_sent        BOOLEAN DEFAULT false,
  service_expire_at DATE,
  issued_by         UUID,          -- 발급한 로그인 유저(auth.users.id)
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_licenses_partner  ON partner_licenses (partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_licenses_deal     ON partner_licenses (partner_deal_id);
CREATE INDEX IF NOT EXISTS idx_partner_licenses_coupon   ON partner_licenses (coupon_code);

-- RLS (MVP: permissive. 실제 발급 스코프는 엣지 함수가 partner_id 강제)
ALTER TABLE partner_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_partner_licenses" ON partner_licenses
  FOR ALL TO anon USING (true) WITH CHECK (true);
