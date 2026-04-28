-- 럭키세븐 이벤트 — 그룹 신청 + 결제 묶음 분할
-- 2026-04 5월 한정 럭키세븐 이벤트용 데이터 모델
-- 1) lucky_seven_groups        : 7~10명 그룹 단위 신청
-- 2) lucky_seven_payment_groups: 그룹 안의 결제 묶음 (= 견적서 1장 = 결제 1회)
-- 3) campaign_leads 컬럼 추가  : 멤버 ↔ 그룹/묶음 연결
-- 4) Storage 버킷               : 견적서 PDF
-- 5) RLS                        : 공개 폼 anon insert + 본인확인 select RPC

-- ================================================================
-- 1. 그룹 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS lucky_seven_groups (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id              UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  group_code               TEXT UNIQUE NOT NULL,
  leader_lead_id           UUID REFERENCES campaign_leads(id) ON DELETE SET NULL,
  leader_phone_normalized  TEXT NOT NULL,
  member_count             INT  NOT NULL CHECK (member_count BETWEEN 7 AND 10),
  total_amount             INT  NOT NULL,
  status                   TEXT NOT NULL DEFAULT '신청',
    -- 신청 | 견적발송 | 일부결제 | 결제완료 | 발급완료 | 이탈
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ls_groups_campaign ON lucky_seven_groups(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ls_groups_code     ON lucky_seven_groups(group_code);
CREATE INDEX IF NOT EXISTS idx_ls_groups_status   ON lucky_seven_groups(status);

DROP TRIGGER IF EXISTS set_ls_groups_updated_at ON lucky_seven_groups;
CREATE TRIGGER set_ls_groups_updated_at
  BEFORE UPDATE ON lucky_seven_groups
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ================================================================
-- 2. 결제 묶음 테이블 (1 그룹 : N 묶음, 묶음당 견적서 1장)
-- ================================================================
CREATE TABLE IF NOT EXISTS lucky_seven_payment_groups (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                 UUID NOT NULL REFERENCES lucky_seven_groups(id) ON DELETE CASCADE,
  quote_number             TEXT UNIQUE NOT NULL,
  payer_name               TEXT NOT NULL,
  payer_phone              TEXT NOT NULL,
  payer_phone_normalized   TEXT NOT NULL,
  payer_email              TEXT NOT NULL,
  buyer_org_name           TEXT,
  buyer_business_no        TEXT,
  buyer_org_addr           TEXT,
  buyer_org_ceo            TEXT,
  buyer_contact            TEXT,
  school_id_url            TEXT,                    -- 고유번호증 파일 URL (세금계산서 발급 시)
  amount                   INT  NOT NULL,
  tax_invoice_required     BOOLEAN NOT NULL DEFAULT false,
  status                   TEXT NOT NULL DEFAULT '대기',
    -- 대기 | 견적발송 | 결제완료 | 취소
  quote_pdf_url            TEXT,
  toss_order_id            TEXT,
  toss_payment_key         TEXT,
  paid_at                  TIMESTAMPTZ,
  email_sent_at            TIMESTAMPTZ,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기존 테이블이 있는 경우 컬럼 추가 (재실행 안전)
ALTER TABLE lucky_seven_payment_groups
  ADD COLUMN IF NOT EXISTS school_id_url TEXT;
CREATE INDEX IF NOT EXISTS idx_ls_pay_groups_group ON lucky_seven_payment_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_ls_pay_groups_quote ON lucky_seven_payment_groups(quote_number);
CREATE INDEX IF NOT EXISTS idx_ls_pay_groups_status ON lucky_seven_payment_groups(status);

DROP TRIGGER IF EXISTS set_ls_pay_groups_updated_at ON lucky_seven_payment_groups;
CREATE TRIGGER set_ls_pay_groups_updated_at
  BEFORE UPDATE ON lucky_seven_payment_groups
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ================================================================
-- 3. campaign_leads 컬럼 추가 (멤버 ↔ 그룹/묶음 매핑)
-- ================================================================
ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS ls_group_id         UUID REFERENCES lucky_seven_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ls_payment_group_id UUID REFERENCES lucky_seven_payment_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ls_role             TEXT,         -- 'leader' | 'member'
  ADD COLUMN IF NOT EXISTS ls_member_index     INT;          -- 1~10 (입력 순서)
CREATE INDEX IF NOT EXISTS idx_campaign_leads_ls_group ON campaign_leads(ls_group_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_ls_pg    ON campaign_leads(ls_payment_group_id);

-- ================================================================
-- 4. RLS 정책
-- ================================================================
ALTER TABLE lucky_seven_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lucky_seven_payment_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "all_ls_groups"         ON lucky_seven_groups;
DROP POLICY IF EXISTS "all_ls_payment_groups" ON lucky_seven_payment_groups;

-- 내부/익명 모두 ALL 허용 (campaign_leads와 동일 정책 — 공개 폼 anon insert + 결제콜백 anon update 필요).
-- 향후 RPC로 제한이 필요해지면 정책을 분리.
CREATE POLICY "all_ls_groups"         ON lucky_seven_groups         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_ls_payment_groups" ON lucky_seven_payment_groups FOR ALL USING (true) WITH CHECK (true);

-- ================================================================
-- 5. Storage 버킷 — 견적서 PDF + 고유번호증 (anon 업로드/읽기 허용)
-- ================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('lucky_seven_quote_pdfs', 'lucky_seven_quote_pdfs', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('lucky_seven_school_id_files', 'lucky_seven_school_id_files', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ls_quote_pdfs_anon_insert" ON storage.objects;
CREATE POLICY "ls_quote_pdfs_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'lucky_seven_quote_pdfs');

DROP POLICY IF EXISTS "ls_quote_pdfs_public_read" ON storage.objects;
CREATE POLICY "ls_quote_pdfs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'lucky_seven_quote_pdfs');

DROP POLICY IF EXISTS "ls_school_id_anon_insert" ON storage.objects;
CREATE POLICY "ls_school_id_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'lucky_seven_school_id_files');

DROP POLICY IF EXISTS "ls_school_id_public_read" ON storage.objects;
CREATE POLICY "ls_school_id_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'lucky_seven_school_id_files');

-- (group_code는 클라이언트(JS)에서 생성. RPC/시퀀스 불필요.)
