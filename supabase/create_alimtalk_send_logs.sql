-- 알림톡 발송 이력 테이블
-- 단계별 1회 보장 (재발송 방지) + 발송 이력 추적

CREATE TABLE IF NOT EXISTS alimtalk_send_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id      text NOT NULL,
  license_source  text NOT NULL CHECK (license_source IN ('deal', 'mdiary', 'campaign')),
  tpl_code        text NOT NULL,                -- 'UD_5369' | 'UH_2821' 등
  stage           text NOT NULL,                -- 'D-7' | 'D-3' | 'D-1' | 'UH_initial' 등
  receiver_phone  text NOT NULL,
  receiver_name   text,
  payload         jsonb NOT NULL,               -- 발송 시점 전체 페이로드 보관
  sent_at         timestamptz NOT NULL DEFAULT now(),
  sent_by         text,                         -- admin email
  success         boolean NOT NULL DEFAULT true,
  error_message   text
);

-- 단계별 1회 보장: 같은 라이선스 + 같은 템플릿 + 같은 단계의 성공 발송은 1건만 허용
CREATE UNIQUE INDEX IF NOT EXISTS alimtalk_send_logs_unique
  ON alimtalk_send_logs (license_id, license_source, tpl_code, stage)
  WHERE success = true;

-- 최근 이력 조회 인덱스 (대시보드 30일 이내 로그 조회용)
CREATE INDEX IF NOT EXISTS alimtalk_send_logs_recent
  ON alimtalk_send_logs (sent_at DESC);

-- 라이선스별 조회 인덱스
CREATE INDEX IF NOT EXISTS alimtalk_send_logs_license
  ON alimtalk_send_logs (license_id, license_source);

-- RLS
ALTER TABLE alimtalk_send_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full" ON alimtalk_send_logs;
CREATE POLICY "service_role full"
  ON alimtalk_send_logs FOR ALL
  USING (true);

DROP POLICY IF EXISTS "anon read" ON alimtalk_send_logs;
CREATE POLICY "anon read"
  ON alimtalk_send_logs FOR SELECT
  USING (true);
