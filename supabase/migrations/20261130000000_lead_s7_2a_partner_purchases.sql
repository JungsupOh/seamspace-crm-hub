-- ⚠️ 미적용. LEAD-S7-2a — 도매 선구매 원장
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_2a_ledger.sql
-- 드라이런: audit/dryrun_lead_s7_2a_ledger.sql
-- 선행   : 20261129000000(partner_contracts) · 20261129000100
-- 근거   : audit/lead_s6_design.md 1-2·1-3 / audit/lead_s7_2a_requirements.md
--
-- 무엇을 담나
--   도매형 계약에서 파트너가 **수량을 미리 산 회차**를 한 줄씩 남긴다.
--   날짜 · 인원·개월 · 단가 · 통화 · 합계 · 청구서 번호 · 청구·입금 상태 · 입금일 · 입금액.
--   추가 구매(충전)는 **행을 더하는 것**이다 — 기존 행을 고치지 않는다.
--
-- 잔량은 여기에도 없다 (설계 1-3)
--   잔량 = 이 표의 합계 − partner_licenses 의 발급 합계. **저장하지 않고 센다.**
--   무효화한 구매 회차는 합계에서 뺀다. 무효화한 **이용권**은 빼지 않는다(James 확정).
--
-- 세무 분류를 넣지 않는다 (James 확정 Q7)
--   영세율·환율 기준일·매출 인식 시점은 James 가 별도로 확인한다. 그래서 이 표는
--   **날짜·금액·통화·입금일만** 남긴다. 분류·집계를 지금 칸으로 박으면 확인 결과에 따라
--   데이터를 다시 써야 한다. 어느 기준을 택해도 뒤에서 집계할 수 있게 사실만 둔다.
--
-- partner_id 를 두지 않은 이유 (요구사항이 근거를 묻는 항목)
--   구매는 **계약에 속한다.** 계약은 파트너 하나에 속한다(partner_contracts.partner_id).
--   여기에 partner_id 를 또 두면 "계약의 파트너"와 "구매의 파트너"가 **어긋날 수 있는
--   상태**가 생긴다. 그것을 DB 가 막으려면 복합 외래키
--     (contract_id, partner_id) → partner_contracts(id, partner_id)
--   가 필요하고, 그러려면 이미 **운영에 적용된** partner_contracts 에
--   `unique (id, partner_id)` 를 더해야 한다. 이번 단계는 S7-1 표 구조를 바꾸지 않기로
--   했으므로(요구사항 7) 칸을 두지 않는 쪽을 골랐다.
--   → 칸이 없으므로 **어긋남이 생길 수 없다.** 이것이 DB 수준의 보장이다.
--     (대안은 결과 문서 §3-1 에 제안으로 적었다.)
-- ============================================================================

