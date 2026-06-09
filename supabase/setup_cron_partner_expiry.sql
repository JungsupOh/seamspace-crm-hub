-- ─────────────────────────────────────────────────────────────
-- 파트너 만기 안내 메일 자동 발송 cron
-- 매일 1회 partner-expiry-notify 호출 → 기관별 최소 남은일수 <= 7 인 건을
--   해당 기관 딜 통합하여 파트너 등록 메일로 발송 (멱등).
-- ※ 활성화 전 반드시 dry_run / test_email 로 내용 검증 후 등록 권장.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('partner-expiry-notify-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'partner-expiry-notify-daily');

-- 매일 UTC 00:00 = KST 09:00
SELECT cron.schedule(
  'partner-expiry-notify-daily',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://awosikecivzhwisqzlds.supabase.co/functions/v1/partner-expiry-notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body    := '{"threshold":7}'::jsonb
  );
  $$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'partner-expiry-notify-daily';
