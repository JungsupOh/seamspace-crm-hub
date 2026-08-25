-- ════════════════════════════════════════════════════════════════════════
-- contacts.phone_normalized 형식 통일 + 형식 차이로 갈라진 중복 고객 병합
-- ════════════════════════════════════════════════════════════════════════
--
-- 배경
--   phone_normalized 를 쓰는 코드가 두 갈래였다.
--     - src/lib/phone.ts            → 숫자만  01012345678
--     - src/pages/Upload.tsx (구)   → 하이픈  010-1234-5678
--     - src/pages/Deals.tsx  (구)   → 하이픈  010-1234-5678
--   중복 판정이 문자열 완전일치라서, 같은 사람이 형식만 다르면 별개 고객으로 쌓였다.
--   실측(2026-08-19): 1522행 중 하이픈 866 / 숫자만 593 / 빈값 46,
--   216개 번호가 2행 이상으로 갈라짐 — 그중 213개가 순전히 형식 차이.
--   이 스크립트로 197그룹(201행)이 자동 병합되고 19그룹은 사람이 판단한다.
--
--   코드는 이미 정본(@/lib/phone, 숫자만)으로 통일했다. 이 스크립트는 기존 데이터를 맞춘다.
--
-- 실행 방법
--   Supabase SQL Editor에서 STEP 순서대로 하나씩 실행한다.
--   STEP 3(DRY-RUN) 결과를 눈으로 확인하기 전에는 STEP 4를 실행하지 말 것.
--   STEP 4는 행을 삭제한다. STEP 1 백업이 있어야 되돌릴 수 있다.
-- ════════════════════════════════════════════════════════════════════════


-- ── STEP 0. 사전점검 ─────────────────────────────────────────────────────
-- phone_normalized 에 UNIQUE 제약이 걸려 있으면 STEP 2가 중간에 실패한다.
-- 결과가 0행이어야 다음으로 진행.
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  tablename = 'contacts'
  AND  indexdef ILIKE '%unique%'
  AND  indexdef ILIKE '%phone_normalized%';

-- 현재 형식 분포 (실행 전 스냅샷 — 나중에 비교용)
SELECT CASE
         WHEN phone_normalized IS NULL OR btrim(phone_normalized) = '' THEN '빈값'
         WHEN phone_normalized ~ '^\d+$'                               THEN '숫자만'
         WHEN phone_normalized ~ '^[\d-]+$'                            THEN '하이픈'
         ELSE '기타(수동확인)'
       END AS 형식,
       count(*) AS 건수
FROM   contacts
GROUP  BY 1 ORDER BY 2 DESC;


-- ── STEP 1. 백업 ─────────────────────────────────────────────────────────
-- 검증이 모두 끝날 때까지 이 테이블을 지우지 말 것.
CREATE TABLE IF NOT EXISTS contacts_backup_20260819 AS
SELECT * FROM contacts;

SELECT count(*) AS 백업행수 FROM contacts_backup_20260819;   -- 실측 1522


-- ── STEP 2. 정규화 ───────────────────────────────────────────────────────
-- 숫자만 남긴다. 국가번호 82는 국내표기(0…)로 되돌린다 — @/lib/phone 과 동일 규칙.
UPDATE contacts
SET    phone_normalized = regexp_replace(phone_normalized, '\D', '', 'g')
WHERE  phone_normalized ~ '\D';

UPDATE contacts
SET    phone_normalized = '0' || substring(phone_normalized from 3)
WHERE  phone_normalized ~ '^82\d{9,}$';

-- 숫자가 하나도 없던 값('.', 이름이 잘못 들어간 행 등)은 빈 문자열이 된다.
-- 빈 문자열끼리 한 그룹으로 묶여 엉뚱한 사람이 병합되는 사고를 막기 위해 NULL로 내린다.
UPDATE contacts
SET    phone_normalized = NULL
WHERE  phone_normalized IS NOT NULL AND btrim(phone_normalized) = '';

-- 검증: 0이어야 한다
SELECT count(*) AS 남은_비숫자 FROM contacts WHERE phone_normalized ~ '\D';

