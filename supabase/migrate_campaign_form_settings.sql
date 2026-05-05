-- 캠페인 신청 폼 동적 구성 — 마이그레이션
-- 1) campaigns에 form_settings JSONB (캠페인별 폼 구성)
-- 2) campaign_leads에 custom_fields JSONB (자유 질문 답변 + 활용방안 등 동적 필드)

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS form_settings JSONB;

COMMENT ON COLUMN campaigns.form_settings IS
'공개 신청 폼 동적 구성.
{
  "school": {
    "enabled": true,
    "mode": "k12_search" | "free_text" | "mixed",
    "label": "학교명"
  },
  "role":       { "enabled": true,  "label": "담당 업무" },
  "source":     { "enabled": true },
  "usage_plan": { "enabled": false, "label": "활용 방안" },
  "custom_questions": [
    { "label": "어떤 점이 궁금하신가요?", "type": "textarea" }
  ]
}

school.mode:
- k12_search: NEIS 검색만 (초중고)
- free_text:  자유 입력 (대학교/기관)
- mixed:      NEIS 검색 표시 + 미선택 시 입력한 텍스트 그대로 저장 (초중고+대학교 혼합)

form_settings NULL이면 기본 동작 (학교=k12_search, 담당업무 ON, 소개경로 ON).';

ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS custom_fields JSONB;

COMMENT ON COLUMN campaign_leads.custom_fields IS
'동적 폼에서 입력된 추가 답변. 예: { "usage_plan": "...", "custom_q1": "..." }';
