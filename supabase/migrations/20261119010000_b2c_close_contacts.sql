-- ⚠️ 미적용. HARD-B2c. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ============================================================
-- contacts — 공개 키 정책을 닫는다
-- ============================================================
-- 롤백   : audit/rollback_b2c_contacts.sql
-- 드라이런: audit/dryrun_b2c_contacts.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /order 가 접수·미리보기 때 contacts 를 공개 키로 직접 읽고 썼다.
--   HARD-B2c 에서 order-submit-quote 안으로 옮겼다(service_role).
--   공개 라우트 도달 anon 호출 0건 — 호출 그래프로 재증명(문서 §B-3).
--   관리자 /contacts·/campaigns 는 021-8b-4 에서 로그인 토큰으로 전환됐다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "anon_contacts_all"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
-- ============================================================

drop policy if exists "anon_contacts_all" on public.contacts;

create policy "b2c_contacts_admin"
  on public.contacts for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
