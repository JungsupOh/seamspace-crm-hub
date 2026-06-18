-- 딜: 결제일(charge_date) 컬럼 추가 — 입금일(payment_date)과 분리.
-- charge_date = 카드결제(charge)일(자동), payment_date = 실제 입금/정산일(수동, 회계 기준).
ALTER TABLE deals ADD COLUMN IF NOT EXISTS charge_date date;
COMMENT ON COLUMN deals.charge_date IS '결제일(카드 charge 일자). 입금일=payment_date(정산 입금일, 회계 기준)와 구분.';
