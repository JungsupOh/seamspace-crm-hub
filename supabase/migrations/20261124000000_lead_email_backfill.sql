-- LEAD 후속 (제시카 작성, 2026-11-17): 기존 리드의 email_normalized 채우기
-- 이유: 해외 명단 가져오기의 중복 판정이 email_normalized 만 본다. LEAD-2 마이그레이션 전에 생긴
--       리드(이메일은 있고 email_normalized 는 NULL)가 중복으로 잡히지 않아 이미 등록된 부스 리드가 다시 들어온다.
-- 규칙: 코드 normalizeLeadEmail 과 같다(trim + lower). 파생 칸만 채우고 원본 email 은 건드리지 않는다.
-- 롤백: update public.campaign_leads set email_normalized = null where id in (선택) — 또는 audit/rollback_lead_email_backfill.sql
update public.campaign_leads
   set email_normalized = lower(btrim(email))
 where email_normalized is null
   and email is not null
   and btrim(email) <> '';
