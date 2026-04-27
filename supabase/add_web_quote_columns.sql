-- deal_quotes 테이블 컬럼 추가 마이그레이션
-- 웹 주문 및 견적 관리 기능 확장

-- 웹 주문 견적에서 deal_id 없이도 저장 가능하도록 (nullable 허용)
ALTER TABLE deal_quotes ALTER COLUMN deal_id DROP NOT NULL;
ALTER TABLE deal_quotes ALTER COLUMN deal_id SET DEFAULT 'web';

-- 담당자 연락처 컬럼 추가
ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- 이용권 수량 컬럼 추가 (qty와 별개로 실제 발송할 이용권 수)
ALTER TABLE deal_quotes ADD COLUMN IF NOT EXISTS license_qty INTEGER;
