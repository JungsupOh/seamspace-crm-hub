-- ─────────────────────────────────────────────────────────────
-- 파트너 만기 안내 메일 발송 로그
-- partner-expiry-notify 엣지 함수가 기록. 발송 내역 + 메일 원문(html) 보관.
-- 멱등: (partner_id, org_name, soonest_expire_at)당 성공 1회만 (부분 unique index).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_expiry_emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        uuid,
  partner_name      text,
  partner_email     text,
  org_name          text NOT NULL,
  soonest_expire_at date NOT NULL,         -- 해당 기관 최소 만기일 (트리거 기준)
  soonest_dday      int,                   -- 발송 시점 D-day
  license_count     int  DEFAULT 0,        -- 메일에 포함된 이용권 수
  license_ids       jsonb DEFAULT '[]'::jsonb,
  subject           text,
  html              text,                  -- 메일 원문 (대시보드에서 열람)
  status            text NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed' | 'skipped'
  error             text,
  resend_id         text,
  triggered_by      text DEFAULT 'cron',   -- 'cron' | 'manual' | 'test'
  sent_at           timestamptz NOT NULL DEFAULT now()
);

-- 멱등: 같은 (파트너, 기관, 최소만기일)로 '성공' 발송은 1회만
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_expiry_sent
  ON partner_expiry_emails (partner_id, org_name, soonest_expire_at)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_partner_expiry_sent_at
  ON partner_expiry_emails (sent_at DESC);

-- RLS: 다른 테이블과 동일 정책 (anon 전체 허용 — 운영 어드민 전용 앱)
ALTER TABLE partner_expiry_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_expiry_emails_all ON partner_expiry_emails;
CREATE POLICY partner_expiry_emails_all ON partner_expiry_emails
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
