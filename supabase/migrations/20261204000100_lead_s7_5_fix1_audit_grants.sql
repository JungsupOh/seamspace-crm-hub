-- ⚠️ 미적용. LEAD-S7-5 fix1 — 감사 기록 표의 쓰기 권한 거두기
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_5_fix1_grants.sql
-- 드라이런: audit/dryrun_lead_s7_5_fix1_grants.sql
--
-- 무엇을 놓쳤나 (운영 적용 뒤 읽기 전용 확인에서 찾음, 2026-11-18)
--   20261203000000 에서 `revoke all ... from anon, public` 과
--   `grant select ... to authenticated` 를 했다. anon 은 제대로 비었는데
--   **authenticated 에는 arwdDxtm(전부) 가 그대로 남아 있었다.**
--
--     relacl = postgres=arwdDxtm/postgres
--              authenticated=arwdDxtm/postgres   ← 이것
--              service_role=arwdDxtm/postgres
--
--   Supabase 가 `alter default privileges ... grant all on tables to authenticated`
--   를 걸어 두어, 표를 만드는 순간 전부가 붙는다. `grant select` 는 **이미 있는 것에
--   더하기**라 아무것도 좁히지 못했다. **거두지 않으면 좁아지지 않는다.**
--
-- 지금 뚫려 있나 — **아니다.**
--   INSERT 정책이 0개이고 RLS 가 켜져 있어 지금은 모든 INSERT 가 막힌다.
--   UPDATE·DELETE 도 restrictive `using(false)` 가 막는다.
--   그래도 거둔다: **표 권한이 열려 있으면, 나중에 누가 INSERT 정책을 하나
--   더하는 순간 조용히 뚫린다.** 두 겹으로 막아 두는 쪽이 맞다.
--
-- 기존 동작에 영향 없음: service_role(엣지 함수)은 그대로고,
-- 읽기(SELECT)도 그대로다. 거두는 것은 쓰기뿐이다.
-- ============================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.partner_audit_log from authenticated;

-- 읽기는 다시 한 번 분명히 해 둔다(위 revoke 가 select 를 건드리지 않지만,
-- 이 파일만 읽고도 무엇이 남는지 알 수 있게).
grant select on public.partner_audit_log to authenticated;

comment on table public.partner_audit_log is
  'LEAD-S7-5. 파트너 계정 사건 기록. authenticated 는 **읽기만**(fix1), 쓰기는 service_role 뿐. 아무도 고치거나 지울 수 없다.';
