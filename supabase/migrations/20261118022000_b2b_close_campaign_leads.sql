-- ⚠️ 미적용. HARD-B2b. **서버 함수 배포 + 프런트 배포 + 스모크 통과 뒤**에 적용한다.
-- ==========================================================
-- campaign_leads — 공개 키 정책을 닫는다
-- ==========================================================
-- 롤백   : audit/rollback_b2b_campaign_leads.sql
-- 드라이런: audit/dryrun_b2b_campaign_leads.sql
-- 선행   : 20261117000000_b1_role_helper.sql (app_is_admin — 운영 적용됨)
--
-- 왜 닫아도 되나
--   공개 /c 의 리드 등록이 H-2 에서 campaign-submit-lead(service_role)로 옮겨졌다.
--   public_insert_leads 도 더는 쓰이지 않는다 — 서버가 service_role 로 넣는다.
--
-- 삭제하는 정책 (운영본 정의 그대로)
--   "all_campaign_leads"  ALL / {public}
--      USING      = true
--      WITH CHECK = true
--   "public_insert_leads"  INSERT / {public}
--      USING      = (없음)
--      WITH CHECK = true
-- ==========================================================

drop policy if exists "all_campaign_leads" on public.campaign_leads;
drop policy if exists "public_insert_leads" on public.campaign_leads;

create policy "b2b_campaign_leads_admin"
  on public.campaign_leads for all to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );
