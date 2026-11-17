-- ⚠️ 미적용. LEAD-S7-3 — 발급 좌석 예약 (원자적)
-- ============================================================================
-- 롤백   : audit/rollback_lead_s7_3_issue.sql
-- 드라이런: audit/dryrun_lead_s7_3_issue.sql
-- 선행   : 20261201000000_lead_s7_3_license_contract_link.sql
--
-- 무엇을 푸는가 — **동시 발급 초과**
--   잔량은 저장하지 않고 "구매 합계 − 발급 합계"로 센다(설계 1-3). 그런데 두 사람이
--   같은 순간에 발급하면 **둘 다 "잔량 있음"을 보고** 합쳐서 한도를 넘길 수 있다.
--   화면이나 엣지 함수에서 세는 것으로는 막을 수 없다 — 세는 것과 쓰는 것 사이에
--   틈이 있기 때문이다.
--
--   그래서 **DB 한 곳에서, 계약 행을 잠근 채로** 세고 넣는다:
--       select ... from partner_contracts where id = ... for update   ← 잠근다
--       구매 합계 − 발급 합계 재계산                                   ← 잠긴 동안
--       부족하면 거절, 통과하면 예약 행 insert                          ← 잠긴 동안
--   두 번째 호출은 첫 번째가 커밋할 때까지 `for update` 에서 **기다린다.**
--   기다린 뒤 다시 세므로 첫 번째가 쓴 예약이 보이고, 한도를 넘지 못한다.
--
-- 왜 "예약"인가 (쿠폰보다 먼저 원장에 넣는 이유)
--   쿠폰을 먼저 만들면 "쿠폰은 생겼는데 원장 기록이 실패"하는 창이 생긴다.
--   그러면 파트너는 쿠폰을 받았는데 수량은 안 빠진다 — **공짜 발급**이다.
--   예약을 먼저 넣으면 최악의 경우가 "수량은 빠졌는데 쿠폰이 없다"가 되고,
--   그건 사람이 보고 되돌릴 수 있다(엣지 함수가 실패 시 예약을 지운다).
--
-- 세는 규칙 (TS 쪽 partnerContract.ts·_shared/seat-balance.ts 와 **같아야 한다**)
--   구매: voided_at 이 null 인 행의 seat_months 합
--   발급: 같은 계약의 행 중 status 가 'failed' 가 **아닌** 것의 수량 합
--         · 'revoked'(무효화)도 **센다** — 무효화해도 수량은 돌려주지 않는다(James 확정)
--         · 'reserved'(진행 중)도 **센다** — 안 세면 그 틈에 두 번 나간다
--         · 'failed' 만 뺀다 — 쿠폰이 안 만들어져 아무 일도 없었던 줄
--   수량: seat_months 가 있으면 그것, 없으면 user_count × duration,
--         그것도 셀 수 없으면 **셀 수 없음**(0 으로 치지 않는다 — 0 으로 치면
--         잔량이 많아 보여 초과 발급이 난다)
--         ⚠️ NULL 안전해야 한다. `NULL ~ '정규식'` 은 false 가 아니라 **NULL** 이고,
--            `not NULL` 도 NULL 이라 `filter (where ... )` 에서 **조용히 빠진다**.
--            그래서 정규식마다 `coalesce(..., false)` 로 감싸고, 수량을 **한 번만**
--            계산해 NULL 이면 "셀 수 없음"으로 삼는다(fix2).
-- ============================================================================

create or replace function public.partner_reserve_license_seats(
  p_contract_id   uuid,
  p_partner_id    uuid,
  p_user_count    integer,
  p_duration      integer,
  p_issued_by     uuid,
  p_partner_deal_id       uuid default null,
  p_partner_deal_buyer_id uuid default null,
  p_contact_name  text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_org_name      text default null,
  p_plan          text default null,
  p_amount        numeric default null,
  p_currency      text default null
)
returns jsonb
language plpgsql
security definer
-- ⚠️ security definer 는 함수 소유자 권한으로 돈다. search_path 를 고정하지 않으면
--    호출자가 같은 이름의 가짜 표를 앞세워 다른 것을 읽게 만들 수 있다.
set search_path = public, pg_temp
as $$
declare
  v_contract    public.partner_contracts%rowtype;
  v_seat_months bigint;
  v_purchased   bigint;
  v_issued      bigint;
  v_unknown     bigint;
  v_balance     bigint;
  v_license_id  uuid;
