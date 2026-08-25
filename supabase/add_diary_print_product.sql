-- ════════════════════════════════════════════════════════════════════════
-- 일기 제본(나의 이야기 출력 서비스) 상품 등록
-- ════════════════════════════════════════════════════════════════════════
--
-- shop_products 에 'diary' 행이 이미 있으나 가격 0 · active=false 인 자리표시 상태였다.
-- 새 행을 만들지 않고 그 자리를 채운다.
--
-- 두 가지가 기존 구조와 달라 컬럼/로직을 확장했다:
--   1) 페이지 구간별로 단가가 다르다 → options 를 {label, price} 형태로 저장.
--      기존 문자열 배열(보드게임 '한글판'/'영문판')도 그대로 동작한다.
--   2) 배송비가 3,500원 고정이다 → shipping_fee 컬럼 신설.
--      값이 있으면 공통 정책(3,000원 + 5만원당 3,000원 할인) 대신 이 금액을 쓰고
--      무료배송 할인을 적용하지 않는다. 제작 상품이라 수량이 늘어도 실비가 줄지 않는다.
-- ════════════════════════════════════════════════════════════════════════

-- STEP 1. 상품별 고정 배송비 컬럼
ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS shipping_fee INT;

COMMENT ON COLUMN shop_products.shipping_fee IS
  '이 상품만의 고정 배송비(원). NULL이면 공통 정책(3,000원 + 5만원당 3,000원 할인). 값이 있으면 무료배송 할인 미적용';

-- STEP 2. diary 상품 내용 채우기
UPDATE shop_products
SET    name             = '나의 이야기 출력 서비스',
       description      = '우리 반 일기를 한 권의 책으로 · 36p부터 제작',
       price            = 26000,          -- 최저 구간가. 화면에는 '26,000원부터'로 표시된다
       original_price   = NULL,
       unit_qty         = 1,
       unit_label       = '1권',
       options          = '[
         {"label": "36~100p",   "price": 26000},
         {"label": "101~150p",  "price": 29000},
         {"label": "151~200p",  "price": 32000},
         {"label": "201~250p",  "price": 35000},
         {"label": "251~300p",  "price": 38000}
       ]'::jsonb,
       image_url        = '/banner/diary(Thmb).png',
       detail_image_url = '/banner/diary_detail.png',
       shipping_fee     = 3500,
       active           = true,
       sort_order       = 3
WHERE  id = 'diary';

-- STEP 3. 검증
SELECT id, name, price, unit_label, shipping_fee, active, sort_order,
       jsonb_array_length(options) AS 옵션수
FROM   shop_products
WHERE  id = 'diary';
-- 기대: 나의 이야기 출력 서비스 / 26000 / 1권 / 3500 / true / 3 / 5

-- 옵션 구간과 단가 확인
SELECT o->>'label' AS 페이지구간, (o->>'price')::int AS 단가
FROM   shop_products, jsonb_array_elements(options) o
WHERE  id = 'diary';

-- 기존 상품이 영향받지 않았는지 (보드게임 옵션은 문자열 배열 그대로여야 한다)
SELECT id, name, options, shipping_fee FROM shop_products ORDER BY sort_order;
