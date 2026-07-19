-- 파트너 옵션 컬럼 추가 (튀르키예 등 해외 파트너 지원)
-- Supabase SQL Editor에서 실행
-- can_issue_licenses: 이용권 발급 기능 on/off (기본 off → 국내 파트너 무변화)
-- locale: 파트너 포털 언어 ('ko' | 'en' | 'tr')
-- currency: 딜/이용권 금액 통화 ('KRW' | 'USD')
-- country: 리포팅 그룹 ('KR' | 'TR' ...)

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS can_issue_licenses BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locale             TEXT    NOT NULL DEFAULT 'ko',
  ADD COLUMN IF NOT EXISTS currency           TEXT    NOT NULL DEFAULT 'KRW',
  ADD COLUMN IF NOT EXISTS country            TEXT    NOT NULL DEFAULT 'KR';

-- ※ 파트너 레코드는 SQL seed로 만들지 않는다.
--    해외 파트너도 국내와 동일하게 관리자 화면(파트너 등록 → 초대)으로 생성하고,
--    위 옵션 컬럼만 등록 폼에서 켜 준다. (seed INSERT는 partners에 name 유니크 제약이
--    없어 재실행 시 동일 파트너가 중복 생성되는 문제가 있어 제거함)
