-- partner_deals 국제화 컬럼 (해외 파트너 딜의 통화/국가 구분)
-- Supabase SQL Editor에서 실행
-- ※ partner_deals 기본 스키마는 별도 추적 파일이 없으므로 ADD COLUMN IF NOT EXISTS 만 사용

ALTER TABLE partner_deals
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'KRW',
  ADD COLUMN IF NOT EXISTS country  TEXT DEFAULT 'KR';
