// Supabase Edge Function: apk-subscribe
// 공개 신청 폼에서 호출 → apk_subscribers INSERT → 즉시 최신 APK 메일 발송
// 사용자 노출 텍스트는 '심스페이스'만 사용 (mDiary 표기 금지)
// 문의처: info@tebahsoft.com (APK 배포 전용 채널)

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Edge → Edge 호출(send-email)은 SERVICE_ROLE_KEY 로 Bearer 시 401. ANON_KEY 사용 필수.
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
    const {
      email,
      school_name,
      school_code,
      school_kind,
      contact_name,
      phone,
      memo,
      consent,
    } = await req.json() as {
      email: string;
      school_name: string;
      school_code?: string;
      school_kind?: string;
      contact_name: string;
      phone?: string;
      memo?: string;
      consent: boolean;
    };

    // 입력 검증 — 친화적 메시지
    if (!consent) {
      return json({ ok: false, reason: "no_consent", message: "약관 및 개인정보 수집에 동의해 주세요." }, 200);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, reason: "invalid_email", message: "이메일 형식이 올바르지 않습니다." }, 200);
    }
    if (!school_name?.trim()) {
      return json({ ok: false, reason: "missing_school", message: "학교명을 NEIS 검색에서 선택해 주세요." }, 200);
    }
    if (!contact_name?.trim()) {
      return json({ ok: false, reason: "missing_contact", message: "담당자명을 입력해 주세요." }, 200);
    }

    // 중복 이메일 확인 — 이미 active면 안내 후 메일만 다시 발송, paused/unsubscribed면 active로 재활성
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_subscribers?email=eq.${encodeURIComponent(email)}&select=id,status,unsubscribe_token,school_name,contact_name`,
      { headers: DB_HEADERS },
    );
    const existing = existRes.ok ? (await existRes.json() as Array<{ id: string; status: string; unsubscribe_token: string; school_name: string; contact_name: string }>) : [];
    let subscriber: { id: string; unsubscribe_token: string; school_name: string; contact_name: string };

    if (existing.length > 0) {
      // 재활성화 + 최신 정보 업데이트
      const cur = existing[0];
      await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers?id=eq.${cur.id}`, {
        method: "PATCH",
        headers: { ...DB_HEADERS, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "active",
          school_name,
          school_code: school_code ?? null,
          school_kind: school_kind ?? null,
          contact_name,
          phone: phone ?? null,
          memo: memo ?? null,
          consent_at: new Date().toISOString(),
        }),
      });
      subscriber = { id: cur.id, unsubscribe_token: cur.unsubscribe_token, school_name, contact_name };
    } else {
      // 신규 INSERT
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers`, {
        method: "POST",
        headers: { ...DB_HEADERS, Prefer: "return=representation" },
        body: JSON.stringify({
          email,
          school_name,
          school_code: school_code ?? null,
          school_kind: school_kind ?? null,
          contact_name,
          phone: phone ?? null,
          memo: memo ?? null,
          status: "active",
        }),
      });
      if (!insRes.ok) {
        const err = await insRes.text();
        console.error("[apk-subscribe] insert 실패:", err);
        return json({ ok: false, reason: "internal", message: "등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 200);
      }
      const [row] = await insRes.json();
      subscriber = { id: row.id, unsubscribe_token: row.unsubscribe_token, school_name, contact_name };
    }

    // 최신 APK 버전 조회 → 메일 발송
    const verRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apk_versions?is_latest=eq.true&select=*&limit=1`,
      { headers: DB_HEADERS },
    );
    const versions = verRes.ok ? await verRes.json() as Array<{
      id: string; version_name: string; version_code: number;
      changelog?: string; min_android?: string; file_size?: number; sha256?: string;
    }> : [];

    if (versions.length === 0) {
      // 등록은 됐지만 발송할 버전 없음
      return json({
        ok: true,
        subscriber_id: subscriber.id,
        message: "등록이 완료되었습니다. 아직 배포된 버전이 없어 메일은 발송되지 않았습니다. 첫 배포 시 자동으로 안내드립니다.",
      }, 200);
    }

    const v = versions[0];
    // 메일 발송 (send-email Edge Function 호출)
    await sendApkMailViaEdge({
      to: email,
      contactName: subscriber.contact_name,
      schoolName: subscriber.school_name,
      versionId: v.id,
      versionName: v.version_name,
      versionCode: v.version_code,
      changelog: v.changelog,
      minAndroid: v.min_android,
      fileSize: v.file_size,
      sha256: v.sha256,
      unsubscribeToken: subscriber.unsubscribe_token,
    });

    // apk_send_history INSERT (UNIQUE 제약으로 중복 차단)
    await fetch(`${SUPABASE_URL}/rest/v1/apk_send_history`, {
      method: "POST",
      headers: { ...DB_HEADERS, Prefer: "return=minimal" },
      body: JSON.stringify({
        version_id: v.id,
        subscriber_id: subscriber.id,
        email_status: "sent",
      }),
    }).catch(() => {});  // 이미 보낸 경우 23505 무시

    return json({
      ok: true,
      subscriber_id: subscriber.id,
      message: `등록이 완료되었습니다. ${email}로 다운로드 안내 메일을 발송했습니다.`,
    }, 200);
  } catch (e) {
    console.error("[apk-subscribe] 오류:", e);
    return json({ ok: false, reason: "internal", message: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 200);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sendApkMailViaEdge(p: {
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
}): Promise<void> {
  // send-email Edge Function 호출 (Resend 경유)
  const downloadUrl = `${APP_URL}/apk/download/${p.versionId}`;
  const unsubscribeUrl = `${APP_URL}/apk/unsubscribe?token=${encodeURIComponent(p.unsubscribeToken)}`;
  const sizeMB = p.fileSize ? `${(p.fileSize / 1024 / 1024).toFixed(1)} MB` : "";

  const changelogHtml = (p.changelog || "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<li>${l.replace(/^[-*]\s*/, "")}</li>`)
    .join("");

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
  }).catch(e => { console.warn("[apk-subscribe] 메일 발송 실패:", e); return null; });
  if (r && !r.ok) {
    const err = await r.text().catch(() => "(read failed)");
    console.warn(`[apk-subscribe] send-email ${r.status}:`, err);
  }
}
