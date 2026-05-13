// Supabase Edge Function: apk-download-verify
// 다운로드 페이지에서 이메일 입력 → 검증 → signed URL 발급 + 로깅
// 친화적 한국어 메시지 반환 (status 200 + reason 필드)
// 사용자 노출 텍스트는 '심스페이스'만 사용, 문의처 info@tebahsoft.com

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "apk-files";
const MAX_DOWNLOADS = 2;
const SIGNED_URL_EXPIRES_SEC = 300;  // 5분

const DB_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { version_id, email } = await req.json() as {
      version_id: string;
      email: string;
    };

    if (!version_id || !email) {
      return json({ ok: false, reason: "missing", message: "버전 또는 이메일이 누락되었습니다." }, 200);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, reason: "invalid_email", message: "이메일 형식이 올바르지 않습니다." }, 200);
    }

    // 버전 조회
    const verRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_versions?id=eq.${version_id}&select=id,file_path,version_name`,
      { headers: DB_HEADERS },
    );
    const versions = verRes.ok ? await verRes.json() as Array<{ id: string; file_path: string; version_name: string }> : [];
    if (versions.length === 0) {
      return json({ ok: false, reason: "version_not_found", message: "해당 버전을 찾을 수 없습니다. 다시 메일에서 링크를 확인해 주세요." }, 200);
    }
    const v = versions[0];

    // 구독자 조회
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_subscribers?email=eq.${encodeURIComponent(email)}&select=id,status`,
      { headers: DB_HEADERS },
    );
    const subs = subRes.ok ? await subRes.json() as Array<{ id: string; status: string }> : [];
    if (subs.length === 0) {
      return json({
        ok: false,
        reason: "not_subscribed",
        message: "메일링 리스트에 등록된 이메일이 아닙니다. 먼저 신청해 주세요.",
        signup_url: "/apk/subscribe",
      }, 200);
    }
    const sub = subs[0];

    if (sub.status === "paused") {
      return json({
        ok: false,
        reason: "paused",
        message: "구독이 일시중지된 상태입니다. info@tebahsoft.com으로 문의 부탁드립니다.",
      }, 200);
    }
    if (sub.status === "unsubscribed") {
      return json({
        ok: false,
        reason: "unsubscribed",
        message: "구독을 취소하셨습니다. 다시 받으시려면 재등록해 주세요.",
        signup_url: "/apk/subscribe",
      }, 200);
    }
    if (sub.status !== "active") {
      return json({ ok: false, reason: "inactive", message: "구독 상태를 확인할 수 없습니다. info@tebahsoft.com으로 문의 주세요." }, 200);
    }

    // 다운로드 횟수 확인 (이메일 기준 — subscriber_id가 NULL인 legacy도 포함)
    const dlRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_downloads?version_id=eq.${version_id}&email=eq.${encodeURIComponent(email)}&select=downloaded_at&order=downloaded_at.desc`,
      { headers: DB_HEADERS },
    );
    const downloads = dlRes.ok ? await dlRes.json() as Array<{ downloaded_at: string }> : [];

    if (downloads.length >= MAX_DOWNLOADS) {
      const lastAt = downloads[0]?.downloaded_at;
      const lastStr = lastAt ? new Date(lastAt).toLocaleString("ko-KR") : "";
      return json({
        ok: false,
        reason: "limit_exceeded",
        message: `이미 ${MAX_DOWNLOADS}회 다운로드를 받으셨습니다. 추가 다운로드가 필요하시면 info@tebahsoft.com으로 문의 주세요.`,
        last_downloaded_at: lastStr,
        downloaded_count: downloads.length,
      }, 200);
    }

    // signed URL 발급
    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${v.file_path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: SIGNED_URL_EXPIRES_SEC }),
    });
    if (!signRes.ok) {
      const err = await signRes.text();
      console.error("[apk-download-verify] signed URL 발급 실패:", err);
      return json({ ok: false, reason: "internal", message: "다운로드 링크 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 200);
    }
    const { signedURL } = await signRes.json() as { signedURL: string };
    // signedURL은 path-only 형식 (예: /storage/v1/object/sign/apk-files/...) → 절대 URL로 prefix
    const downloadUrl = signedURL.startsWith("http") ? signedURL : `${SUPABASE_URL}${signedURL}`;

    // 다운로드 로깅
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const ua = req.headers.get("user-agent") ?? null;
    await fetch(`${SUPABASE_URL}/rest/v1/apk_downloads`, {
      method: "POST",
      headers: { ...DB_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify({
        version_id,
        subscriber_id: sub.id,
        email,
        ip,
        user_agent: ua,
      }),
    }).catch(e => console.warn("[apk-download-verify] 로깅 실패:", e));

    return json({
      ok: true,
      download_url: downloadUrl,
      expires_in: SIGNED_URL_EXPIRES_SEC,
      remaining: MAX_DOWNLOADS - downloads.length - 1,
      file_name: `seamspace-v${v.version_name}.apk`,
    }, 200);
  } catch (e) {
    console.error("[apk-download-verify] 오류:", e);
    return json({ ok: false, reason: "internal", message: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 200);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
