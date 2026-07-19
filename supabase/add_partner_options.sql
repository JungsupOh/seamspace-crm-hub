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

-- 튀르키예 파트너 seed (이미 있으면 옵션만 갱신, 없으면 생성)
-- ※ 실제 파트너명이 다르면 아래 name을 맞춰 수정
INSERT INTO partners (name, can_issue_licenses, locale, currency, country)
VALUES ('Türkiye Partner', true, 'en', 'USD', 'TR')
ON CONFLICT DO NOTHING;
