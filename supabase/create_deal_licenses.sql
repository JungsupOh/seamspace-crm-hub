-- deal_licenses 테이블
-- 이용권 발급 수량만큼 각 쿠폰코드를 개별 행으로 관리
-- 상태: 대기 → 사용중 → 만료 / 이탈

create table if not exists deal_licenses (
  id           uuid primary key default gen_random_uuid(),
  deal_id      text        not null,   -- Airtable 딜 레코드 ID
  coupon_code  text        not null,   -- 쿠폰/이용권 코드
  contact_name text        not null default '',
  contact_phone text       not null default '',
  org_name     text        not null default '',
  duration     text        not null default '',  -- 이용 기간 (e.g. "3개월")
  user_count   text        not null default '',  -- 인원 수
  status       text        not null default '대기'
                check (status in ('대기', '사용중', '만료', '이탈')),
  created_at   timestamptz not null default now()
);

create index if not exists deal_licenses_deal_id_idx on deal_licenses(deal_id);
create index if not exists deal_licenses_coupon_code_idx on deal_licenses(coupon_code);

-- RLS (필요시 활성화)
alter table deal_licenses enable row level security;

-- anon key로 읽기/쓰기 허용 (CRM 내부용)
create policy "allow_all" on deal_licenses
  for all using (true) with check (true);
