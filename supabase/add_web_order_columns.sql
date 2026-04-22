-- deal_quotes 테이블에 웹 주문 관련 컬럼 추가
-- 비회원 구매 플로우 (견적→결제→이용권발송) 상태 관리용

ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'crm';
-- 'crm': 관리자가 CRM에서 등록, 'web': 고객이 /order에서 직접 생성

ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS buyer_phone TEXT;
ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS buyer_phone_normalized TEXT;
ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS buyer_name TEXT;
ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS buyer_email TEXT;
ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS org_name TEXT;

ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS order_status TEXT;
-- 견적 / 결제대기 / 결제완료 / 발송완료 / 취소

ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS payment_method TEXT;
-- card / bank / null

ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS payment_key TEXT;
-- Toss Payments paymentKey (카드결제 시)

ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS student_count INT;

-- 인덱스: 비회원 조회용 (견적번호 + 핸드폰)
CREATE INDEX IF NOT EXISTS idx_deal_quotes_web_lookup
  ON deal_quotes (quote_number, buyer_phone_normalized)
  WHERE source = 'web';
