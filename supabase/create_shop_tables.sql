-- 실물 상품 주문 시스템 테이블
-- Supabase SQL Editor에서 실행

-- 1. 상품 마스터
CREATE TABLE IF NOT EXISTS shop_products (
  id              TEXT PRIMARY KEY,              -- 'keyring', 'boardgame', 'diary'
  name            TEXT NOT NULL,
  description     TEXT,
  price           INTEGER NOT NULL DEFAULT 0,    -- 판매가 (원)
  original_price  INTEGER,                       -- 정가 (할인 전, NULL이면 할인 없음)
  unit_qty        INTEGER NOT NULL DEFAULT 1,    -- 키링=10(묶음), 보드게임=1
  unit_label      TEXT,                          -- '10개 1세트', '1개' 등
  options         JSONB,                         -- ["한글판","영문판"] or null
  image_url       TEXT,
  detail_image_url TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. 주문
CREATE TABLE IF NOT EXISTS shop_orders (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        TEXT NOT NULL UNIQUE,           -- nanoid, Toss orderId
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT '결제완료', -- 결제완료 / 배송준비 / 배송중 / 배송완료 / 취소
  -- 고객
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,
  -- 배송지
  zipcode         TEXT NOT NULL,
  address         TEXT NOT NULL,
  address_detail  TEXT,
  delivery_memo   TEXT,
  -- 금액
  subtotal        INTEGER NOT NULL,               -- 상품 합계
  shipping_fee    INTEGER NOT NULL DEFAULT 3000,   -- 배송비 (5만원 이상 무료)
  discount        INTEGER NOT NULL DEFAULT 0,      -- 할인
  coupon_code     TEXT,
  total_amount    INTEGER NOT NULL,               -- 실 결제액
  -- Toss
  payment_key     TEXT UNIQUE,
  toss_method     TEXT,
  approved_at     TEXT,
  -- 배송
  carrier         TEXT,                           -- 택배사
  tracking_number TEXT,
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ
);

-- 3. 주문 상세 항목
CREATE TABLE IF NOT EXISTS shop_order_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES shop_orders(order_id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option      TEXT,                               -- '한글판', '영문판', null
  qty         INTEGER NOT NULL DEFAULT 1,
  unit_price  INTEGER NOT NULL,
  subtotal    INTEGER NOT NULL                    -- qty * unit_price
);

-- 4. RLS
ALTER TABLE shop_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_shop_products"    ON shop_products    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_shop_orders"      ON shop_orders      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "all_shop_order_items" ON shop_order_items FOR ALL USING (true) WITH CHECK (true);

-- 5. 인덱스
CREATE INDEX IF NOT EXISTS idx_shop_orders_phone ON shop_orders (customer_phone);
CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop_order_items (order_id);

-- 6. 초기 상품 데이터
INSERT INTO shop_products (id, name, description, price, original_price, unit_qty, unit_label, options, image_url, detail_image_url, active, sort_order)
VALUES
  ('keyring', '심스페이스 감정 키링 10종', '내 마음을 표현하는 감정 캐릭터 키링 세트', 30000, 33000, 10, '10개 1세트', NULL, '/banner/keyring.png', '/banner/keyring_detail.png', true, 1),
  ('boardgame', '심스페이스 마음여행 보드게임', '심소와 함께 떠나는 마음 여행', 32000, 44000, 1, '1개', '["한글판","영문판"]', '/banner/boardgame.png', '/banner/boardgame_detail.png', true, 2),
  ('diary', '심스페이스 일기책', '나의 이야기를 한 권의 책으로', 0, NULL, 1, '1권', NULL, '/banner/diary.png', '/banner/diary_detail.png', false, 3)
ON CONFLICT (id) DO NOTHING;
