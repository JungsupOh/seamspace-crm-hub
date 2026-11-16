-- ⚠️ 미적용. LEAD-2 (CRM-011) — 시장 모드(KR/INTL)와 해외 이메일 열쇠
-- ============================================================================
-- 롤백   : audit/rollback_lead2.sql
-- 드라이런: audit/dryrun_lead2.sql
--
-- 무엇을 하나
--   ① campaigns.market        캠페인의 시장 모드 (KR 기본)
--   ② campaign_leads.market   리드 자신의 시장 모드 (KR 기본)
--                             — 엑셀 가져오기·수동 등록은 캠페인 없이도 들어오므로
--                               리드가 자기 열쇠를 알아야 한다.
--   ③ campaign_leads.email_normalized  해외 중복 판정 열쇠 (lower(trim(email)))
--   ④ campaign_leads.phone    NOT NULL **해제**
--
-- 왜 ④ 가 필요한가
--   해외 리드는 휴대폰이 없는 경우가 많고(브리프 A항) 이메일이 열쇠다.
--   NOT NULL 해제는 **완화**이므로 기존에 값을 넣어 온 코드는 전부 그대로 동작한다.
--   읽는 쪽에서 null 이면 깨지던 3곳은 코드에서 `?? ''` 로 보강했다
--   (Campaigns.tsx:1259·1495·1625 — audit/lead2_market_mode.md §2).
--
-- 안전장치
--   · 기존 열 삭제·형변경·데이터 변경 없음.
--   · 새 열은 전부 기본값이 있거나 NULL 허용 → 기존 행과 기존 INSERT 가 그대로 동작.
--   · DEFAULT 'KR' 이라 **기존 23,000여 행과 기존 모든 INSERT 는 국내로 남는다.**
--   · UNIQUE 제약을 만들지 않는다 — 운영에 이미 중복이 있으면 적용이 실패하고,
--     기존 데이터를 막게 된다. 중복 검사는 등록 경로 3곳의 앱 코드가 한다.
--   · 여러 번 돌려도 같은 결과(IF NOT EXISTS).
-- ============================================================================

-- ① 캠페인 시장 모드
alter table public.campaigns
  add column if not exists market text not null default 'KR';

alter table public.campaigns
  drop constraint if exists campaigns_market_check;
alter table public.campaigns
  add constraint campaigns_market_check check (market in ('KR', 'INTL'));

-- ② 리드 시장 모드
alter table public.campaign_leads
  add column if not exists market text not null default 'KR';

alter table public.campaign_leads
  drop constraint if exists campaign_leads_market_check;
alter table public.campaign_leads
  add constraint campaign_leads_market_check check (market in ('KR', 'INTL'));

-- ③ 해외 중복 판정 열쇠. 앱이 lower(trim(email)) 로 채운다.
--    생성 열(GENERATED)로 두지 않은 이유: 입구가 셋(공개 폼 서버 함수·가져오기·수동 등록)이고
--    모두 앱 코드라 한 곳(src/lib/leadMarket.ts)에서 계산하면 된다.
alter table public.campaign_leads
  add column if not exists email_normalized text;

-- 해외 중복 조회용. UNIQUE 가 아니다(위 '안전장치' 참고).
create index if not exists idx_campaign_leads_email_norm
  on public.campaign_leads (email_normalized);

-- 시장별 목록 조회용
create index if not exists idx_campaign_leads_market
  on public.campaign_leads (market);

-- ④ phone NOT NULL 해제 (완화)
alter table public.campaign_leads
  alter column phone drop not null;