-- 참고: 자릿수가 비정상인 값(해외번호 8~9자리, 두 번호가 붙어 들어간 12자리 등)은
-- 병합 대상에서 제외된다 — 병합 로직은 10~11자리만 다룬다. 실측 9행.
-- 아래 목록은 사람이 직접 정리할 대상이다.
SELECT id, name, phone, phone_normalized, length(phone_normalized) AS 자릿수
FROM   contacts
WHERE  phone_normalized IS NOT NULL
  AND  length(phone_normalized) NOT BETWEEN 10 AND 11
ORDER  BY 자릿수 DESC;


-- ── STEP 3. DRY-RUN — 무엇이 병합될지 먼저 눈으로 본다 ───────────────────
-- 병합 계획 테이블 생성 (임시 테이블은 SQL Editor 세션이 끊기면 사라지므로 실제 테이블로 만든다)
DROP TABLE IF EXISTS contacts_merge_plan_20260819;

CREATE TABLE contacts_merge_plan_20260819 AS
WITH grp AS (
  SELECT phone_normalized,
         count(*)                                        AS row_count,
         count(DISTINCT btrim(lower(coalesce(name,'')))) AS name_variants
  FROM   contacts
  WHERE  phone_normalized IS NOT NULL
    AND  length(phone_normalized) BETWEEN 10 AND 11
  GROUP  BY phone_normalized
  HAVING count(*) > 1
),
ranked AS (
  SELECT c.id,
         c.phone_normalized,
         c.name,
         c.created_at,
         g.row_count,
         g.name_variants,
         -- 생존 행 = created_at 이 가장 오래된 행 (등록일의 진실을 보존)
         row_number() OVER (PARTITION BY c.phone_normalized
                            ORDER BY c.created_at ASC NULLS LAST, c.id ASC) AS rn
  FROM   contacts c
  JOIN   grp g USING (phone_normalized)
)
SELECT phone_normalized,
       name,
       created_at,
       row_count,
       name_variants,
       id                                              AS contact_id,
       (rn = 1)                                        AS is_survivor,
       first_value(id) OVER (PARTITION BY phone_normalized
                             ORDER BY rn)              AS survivor_id,
       -- 이름이 모두 같은 그룹만 자동 병합 대상. 다르면 사람이 판단한다.
       (name_variants = 1)                             AS auto_mergeable
FROM   ranked;

-- 요약: 자동 병합 그룹 수 / 삭제될 행 수 / 수동 확인 그룹 수
SELECT count(*) FILTER (WHERE is_survivor AND auto_mergeable)          AS 자동병합_그룹수,
       count(*) FILTER (WHERE NOT is_survivor AND auto_mergeable)      AS 삭제될_행수,
       count(*) FILTER (WHERE is_survivor AND NOT auto_mergeable)      AS 수동확인_그룹수
FROM   contacts_merge_plan_20260819;
-- 실측 시뮬레이션(2026-08-19) 기준 기대값:
--   자동병합_그룹수 = 197,  삭제될_행수 = 201,  수동확인_그룹수 = 19
--   → contacts 총원 1522 → 1321
-- 이 숫자와 크게 다르면 멈추고 원인부터 확인할 것.

-- 실제로 어떤 행이 사라지는지 표본 확인
SELECT phone_normalized, name, created_at, is_survivor, auto_mergeable
FROM   contacts_merge_plan_20260819
WHERE  auto_mergeable
ORDER  BY phone_normalized, is_survivor DESC
LIMIT  40;


-- ── STEP 4. 병합 실행 (파괴적 — STEP 3 확인 후에만) ─────────────────────

-- 4-1. 생존 행에 notes 이력을 합친다 (줄 단위 중복 제거, 날짜 오름차순)
--      Upload.tsx 의 mergeNoteStrings 와 같은 규칙.
UPDATE contacts c
SET    notes = m.merged_notes
FROM (
  SELECT p.survivor_id,
         (SELECT string_agg(s.line, E'\n' ORDER BY s.date_key, s.line)
          FROM (
            SELECT DISTINCT btrim(l) AS line,
                   coalesce(substring(btrim(l) from '^\[(\d{4}-\d{2}-\d{2})\]'), '') AS date_key
            FROM   contacts c2
            CROSS  JOIN unnest(string_to_array(coalesce(c2.notes, ''), E'\n')) AS l
            WHERE  c2.phone_normalized = p.phone_normalized
              AND  btrim(l) <> ''
          ) s) AS merged_notes
  FROM   contacts_merge_plan_20260819 p
  WHERE  p.is_survivor AND p.auto_mergeable
) m
WHERE c.id = m.survivor_id
  AND coalesce(m.merged_notes, '') <> coalesce(c.notes, '');

