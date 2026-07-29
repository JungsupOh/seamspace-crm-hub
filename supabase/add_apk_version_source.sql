-- APK 버전 출처 컬럼 (apk_versions.source)
-- 'admin' : 관리자가 CRM 화면에서 브라우저 업로드 (기존)
-- 'ci'    : 개발팀 CI/CD가 apk-publish 엔드포인트로 자동 푸시
-- 관리자 목록에서 CI 업로드분을 배지로 구분하기 위함.

ALTER TABLE apk_versions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin'
    CHECK (source IN ('admin', 'ci'));
