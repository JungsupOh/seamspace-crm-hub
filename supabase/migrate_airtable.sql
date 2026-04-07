-- Airtable → Supabase 마이그레이션: contacts & deals 테이블 생성

CREATE EXTENSION IF NOT EXISTS moddatetime;

-- ── contacts 테이블 ──
CREATE TABLE IF NOT EXISTS contacts (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name               text,
  email              text,
  phone              text,
  phone_normalized   text,
  org_name           text,
  country            text,
  contact_type       text,
  lead_stage         text,
  role               text,
  lead_source        text,
  data_source_date   text,
  notes              text,
  school_id_number   text,
  org_zipcode        text,
  org_address        text,
  org_address_detail text,
  org_tel            text,
  org_homepage       text,
  education_office   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone_normalized ON contacts (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_org_name ON contacts (org_name);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_stage ON contacts (lead_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);

DROP TRIGGER IF EXISTS set_contacts_updated_at ON contacts;
CREATE TRIGGER set_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ── deals 테이블 ──
CREATE TABLE IF NOT EXISTS deals (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  deal_name             text,
  deal_stage            text,
  deal_type             text,
  contact_name          text,
  contact_phone         text,
  contact_email         text,
  org_name              text,
  admin_name            text,
  admin_phone           text,
  admin_email           text,
  school_id_number      text,
  org_zipcode           text,
  org_address           text,
  org_address_detail    text,
  org_tel               text,
  org_homepage          text,
  education_office      text,
  quote_date            text,
  quote_qty             integer,
  quote_plan            text,
  quote_number          text,
  license_duration      integer,
  unit_price            integer,
  list_price            integer,
  supply_price          integer,
  tax_amount            integer,
  final_contract_value  integer,
  license_code_count    integer,
  license_send_date     text,
  license_template      text,
  renewal_date          text,
  lead_source           text,
  order_date            text,
  contract_date         text,
  payment_date          text,
  receipt_date          text,
  expected_close_date   text,
  lost_competitor       text,
  assigned_to           text,
  notes                 text,
  created_date          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_deal_stage ON deals (deal_stage);
CREATE INDEX IF NOT EXISTS idx_deals_org_name ON deals (org_name);
CREATE INDEX IF NOT EXISTS idx_deals_contact_name ON deals (contact_name);
CREATE INDEX IF NOT EXISTS idx_deals_quote_number ON deals (quote_number);

DROP TRIGGER IF EXISTS set_deals_updated_at ON deals;
CREATE TRIGGER set_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ── RLS 정책 ──
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_contacts_all" ON contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_deals_all" ON deals FOR ALL USING (true) WITH CHECK (true);