-- 4-2. 생존 행의 빈 칸만 다른 행 값으로 채운다 (덮어쓰기 금지)
UPDATE contacts c
SET    name               = coalesce(nullif(btrim(c.name), ''),               f.name),
       email              = coalesce(nullif(btrim(c.email), ''),              f.email),
       phone              = coalesce(nullif(btrim(c.phone), ''),              f.phone),
       org_name           = coalesce(nullif(btrim(c.org_name), ''),           f.org_name),
       education_office   = coalesce(nullif(btrim(c.education_office), ''),   f.education_office),
       role               = coalesce(nullif(btrim(c.role), ''),               f.role),
       lead_source        = coalesce(nullif(btrim(c.lead_source), ''),        f.lead_source),
       data_source_date   = coalesce(nullif(btrim(c.data_source_date), ''),   f.data_source_date),
       school_id_number   = coalesce(nullif(btrim(c.school_id_number), ''),   f.school_id_number),
       org_zipcode        = coalesce(nullif(btrim(c.org_zipcode), ''),        f.org_zipcode),
       org_address        = coalesce(nullif(btrim(c.org_address), ''),        f.org_address),
       org_address_detail = coalesce(nullif(btrim(c.org_address_detail), ''), f.org_address_detail),
       org_tel            = coalesce(nullif(btrim(c.org_tel), ''),            f.org_tel),
       org_homepage       = coalesce(nullif(btrim(c.org_homepage), ''),       f.org_homepage),
       country            = coalesce(nullif(btrim(c.country), ''),            f.country),
       -- 유형/스테이지는 퍼널상 더 진행된 값을 채택 (구매고객 > 리드)
       contact_type       = f.best_contact_type,
       lead_stage         = f.best_lead_stage
FROM (
  SELECT p.survivor_id,
         min(nullif(btrim(c2.name), ''))               AS name,
         min(nullif(btrim(c2.email), ''))              AS email,
         min(nullif(btrim(c2.phone), ''))              AS phone,
         min(nullif(btrim(c2.org_name), ''))           AS org_name,
         min(nullif(btrim(c2.education_office), ''))   AS education_office,
         min(nullif(btrim(c2.role), ''))               AS role,
         min(nullif(btrim(c2.lead_source), ''))        AS lead_source,
         max(nullif(btrim(c2.data_source_date), ''))   AS data_source_date,  -- 최근 활동일
         min(nullif(btrim(c2.school_id_number), ''))   AS school_id_number,
         min(nullif(btrim(c2.org_zipcode), ''))        AS org_zipcode,
         min(nullif(btrim(c2.org_address), ''))        AS org_address,
         min(nullif(btrim(c2.org_address_detail), '')) AS org_address_detail,
         min(nullif(btrim(c2.org_tel), ''))            AS org_tel,
         min(nullif(btrim(c2.org_homepage), ''))       AS org_homepage,
         min(nullif(btrim(c2.country), ''))            AS country,
         (ARRAY_AGG(c2.contact_type ORDER BY CASE btrim(coalesce(c2.contact_type,''))
             WHEN '구매고객'   THEN 1
             WHEN 'Customer'   THEN 1
             WHEN 'Advocate'   THEN 2
             WHEN '파트너'     THEN 3
             WHEN '행정담당자' THEN 4
             WHEN '교사'       THEN 5
             WHEN 'Trial'      THEN 6
             WHEN '리드'       THEN 7
             ELSE 9 END, c2.created_at DESC))[1]       AS best_contact_type,
         (ARRAY_AGG(c2.lead_stage ORDER BY CASE btrim(coalesce(c2.lead_stage,''))
             WHEN '유지' THEN 1
             WHEN '구매' THEN 2
             WHEN '체험' THEN 3
             WHEN '관심' THEN 4
             WHEN '신규' THEN 5
             WHEN '미활성' THEN 6
             WHEN '이탈'   THEN 7
             ELSE 9 END, c2.created_at DESC))[1]       AS best_lead_stage
  FROM   contacts_merge_plan_20260819 p
  JOIN   contacts c2 ON c2.phone_normalized = p.phone_normalized
  WHERE  p.is_survivor AND p.auto_mergeable
  GROUP  BY p.survivor_id
) f
WHERE c.id = f.survivor_id;

