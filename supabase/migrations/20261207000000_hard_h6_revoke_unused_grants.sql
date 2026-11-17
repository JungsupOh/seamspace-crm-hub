-- ⚠️ 미적용. H-6 — 쓰지 않는 권한 거두기
-- ============================================================================
-- 롤백   : audit/rollback_hard_h6_grants.sql
-- 드라이런: audit/dryrun_hard_h6_grants.sql
--
-- 왜 하나 (S7-5 fix1 에서 찾은 것)
--   Supabase 가 `alter default privileges ... grant all on tables to authenticated`
--   를 걸어 두어, 표를 만드는 순간 **authenticated 에 전부**가 붙는다.
--   `grant select` 는 더하기라 아무것도 좁히지 못한다 — **거두어야 좁아진다.**
--
--   지금 열두 표 모두 `TRUNCATE·REFERENCES·TRIGGER` 를 갖고 있다. 셋 다
--   **앱이 한 번도 쓰지 않는다.** TRUNCATE 는 원장을 통째로 비우는 명령이고,
--   REFERENCES·TRIGGER 는 남의 표에 외래키·트리거를 걸 수 있게 한다.
--   RLS 가 지금 막고 있지만(TRUNCATE 는 **RLS 가 막지 않는다**), 권한이 열려
--   있으면 정책이 하나 느슨해지는 순간 조용히 뚫린다.
--
-- ⚠️ **TRUNCATE 는 RLS 를 지나가지 않는다.** 정책이 아무리 단단해도 권한이
--    있으면 표가 비워진다. 열두 표 중 열하나가 원장이다. 이것만으로도 할 값이 있다.
--
-- DELETE 는 **표마다 다르다**
--   삭제 불가(restrictive delete `using(false)`)로 지키는 원장에서는 DELETE 권한도
--   거둔다 — 정책과 권한, 두 겹이다.
--   **`lead_cc_links` 는 예외다.** 삭제 금지 정책이 없고(0건), 앱이 실제로 DELETE 를
--   쓴다(`src/lib/leadsApi.ts:385` `setCcLink(..., on=false)` — CC 를 해제한다).
--   여기서 DELETE 를 거두면 **CC 해제가 깨진다.** 그래서 건드리지 않는다.
--   `partner_licenses` 는 S7-3 fix1 에서 이미 거뒀다(그대로 둔다 — 멱등).
--
-- INSERT·UPDATE·SELECT 는 **건드리지 않는다** — 관리자 화면과 함수가 쓴다.
-- ============================================================================

-- ── ① 열두 표 전부: 아무도 쓰지 않는 셋 ──
revoke truncate, references, trigger on public.partner_contracts    from authenticated;
revoke truncate, references, trigger on public.partner_purchases    from authenticated;
revoke truncate, references, trigger on public.partner_requests     from authenticated;
revoke truncate, references, trigger on public.partner_licenses     from authenticated;
revoke truncate, references, trigger on public.lead_activities      from authenticated;
revoke truncate, references, trigger on public.lead_strategies      from authenticated;
revoke truncate, references, trigger on public.lead_signals         from authenticated;
revoke truncate, references, trigger on public.lead_outreach_drafts from authenticated;
revoke truncate, references, trigger on public.lead_research_notes  from authenticated;
revoke truncate, references, trigger on public.lead_cc_links        from authenticated;
revoke truncate, references, trigger on public.outreach_facts       from authenticated;
revoke truncate, references, trigger on public.outreach_fact_log    from authenticated;

-- ── ② 삭제 불가로 지키는 원장: DELETE 도 거둔다 (lead_cc_links 는 **제외**) ──
revoke delete on public.partner_contracts    from authenticated;
revoke delete on public.partner_purchases    from authenticated;
revoke delete on public.partner_requests     from authenticated;
revoke delete on public.partner_licenses     from authenticated;  -- 이미 없음(멱등)
revoke delete on public.lead_activities      from authenticated;
revoke delete on public.lead_strategies      from authenticated;
revoke delete on public.lead_signals         from authenticated;
revoke delete on public.lead_outreach_drafts from authenticated;
revoke delete on public.lead_research_notes  from authenticated;
revoke delete on public.outreach_facts       from authenticated;
revoke delete on public.outreach_fact_log    from authenticated;

-- ⚠️ `lead_cc_links` 의 DELETE 는 **일부러 남긴다** — CC 해제가 쓴다.
--    대신 그 표가 원장이 되어야 한다고 판단되면, 먼저 화면을 "해제" 대신
--    "무효 처리" 로 바꾼 뒤에 거두어야 한다. 순서를 거꾸로 하면 화면이 깨진다.

comment on table public.lead_cc_links is
  'CC 연결. ⚠️ H-6: 이 표만 DELETE 권한을 남겼다 — 화면의 "CC 해제"(leadsApi.setCcLink)가 실제로 지운다. 원장으로 바꾸려면 화면을 먼저 고쳐라.';
