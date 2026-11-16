-- ⚠️ 미적용. HARD-B1. 선행: 20261117000000_b1_role_helper.sql
-- ==========================================================
-- alimtalk_send_logs — 공개 키 전체 허용 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b1_alimtalk_send_logs.sql
-- 드라이런: audit/dryrun_b1_alimtalk_send_logs.sql
--
-- 왜 닫아도 되나
--   조회 1곳(lib/alimtalk.ts:76)뿐이고 021-8b-4 에서 전환됐다.
--   기록은 send-alimtalk(SERVICE_ROLE)가 한다 — service_role 은 RLS 를 우회하므로
--   "service_role full" 정책은 사실 쓰이지 않는 껍데기였다(roles 가 public 이라 이름과도 다르다).
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "anon read"  SELECT / {public} / PERMISSIVE
--      USING      = true
--      WITH CHECK = (없음)
--   "service_role full"  ALL / {public} / PERMISSIVE
--      USING      = true
--      WITH CHECK = (없음)
-- ==========================================================

drop policy if exists "anon read" on public.alimtalk_send_logs;
drop policy if exists "service_role full" on public.alimtalk_send_logs;

create policy "b1_alimtalk_send_logs_admin"
  on public.alimtalk_send_logs for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
