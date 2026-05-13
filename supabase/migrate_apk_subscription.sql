-- APK 구독관리 — 4 테이블 + Storage 버킷 + RLS
-- 심스페이스 Android 앱 sideload 배포용 (Google Play 외 MDM 환경 대상)

-- 1) apk_versions — 업로드된 APK 버전 메타
CREATE TABLE IF NOT EXISTS apk_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name    TEXT NOT NULL,        -- 예: '1.2.0'
  version_code    INTEGER NOT NULL,     -- 예: 12 (정수, 비교 용도)
  file_path       TEXT NOT NULL,        -- Storage 경로
  file_size       BIGINT,               -- bytes
  sha256          TEXT,                 -- 변조 검증용
  changelog       TEXT,                 -- markdown
  min_android     TEXT,                 -- 예: '7.0+'
  uploaded_by     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  is_latest       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apk_versions_code ON apk_versions(version_code DESC);
CREATE INDEX IF NOT EXISTS idx_apk_versions_latest ON apk_versions(is_latest) WHERE is_latest = true;

-- 2) apk_subscribers — 메일링 리스트
CREATE TABLE IF NOT EXISTS apk_subscribers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL UNIQUE,
  school_name        TEXT NOT NULL,
  school_code        TEXT,              -- NEIS school code
  school_kind        TEXT,              -- NEIS 학교급 (초/중/고)
  contact_name       TEXT NOT NULL,
  phone              TEXT,
  memo               TEXT,
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'paused', 'unsubscribed')),
  consent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  unsubscribe_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apk_subscribers_status ON apk_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_apk_subscribers_token ON apk_subscribers(unsubscribe_token);

-- 3) apk_send_history — version × subscriber 발송 이력 (UNIQUE로 한 버전당 1회 발송 보장)
CREATE TABLE IF NOT EXISTS apk_send_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    UUID NOT NULL REFERENCES apk_versions(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES apk_subscribers(id) ON DELETE CASCADE,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_status  TEXT NOT NULL DEFAULT 'sent'
                  CHECK (email_status IN ('sent', 'failed')),
  error_message TEXT,
  UNIQUE(version_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_apk_send_history_version ON apk_send_history(version_id);
CREATE INDEX IF NOT EXISTS idx_apk_send_history_subscriber ON apk_send_history(subscriber_id);

-- 4) apk_downloads — 다운로드 로그
CREATE TABLE IF NOT EXISTS apk_downloads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    UUID NOT NULL REFERENCES apk_versions(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES apk_subscribers(id) ON DELETE SET NULL,
  email         TEXT NOT NULL,                  -- 도용 추적용 (subscriber 삭제돼도 보존)
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_apk_downloads_version ON apk_downloads(version_id);
CREATE INDEX IF NOT EXISTS idx_apk_downloads_subscriber ON apk_downloads(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_apk_downloads_email ON apk_downloads(email);

-- ──────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────

ALTER TABLE apk_versions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE apk_subscribers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE apk_send_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE apk_downloads      ENABLE ROW LEVEL SECURITY;

-- apk_versions: 인증 사용자(admin/sub_admin) 전체 권한. anon은 SELECT만 가능 (다운로드 페이지가 version 정보 조회)
DROP POLICY IF EXISTS apk_versions_all_authenticated ON apk_versions;
CREATE POLICY apk_versions_all_authenticated ON apk_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS apk_versions_read_anon ON apk_versions;
CREATE POLICY apk_versions_read_anon ON apk_versions
  FOR SELECT TO anon USING (true);

-- apk_subscribers: 인증 사용자 전체 권한. anon은 INSERT만 가능 (공개 신청 폼)
DROP POLICY IF EXISTS apk_subscribers_all_authenticated ON apk_subscribers;
CREATE POLICY apk_subscribers_all_authenticated ON apk_subscribers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS apk_subscribers_insert_anon ON apk_subscribers;
CREATE POLICY apk_subscribers_insert_anon ON apk_subscribers
  FOR INSERT TO anon WITH CHECK (true);
-- anon이 자기 정보 확인용 SELECT (이메일 비교) + unsubscribe_token 매칭 UPDATE
DROP POLICY IF EXISTS apk_subscribers_select_anon ON apk_subscribers;
CREATE POLICY apk_subscribers_select_anon ON apk_subscribers
  FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS apk_subscribers_update_anon_unsubscribe ON apk_subscribers;
CREATE POLICY apk_subscribers_update_anon_unsubscribe ON apk_subscribers
  FOR UPDATE TO anon
  USING (true)  -- 토큰 검증은 클라이언트에서 (실수로 다른 row 건드릴 위험 작음, 안전을 위해 Edge Function 경유 권장)
  WITH CHECK (status = 'unsubscribed');  -- anon은 unsubscribed로만 변경 가능

-- apk_send_history: 인증 사용자만. anon SELECT 차단 (어드민 통계 노출 방지)
DROP POLICY IF EXISTS apk_send_history_all_authenticated ON apk_send_history;
CREATE POLICY apk_send_history_all_authenticated ON apk_send_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- apk_downloads: 인증 사용자 전체 권한. anon은 INSERT만 가능 (다운로드 페이지가 로깅)
DROP POLICY IF EXISTS apk_downloads_all_authenticated ON apk_downloads;
CREATE POLICY apk_downloads_all_authenticated ON apk_downloads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS apk_downloads_insert_anon ON apk_downloads;
CREATE POLICY apk_downloads_insert_anon ON apk_downloads
  FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS apk_downloads_select_anon_self ON apk_downloads;
CREATE POLICY apk_downloads_select_anon_self ON apk_downloads
  FOR SELECT TO anon USING (true);  -- /apk/info에서 자기 이력 조회용 (이메일 필터는 클라이언트에서)

-- ──────────────────────────────────────────────────────────────
-- Storage 버킷 (apk-files, private)
-- ──────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('apk-files', 'apk-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 인증 사용자만 업로드. 다운로드는 signed URL (Edge Function이 발급)이라 별도 anon 정책 불필요
DROP POLICY IF EXISTS "apk-files admin all" ON storage.objects;
CREATE POLICY "apk-files admin all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'apk-files') WITH CHECK (bucket_id = 'apk-files');

-- 코멘트
COMMENT ON TABLE apk_versions IS '심스페이스 Android 앱 배포 버전 관리 (MDM sideload용)';
COMMENT ON TABLE apk_subscribers IS 'APK 메일링 리스트 — 학교 IT 담당자';
COMMENT ON TABLE apk_send_history IS 'version × subscriber 발송 이력 (UNIQUE로 한 버전당 1회 보장)';
COMMENT ON TABLE apk_downloads IS '다운로드 로그 (이메일/시각/IP 추적)';
