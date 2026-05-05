-- 캠페인 체험 이용권 옵션 — 마이그레이션
-- campaigns에 trial_license_settings JSONB 추가 (플랜/인원/개월/자동발급)

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS trial_license_settings JSONB;

COMMENT ON COLUMN campaigns.trial_license_settings IS
'캠페인 체험 이용권 자동/수동 발급 설정.
{
  "enabled": true,
  "plan": "classroom" | "grade",
  "user_count": 40 | 200,
  "duration_months": 1,
  "auto_issue": true,
  "service_expire_at": "2026-12-31"
}
- enabled=false: 이용권 발급 안 함
- auto_issue=true: 리드 등록 시 자동으로 쿠폰 생성 + 알림톡 발송 + campaign_licenses 저장
- auto_issue=false: 어드민이 /campaigns에서 수동 발송
- service_expire_at: 만기일 명시 (없으면 발급일 기준 자동)';