-- 4-3. 삭제될 행을 가리키는 참조를 생존 행으로 옮긴다 (FK가 없어 수동으로 해야 한다)
UPDATE campaign_leads cl
SET    converted_contact_id = p.survivor_id
FROM   contacts_merge_plan_20260819 p
WHERE  p.auto_mergeable AND NOT p.is_survivor
  AND  cl.converted_contact_id = p.contact_id;

UPDATE mdiary_coupons mc
SET    linked_contact_id = p.survivor_id
FROM   contacts_merge_plan_20260819 p
WHERE  p.auto_mergeable AND NOT p.is_survivor
  AND  mc.linked_contact_id = p.contact_id;

-- 4-4. 잉여 행 삭제
DELETE FROM contacts c
USING  contacts_merge_plan_20260819 p
WHERE  p.auto_mergeable AND NOT p.is_survivor
  AND  c.id = p.contact_id;


-- ── STEP 5. 검증 ─────────────────────────────────────────────────────────

-- 5-1. 형식이 전부 숫자만인지 (0이어야 함)
SELECT count(*) AS 비숫자_잔여 FROM contacts WHERE phone_normalized ~ '\D';

-- 5-2. 자동병합 대상 중복이 남아있지 않은지 (0행이어야 함)
SELECT phone_normalized, count(*) AS n, count(DISTINCT btrim(lower(name))) AS 이름종류
FROM   contacts
WHERE  phone_normalized IS NOT NULL AND length(phone_normalized) BETWEEN 10 AND 11
GROUP  BY phone_normalized
HAVING count(*) > 1 AND count(DISTINCT btrim(lower(name))) = 1;

-- 5-3. 끊어진 참조가 없는지 (둘 다 0행이어야 함)
SELECT count(*) AS 끊긴_campaign_leads
FROM   campaign_leads cl
WHERE  cl.converted_contact_id IS NOT NULL
  AND  NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = cl.converted_contact_id);

SELECT count(*) AS 끊긴_mdiary_coupons
FROM   mdiary_coupons mc
WHERE  mc.linked_contact_id IS NOT NULL
  AND  NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = mc.linked_contact_id);

-- 5-4. 총원 확인 — 백업행수 - 삭제행수 와 일치해야 한다
SELECT (SELECT count(*) FROM contacts_backup_20260819) AS 이전,
       (SELECT count(*) FROM contacts)                 AS 이후,
       (SELECT count(*) FROM contacts_merge_plan_20260819
        WHERE auto_mergeable AND NOT is_survivor)      AS 삭제예정;

-- 5-5. 이름이 달라 자동 병합하지 않은 그룹 — 사람이 직접 판단할 목록
--      (가족/기기공유면 그대로 두고, 오타로 갈라진 동일인이면 수동 병합)
SELECT p.phone_normalized,
       string_agg(c.name || ' (' || to_char(c.created_at, 'YYYY-MM-DD') || ')', ' | '
                  ORDER BY c.created_at) AS 후보들
FROM   contacts_merge_plan_20260819 p
JOIN   contacts c ON c.id = p.contact_id
WHERE  NOT p.auto_mergeable
GROUP  BY p.phone_normalized
ORDER  BY p.phone_normalized;


-- ── 정리 (검증 완료 후에만) ──────────────────────────────────────────────
-- DROP TABLE contacts_merge_plan_20260819;
-- DROP TABLE contacts_backup_20260819;


