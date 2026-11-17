-- ⚠️ 미적용. LEAD-S7-2a — 발급분의 인원·개월
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_2a_ledger.sql (같은 파일에서 함께 되돌린다)
-- 드라이런: audit/dryrun_lead_s7_2a_ledger.sql
-- 선행   : 20261130000000_lead_s7_2a_partner_purchases.sql
--
-- 왜 칸을 더하나
--   잔량을 셀 때 발급분의 **인원·개월**이 필요하다. 지금은 user_count 와 duration 이
--   따로 있어 매번 곱해야 하는데, 규격(플랜·기간)의 뜻이 나중에 바뀌면
--   **과거 발급의 수량이 흔들린다.** 그래서 발급 시점의 곱을 박아 둔다.
--
-- **백필하지 않는다** (요구사항 2)
--   운영 발급은 2건뿐이고, 그 2건을 어떻게 셀지는 화면 단계(S7-2b)에서 James 와 정한다.
--   추측으로 채우면 잔량이 틀리고, 틀린 잔량은 발급 한도를 틀리게 만든다.
--   순수 로직(issuedSeatMonthsOf)은 이 칸이 비면 user_count × duration 으로 세고,
--   그것도 셀 수 없으면 **0 으로 치지 않고** "셀 수 없음"으로 돌려준다.
--
-- 새 발급에서 이 칸을 채우는 것은 **S7-3**(발급 함수)이다. 이번 단계는 칸만 만든다.
-- 테이블을 다시 쓰지 않는다: 기본값이 없는 칸을 더하는 것이라 메타데이터만 바뀐다.
-- ============================================================================

alter table public.partner_licenses
  add column if not exists seat_months bigint;

alter table public.partner_licenses drop constraint if exists partner_licenses_seat_months_check;
alter table public.partner_licenses
  add constraint partner_licenses_seat_months_check
  check (seat_months is null or seat_months > 0);

comment on column public.partner_licenses.seat_months is
  'LEAD-S7-2a. 발급 시점에 박아 둔 인원·개월(= user_count × duration). NULL = 아직 안 박힌 옛 기록이며, 그때는 user_count × duration 으로 센다. 규격의 뜻이 바뀌어도 과거 수량이 흔들리지 않게 하려는 칸이다. 무효화(revoked_at)해도 이 수량은 되돌리지 않는다(James 확정).';
