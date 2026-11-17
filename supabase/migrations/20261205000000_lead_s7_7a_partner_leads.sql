-- ⚠️ 미적용. LEAD-S7-7a — 파트너가 직접 넣은 리드 (귀속·보호 기간·동의)
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_7a_partner_leads.sql
-- 드라이런: audit/dryrun_lead_s7_7a_partner_leads.sql
--
-- 왜 새 표가 아니라 `campaign_leads` 에 칸을 더하나 (설계 3장, 요구사항 1)
--   리드는 하나다. 파트너가 넣었든 우리가 넣었든 **같은 깔때기**를 지나고
--   같은 화면에서 보여야 한다(기존 패턴 확장 > 새 병렬 시스템).
--   표를 나누면 중복 판정을 두 표에 걸쳐 해야 하고 — 중복 판정이 이 단계에서
--   **제일 틀리기 쉬운 것** — 한쪽만 보고 "없다"고 답하는 사고가 난다.
--
-- **파트너는 이 표를 직접 읽지 못한다.**
--   정책은 지금 `b2b_campaign_leads_admin`(admin 전용 FOR ALL) 하나뿐이고
--   **여기서 바꾸지 않는다.** 파트너 조회는 전부 엣지 함수 `partner-lead` 를
--   거치고, 함수가 **허용 칸만** 골라서 돌려준다.
--
-- 저장하는 것은 **사실뿐**이다.
--   "지금 보호 중인가"는 저장하지 않고 그때그때 계산한다(설계 3-3).
--   보호 기간을 60일로 바꾸는 결정이 데이터 보정을 요구하면 안 된다.
--
-- 재사용: `last_contact_at` 은 **이미 있다**(국내 흐름이 쓰는 칸). 접촉 연장은
--   그 칸을 그대로 쓴다 — 같은 뜻의 칸을 두 개 두지 않는다.
-- ============================================================================

alter table public.campaign_leads
  add column if not exists partner_id uuid,
  add column if not exists partner_claimed_at timestamptz,
  add column if not exists contact_owner text,
  add column if not exists consent_by uuid,
  add column if not exists consent_at timestamptz;

-- 파트너를 지우려 해도 리드가 있으면 막는다(원장은 지우지 않는다).
alter table public.campaign_leads drop constraint if exists campaign_leads_partner_id_fkey;
alter table public.campaign_leads
  add constraint campaign_leads_partner_id_fkey
  foreign key (partner_id) references public.partners(id) on delete restrict;

-- 연락처 주체: 최종 사용자 / 파트너 대행 (설계 3-4)
alter table public.campaign_leads drop constraint if exists campaign_leads_contact_owner_check;
alter table public.campaign_leads
  add constraint campaign_leads_contact_owner_check
  check (contact_owner is null or contact_owner in ('end_user', 'partner'));

-- 파트너가 넣은 리드는 **셋이 함께** 있어야 한다. 하나라도 빠지면 귀속을 모른다.
alter table public.campaign_leads drop constraint if exists campaign_leads_partner_claim_check;
alter table public.campaign_leads
  add constraint campaign_leads_partner_claim_check
  check (
    (partner_id is null and partner_claimed_at is null and contact_owner is null)
    or
    (partner_id is not null and partner_claimed_at is not null and contact_owner is not null)
  );

-- **최종 사용자**의 정보를 넣었다면 누가·언제 동의를 확인했는지 남아야 한다.
-- 파트너 자신의 연락처(대행)는 동의가 필요 없다.
alter table public.campaign_leads drop constraint if exists campaign_leads_consent_check;
alter table public.campaign_leads
  add constraint campaign_leads_consent_check
  check (
    contact_owner is distinct from 'end_user'
    or (consent_by is not null and consent_at is not null)
  );

-- 파트너별 리드 조회(함수가 쓴다)와 "보호 중인 것 찾기"
create index if not exists idx_campaign_leads_partner
  on public.campaign_leads (partner_id, partner_claimed_at desc)
  where partner_id is not null;

-- 중복 판정이 이메일로 훑는다. 정규화 칸은 이미 있다.
create index if not exists idx_campaign_leads_email_norm
  on public.campaign_leads (email_normalized) where email_normalized is not null;

comment on column public.campaign_leads.partner_id is
  'LEAD-S7-7a. 이 리드를 넣은 파트너. NULL = 우리가 넣은 리드(기존 270건 전부).';
comment on column public.campaign_leads.partner_claimed_at is
  'LEAD-S7-7a. 파트너가 등록한 시각. 보호 기간의 시작점이고, 접촉하면 last_contact_at 으로 연장된다. **보호 여부는 저장하지 않고 계산한다.**';
comment on column public.campaign_leads.contact_owner is
  'LEAD-S7-7a. end_user = 최종 사용자의 연락처(동의 필요) · partner = 파트너 대행(마케팅 발송 제외).';
comment on column public.campaign_leads.consent_by is
  'LEAD-S7-7a. 동의를 확인했다고 체크한 계정. 개인정보가 아니라 **책임 소재**다.';