-- ════════════════════════════════════════════════════════════════════════
-- STEP 6. 수동 검수 그룹 중 '같은 사람'으로 확인된 17건 병합
-- ════════════════════════════════════════════════════════════════════════
--
-- STEP 5-5가 뽑은 19개 그룹을 소속·이메일·구매이력까지 열어 확인한 결과:
--
--   [병합 대상 17건] 한 행은 실명+이메일+구매이력, 다른 행은 학교/반 이름 +
--     이용권 유입(seamspace·mDiary). 이용권을 반 단위로 등록하며 이름 칸에
--     반 이름을 넣은 케이스로, 17건 모두 org_name 이 완전히 동일하다.
--
--   [제외 2건] 테스트 데이터가 섞여 있어 병합하지 않는다.
--     · 01012341234 — 번호가 010-1234-1234(더미). '새롬초등학교 1'(새롬초, 실제
--       이용권 발송 이력)과 '이호동'(마음학교)은 소속이 달라 서로 다른 사람이다.
--     · 01055469026 — '아멜리아'의 이메일이 amelia@tebahsoft.com(사내 도메인).
--       아멜리아2/3, 오정섭2~4 처럼 번호를 올려가며 만든 내부 테스트 계정군.
--     두 그룹은 jin30120@naver.com 을 공유해 같은 테스트 뭉치에서 나왔다.
--     테스트 계정 정리는 이번 범위 밖 — 별도로 다룬다.
--
-- STEP 4와 병합 규칙은 같되 이름 규칙 하나만 다르다:
--   STEP 4는 생존 행의 이름을 그대로 두지만, 여기서는 한쪽 이름이 '천마초 5-1반'
--   같은 반 이름이라 그대로 두면 실제 담당 선생님 이름이 사라진다.
--   → 이름은 '이메일이 있는 행'의 것을 우선 채택한다.

-- 6-1. 병합 계획 (대상 번호를 명시적으로 나열 — 검토 가능하도록)
DROP TABLE IF EXISTS contacts_manual_merge_20260819;

CREATE TABLE contacts_manual_merge_20260819 AS
WITH target(phone_normalized) AS (
  VALUES ('01020580492'),  -- 천마초등학교 / 천마초 5-1반
         ('01022522214'),  -- 백암초 / 백암초1
         ('01023035155'),  -- 광주광명초 / 광주광명초 5-1반
         ('01025246867'),  -- 이태관 ×2 / 광양제철남초등학교 (3행)
         ('01032298188'),  -- 조정현 / 부원초등학교 4
         ('01035971300'),  -- 채지수 / 솔터초
         ('01038971400'),  -- 천마초등학교 / 천마초등학교 1
         ('01045098669'),  -- 송주연 / 화중초 4-1
         ('01055283877'),  -- 김은수 / 조치원중 1-6반
         ('01063366025'),  -- 박준호 / 다빛초 6가람
         ('01063993121'),  -- 최하영 / 최하영1
         ('01064011132'),  -- 허경무 / 4학년 1반
         ('01082091391'),  -- (이름없음) / 대전서부아동보호전문기관
         ('01086673910'),  -- 김소연 / 김소연 1
         ('01086684648'),  -- 박현도 / 6학년(7반)
         ('01088510052'),  -- 임진희 / 일산초 2-2반
         ('01097941009')   -- 홍O현 / 계림초등학교
),
ranked AS (
  SELECT c.id,
         c.phone_normalized,
         row_number() OVER (PARTITION BY c.phone_normalized
                            ORDER BY c.created_at ASC NULLS LAST, c.id ASC) AS rn
  FROM   contacts c
  JOIN   target t USING (phone_normalized)
)
SELECT phone_normalized,
       id                                              AS contact_id,
       (rn = 1)                                        AS is_survivor,
       first_value(id) OVER (PARTITION BY phone_normalized
                             ORDER BY rn)              AS survivor_id
FROM   ranked;

-- 확인: 그룹수 17 / 행수 35 / 삭제될_행수 18 이어야 한다
--       (16개 그룹은 2행, 이태관 그룹만 3행)
SELECT count(DISTINCT phone_normalized) AS 그룹수,
       count(*)                          AS 행수,
       count(*) FILTER (WHERE NOT is_survivor) AS 삭제될_행수
FROM   contacts_manual_merge_20260819;

