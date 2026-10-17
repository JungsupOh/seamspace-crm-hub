-- 일기 제본 주문 기록 + 웹훅 수신 로그
--
-- 왜 필요한가: 스위트북 웹훅은 order_uid 만 준다. 알림톡을 보내려면 "누구의 주문인가"
-- (이름·전화)를 되짚어야 하는데, 지금은 주문 결과를 화면에 보여주고 끝이라 되짚을 데가 없다.
--
-- 주문 당시의 값을 그대로 박아 둔다(비정규화). 나중에 가격표나 배송지가 바뀌어도
-- "그때 얼마에, 어디로 보냈는지" 가 남아야 CS 가 된다.

create table if not exists print_orders (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- 식별
  order_ref         text not null unique,   -- 우리 주문번호 (externalRef 로 스위트북에 전달)
  vendor            text not null,          -- 'sweetbook' | 'ddukddak'
  vendor_env        text,                   -- 'sandbox' | 'live' — 테스트 주문을 구분한다
  vendor_order_uid  text unique,            -- 스위트북 orderUid. 웹훅이 이 값으로 들어온다

  -- 대상 (일기 주인)
  diary_username    text not null,
  diary_name        text,                   -- 표지에 들어간 실제 이름

  -- 수령인
  recipient_name    text not null,
  recipient_phone   text not null,
  postal_code       text,
  address1          text,
  address2          text,
  shipping_memo     text,

  -- 내용
  volumes           jsonb not null default '[]'::jsonb,  -- [{volume, from, to, pages, price, bookUid}]
  include_secret    boolean not null default true,
  book_uids         text[] not null default '{}',

  -- 금액 (주문 시점 스냅샷)
  product_amount    integer not null default 0,   -- 우리 판매가 합계
  shipping_fee      integer not null default 0,
  total_amount      integer not null default 0,
  vendor_cost       integer,                      -- 스위트북 충전금 차감액 (원가)

  -- 상태 — 웹훅으로 갱신된다
  status            text not null default 'ORDERED',
  tracking_carrier  text,
  tracking_number   text,
  ordered_at        timestamptz,
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz
);

create index if not exists print_orders_vendor_uid_idx on print_orders (vendor_order_uid);
create index if not exists print_orders_phone_idx      on print_orders (recipient_phone);
create index if not exists print_orders_created_idx    on print_orders (created_at desc);

-- 웹훅 수신 로그.
-- 스위트북은 실패 시 최대 3회 재시도하므로 같은 이벤트가 여러 번 온다.
-- delivery_id 를 unique 로 걸어 알림톡이 중복 발송되지 않게 한다(멱등 키).
create table if not exists print_order_events (
  id                uuid primary key default gen_random_uuid(),
  received_at       timestamptz not null default now(),

  delivery_id       text not null unique,   -- X-Webhook-Delivery
  event_uid         text,
  event_type        text not null,
  vendor_order_uid  text,
  is_test           boolean,

  payload           jsonb not null,

  -- 알림톡 처리 결과
  alimtalk_tpl      text,
  alimtalk_sent     boolean not null default false,
  alimtalk_error    text
);

create index if not exists print_order_events_order_idx on print_order_events (vendor_order_uid);
create index if not exists print_order_events_type_idx  on print_order_events (event_type, received_at desc);

-- RLS: 서버(service_role)만 읽고 쓴다.
-- 주문에 수령인 이름·전화·주소가 들어 있어 shop_* 의 개방형 정책을 따라가면 안 된다.
-- 정책을 하나도 만들지 않으면 anon 키로는 아무것도 못 한다.
alter table print_orders       enable row level security;
alter table print_order_events enable row level security;

-- 엣지 함수가 쓰는 소형 시크릿 보관소.
-- 스위트북 웹훅 secretKey 는 최초 등록 응답에서 1회만 전체값이 내려온다.
-- 함수 시크릿(supabase secrets)이 1순위이고 여기는 폴백 — PAT 없이도 넣을 수 있게 열어 뒀다.
create table if not exists app_secrets (
  key        text primary key,
  value      text not null,
  note       text,
  updated_at timestamptz not null default now()
);
alter table app_secrets enable row level security;
