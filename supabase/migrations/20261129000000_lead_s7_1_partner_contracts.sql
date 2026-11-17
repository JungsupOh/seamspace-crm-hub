-- ⚠️ 미적용. LEAD-S7-1 — 파트너 계약 표
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_1_contracts.sql
-- 드라이런: audit/dryrun_lead_s7_1_contracts.sql
-- 선행   : b1_role_helper(app_is_admin) · 20261116000000(H-4 partner_scoped_*)
-- 근거   : audit/lead_s6_design.md §0·1-2·1-3·1-6 / audit/lead_s7_1_requirements.md
--
-- 왜 필요한가
--   브리프 M항은 "**계약 건마다** 커미션형 또는 도매형 하나만"이라고 확정했는데,
--   **계약을 담는 표가 없다.** 지금 있는 것은
--     partners        = 파트너 **회사**(15곳)
--     partner_deals   = **판매 한 건**(117건 — seq_number·school_name·buyer_* 가 그 증거)
--     partner_licenses= **발급한 이용권 하나**(2건)
--     partner_files   = 계약서 **파일**
--   계약 조건(기간·수량·단가·통화·정산 방식)이 들어갈 자리가 없어서
--   "계약 수량에서 차감"·"계약별 단가"·"계약서 열람"이 걸칠 곳이 없다.
--
-- 기존 데이터에 손대지 않는다
--   이 파일은 **새 표 하나만 만든다.** partners·partner_deals·partner_licenses 의
--   기존 117건/15곳/2건은 그대로다. 계약을 붙이는 것은 다음 파일(…000100)이고
--   거기서도 NULL 허용 칸 하나만 더한다 → contract_id NULL = 지금과 똑같이 동작.
--
-- 보유 수량(잔량)을 칸으로 두지 않는 이유 (설계 1-3)
--   잔량 = 구매 합계 − 발급 합계 다. 칸에 저장하면 두 원장과 어긋나는 순간
--   (동시 발급·중간 실패·수동 보정) 어느 쪽이 맞는지 알 수 없다. 돈이 걸린 숫자라
--   언제든 원장으로 되짚을 수 있어야 한다. 그래서 **저장하지 않고 센다**.
--   (무효화한 이용권도 발급으로 **그대로 센다** — James 확정: 무효화해도 수량 복구 없음.)
--
-- 정산 방식은 만든 뒤 바꿀 수 없다 — 다만 **앱이 막는다**
--   바꾸면 그 계약에 달린 구매·발급·정산의 뜻이 통째로 달라진다. 바꿔야 하면 새 계약을 만든다.
--   트리거로 막지 않는 것은 이 저장소의 방침이다(되돌리기가 어렵고 순수 SQL 을 단순하게 둔다
--   — lead_outreach_drafts 의 "승인 후 본문 수정 불가"와 같은 처리).
--   대신 `canChangeSettlementMethod()`(src/lib/partnerContract.ts)에 한 곳으로 모으고
--   테스트로 고정했다.
-- ============================================================================

create table if not exists public.partner_contracts (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete restrict,

  -- 계약 건마다 **하나만**(James 확정 Q1: 회사는 여러 계약, 계약마다 하나).
  settlement_method text not null,

  -- 기간. 종료가 비면 "무기한 또는 미정"이다(모르는 것을 0 이나 먼 날짜로 적지 않는다).
  starts_on     date not null,
  ends_on       date,
  renews_on     date,

  -- 계약 수량. 단위는 **인원·개월**(James 확정 — 100명 연간 = 1,200).
  -- 커미션형에서는 "초과 경고"의 기준으로만 쓰이고, 비어 있으면 경고하지 않는다.
  contracted_seat_months bigint,

  -- 연간 인원당 단가와 통화. 도매형에서만 뜻이 있다.
  -- **단가 0(무상 배정)과 "단가 미입력"은 다르다**(설계 1-6) — 그래서 기본값을 두지 않고
  --  active 로 올릴 때만 있어야 하게 CHECK 로 좁힌다.
  unit_price_per_seat_year numeric(14,2),
  currency      text,

  -- 커미션형의 수수료율(계약별). partners.commission_rate 는 회사 단위라 계약마다 다를 수 없다.
  commission_rate numeric(6,3),

  -- 무상 배정(행사·테스트용). 도매형 + 단가 0 으로 처리하되 **회계에서 가려낼 수 있게** 표시한다.
  is_grant      boolean not null default false,

  status        text not null default 'draft',

  -- 계약서 파일(선택). 파일은 지우지 못하게 restrict.
  contract_file_id uuid references public.partner_files(id) on delete restrict,

  notes         text,

  -- 원장이라 지우지 않는다. 잘못 만든 계약은 voided 로 표시한다.
  voided_at     timestamptz,
  void_reason   text,

  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 값의 범위 ──
alter table public.partner_contracts drop constraint if exists partner_contracts_method_check;
alter table public.partner_contracts
  add constraint partner_contracts_method_check
  check (settlement_method in ('commission', 'wholesale'));

alter table public.partner_contracts drop constraint if exists partner_contracts_status_check;
alter table public.partner_contracts
  add constraint partner_contracts_status_check
  check (status in ('draft', 'active', 'ended', 'cancelled'));

-- 기간이 거꾸로 된 계약은 받지 않는다.
alter table public.partner_contracts drop constraint if exists partner_contracts_period_check;
alter table public.partner_contracts
  add constraint partner_contracts_period_check
  check (ends_on is null or ends_on >= starts_on);

-- 음수 수량·단가·수수료율은 받지 않는다. 0 은 받는다(무상 배정).
alter table public.partner_contracts drop constraint if exists partner_contracts_amount_check;
alter table public.partner_contracts
  add constraint partner_contracts_amount_check
  check (
    (contracted_seat_months is null or contracted_seat_months >= 0)
    and (unit_price_per_seat_year is null or unit_price_per_seat_year >= 0)
    and (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100))
  );

