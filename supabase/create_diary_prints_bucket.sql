-- ════════════════════════════════════════════════════════════════════════
-- 일기 제본 PDF 보관 버킷
-- ════════════════════════════════════════════════════════════════════════
--
-- /print 에서 만든 인쇄용 PDF를 여기에 올리고 signed URL로 내려받는다.
-- PDF를 응답 본문에 직접 실을 수도 있지만, Vercel 서버리스 응답 상한이 4.5MB고
-- 실측상 300페이지 책이 글자 다양성에 따라 2.8MB 안팎이라 여유가 없다.
--
-- 이 버킷은 반드시 비공개다. shop_* 테이블은 anon 키에 열려 있지만(RLS `using (true)`)
-- 여기 들어가는 건 사용자가 쓴 일기 본문이라 같은 정책을 따라가면 안 된다.
-- 서버(service_role 키)만 쓰고, 다운로드는 30분짜리 signed URL로만 준다.
-- ════════════════════════════════════════════════════════════════════════

-- STEP 1. 버킷 생성 (이미 있으면 비공개로 되돌린다)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('diary_prints', 'diary_prints', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 52428800,
      allowed_mime_types = ARRAY['application/pdf'];

-- STEP 2. 정책은 두지 않는다
-- storage.objects 는 RLS가 켜져 있고, service_role 키는 RLS를 우회한다.
-- 즉 정책을 하나도 만들지 않으면 anon/authenticated 는 접근할 수 없고
-- 서버만 읽고 쓸 수 있다 — 이 버킷에 원하는 상태가 정확히 그것이다.

-- STEP 3. 검증
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM   storage.buckets WHERE id = 'diary_prints';
-- 기대: diary_prints / diary_prints / false / 52428800 / {application/pdf}

-- anon 으로 접근이 막히는지 (정책이 없어야 한다)
SELECT policyname FROM pg_policies
WHERE  schemaname = 'storage' AND tablename = 'objects'
       AND qual ILIKE '%diary_prints%';
-- 기대: 0건
