-- 파트너 서류 업로드 오류 수정
-- Supabase SQL Editor에서 실행

-- 1. partner_files 테이블 RLS 정책 재설정 (전체 역할 허용)
DROP POLICY IF EXISTS "anon_all_partner_files" ON partner_files;
DROP POLICY IF EXISTS "auth_all_partner_files" ON partner_files;

CREATE POLICY "all_partner_files" ON partner_files
  FOR ALL USING (true) WITH CHECK (true);

-- 2. Storage 버킷 partner-files 생성 (없을 경우)
INSERT INTO storage.buckets (id, name, public)
VALUES ('partner-files', 'partner-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Storage 오브젝트 정책 설정
DROP POLICY IF EXISTS "partner_files_storage_all" ON storage.objects;

CREATE POLICY "partner_files_storage_all" ON storage.objects
  FOR ALL USING (bucket_id = 'partner-files')
  WITH CHECK (bucket_id = 'partner-files');
