-- ─────────────────────────────────────────────────────────────
-- CRM 운영DB 동기화 cron — 안전망 (webhook 보강)
-- ─────────────────────────────────────────────────────────────
-- 주 동기화 메커니즘: mDiary 백엔드 → /functions/v1/coupon-webhook (실시간)
-- 본 cron 의 역할: webhook 누락/장애 대비 + 사용자 발급 직후 ~ activated 사이의
--                새 쿠폰 메타 회수 (webhook 은 activated 시점에만 발화하므로)
--
-- 빈도: 매일 1회. KST 새벽 4~5시 (UTC 19~20시) — 운영 트래픽 적은 시간대.
-- ─────────────────────────────────────────────────────────────

-- 1. pg_net (HTTP 호출용)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. 기존 cron 모두 제거 (재실행 안전)
SELECT cron.unschedule('sync-new-coupons-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-new-coupons-daily');
SELECT cron.unschedule('sync-coupon-status-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-coupon-status-daily');
-- 기존 매시간 동기화도 제거 (혹시 남아있다면)
SELECT cron.unschedule('sync-coupon-status')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-coupon-status');

-- 3. (필요 시) Vault 시크릿 등록 — Supabase Dashboard → Settings → Vault → New secret
--    Name:  supabase_service_role_key
--    Value: (Settings → API → service_role 키)
--    ※ 본 SQL 실행 전 시크릿이 이미 등록돼 있어야 합니다.

-- 4-1. 매일 KST 04:00 (UTC 19:00) — 신규 쿠폰 메타 동기화
--   webhook 은 activated 시점에만 발화하므로, mDiary 에 갓 발급된 unused 쿠폰들의
--   metadata(coupon_code/duration/user_limit/descript)는 polling 으로 회수해야 함.
SELECT cron.schedule(
  'sync-new-coupons-daily',
  '0 19 * * *',  -- UTC 19:00 = KST 04:00
  $$
  SELECT net.http_post(
    url     := 'https://awosikecivzhwisqzlds.supabase.co/functions/v1/sync-new-coupons',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- 4-2. 매일 KST 05:00 (UTC 20:00) — 사용 상태 안전망 동기화
--   webhook 누락/장애 시 fallback. 정상이라면 변경 0건이어야 함.
--   limit=500 으로 한 번에 처리 (대부분 활성 쿠폰 수가 그 이하).
SELECT cron.schedule(
  'sync-coupon-status-daily',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://awosikecivzhwisqzlds.supabase.co/functions/v1/get-coupon-status',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body    := '{"limit":500}'::jsonb
  );
  $$
);

-- 5. 등록 확인
SELECT jobname, schedule, active
  FROM cron.job
 WHERE jobname IN ('sync-new-coupons-daily', 'sync-coupon-status-daily')
 ORDER BY schedule;

-- 6. (선택) 실행 이력 확인
-- SELECT jobid, jobname, start_time, end_time, status, return_message
--   FROM cron.job_run_details
--  WHERE jobname IN ('sync-new-coupons-daily', 'sync-coupon-status-daily')
--  ORDER BY start_time DESC LIMIT 10;

-- ─────────────────────────────────────────────────────────────
-- 향후 (webhook 안정화 후, 1~2개월 모니터링 후):
--   - sync-coupon-status-daily 를 주 1회로 더 줄이거나 제거
--   - sync-new-coupons-daily 는 유지 (webhook 발화 전 단계 쿠폰 처리용)
-- ─────────────────────────────────────────────────────────────
