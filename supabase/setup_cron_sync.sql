-- ─────────────────────────────────────────────────────────────
-- CRM 전체 자동 동기화 — 매일 KST 18:00 (= UTC 09:00)
-- ─────────────────────────────────────────────────────────────
-- 동기화 대상 (mDiary 운영DB → CRM):
--   1. sync-new-coupons      — 새 쿠폰을 mdiary_coupons 에 추가
--   2. get-coupon-status     — 기존 쿠폰의 사용 상태/만료일/멤버수 갱신
--                              → deal_licenses + campaign_licenses + mdiary_coupons 모두 반영
-- 캠페인/이용권/딜관리/고객DB/대시보드 화면은 모두 위 테이블을 조회하므로
-- 이 한 번의 동기화로 전체 CRM 데이터가 최신화됨.
-- ─────────────────────────────────────────────────────────────

-- 1. pg_net (HTTP 호출용)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. 기존 cron 제거 (재실행 안전)
SELECT cron.unschedule('sync-new-coupons-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-new-coupons-daily');
SELECT cron.unschedule('sync-coupon-status-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-coupon-status-daily');
-- 기존 매시간 동기화도 함께 제거 (필요하면 아래 주석 해제)
-- SELECT cron.unschedule('sync-coupon-status')
--   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-coupon-status');

-- 3. SERVICE_ROLE_KEY 를 Supabase Vault 에서 안전하게 꺼내 사용
--    (이 SQL을 실행하기 전에 Vault 에 'supabase_service_role_key' 시크릿이 있는지 확인)
--    없으면 임시로 아래 <SERVICE_ROLE_KEY> 자리에 service_role 키를 하드코딩.

-- 4-1. 매일 KST 18:00 (UTC 09:00) — 새 쿠폰 추가
SELECT cron.schedule(
  'sync-new-coupons-daily',
  '0 9 * * *',  -- UTC 09:00 = KST 18:00
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

-- 4-2. 매일 KST 18:05 (UTC 09:05) — 기존 쿠폰 상태 갱신
--   sync-new-coupons 가 먼저 끝나도록 5분 텀
--   limit=500 을 한번에 보내서 페이지 1회로 처리 (작은 DB 부하 환경에서는 충분).
--   500건 초과 시 hasMore=true 가 돼서 다음날까지 남은 행은 다음 cron 실행에서 처리됨.
SELECT cron.schedule(
  'sync-coupon-status-daily',
  '5 9 * * *',
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
SELECT jobname, schedule, active, command
  FROM cron.job
 WHERE jobname IN ('sync-new-coupons-daily', 'sync-coupon-status-daily')
 ORDER BY schedule;

-- 6. (선택) 실행 이력 확인
-- SELECT jobid, jobname, start_time, end_time, status, return_message
--   FROM cron.job_run_details
--  WHERE jobname IN ('sync-new-coupons-daily', 'sync-coupon-status-daily')
--  ORDER BY start_time DESC LIMIT 10;

-- ─────────────────────────────────────────────────────────────
-- Vault 시크릿 등록 방법 (1회만):
--   Supabase Dashboard → Settings → Vault → New secret
--     Name:  supabase_service_role_key
--     Value: (Settings → API → service_role 키 복사)
-- 등록 후 본 SQL을 다시 실행하면 cron 이 시크릿을 자동 사용.
-- ─────────────────────────────────────────────────────────────
