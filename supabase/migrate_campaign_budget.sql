-- campaigns에 예산/집행비용 컬럼 추가 (CAC 산출용)
-- 어드민 캠페인 다이얼로그의 '예산 (원)' / '집행 비용 (원)' 입력값 저장.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS budget BIGINT,
  ADD COLUMN IF NOT EXISTS actual_cost BIGINT;

COMMENT ON COLUMN campaigns.budget       IS '캠페인 책정 예산 (원)';
COMMENT ON COLUMN campaigns.actual_cost  IS '캠페인 실집행 비용 (원). budget 대비 ROI/CAC 계산에 사용';