create table if not exists public.partner_purchases (
  id            uuid primary key default gen_random_uuid(),

  -- 어느 계약으로 산 것인가. 계약은 지울 수 없다(restrict).
  contract_id   uuid not null references public.partner_contracts(id) on delete restrict,

  purchased_on  date not null,

  -- 산 수량. 단위는 **인원·개월**(James 확정 — 100명 연간 = 1,200).
  seat_months   bigint not null,

  -- 그때의 연간 인원당 단가와 통화. 계약의 단가와 다를 수 있다(회차마다 협의).
  -- 무상 배정은 0 이다 — **0 과 "미입력"은 다르다**(설계 1-6).
  unit_price_per_seat_year numeric(14,2),
  currency      text,

  -- 합계(청구 금액). seat_months/12 × 단가가 보통이지만 할인·절삭이 있어
  -- 계산으로 **강제하지 않는다**. 어긋나면 화면이 알려 준다(expectedAmount()).
  amount        numeric(16,2),

  invoice_no    text,
  billing_status text not null default 'unbilled',
  invoiced_on   date,
  paid_on       date,
  paid_amount   numeric(16,2),

  memo          text,

  -- 원장이라 지우지 않는다. 잘못 적은 회차는 무효 표시한다.
  voided_at     timestamptz,
  void_reason   text,

  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 값의 범위 ──

alter table public.partner_purchases drop constraint if exists partner_purchases_status_check;
alter table public.partner_purchases
  add constraint partner_purchases_status_check
  check (billing_status in ('unbilled', 'billed', 'partial', 'paid'));

-- 0 인원·개월을 산다는 것은 뜻이 없다. 금액은 0 을 받는다(무상 배정).
alter table public.partner_purchases drop constraint if exists partner_purchases_amount_check;
alter table public.partner_purchases
  add constraint partner_purchases_amount_check
  check (
    seat_months > 0
    and (unit_price_per_seat_year is null or unit_price_per_seat_year >= 0)
    and (amount is null or amount >= 0)
    and (paid_amount is null or paid_amount >= 0)
  );

-- 입금일이 있으면 **얼마가 들어왔는지**가 있어야 한다. 날짜만 있는 입금은 셀 수 없다.
alter table public.partner_purchases drop constraint if exists partner_purchases_paid_check;
alter table public.partner_purchases
  add constraint partner_purchases_paid_check
  check (paid_on is null or paid_amount is not null);

-- 무효 표시는 **시각과 사유가 같이** 있어야 한다. 사유 없는 무효는 나중에 설명할 수 없다.
alter table public.partner_purchases drop constraint if exists partner_purchases_void_check;
alter table public.partner_purchases
  add constraint partner_purchases_void_check
  check (
    (voided_at is null     and coalesce(trim(void_reason), '') =  '')
    or (voided_at is not null and coalesce(trim(void_reason), '') <> '')
  );

create index if not exists idx_partner_purchases_contract
  on public.partner_purchases (contract_id, purchased_on desc);
-- 미수금 화면이 "청구했는데 입금 안 된 것"을 찾는다.
create index if not exists idx_partner_purchases_receivable
  on public.partner_purchases (billing_status, invoiced_on)
  where voided_at is null and billing_status in ('billed', 'partial');

-- ── 보안 (S7-1 fix1 과 **같은 4개 구조**) ──
--
-- 이 표는 **돈**이다(청구액·입금액). 파트너가 고칠 수 있으면 "입금했다"고 적을 수 있고,
-- seat_months 를 늘리면 발급 한도가 늘어난다. 그래서 **쓰기는 admin 전용**이다.
-- 읽기는 자기 계약의 구매만 — 포털에서 자기 구매·입금 상태를 봐야 한다(설계 2-1).

alter table public.partner_purchases enable row level security;

-- 읽기: 자기 계약의 구매 **또는** admin·sub_admin.
--   판정은 계약을 타고 간다(이 표에 partner_id 가 없다).
--   partner_contracts 자체에도 RLS 가 걸려 있어 **두 겹으로** 걸러진다.
drop policy if exists "partner_purchases_select" on public.partner_purchases;
create policy "partner_purchases_select"
  on public.partner_purchases
  for select
  to authenticated
  using (
    exists (
      select 1 from public.partner_contracts c
       where c.id = partner_purchases.contract_id
         and (
           c.partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
           or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
         )
    )
  );

-- 쓰기: **admin·sub_admin 만.** 파트너는 자기 계약의 구매도 만들거나 고칠 수 없다.
drop policy if exists "partner_purchases_admin_insert" on public.partner_purchases;
create policy "partner_purchases_admin_insert"
  on public.partner_purchases
  for insert
  to authenticated
  with check (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

drop policy if exists "partner_purchases_admin_update" on public.partner_purchases;
create policy "partner_purchases_admin_update"
  on public.partner_purchases
  for update
  to authenticated
  using (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 구매 원장은 지우지 않는다 — 잘못 적은 것도 voided_at 으로 남긴다.
drop policy if exists "partner_purchases_no_delete" on public.partner_purchases;
create policy "partner_purchases_no_delete"
  on public.partner_purchases as restrictive for delete to authenticated using ( false );

revoke all on public.partner_purchases from anon;
revoke all on public.partner_purchases from public;

grant select, insert, update on public.partner_purchases to authenticated;

comment on table public.partner_purchases is
  'LEAD-S7-2a. 도매 선구매 원장(회차마다 한 줄). 잔량은 저장하지 않고 이 합계 − 발급 합계로 센다. partner_id 는 두지 않는다 — 계약을 타고 간다.';
comment on column public.partner_purchases.seat_months is
  '인원·개월. 100명 연간 = 1200. 발급 때 이 합계에서 빠진다.';
comment on column public.partner_purchases.amount is
  '청구 금액. seat_months/12 × 단가가 보통이지만 할인·절삭이 있어 강제하지 않는다.';
comment on column public.partner_purchases.billing_status is
  'unbilled|billed|partial|paid. **이름표일 뿐이고 사실은 금액이다** — 미수액은 amount − paid_amount 로 센다.';
