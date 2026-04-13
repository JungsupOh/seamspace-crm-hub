-- ================================================================
-- 이벤트(events) → 캠페인(campaigns) 전환 마이그레이션
-- ----------------------------------------------------------------
-- 실행 순서:
--   1. 새 테이블 생성 (campaigns, campaign_leads, campaign_licenses)
--   2. 기존 events / event_licenses 데이터 복사
--   3. RLS 정책 설정 (공개 폼 INSERT 익명 허용 포함)
--   4. Storage 버킷 campaign-images 생성
--   5. 기존 events / event_licenses 테이블 DROP
-- ================================================================

-- 1. 캠페인 테이블 (기존 events 구조 + title/slug/image_url)
CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,                 -- 내부 관리용 캠페인명
  title       TEXT,                          -- 공개 폼 상단 제목
  description TEXT,
  image_url   TEXT,                          -- 공개 폼 상단 이미지
  slug        TEXT UNIQUE,                   -- 공개 폼 URL 해시 (8자리)
  start_date  DATE,
  end_date    DATE,
  status      TEXT DEFAULT 'active',         -- active | ended | planned
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. 캠페인 리드 테이블 (공개 폼 제출분)
CREATE TABLE IF NOT EXISTS campaign_leads (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id            UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  school_name            TEXT,
  school_code            TEXT,               -- NEIS 학교 코드
  school_kind            TEXT,               -- NEIS 학교 종류
  position               TEXT,               -- 담당업무
  name                   TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  phone_normalized       TEXT,
  email                  TEXT,
  source                 TEXT,               -- 소개받으신 경로
  source_etc             TEXT,               -- 기타 직접입력
  marketing_consent      BOOLEAN DEFAULT false,
  status                 TEXT DEFAULT '신규', -- 신규 | 발송완료 | 실패 | 제외
  is_existing_customer   BOOLEAN DEFAULT false, -- 제출 시점 기존 고객 여부 스냅샷
  converted_contact_id   TEXT,               -- 01_Contacts.id (발송 성공 시)
  sent_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_phone    ON campaign_leads(phone_normalized);

-- 3. 캠페인 이용권 테이블 (기존 event_licenses + lead_id FK)
CREATE TABLE IF NOT EXISTS campaign_licenses (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id       UUID REFERENCES campaigns(id)     ON DELETE CASCADE,
  lead_id           UUID REFERENCES campaign_leads(id) ON DELETE SET NULL,
  coupon_code       TEXT,
  contact_name      TEXT,
  contact_phone     TEXT,
  org_name          TEXT,
  duration          TEXT DEFAULT '1',
  user_count        TEXT DEFAULT '10',
  status            TEXT DEFAULT '대기',    -- 대기 | 사용중 | 만료
  service_expire_at DATE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_licenses_campaign ON campaign_licenses(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_licenses_phone    ON campaign_licenses(contact_phone);

-- ================================================================
-- 4. 기존 데이터 마이그레이션 (events → campaigns)
-- ================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
    INSERT INTO campaigns (id, name, description, start_date, end_date, status, created_at)
    SELECT id, name, description, start_date, end_date, status, created_at
    FROM events
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_licenses') THEN
    INSERT INTO campaign_licenses (
      id, campaign_id, coupon_code, contact_name, contact_phone,
      org_name, duration, user_count, status, service_expire_at, created_at
    )
    SELECT id, event_id, coupon_code, contact_name, contact_phone,
           org_name, duration, user_count, status, service_expire_at, created_at
    FROM event_licenses
    ON CONFLICT (id) DO NOTHING;
  END IF;
END$$;

-- ================================================================
-- 5. RLS 정책
-- ================================================================
ALTER TABLE campaigns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_licenses ENABLE ROW LEVEL SECURITY;

-- 내부 사용자: 전체 접근 가능
DROP POLICY IF EXISTS "all_campaigns"         ON campaigns;
DROP POLICY IF EXISTS "all_campaign_leads"    ON campaign_leads;
DROP POLICY IF EXISTS "all_campaign_licenses" ON campaign_licenses;

CREATE POLICY "all_campaigns"         ON campaigns         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_campaign_leads"    ON campaign_leads    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_campaign_licenses" ON campaign_licenses FOR ALL USING (true) WITH CHECK (true);

-- 공개 폼: 익명 사용자에게 campaigns SELECT + campaign_leads INSERT 허용
-- (현재는 all 정책으로 이미 열려있지만, 명시적 정책으로 분리해서 향후 제한 쉽게 하도록 준비)
DROP POLICY IF EXISTS "public_read_campaigns" ON campaigns;
CREATE POLICY "public_read_campaigns" ON campaigns FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_insert_leads" ON campaign_leads;
CREATE POLICY "public_insert_leads" ON campaign_leads FOR INSERT WITH CHECK (true);

-- ================================================================
-- 6. Storage 버킷 (캠페인 이미지 업로드용)
-- ================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-images', 'campaign-images', true)
ON CONFLICT (id) DO NOTHING;

-- 버킷 공개 읽기 정책
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'campaign_images_public_read'
  ) THEN
    CREATE POLICY "campaign_images_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'campaign-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'campaign_images_auth_write'
  ) THEN
    CREATE POLICY "campaign_images_auth_write" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'campaign-images');
  END IF;
END$$;

-- ================================================================
-- 7. 기존 테이블 제거 (데이터 복사 확인 후)
-- ================================================================
-- ⚠️ 복사가 정상적으로 완료됐다면 아래 주석을 해제하고 실행:
-- DROP TABLE IF EXISTS event_licenses;
-- DROP TABLE IF EXISTS events;
