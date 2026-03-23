-- 이용권 상태 자동 동기화 Cron 설정
-- Supabase SQL Editor에서 실행

-- 1. pg_net 확장 활성화 (HTTP 호출용)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. 기존 cron 제거 (재설정 시)
SELECT cron.unschedule('sync-coupon-status')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-coupon-status');

-- 3. 1시간마다 자동 동기화
-- ⚠️  아래 <ANON_KEY> 를 Supabase Dashboard > Settings > API > anon public 키로 교체하세요
SELECT cron.schedule(
  'sync-coupon-status',
  '0 * * * *',  -- 매시간 정각
  $$
  SELECT net.http_post(
    url     := 'https://awosikecivzhwisqzlds.supabase.co/functions/v1/get-coupon-status',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <ANON_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 4. 등록 확인
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'sync-coupon-status';
