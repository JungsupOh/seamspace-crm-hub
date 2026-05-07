-- 과거 연도 월별 매출 — 부가세 증빙 기반 SEED 입력용
-- (당해년도는 deals.Payment_Date 기준으로 자동 집계, 작년 이전은 이 테이블 사용)

CREATE TABLE IF NOT EXISTS prior_year_revenue (
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount     BIGINT  NOT NULL DEFAULT 0,   -- 원 단위
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month)
);

COMMENT ON TABLE prior_year_revenue IS
'과거 연도 월별 매출 (현금주의 기준). 당해년도는 deals.Payment_Date로 실시간 집계,
이전 연도는 부가세 신고 자료 기반으로 SEED INSERT.';

ALTER TABLE prior_year_revenue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all_prior_year_revenue" ON prior_year_revenue FOR ALL USING (true) WITH CHECK (true);

-- 예시 SEED (실제 부가세 자료 도착 시 UPSERT로 일괄 적용):
-- INSERT INTO prior_year_revenue (year, month, amount, note) VALUES
--   (2025, 1,  3000000, '2025년 1월 부가세 신고 기준'),
--   (2025, 2,  4500000, ''),
--   ...
-- ON CONFLICT (year, month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();
