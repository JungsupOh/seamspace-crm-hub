// Supabase Edge Function: get-coupon-status
// 1. 운영DB(MySQL)에서 쿠폰 상태 조회
// 2. Supabase deal_licenses에 status + service_expire_at 업데이트 (동기화)
// 3. Supabase mdiary_coupons에 is_used + service_expire_at + member_count + group_name + edu_office_name + admin_last_login 업데이트

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

interface CouponRow {
  coupon_code:      string;
  is_used:          number;
  used_group_id:    number | null;
  service_expire_at: string | null;
  member_count:     number | null;
  group_name:       string | null;
  edu_office_name:  string | null;
  admin_name:       string | null;
  admin_phone:      string | null;
  admin_last_login: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({})) as { codes?: string[]; offset?: number; limit?: number };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // codes 미제공 시 → deal_licenses(대기/사용중) + mdiary_coupons(is_used=true) 자동 조회
    // 미사용 쿠폰은 그룹 데이터가 없어 MySQL 부하만 높임 → 제외
    let codes: string[] = body.codes ?? [];
    if (codes.length === 0) {
      const [{ data: dealData }, { data: mdiaryData }] = await Promise.all([
        supabase
          .from("deal_licenses")
          .select("coupon_code")
          .in("status", ["대기", "사용중"])
          .not("coupon_code", "is", null),
        supabase
          .from("mdiary_coupons")
          .select("coupon_code")
          .eq("is_used", true)
          .not("coupon_code", "is", null),
      ]);
      const dealCodes   = (dealData   ?? []).map((r: { coupon_code: string }) => r.coupon_code).filter(Boolean);
      const mdiaryCodes = (mdiaryData ?? []).map((r: { coupon_code: string }) => r.coupon_code).filter(Boolean);
      codes = [...new Set([...dealCodes, ...mdiaryCodes])];
    }
    const totalCodes = codes.length;
    if (totalCodes === 0) return json({ updated: 0, total: 0, hasMore: false });

    // 페이지네이션: offset/limit으로 이번 호출에서 처리할 범위만 슬라이스
    const offset = body.offset ?? 0;
    const limit  = body.limit  ?? 15;
    codes = codes.slice(offset, offset + limit);
    if (codes.length === 0) return json({ updated: 0, total: totalCodes, hasMore: false });

    // MySQL 연결
    const password = Deno.env.get("MDIARY_DB_PASSWORD");
    if (!password) throw new Error("MDIARY_DB_PASSWORD secret이 설정되지 않았습니다");

    const mysql = await import("npm:mysql2/promise");
    const conn  = await mysql.createConnection({
      host: MYSQL_HOST, port: MYSQL_PORT,
      database: MYSQL_DB, user: MYSQL_USER,
      password, ssl: false,
    });

    // 한 번에 최대 50개씩 배치 처리
    // is_used=0 행은 CASE WHEN으로 서브쿼리 실행 자체를 건너뜀 → 부하 대폭 감소
    const BATCH = 50;
    let rows: CouponRow[] = [];
    try {
      for (let i = 0; i < codes.length; i += BATCH) {
        const batch = codes.slice(i, i + BATCH);
        const placeholders = batch.map(() => "?").join(", ");
        const [result] = await conn.execute<CouponRow[]>(
        `SELECT
           c.coupon_code,
           c.is_used,
           c.used_group_id,
           CASE WHEN c.is_used = 1
             THEN DATE_FORMAT(g.service_expire_at, '%Y-%m-%d')
           END AS service_expire_at,
           CASE WHEN c.is_used = 1
             THEN (SELECT COUNT(*)
                     FROM mDiary_app_customuser u2
                    WHERE u2.current_groupName LIKE CONCAT('%', ag.name, '%'))
           END AS member_count,
           CASE WHEN c.is_used = 1 THEN ag.name END AS group_name,
           CASE WHEN c.is_used = 1
             THEN (SELECT eo.name FROM mDiary_app_eduoffice eo WHERE eo.id = g.edu_office_id)
           END AS edu_office_name,
           CASE WHEN c.is_used = 1
             THEN (SELECT CONCAT(COALESCE(u3.last_name,''), COALESCE(u3.first_name,''))
                     FROM mDiary_app_customuser u3
                    WHERE u3.role = 'admin'
                      AND u3.current_groupName LIKE CONCAT('%', ag.name, '%')
                    ORDER BY COALESCE(u3.date_login, u3.last_login) DESC LIMIT 1)
           END AS admin_name,
           CASE WHEN c.is_used = 1
             THEN (SELECT u4.phone
                     FROM mDiary_app_customuser u4
                    WHERE u4.role = 'admin'
                      AND u4.current_groupName LIKE CONCAT('%', ag.name, '%')
                    ORDER BY COALESCE(u4.date_login, u4.last_login) DESC LIMIT 1)
           END AS admin_phone,
           CASE WHEN c.is_used = 1
             THEN (SELECT DATE_FORMAT(COALESCE(u5.date_login, u5.last_login), '%Y-%m-%d')
                     FROM mDiary_app_customuser u5
                    WHERE u5.role = 'admin'
                      AND u5.current_groupName LIKE CONCAT('%', ag.name, '%')
                      AND COALESCE(u5.date_login, u5.last_login) IS NOT NULL
                    ORDER BY COALESCE(u5.date_login, u5.last_login) DESC LIMIT 1)
           END AS admin_last_login
         FROM mDiary_app_coupon c
         LEFT JOIN mDiary_app_group g ON c.used_group_id = g.group_ptr_id
         LEFT JOIN auth_group ag ON g.group_ptr_id = ag.id
         WHERE c.coupon_code IN (${placeholders})`,
          batch,
        );
        rows = rows.concat(result as CouponRow[]);
      }
    } finally {
      await conn.end();
    }

    // Supabase에 동기화 — 병렬 처리 (20개씩 concurrent)
    const today = new Date().toISOString().split("T")[0];
    let updated = 0;

    const SYNC_BATCH = 20;
    for (let i = 0; i < rows.length; i += SYNC_BATCH) {
      const batch = rows.slice(i, i + SYNC_BATCH);
      const results = await Promise.all(batch.map(row => {
        const status =
          !row.is_used                                              ? "대기"
          : row.service_expire_at && row.service_expire_at < today ? "만료"
          : "사용중";

        return Promise.all([
          supabase.from("deal_licenses").update({
            status,
            service_expire_at: row.service_expire_at ?? null,
          }).eq("coupon_code", row.coupon_code),
          supabase.from("mdiary_coupons").update({
            is_used:           !!row.is_used,
            service_expire_at: row.service_expire_at ?? null,
            member_count:      row.member_count ?? 0,
            group_name:        row.group_name    ?? null,
            edu_office_name:   row.edu_office_name ?? null,
            admin_name:        row.admin_name    ?? null,
            admin_phone:       row.admin_phone   ?? null,
            admin_last_login:  row.admin_last_login ?? null,
          }).eq("coupon_code", row.coupon_code),
        ]);
      }));
      updated += results.filter(([dl, mc]) => !dl.error || !mc.error).length;
    }

    return json({ updated, total: totalCodes, processed: offset + rows.length, hasMore: offset + rows.length < totalCodes });
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
