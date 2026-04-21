// MySQL 연결 디버깅 — mysql2 버전별 테스트
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const results: Record<string, unknown> = {};
  const password = Deno.env.get("MDIARY_DB_PASSWORD");
  results.password_set = !!password;
  results.deno_version = Deno.version;

  try {
    // mysql2 버전 고정해서 import
    const mysql = await import("npm:mysql2@3.9.7/promise");
    results.mysql2_imported = true;

    const conn = await mysql.createConnection({
      host: "mdiary-db-lb01-103229276-bd373dd901f6.kr.lb.naverncp.com",
      port: 12327,
      database: "mdiary2",
      user: "md_james",
      password: password!,
      ssl: false,
      connectTimeout: 8000,
    });
    results.connected = true;

    const [rows] = await conn.execute("SELECT COUNT(*) as cnt FROM mDiary_app_coupon WHERE is_used = 1");
    results.query = rows;
    await conn.end();
    results.success = true;
  } catch (e) {
    results.success = false;
    results.error = String(e);
    results.error_name = (e as Error)?.name;
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
