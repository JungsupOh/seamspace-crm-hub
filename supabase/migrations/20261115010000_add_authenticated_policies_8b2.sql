-- ⚠️ 미적용, James 승인 후, 프런트 전환 배포보다 **먼저** 적용 (021-8b-2)
-- ============================================================
-- authenticated 역할 허용 정책 추가 — 관리자 화면 로그인 토큰 전환의 선행 조건
-- ============================================================
-- 근거   : audit/021-8b2_policy_audit.md §C(격차 표)
-- 롤백   : audit/rollback_8b2_added_policies.sql
--
-- 무엇이 문제인가
--   관리자 화면 일부가 `Authorization: Bearer <공개 anon 키>` 로 rest/v1 을 부른다.
--   021-8b-4 에서 이걸 로그인 세션 토큰(= authenticated 역할)으로 바꾸는데,
--   아래 세 테이블은 **anon 역할에만** 허용 정책이 있고 authenticated 에는 없다.
--   토큰만 바꾸면 RLS 가 조용히 막아서 — 오류 없이 — 목록이 비거나 저장이 실패한다.
--
--     deal_files        : "allow anon all"           [anon/ALL]   → authenticated 없음
--     partner_licenses  : "anon_all_partner_licenses"[anon/ALL]   → authenticated 없음
--     partners          : "anon_all_partners"        [anon/ALL]   → authenticated 는 SELECT만
--
-- 무엇을 바꾸나
--   authenticated 역할 **허용 정책만 추가**한다. 기존 정책은 삭제·수정하지 않는다.
--   → 지금 돌아가는 anon 경로는 그대로라, 적용해도 운영 동작이 바뀌지 않는다.
--   → anon 정책 제거는 이 단위가 아니라 021-8i 에서 한다.
--
--   partners 는 SELECT 를 **일부러 추가하지 않는다**. 이미 있는
--   "authenticated_read_own_partner"(= 본인 소속 파트너 OR admin/sub_admin 은 전체)가
--   의도된 범위다. 여기에 USING(true) SELECT 를 더하면 그 제한이 무력화된다.
--   현재 운영 계정은 admin 2 · sub_admin 3 뿐이라 전체 조회가 되고, 화면은 그대로다.
-- ============================================================

-- ── deal_files ───────────────────────────────────────────────
-- 쓰는 곳: AdminBackfillQuotePdfs.tsx(SELECT), src/lib/storage.ts(INSERT·DELETE)
create policy "authenticated_all_deal_files"
  on public.deal_files
  for all
  to authenticated
  using (true)
  with check (true);

-- ── partner_licenses ────────────────────────────────────────
-- 쓰는 곳: src/lib/partner-licenses.ts(SELECT·UPDATE) — Partners.tsx / PartnerPortal.tsx
create policy "authenticated_all_partner_licenses"
  on public.partner_licenses
  for all
  to authenticated
  using (true)
  with check (true);

-- ── partners (쓰기만) ───────────────────────────────────────
-- 쓰는 곳: Partners.tsx createPartner(:103) / updatePartner(:117) / deletePartner(:126)
create policy "authenticated_insert_partners"
  on public.partners
  for insert
  to authenticated
  with check (true);

create policy "authenticated_update_partners"
  on public.partners
  for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated_delete_partners"
  on public.partners
  for delete
  to authenticated
  using (true);
