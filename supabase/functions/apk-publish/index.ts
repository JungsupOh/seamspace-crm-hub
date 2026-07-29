// Supabase Edge Function: apk-publish
// 개발팀 CI/CD가 APK를 CRM에 직접 푸시하는 엔드포인트.
//
// 바이너리는 이 함수를 통과하지 않는다(100MB+ → 메모리/크기 한계). 대신:
//   1) action='init'   → 서명 업로드 URL 발급 (CI가 스토리지에 직접 업로드)
//   2) CI가 upload_url 로 APK PUT
//   3) action='commit' → apk_versions 메타 등록 (자동 최신 / 발송은 안 함=스테이징)
//
// 인증: X-Webhook-Secret (APK_PUSH_SECRET). coupon-webhook 패턴, 상수시간 비교, fail-closed.

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
};

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUSH_SECRET    = Deno.env.get("APK_PUSH_SECRET") ?? "";
const BUCKET         = "apk-files";

const DB_HEADERS = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// 상수시간 문자열 비교 (타이밍 공격 방지)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── 인증 ──
  if (!PUSH_SECRET) {
    console.error("[apk-publish] APK_PUSH_SECRET 미설정 — 모든 호출 거부");
    return json({ error: "Server misconfigured" }, 500);
  }
  const secret = req.headers.get("X-Webhook-Secret") ?? "";
  if (!safeEqual(secret, PUSH_SECRET)) return json({ error: "Invalid secret" }, 401);

  try {
    const body = await req.json();
    const action = body.action as string;

    // ── action: init — 서명 업로드 URL 발급 ──
    if (action === "init") {
      const raw = (body.filename as string) || "app-release.apk";
      const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.apk$/i, "");
      // Date.now()는 엣지 함수(Deno)에서 사용 가능
      const path = `releases/${Date.now()}-${safe}.apk`;

      const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
        { method: "POST", headers: DB_HEADERS, body: JSON.stringify({}) },
      );
      if (!signRes.ok) {
        const detail = await signRes.text().catch(() => "");
        return json({ error: `서명 URL 발급 실패 (${signRes.status})`, detail }, 502);
      }
      const signed = await signRes.json();
      // signed.url 형식: /object/upload/sign/apk-files/<path>?token=...
      return json({
        path,
        upload_url: `${SUPABASE_URL}/storage/v1${signed.url}`,
      });
    }

    // ── action: commit — 메타 등록 ──
    if (action === "commit") {
      const {
        path, version_name, version_code, sha256, file_size,
        changelog = null, min_android = null, set_latest = true,
      } = body as {
        path?: string; version_name?: string; version_code?: number | string;
        sha256?: string; file_size?: number; changelog?: string | null;
        min_android?: string | null; set_latest?: boolean;
      };

      if (!path || !version_name || version_code == null) {
        return json({ error: "path, version_name, version_code는 필수입니다" }, 400);
      }
      const vcode = Number(String(version_code).replace(/\D/g, ""));
      if (!Number.isFinite(vcode)) return json({ error: "version_code는 정수여야 합니다" }, 400);

      // 업로드된 객체 존재 확인
      const infoRes = await fetch(`${SUPABASE_URL}/storage/v1/object/info/${BUCKET}/${path}`, { headers: DB_HEADERS });
      if (!infoRes.ok) {
        return json({ error: "업로드된 파일을 찾을 수 없습니다. init→PUT 후 commit 하세요.", path }, 400);
      }

      // 중복/멱등 가드: 같은 version_code 존재 시
      const dupRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apk_versions?version_code=eq.${vcode}&select=id,sha256,version_name,is_latest`,
        { headers: DB_HEADERS },
      );
      const dup = dupRes.ok ? await dupRes.json() : [];
      if (Array.isArray(dup) && dup.length > 0) {
        const existing = dup[0];
        if (sha256 && existing.sha256 && existing.sha256 === sha256) {
          // 동일 빌드 재푸시 → 멱등 성공
          return json({ id: existing.id, version_name: existing.version_name, version_code: vcode, is_latest: existing.is_latest, idempotent: true });
        }
        return json({ error: `version_code ${vcode}가 이미 다른 빌드로 등록돼 있습니다`, error_code: "version_conflict" }, 409);
      }

      // 최신 승격이면 기존 is_latest=true 를 false 로
      if (set_latest) {
        await fetch(`${SUPABASE_URL}/rest/v1/apk_versions?is_latest=eq.true`, {
          method: "PATCH", headers: { ...DB_HEADERS, Prefer: "return=minimal" },
          body: JSON.stringify({ is_latest: false }),
        });
      }

      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/apk_versions`, {
        method: "POST", headers: { ...DB_HEADERS, Prefer: "return=representation" },
        body: JSON.stringify({
          version_name, version_code: vcode, file_path: path,
          file_size: file_size ?? null, sha256: sha256 ?? null,
          changelog, min_android, is_latest: !!set_latest,
          uploaded_by: null, source: "ci",
        }),
      });
      if (!insRes.ok) {
        const detail = await insRes.text().catch(() => "");
        return json({ error: `버전 등록 실패 (${insRes.status})`, detail }, 502);
      }
      const [row] = await insRes.json();
      return json({ id: row.id, version_name: row.version_name, version_code: row.version_code, is_latest: row.is_latest });
    }

    return json({ error: "action은 'init' 또는 'commit' 이어야 합니다" }, 400);
  } catch (e) {
    console.error("[apk-publish]", e);
    return json({ error: String(e) }, 500);
  }
});
