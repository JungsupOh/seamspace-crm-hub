-- ⚠️ 미적용. LEAD-S2 S2-2 — 아웃리치 초안
-- ============================================================================
-- 롤백   : audit/rollback_lead_s2_outreach_drafts.sql
-- 드라이런: audit/dryrun_lead_s2_outreach_drafts.sql
-- 선행   : 20261126001000(lead_strategies) · 20261127000000 · b1_role_helper
--
-- **CRM 은 메일을 보내지 않는다**(제시카 추천, James 결정 전까지). 이 표는
-- 초안 작성 → 승인 → 예약 → "발송 완료 기록" 까지의 **상태**만 들고 있다.
-- 실제 발송은 James 계정으로 제시카가 하고, 돌아와서 "발송 완료"를 누른다.
--
--   · 삭제 불가. 취소는 `status='cancelled'` + 사유.
--   · **승인된 초안은 본문을 고칠 수 없다** — 트리거가 아니라 앱이 막는다
--     (트리거를 쓰면 되돌리기가 어렵고, 이 저장소는 순수 SQL 단순 유지 원칙이다).
--     대신 status 흐름을 CHECK 로 좁혀 두고, 화면이 복제를 권한다.
-- ============================================================================

create table if not exists public.lead_outreach_drafts (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.campaign_leads(id) on delete restrict,
  -- 어느 전략 판으로 쓴 초안인가(선택). 전략은 지울 수 없으므로 restrict 가 안전하다.
  strategy_id uuid references public.lead_strategies(id) on delete restrict,

  language    text not null default 'en',
  subject     text,
  body        text,

  status      text not null default 'draft',

  -- 이 초안이 쓴 확정 사실(outreach_facts.id 목록). 전략의 fact_ids 와 같은 모양.
  fact_ids    jsonb not null default '[]'::jsonb,

  -- ⚠️ **승인 시점의** CC 대상을 박아 둔다. lead_cc_links 는 나중에 바뀔 수 있어서,
  --    "그때 누구를 참조에 넣기로 했는지" 가 남지 않으면 발송 기록을 믿을 수 없다.
  cc_snapshot jsonb not null default '[]'::jsonb,

  -- 받는 사람 현지 시각 기준으로 고른 예약 시각(저장은 timestamptz).
  scheduled_at timestamptz,

  approved_by uuid,
  approved_at timestamptz,
  sent_at     timestamptz,
  -- 발송 완료를 누를 때 만든 활동 기록. 그 기록이 n차 접촉의 근거가 된다.
  sent_activity_id uuid references public.lead_activities(id) on delete set null,

  cancelled_reason text,

  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.lead_outreach_drafts drop constraint if exists lead_outreach_drafts_status_check;
alter table public.lead_outreach_drafts
  add constraint lead_outreach_drafts_status_check
  check (status in ('draft', 'approved', 'scheduled', 'sent', 'cancelled'));

alter table public.lead_outreach_drafts drop constraint if exists lead_outreach_drafts_lang_check;
alter table public.lead_outreach_drafts
  add constraint lead_outreach_drafts_lang_check check (language in ('en', 'ko'));

-- 취소에는 사유가 있어야 한다(원장 성격 — 왜 접었는지가 남아야 한다).
alter table public.lead_outreach_drafts drop constraint if exists lead_outreach_drafts_cancel_check;
alter table public.lead_outreach_drafts
  add constraint lead_outreach_drafts_cancel_check
  check (status <> 'cancelled' or coalesce(trim(cancelled_reason), '') <> '');

create index if not exists idx_lead_outreach_drafts_lead
  on public.lead_outreach_drafts (lead_id, created_at desc);
create index if not exists idx_lead_outreach_drafts_status
  on public.lead_outreach_drafts (status, scheduled_at);

-- ── 보안 ──
alter table public.lead_outreach_drafts enable row level security;

drop policy if exists "lead_outreach_drafts_admin" on public.lead_outreach_drafts;
create policy "lead_outreach_drafts_admin"
  on public.lead_outreach_drafts for all to authenticated
  using ( public.app_is_admin() ) with check ( public.app_is_admin() );

-- 초안은 지우지 않는다 — 취소도 기록이다(무엇을 쓰려다 접었는지).
drop policy if exists "lead_outreach_drafts_no_delete" on public.lead_outreach_drafts;
create policy "lead_outreach_drafts_no_delete"
  on public.lead_outreach_drafts as restrictive for delete to authenticated using ( false );

revoke all on public.lead_outreach_drafts from anon;
revoke all on public.lead_outreach_drafts from public;

-- 상태를 바꾸려면 UPDATE 가 필요하다. DELETE 는 주지 않는다.
grant select, insert, update on public.lead_outreach_drafts to authenticated;