-- 어떤 이름이 살아남는지 미리 확인 (실행 전 눈으로 볼 것)
-- 실데이터 시뮬레이션 결과: 17개 중 14개는 실명이 선택된다.
-- 나머지 3개(01020580492, 01038971400, 01082091391)는 양쪽 행 어디에도
-- 사람 이름이 없어 기관명이 선택된다 — 규칙 문제가 아니라 원본에 실명이 없는 것.
SELECT p.phone_normalized,
       (ARRAY_AGG(btrim(c.name) ORDER BY
          CASE WHEN nullif(btrim(c.email), '') IS NOT NULL THEN 0 ELSE 1 END,
          length(btrim(c.name)), c.created_at)
        FILTER (WHERE nullif(btrim(c.name), '') IS NOT NULL))[1] AS 최종_이름,
       string_agg(btrim(c.name), ' | ' ORDER BY c.created_at)     AS 후보들
FROM   contacts_manual_merge_20260819 p
JOIN   contacts c ON c.id = p.contact_id
GROUP  BY p.phone_normalized
ORDER  BY p.phone_normalized;


-- 6-2. notes 합치기 (STEP 4-1과 같은 규칙)
UPDATE contacts c
SET    notes = m.merged_notes
FROM (
  SELECT p.survivor_id,
         (SELECT string_agg(s.line, E'\n' ORDER BY s.date_key, s.line)
          FROM (
            SELECT DISTINCT btrim(l) AS line,
                   coalesce(substring(btrim(l) from '^\[(\d{4}-\d{2}-\d{2})\]'), '') AS date_key
            FROM   contacts_manual_merge_20260819 p2
            JOIN   contacts c2 ON c2.id = p2.contact_id
            CROSS  JOIN unnest(string_to_array(coalesce(c2.notes, ''), E'\n')) AS l
            WHERE  p2.phone_normalized = p.phone_normalized
              AND  btrim(l) <> ''
          ) s) AS merged_notes
  FROM   contacts_manual_merge_20260819 p
  WHERE  p.is_survivor
) m
WHERE c.id = m.survivor_id
  AND coalesce(m.merged_notes, '') <> coalesce(c.notes, '');


-- 6-3. 빈 칸 채우기 + 이름은 '이메일 있는 행' 우선
UPDATE contacts c
SET    name               = coalesce(f.best_name, c.name),
       email              = coalesce(nullif(btrim(c.email), ''),              f.email),
       phone              = coalesce(nullif(btrim(c.phone), ''),              f.phone),
       org_name           = coalesce(nullif(btrim(c.org_name), ''),           f.org_name),
       education_office   = coalesce(nullif(btrim(c.education_office), ''),   f.education_office),
       role               = coalesce(nullif(btrim(c.role), ''),               f.role),
       lead_source        = coalesce(nullif(btrim(c.lead_source), ''),        f.lead_source),
       data_source_date   = coalesce(nullif(btrim(c.data_source_date), ''),   f.data_source_date),
       school_id_number   = coalesce(nullif(btrim(c.school_id_number), ''),   f.school_id_number),
       org_zipcode        = coalesce(nullif(btrim(c.org_zipcode), ''),        f.org_zipcode),
       org_address        = coalesce(nullif(btrim(c.org_address), ''),        f.org_address),
       org_address_detail = coalesce(nullif(btrim(c.org_address_detail), ''), f.org_address_detail),
       org_tel            = coalesce(nullif(btrim(c.org_tel), ''),            f.org_tel),
       org_homepage       = coalesce(nullif(btrim(c.org_homepage), ''),       f.org_homepage),
       country            = coalesce(nullif(btrim(c.country), ''),            f.country),
       contact_type       = f.best_contact_type,
       lead_stage         = f.best_lead_stage
