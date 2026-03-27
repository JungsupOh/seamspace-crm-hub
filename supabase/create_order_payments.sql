-- order_payments: Toss 결제 승인 후 저장되는 주문 내역
create table if not exists order_payments (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  payment_key    text        not null unique,
  order_id       text        not null unique,
  amount         integer     not null,
  customer_name  text        not null,
  customer_phone text        not null,
  customer_email text,
  org_name       text,
  plan           text,
  qty            integer     not null default 1,
  duration       integer     not null default 12,
  quote_number   text,
  coupon_code    text,
  toss_method    text,
  approved_at    text
);

-- Service role only (Edge Function uses service role key)
alter table order_payments enable row level security;

create policy "service role full access" on order_payments
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
