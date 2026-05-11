-- 럭키세븐 발송 쿠폰을 deal_licenses에 백필 (1회용)
-- 조건:
--   campaign_licenses 행이 럭키세븐 그룹(lead.ls_group_id)에 속하고
--   같은 coupon_code의 deal_licenses 행이 아직 없으며
--   group.group_code = deals.quote_number 매칭이 있는 경우
-- 동작: deal_licenses에 새 행 INSERT (deal_id 매칭)

INSERT INTO deal_licenses
  (deal_id, coupon_code, contact_name, contact_phone, org_name,
   duration, user_count, status, service_expire_at)
SELECT
  d.id AS deal_id,
  cl.coupon_code,
  cl.contact_name,
  cl.contact_phone,
  cl.org_name,
  cl.duration,
  cl.user_count,
  cl.status,
  cl.service_expire_at
FROM campaign_licenses cl
JOIN campaign_leads l       ON l.id = cl.lead_id
JOIN lucky_seven_groups g   ON g.id = l.ls_group_id
JOIN deals d                ON d.quote_number = g.group_code
WHERE l.ls_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deal_licenses dl WHERE dl.coupon_code = cl.coupon_code
  );