FROM (
  SELECT p.survivor_id,
         (ARRAY_AGG(btrim(c2.name) ORDER BY
            CASE WHEN nullif(btrim(c2.email), '') IS NOT NULL THEN 0 ELSE 1 END,
            length(btrim(c2.name)), c2.created_at)
          FILTER (WHERE nullif(btrim(c2.name), '') IS NOT NULL))[1] AS best_name,
         min(nullif(btrim(c2.email), ''))              AS email,
         min(nullif(btrim(c2.phone), ''))              AS phone,
         min(nullif(btrim(c2.org_name), ''))           AS org_name,
         min(nullif(btrim(c2.education_office), ''))   AS education_office,
         min(nullif(btrim(c2.role), ''))               AS role,
         min(nullif(btrim(c2.lead_source), ''))        AS lead_source,
         max(nullif(btrim(c2.data_source_date), ''))   AS data_source_date,
         min(nullif(btrim(c2.school_id_number), ''))   AS school_id_number,
         min(nullif(btrim(c2.org_zipcode), ''))        AS org_zipcode,
         min(nullif(btrim(c2.org_address), ''))        AS org_address,
         min(nullif(btrim(c2.org_address_detail), '')) AS org_address_detail,
         min(nullif(btrim(c2.org_tel), ''))            AS org_tel,
         min(nullif(btrim(c2.org_homepage), ''))       AS org_homepage,
         min(nullif(btrim(c2.country), ''))            AS country,
         (ARRAY_AGG(c2.contact_type ORDER BY CASE btrim(coalesce(c2.contact_type,''))
             WHEN '구매고객'   THEN 1
             WHEN 'Customer'   THEN 1
             WHEN 'Advocate'   THEN 2
             WHEN '파트너'     THEN 3
             WHEN '행정담당자' THEN 4
             WHEN '교사'       THEN 5
             WHEN 'Trial'      THEN 6
             WHEN '리드'       THEN 7
             ELSE 9 END, c2.created_at DESC))[1]       AS best_contact_type,
         (ARRAY_AGG(c2.lead_stage ORDER BY CASE btrim(coalesce(c2.lead_stage,''))
             WHEN '유지' THEN 1
             WHEN '재구매' THEN 1
             WHEN '구매' THEN 2
             WHEN '체험' THEN 3
             WHEN '관심' THEN 4
             WHEN '신규' THEN 5
             WHEN '미활성' THEN 6
             WHEN '이탈'   THEN 7
             ELSE 9 END, c2.created_at DESC))[1]       AS best_lead_stage
  FROM   contacts_manual_merge_20260819 p
  JOIN   contacts c2 ON c2.phone_normalized = p.phone_normalized
  WHERE  p.is_survivor
  GROUP  BY p.survivor_id
) f
WHERE c.id = f.survivor_id;


-- 6-4. 참조 재지정 (STEP 4-3과 동일)
UPDATE campaign_leads cl
SET    converted_contact_id = p.survivor_id
FROM   contacts_manual_merge_20260819 p
WHERE  NOT p.is_survivor AND cl.converted_contact_id = p.contact_id;

UPDATE mdiary_coupons mc
SET    linked_contact_id = p.survivor_id
FROM   contacts_manual_merge_20260819 p
WHERE  NOT p.is_survivor AND mc.linked_contact_id = p.contact_id;


-- 6-5. 잉여 행 삭제
DELETE FROM contacts c
USING  contacts_manual_merge_20260819 p
WHERE  NOT p.is_survivor AND c.id = p.contact_id;


-- 6-6. 검증
-- 대상 17개 번호가 전부 1행씩만 남았는지 (0행이어야 함)
SELECT phone_normalized, count(*)
FROM   contacts
WHERE  phone_normalized IN (SELECT DISTINCT phone_normalized FROM contacts_manual_merge_20260819)
GROUP  BY phone_normalized HAVING count(*) > 1;

-- 병합 결과 확인 — 이름·소속·유형이 제대로 살아남았는지 눈으로
SELECT phone_normalized, name, org_name, email, contact_type, lead_stage
FROM   contacts
WHERE  phone_normalized IN (SELECT DISTINCT phone_normalized FROM contacts_manual_merge_20260819)
ORDER  BY phone_normalized;

-- 끊어진 참조 없는지 (둘 다 0이어야 함)
SELECT count(*) AS 끊긴_campaign_leads FROM campaign_leads cl
WHERE  cl.converted_contact_id IS NOT NULL
  AND  NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = cl.converted_contact_id);
SELECT count(*) AS 끊긴_mdiary_coupons FROM mdiary_coupons mc
WHERE  mc.linked_contact_id IS NOT NULL
  AND  NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = mc.linked_contact_id);

-- 남아있어야 하는 2개(테스트 데이터 섞임) — 그대로 2행씩인지 확인
SELECT phone_normalized, name, org_name, email
FROM   contacts
WHERE  phone_normalized IN ('01012341234', '01055469026')
ORDER  BY phone_normalized, created_at;

-- 정리 (검증 완료 후)
-- DROP TABLE contacts_manual_merge_20260819;