begin
  -- 요청 수량부터 본다. 반 달은 없다(James 위임 확정 ①).
  if p_user_count is null or p_duration is null
     or p_user_count <= 0 or p_duration <= 0 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST',
      'message', '인원과 개월 수는 1 이상이어야 합니다.');
  end if;
  v_seat_months := p_user_count::bigint * p_duration::bigint;

  -- ── 여기서부터 잠근다 ──
  select * into v_contract
    from public.partner_contracts
   where id = p_contract_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_CONTRACT',
      'message', '계약을 찾을 수 없습니다.');
  end if;

  -- 남의 계약으로 발급하려는 시도를 막는다(엣지 함수도 막지만 두 겹으로).
  if v_contract.partner_id <> p_partner_id then
    return jsonb_build_object('ok', false, 'code', 'NO_CONTRACT',
      'message', '계약을 찾을 수 없습니다.');
  end if;

  if v_contract.voided_at is not null or v_contract.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_NOT_ACTIVE',
      'message', '유효한 계약이 아닙니다.');
  end if;

  if v_contract.ends_on is not null and v_contract.ends_on < current_date then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_EXPIRED',
      'message', '계약 기간이 끝났습니다.');
  end if;

  -- 도매형이 아니면 여기서 막지 않는다(커미션형은 경고만 — 엣지 함수가 한다).
  if v_contract.settlement_method <> 'wholesale' then
    return jsonb_build_object('ok', false, 'code', 'NOT_WHOLESALE',
      'message', '도매형 계약이 아닙니다.');
  end if;

  -- ── 구매 합계 (무효 제외) ──
  select coalesce(sum(seat_months), 0) into v_purchased
    from public.partner_purchases
   where contract_id = p_contract_id and voided_at is null;

  -- ── 발급 합계 ('failed' 만 뺀다. revoked·reserved 는 센다) ──
  --
  -- ⚠️ fix2: 한 줄의 수량을 **한 곳에서만** 정한다.
  --    전에는 합계(case)와 미상 카운트(filter)를 따로 썼는데, `user_count` 가 NULL 이면
  --    `NULL ~ '^[0-9]+$'` 는 **NULL** 이고 `not NULL` 도 NULL 이라 filter 에서 빠졌다.
  --    같은 줄이 합계에서는 `else 0` 으로 떨어져 **0 으로 세고**, 미상에도 안 잡혔다
  --    → 수량을 모르는 발급이 조용히 0 이 되어 **잔량이 부풀었다**(fail-open).
  --
  --    이제 `sm` 을 한 번만 계산하고 **NULL = "셀 수 없음"** 으로 삼는다.
  --    합계는 NULL 을 더하지 않고, 미상은 `sm is null` 로 센다 → 둘이 어긋날 수 없다.
  --    정규식 결과는 `coalesce(..., false)` 로 감싸 NULL 을 "셀 수 없다" 쪽으로 보낸다.
  with counted as (
    select
      case
        when seat_months is not null and seat_months > 0 then seat_months
        when coalesce(user_count ~ '^[0-9]+$', false)
         and coalesce(duration   ~ '^[0-9]+$', false)
         and user_count::bigint > 0
         and duration::bigint   > 0
          then user_count::bigint * duration::bigint
        else null          -- 셀 수 없음
      end as sm
      from public.partner_licenses
     where contract_id = p_contract_id
       -- status 가 NULL 이면 'issued' 로 본다(기본값과 같다) → NULL 안전
       and coalesce(status, 'issued') <> 'failed'
  )
  select coalesce(sum(sm), 0), count(*) filter (where sm is null)
    into v_issued, v_unknown
    from counted;

  -- 수량을 셀 수 없는 줄이 있으면 잔량을 믿을 수 없다 → 사람이 보게 막는다.
  if v_unknown > 0 then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_HISTORY',
      'message', format('수량을 알 수 없는 발급 기록이 %s건 있어 잔량을 셀 수 없습니다. 먼저 확인해 주세요.', v_unknown),
      'unknown_issues', v_unknown);
  end if;

  v_balance := v_purchased - v_issued;

  if v_balance < v_seat_months then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE',
      'balance', v_balance, 'requested', v_seat_months,
      'purchased', v_purchased, 'issued', v_issued);
  end if;

  -- ── 통과: 예약 행을 넣는다 ──
  -- coupon_code 는 NOT NULL 이라 자리표를 넣는다. 쿠폰이 만들어지면 엣지 함수가 바꾼다.
  -- 'RESERVED-' 로 시작하므로 진짜 쿠폰과 섞이지 않는다.
  insert into public.partner_licenses (
    partner_id, contract_id, partner_deal_id, partner_deal_buyer_id,
    coupon_code, contact_name, contact_email, contact_phone, org_name,
    plan, duration, user_count, seat_months, amount, currency,
    status, delivery_channel, email_sent, issued_by
  ) values (
    p_partner_id, p_contract_id, p_partner_deal_id, p_partner_deal_buyer_id,
    'RESERVED-' || replace(gen_random_uuid()::text, '-', ''),
    p_contact_name, p_contact_email, p_contact_phone, p_org_name,
    p_plan, p_duration::text, p_user_count::text, v_seat_months, p_amount,
    coalesce(p_currency, v_contract.currency, 'USD'),
    'reserved', 'email', false, p_issued_by
  )
  returning id into v_license_id;

  return jsonb_build_object(
    'ok', true, 'license_id', v_license_id, 'seat_months', v_seat_months,
    'balance_before', v_balance, 'balance_after', v_balance - v_seat_months,
    'purchased', v_purchased, 'issued', v_issued);
