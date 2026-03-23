-- mDiary 쿠폰 ↔ 고객 확인 상태
ALTER TABLE mdiary_coupons
  ADD COLUMN IF NOT EXISTS linked_contact_id TEXT,     -- Airtable contact record ID
  ADD COLUMN IF NOT EXISTS link_confirmed     BOOLEAN; -- NULL=미확인, TRUE=확인, FALSE=다른 분

-- 인증된 사용자(로그인)가 link 컬럼 업데이트 가능
CREATE POLICY "authenticated update" ON mdiary_coupons
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_mdiary_coupons_link ON mdiary_coupons (linked_contact_id, link_confirmed);
