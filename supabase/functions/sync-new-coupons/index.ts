// Supabase Edge Function: sync-new-coupons
// MySQL mDiary_app_coupon에서 새 쿠폰을 감지해 mdiary_coupons에 추가
// mdiary_id가 현재 max보다 큰 레코드만 INSERT (upsert)

import { createClient } from "jsr:@supabase/supabase-js@2";

const MYSQL_HOST = "mdiary-db-lb01-103229276-bd373dd901f6.kr.lb.naverncp.com";
const MYSQL_PORT = 12327;
const MYSQL_DB   = "mdiary2";
const MYSQL_USER = "md_james";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** descript에서 사람 이름 추출 */
function extractName(descript: string | null): string | null {
  if (!descript) return null;
  const d = descript
    .replace(/\(유료구매\)/g, "")
    .replace(/선생님/g, "")
    .replace(/#\d+$/, "")
    .trim();

  // (이름) 형식
  const bracket = d.match(/\(([가-힣]{2,4})\)/);
  if (bracket) return bracket[1];

  // 마지막 한글 단어
  const parts = d.split(/[\s\-_,]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[가-힣]{2,4}$/.test(parts[i])) return parts[i];
  }
  return null;
}

interface MysqlCoupon {
  id: number;
  coupon_code: string;
  created_at: string;
  duration: number;
  user_limit: number;
  is_used: number;
  descript: string | null;
  used_group_id: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 현재 Supabase에 저장된 최대 mdiary_id 조회
    const { data: maxRow } = await supabase
      .from("mdiary_coupons")
      .select("mdiary_id")
      .order("mdiary_id", { ascending: false })
      .limit(1)
      .single();

    const maxId: number = maxRow?.mdiary_id ?? 0;

    // MySQL 연결
    const password = Deno.env.get("MDIARY_DB_PASSWORD");
    if (!password) throw new Error("MDIARY_DB_PASSWORD secret이 설정되지 않았습니다");

    const mysql = await import("npm:mysql2/promise");
    const conn  = await mysql.createConnection({
      host: MYSQL_HOST, port: MYSQL_PORT,
      database: MYSQL_DB, user: MYSQL_USER,
      password, ssl: false,
    });

    let newRows: MysqlCoupon[] = [];
    try {
      const [result] = await conn.execute<MysqlCoupon[]>(
        `SELECT id, coupon_code, created_at, duration, user_limit,
                is_used, descript, used_group_id
         FROM mDiary_app_coupon
         WHERE id > ?
         ORDER BY id ASC
         LIMIT 500`,
        [maxId],
      );
      newRows = result as MysqlCoupon[];
    } finally {
      await conn.end();
    }

    if (newRows.length === 0) {
      return json({ inserted: 0, message: "새 쿠폰 없음" });
    }

    // Supabase upsert
    const records = newRows.map(r => ({
      mdiary_id:      r.id,
      coupon_code:    r.coupon_code,
      created_at:     r.created_at,
      duration:       r.duration,
      user_limit:     r.user_limit,
      is_used:        !!r.is_used,
      descript:       r.descript ?? null,
      extracted_name: extractName(r.descript ?? null),
      used_group_id:  r.used_group_id ? String(r.used_group_id) : null,
    }));

    const { error, count } = await supabase
      .from("mdiary_coupons")
      .upsert(records, { onConflict: "mdiary_id", ignoreDuplicates: false })
      .select("id", { count: "exact" });

    if (error) throw error;

    return json({ inserted: count ?? records.length, total_new: newRows.length });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