end;
$$;

-- 호출은 **service_role 만**. 파트너·로그인 사용자가 직접 부르면 수량을 마음대로 예약할 수 있다.
revoke all on function public.partner_reserve_license_seats(
  uuid, uuid, integer, integer, uuid, uuid, uuid, text, text, text, text, text, numeric, text) from public;
revoke all on function public.partner_reserve_license_seats(
  uuid, uuid, integer, integer, uuid, uuid, uuid, text, text, text, text, text, numeric, text) from anon;
revoke all on function public.partner_reserve_license_seats(
  uuid, uuid, integer, integer, uuid, uuid, uuid, text, text, text, text, text, numeric, text) from authenticated;
grant execute on function public.partner_reserve_license_seats(
  uuid, uuid, integer, integer, uuid, uuid, uuid, text, text, text, text, text, numeric, text) to service_role;

comment on function public.partner_reserve_license_seats(
  uuid, uuid, integer, integer, uuid, uuid, uuid, text, text, text, text, text, numeric, text) is
  'LEAD-S7-3. 계약 행을 잠그고 잔량을 다시 센 뒤 예약 행을 넣는다. 동시 발급이 한도를 넘지 못하게 한다. service_role 만 호출.';

-- ── 되돌리기용: 예약 취소 ──
-- 쿠폰 생성이 실패하면 예약을 **지운다**. 쿠폰이 안 만들어졌으니 "발급"이 아니었고,
-- 남겨 두면 포털·원장에 가짜 코드가 보인다(포털은 이 단계에서 건드리지 않는다).
-- 지우는 것은 **예약 상태인 줄만** — 이미 확정된 발급은 건드리지 못한다.
create or replace function public.partner_release_license_reservation(
  p_license_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.partner_licenses
   where id = p_license_id
     and status = 'reserved'
     and coupon_code like 'RESERVED-%';
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.partner_release_license_reservation(uuid) from public;
revoke all on function public.partner_release_license_reservation(uuid) from anon;
revoke all on function public.partner_release_license_reservation(uuid) from authenticated;
grant execute on function public.partner_release_license_reservation(uuid) to service_role;

comment on function public.partner_release_license_reservation(uuid) is
  'LEAD-S7-3. 쿠폰 생성이 실패했을 때 예약 행을 지운다. status=reserved 이고 코드가 RESERVED- 인 줄만.';
