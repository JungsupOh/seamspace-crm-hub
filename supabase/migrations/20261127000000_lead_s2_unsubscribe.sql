-- ⚠️ 미적용. LEAD-S2 S2-1 — 수신 거부 (해외 메일 발송의 선행 조건)
-- ============================================================================
-- 롤백   : audit/rollback_lead_s2_unsubscribe.sql
-- 드라이런: audit/dryrun_lead_s2_unsubscribe.sql
--
-- 왜 지금 필요한가
--   LEAD-S1 로 메일에 쓸 문장까지 갖춰졌고, LEAD-UI2 의 CC 결정 때문에 **한 번에 여러
--   사람에게** 나갈 수 있게 됐다. 수신 거부 수단 없이 콜드 아웃리치를 보내면
--   싱가포르 PDPA·EU GDPR/PECR·미국 CAN-SPAM 의 요건을 못 맞춘다(법무 확인 필요).
--
-- ⚠️⚠️ **적용 비용 — 이 마이그레이션만 다르다.**
--   `unsubscribe_token uuid not null default gen_random_uuid()` 는 기본값이
--   **행마다 다른 값**이라, Postgres 의 "기본값만 메타데이터에 적는" 최적화가 **통하지 않는다.**
--   즉 테이블 전체를 다시 쓴다(rewrite). `campaign_leads` 는 **270행**이라 실제로는
--   순식간이지만, 그 동안 테이블에 ACCESS EXCLUSIVE 락이 걸린다.
--   · 270행 규모에서는 수십 밀리초 수준이다.
--   · 그래도 **공개 폼 제출이 몰리는 시간대는 피하는 편이 낫다**(그때 INSERT 가 잠깐 기다린다).
--   · 행이 수십만으로 늘어난 뒤에 이 방식으로 칸을 더하면 오래 잠긴다. 그때는
--     NULL 허용으로 추가 → 배치로 채움 → NOT NULL 로 조이는 3단계를 쓴다.
--
--   UNIQUE 인덱스도 함께 만든다(토큰으로 리드를 찾는 유일한 길이다).
--
-- 안전장치: 기존 데이터를 **바꾸지 않는다**(새 칸만 채운다). 기존 열·제약은 그대로.
-- ============================================================================

alter table public.campaign_leads
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- 토큰으로 찾는다. UNIQUE 라 같은 토큰이 두 리드를 가리킬 수 없다.
create unique index if not exists uq_campaign_leads_unsub_token
  on public.campaign_leads (unsubscribe_token);

alter table public.campaign_leads
  add column if not exists unsubscribed_at timestamptz;

-- 거부한 사람만 인덱스에 담는다(대부분 null). 억제 규칙 조회용.
create index if not exists idx_campaign_leads_unsubscribed
  on public.campaign_leads (unsubscribed_at) where unsubscribed_at is not null;
