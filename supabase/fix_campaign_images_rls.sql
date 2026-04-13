-- Storage 버킷 campaign-images 의 RLS 정책 보강
-- 기존 정책 삭제 후 모든 역할(anon, authenticated)에 대해 INSERT/UPDATE/SELECT 허용

DROP POLICY IF EXISTS "campaign_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "campaign_images_auth_write" ON storage.objects;

-- 전체 공개 읽기
CREATE POLICY "campaign_images_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'campaign-images');

-- 전체 공개 INSERT (업로드)
CREATE POLICY "campaign_images_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'campaign-images');

-- 전체 공개 UPDATE (upsert 헤더 사용 시 필요)
CREATE POLICY "campaign_images_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'campaign-images')
  WITH CHECK (bucket_id = 'campaign-images');

-- 전체 공개 DELETE (이미지 교체 시 필요)
CREATE POLICY "campaign_images_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'campaign-images');
