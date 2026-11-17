-- ⚠️ 미적용. LEAD-S7-8 — 미수금 알림 기록
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_8_receivable_alerts.sql
-- 드라이런: audit/dryrun_lead_s7_8_receivable_alerts.sql
--
-- 이 표가 있는 이유는 **같은 말을 두 번 하지 않기 위해서**다.
--   미수금 알림은 날마다 돌 수 있고, 경과일은 날마다 늘어난다. 기록이 없으면
--   30일이 된 날부터 60일까지 **서른 번** 같은 알림이 간다. 파트너에게 가는
--   것이면 더 나쁘다. 그래서 "이 구매의 이 단계는 이미 보냈다"를 남긴다.
--
--   `(purchase_id, stage, sent_to)` 에 **유일 인덱스**를 걸어, 두 번째 시도는
--   코드가 아니라 **DB 가** 막는다. 함수가 두 번 돌아도(겹쳐 돌아도) 안전하다.
--
-- 알림 기록은 원장이다 — **지우지 못한다.**
--   "보냈다"는 사실은 나중에 "왜 또 보냈냐"·"왜 안 보냈냐"를 가리는 증거다.
--   잘못 보낸 것은 지우는 대신 `voided_at`·`void_reason` 으로 표시한다.
-- ============================================================================

create table if not exists public.partner_receivable_alerts (
  id          uuid primary key default gen_random_uuid(),

  purchase_id uuid not null references public.partner_purchases(id) on delete restrict,
  contract_id uuid     references public.partner_contracts(id) on delete restrict,
  partner_id  uuid not null references public.partners(id) on delete restrict,

  -- 'd30' = 우리에게만, 'd60' = 우리 + 파트너 담당자
  stage       text not null check (stage in ('d30', 'd60')),
  -- 'internal' = 텔레그램(우리), 'partner' = 파트너 담당자 메일
  sent_to     text not null check (sent_to in ('internal', 'partner')),

  -- 보낼 때의 사실을 **그대로** 남긴다(나중에 계산이 바뀌어도 그때 무엇을 보고
  -- 보냈는지 알 수 있어야 한다). 개인정보는 넣지 않는다 — 금액·통화·일수뿐.
  days_elapsed    integer,
  outstanding     numeric,
  currency        text,

  sent_at     timestamptz not null default now(),
  -- 실제로 보냈는가. 거짓이면 **보내려 했지만 실패**한 것이다(그래도 기록은 남는다).
  delivered   boolean not null default true,
  note        text,

  voided_at   timestamptz,
  void_reason text,

  created_at  timestamptz not null default now()
);

-- **같은 구매·같은 단계·같은 상대에게 두 번 보내지 않는다.**
-- 무효 처리한 기록은 세지 않는다(다시 보낼 수 있어야 한다).
create unique index if not exists uniq_receivable_alert_once
  on public.partner_receivable_alerts (purchase_id, stage, sent_to)
  where voided_at is null;

create index if not exists idx_receivable_alert_partner
  on public.partner_receivable_alerts (partner_id, sent_at desc);

alter table public.partner_receivable_alerts enable row level security;

-- 읽기는 우리만. **파트너에게는 보이지 않는다** — 자기 미수금 독촉 이력을
-- 들여다보게 할 이유가 없고, 보여 주면 "왜 저쪽은 안 받았나"가 따라온다.
create policy "partner_receivable_alerts_select"
  on public.partner_receivable_alerts for select to authenticated
  using ( public.app_is_admin() );

-- 넣는 것은 service_role(함수)뿐 — INSERT 정책을 두지 않는다.

-- 고칠 수 있는 것은 **무효 처리뿐**이고, 그것도 admin 만.
create policy "partner_receivable_alerts_void"
  on public.partner_receivable_alerts for update to authenticated
  using ( public.app_is_admin() )
  with check ( public.app_is_admin() );

-- **아무도 지우지 못한다.**
create policy "partner_receivable_alerts_no_delete"
  on public.partner_receivable_alerts as restrictive for delete to public
  using ( false );

revoke all on public.partner_receivable_alerts from anon;
revoke all on public.partner_receivable_alerts from public;
-- ⚠️ `grant` 는 **더하기**다. Supabase 의 default privileges 가 표를 만드는 순간
--    authenticated 에 전부를 붙이므로, **먼저 거두고** 필요한 것만 준다
--    (S7-5 fix1 에서 이것을 놓쳐 쓰기 권한이 그대로 남아 있었다).
revoke all on public.partner_receivable_alerts from authenticated;
grant select, update on public.partner_receivable_alerts to authenticated;

comment on table public.partner_receivable_alerts is
  'LEAD-S7-8. 미수금 알림을 **언제 누구에게** 보냈는지. 같은 구매·단계·상대는 한 번뿐(유일 인덱스). 지울 수 없고 무효 처리만 된다. 파트너에게는 보이지 않는다.';
comment on column public.partner_receivable_alerts.delivered is
  'LEAD-S7-8. 거짓이면 보내려다 실패한 것. 기록은 남겨 둔다 — 실패도 사실이다.';
