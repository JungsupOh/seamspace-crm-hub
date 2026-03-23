-- 이벤트(무료체험) 관리 테이블
-- Supabase SQL Editor에서 실행

-- 1. 이벤트 테이블
CREATE TABLE IF NOT EXISTS events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,               -- 이벤트명 (예: 2026 봄학기 체험)
  description TEXT,                        -- 설명
  start_date  DATE,                        -- 시작일
  end_date    DATE,                        -- 종료일
  status      TEXT DEFAULT 'active',       -- active | ended | planned
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. 이벤트 이용권 테이블 (체험권 발송 내역)
CREATE TABLE IF NOT EXISTS event_licenses (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id          UUID REFERENCES events(id) ON DELETE CASCADE,
  coupon_code       TEXT,
  contact_name      TEXT,
  contact_phone     TEXT,
  org_name          TEXT,
  duration          TEXT DEFAULT '1',      -- 체험 기간 (개월)
  user_count        TEXT DEFAULT '10',     -- 인원
  status            TEXT DEFAULT '대기',   -- 대기 | 사용중 | 만료
  service_expire_at DATE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 3. RLS
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_events"         ON events         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_event_licenses" ON event_licenses FOR ALL USING (true) WITH CHECK (true);

-- 4. 전환 여부는 event_licenses.contact_phone이
--    deal_licenses.contact_phone에 존재하는지로 런타임에 판단 (별도 컬럼 불필요)