-- **active 로 올릴 때만** 방식별 필수값을 따진다.
-- draft 는 비어 있어도 된다 — 해외 파트너 등록 마법사(브리프 K항)가 중간 저장을 한다.
alter table public.partner_contracts drop constraint if exists partner_contracts_active_check;
alter table public.partner_contracts
  add constraint partner_contracts_active_check
  check (
    status <> 'active'
    or (
      case settlement_method
        -- 도매형: 단가와 통화가 있어야 청구할 수 있다. 0 은 명시적으로 넣어야 한다.
        when 'wholesale'  then unit_price_per_seat_year is not null and coalesce(trim(currency), '') <> ''
        -- 커미션형: 수수료율이 없으면 정산 자체가 계산되지 않는다.
        when 'commission' then commission_rate is not null
        else false
      end
    )
  );

-- 무상 배정은 도매형 + 단가 0 이다(설계 1-6).
alter table public.partner_contracts drop constraint if exists partner_contracts_grant_check;
alter table public.partner_contracts
  add constraint partner_contracts_grant_check
  check (
    not is_grant
    or (settlement_method = 'wholesale' and coalesce(unit_price_per_seat_year, -1) = 0)
  );

-- 취소·무효에는 사유가 있어야 한다(원장 성격 — 왜 접었는지가 남아야 한다).
alter table public.partner_contracts drop constraint if exists partner_contracts_void_check;
alter table public.partner_contracts
  add constraint partner_contracts_void_check
  check (voided_at is null or coalesce(trim(void_reason), '') <> '');

create index if not exists idx_partner_contracts_partner
  on public.partner_contracts (partner_id, starts_on desc);
create index if not exists idx_partner_contracts_status
  on public.partner_contracts (status) where voided_at is null;

-- ── 보안 ──
alter table public.partner_contracts enable row level security;

-- H-4 의 partner_scoped_* 와 **같은 모양**을 유지한다(비교하기 쉽게 인라인으로 둔다).
drop policy if exists "partner_scoped_partner_contracts" on public.partner_contracts;
create policy "partner_scoped_partner_contracts"
  on public.partner_contracts
  for all
  to authenticated
  using (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  )
  with check (
    partner_id = (select up.partner_id from public.user_profiles up where up.id = auth.uid())
    or (select up.role from public.user_profiles up where up.id = auth.uid()) = any (array['admin','sub_admin'])
  );

-- 계약은 지우지 않는다 — 잘못 만든 것도 voided_at 으로 남긴다.
drop policy if exists "partner_contracts_no_delete" on public.partner_contracts;
create policy "partner_contracts_no_delete"
  on public.partner_contracts as restrictive for delete to authenticated using ( false );

revoke all on public.partner_contracts from anon;
revoke all on public.partner_contracts from public;

-- 상태·금액을 고치려면 UPDATE 가 필요하다. DELETE 는 주지 않는다.
grant select, insert, update on public.partner_contracts to authenticated;

comment on table public.partner_contracts is
  'LEAD-S7-1. 파트너 계약 건(정산 방식·기간·수량·단가). 잔량은 저장하지 않고 구매−발급으로 센다.';
comment on column public.partner_contracts.settlement_method is
  '계약 건마다 하나(commission|wholesale). 만든 뒤 바꾸지 않는다 — 바꿔야 하면 새 계약(앱이 막는다).';
comment on column public.partner_contracts.contracted_seat_months is
  '인원·개월. 100명 연간 = 1200. 커미션형에서는 초과 경고의 기준.';
