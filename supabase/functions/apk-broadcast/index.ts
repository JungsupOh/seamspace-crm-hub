// Supabase Edge Function: apk-broadcast
// 어드민 호출 → 특정 버전을 모든 active 구독자에게 일괄 발송
// apk_send_history UNIQUE 제약으로 한 버전당 1회만 발송됨 (재시도 멱등성)

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Edge → Edge 호출(send-email)은 SERVICE_ROLE_KEY 로 Bearer 시 401 UNAUTHORIZED_INVALID_JWT_FORMAT.
// ANON_KEY 로 호출해야 Gateway JWT 검증 통과.
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://seamspace-crm-hub.vercel.app";

const DB_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { version_id, force_resend = false } = await req.json() as {
      version_id: string;
      force_resend?: boolean;  // true면 이미 보낸 사람에게도 재발송
    };

    if (!version_id) {
      return json({ ok: false, message: "version_id 필수" }, 400);
    }

    // 버전 조회
    const verRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_versions?id=eq.${version_id}&select=*&limit=1`,
      { headers: DB_HEADERS },
    );
    const versions = verRes.ok ? await verRes.json() as Array<{
      id: string; version_name: string; version_code: number;
      changelog?: string; min_android?: string; file_size?: number; sha256?: string;
    }> : [];
    if (versions.length === 0) {
      return json({ ok: false, message: "버전을 찾을 수 없습니다" }, 404);
    }
    const v = versions[0];

    // active 구독자 전체 조회
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_subscribers?status=eq.active&select=id,email,school_name,contact_name,unsubscribe_token`,
      { headers: DB_HEADERS },
    );
    const subscribers = subRes.ok ? await subRes.json() as Array<{
      id: string; email: string; school_name: string; contact_name: string; unsubscribe_token: string;
    }> : [];

    if (subscribers.length === 0) {
      return json({ ok: true, sent: 0, skipped: 0, message: "활성 구독자가 없습니다" }, 200);
    }

    // 이미 발송된 (version, subscriber) 조회 — force_resend=false일 때만 skip
    const alreadySent = new Set<string>();
    if (!force_resend) {
      const histRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apk_send_history?version_id=eq.${version_id}&select=subscriber_id`,
        { headers: DB_HEADERS },
      );
      if (histRes.ok) {
        const rows = await histRes.json() as Array<{ subscriber_id: string }>;
        rows.forEach(r => alreadySent.add(r.subscriber_id));
      }
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const s of subscribers) {
      if (alreadySent.has(s.id)) {
        skipped++;
        continue;
      }
      try {
        const resendId = await sendApkMail({
          to: s.email,
          contactName: s.contact_name,
          schoolName: s.school_name,
          versionId: v.id,
          versionName: v.version_name,
          versionCode: v.version_code,
          changelog: v.changelog,
          minAndroid: v.min_android,
          fileSize: v.file_size,
          sha256: v.sha256,
          unsubscribeToken: s.unsubscribe_token,
        });
        console.log(`[apk-broadcast] ✓ ${s.email} → Resend ID: ${resendId}`);
        // history INSERT (UNIQUE 충돌은 무시 — force_resend 시 ON CONFLICT 처리)
        // Resend 메일 ID를 error_message 컬럼에 저장(추적용) — 컬럼 재활용
        await fetch(`${SUPABASE_URL}/rest/v1/apk_send_history`, {
          method: "POST",
          headers: { ...DB_HEADERS, Prefer: "return=minimal,resolution=merge-duplicates" },
          body: JSON.stringify({
            version_id: v.id,
            subscriber_id: s.id,
            email_status: "sent",
            sent_at: new Date().toISOString(),
            error_message: resendId ? `resend_id=${resendId}` : null,
          }),
        }).catch(() => {});
        sent++;
      } catch (e) {
        console.warn(`[apk-broadcast] ${s.email} 발송 실패:`, e);
        failed++;
        await fetch(`${SUPABASE_URL}/rest/v1/apk_send_history`, {
          method: "POST",
          headers: { ...DB_HEADERS, Prefer: "return=minimal,resolution=merge-duplicates" },
          body: JSON.stringify({
            version_id: v.id,
            subscriber_id: s.id,
            email_status: "failed",
            error_message: String(e),
          }),
        }).catch(() => {});
      }
    }

    return json({ ok: true, sent, skipped, failed, total: subscribers.length }, 200);
  } catch (e) {
    console.error("[apk-broadcast] 오류:", e);
    return json({ ok: false, message: String(e) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sendApkMail(p: {
  to: string;
  contactName: string;
  schoolName: string;
  versionId: string;
  versionName: string;
  versionCode: number;
  changelog?: string;
  minAndroid?: string;
  fileSize?: number;
  sha256?: string;
  unsubscribeToken: string;
}): Promise<string | null> {
  const downloadUrl = `${APP_URL}/apk/download/${p.versionId}`;
  const unsubscribeUrl = `${APP_URL}/apk/unsubscribe?token=${encodeURIComponent(p.unsubscribeToken)}`;
  const sizeMB = p.fileSize ? `${(p.fileSize / 1024 / 1024).toFixed(1)} MB` : "";

  const changelogHtml = (p.changelog || "")
    .split("\n").map(l => l.trim()).filter(l => l.length > 0)
    .map(l => `<li>${l.replace(/^[-*]\s*/, "")}</li>`).join("");

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>심스페이스</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
<tr><td style="background:#0f172a;padding:24px 40px;text-align:center;">
<img src="https://awosikecivzhwisqzlds.supabase.co/storage/v1/object/public/assets/logo.png" alt="Seamspace" width="200" style="display:inline-block;height:auto;max-width:200px;" />
</td></tr>
<tr><td style="background:#6366f1;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:36px 40px 32px;">
<h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#18181b;">심스페이스 Android 앱 업데이트 📱</h2>
<p style="margin:0 0 16px;font-size:14px;color:#18181b;line-height:1.8;">안녕하세요 ${p.schoolName} ${p.contactName} 선생님,<br/>심스페이스 Android 앱 새 버전이 배포되었습니다. (MDM 환경용 sideload 패키지)</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px;">
<tr><td style="padding:4px 0;font-size:13px;color:#64748b;width:90px;">버전</td><td style="padding:4px 0;font-size:13px;color:#18181b;font-weight:600;">v${p.versionName} (빌드 ${p.versionCode})</td></tr>
${p.minAndroid ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">최소 Android</td><td style="padding:4px 0;font-size:13px;color:#18181b;">${p.minAndroid}</td></tr>` : ""}
${sizeMB ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">파일 크기</td><td style="padding:4px 0;font-size:13px;color:#18181b;">${sizeMB}</td></tr>` : ""}
${p.sha256 ? `<tr><td style="padding:4px 0;font-size:13px;color:#64748b;vertical-align:top;">SHA256</td><td style="padding:4px 0;font-size:11px;color:#71717a;font-family:monospace;word-break:break-all;">${p.sha256}</td></tr>` : ""}
</table>
${changelogHtml ? `<p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">변경 사항</p><ul style="margin:0 0 20px;padding-left:20px;font-size:13px;color:#334155;line-height:1.7;">${changelogHtml}</ul>` : ""}
<p style="margin:0 0 24px;text-align:center;"><a href="${downloadUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">다운로드 페이지로 이동</a></p>
<p style="margin:0 0 16px;font-size:12px;color:#64748b;background:#f8fafc;border-left:3px solid #6366f1;padding:10px 14px;line-height:1.7;">※ 다운로드 페이지에서 본 메일 수신 이메일(<strong>${p.to}</strong>)을 입력해 주세요.<br/>※ 동일 이메일당 최대 2회까지 다운로드 가능합니다.</p>
<p style="margin:0 0 6px;font-size:13px;color:#0f172a;font-weight:600;">설치 안내</p>
<ol style="margin:0 0 24px;padding-left:20px;font-size:13px;color:#334155;line-height:1.7;"><li>다운로드한 APK 파일 실행</li><li>"출처를 알 수 없는 앱 설치" 권한 허용 (안드로이드 설정)</li><li>설치 완료 후 학교 코드 입력</li></ol>
<p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;text-align:center;line-height:1.7;">더 이상 받지 않으려면 <a href="${unsubscribeUrl}" style="color:#6366f1;">구독 취소</a><br/>문의: <a href="mailto:info@tebahsoft.com" style="color:#6366f1;">info@tebahsoft.com</a></p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `심스페이스 Android 앱 업데이트 안내`,
    ``,
    `안녕하세요 ${p.schoolName} ${p.contactName} 선생님,`,
    `심스페이스 Android 앱 새 버전이 배포되었습니다. (MDM 환경용 sideload 패키지)`,
    ``,
    `버전: v${p.versionName} (빌드 ${p.versionCode})`,
    p.minAndroid ? `최소 Android: ${p.minAndroid}` : "",
    sizeMB ? `파일 크기: ${sizeMB}` : "",
    p.sha256 ? `SHA256: ${p.sha256}` : "",
    p.changelog ? `\n변경 사항:\n${p.changelog}` : "",
    ``,
    `다운로드: ${downloadUrl}`,
    `※ 다운로드 페이지에서 본 메일 수신 이메일(${p.to})을 입력해 주세요. 동일 이메일당 최대 2회 다운로드 가능합니다.`,
    ``,
    `설치 안내:`,
    `1. 다운로드한 APK 파일 실행`,
    `2. "출처를 알 수 없는 앱 설치" 권한 허용`,
    `3. 설치 완료 후 학교 코드 입력`,
    ``,
    `구독 취소: ${unsubscribeUrl}`,
    `문의: info@tebahsoft.com`,
  ].filter(Boolean).join("\n");

  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      to: p.to,
      subject: `[심스페이스] 심스페이스 Android 앱 v${p.versionName} 업데이트 안내`,
      html,
      text,
      reply_to: "info@tebahsoft.com",
    }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "(read failed)");
    throw new Error(`send-email ${r.status}: ${err}`);
  }
  // Resend 응답에서 메일 ID 추출 (추적용)
  try {
    const data = await r.json() as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}
