// Supabase Edge Function: send-alimtalk
// 자체 백엔드(tebahsoft)를 경유한 카카오 알림톡 발송 + 이력 기록 + 단계별 1회 보장
// 지원 템플릿:
//   - UD_5369: 만기 알림 (stage: 'D-7' | 'D-3' | 'D-1')
//   - UH_2821: 미등록 알림 (stage: 'UH_initial' 등)

const CORS = {
  "Access-Control-Allow-Origin":  "https://seamspace-crm-hub.vercel.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALIMTOK_URL  = "http://tebahsoft.iptime.org:8310/main/alimtok_send/";

type LicenseSource = "deal" | "mdiary" | "campaign";

interface Recipient {
  license_id:     string;
  license_source: LicenseSource;
  name:           string;
  phone:          string;
  group_name?:    string | null;
  user_limit:     string;
  duration:       string;
  expiry_date?:   string | null;
  coupon_code?:   string | null;
}

interface SendRequest {
  recipients: Recipient[];
  tpl_code:   "UD_5369" | "UH_2821";
  stage:      string;
  sent_by?:   string;
}

interface Detail {
  license_id: string;
  status:     "sent" | "skipped" | "failed";
  error?:     string;
}

const SUPA_HEADERS = {
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const formatPhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  return raw;
};

async function alreadySent(r: Recipient, tpl_code: string, stage: string): Promise<boolean> {
  const url = `${SUPABASE_URL}/rest/v1/alimtalk_send_logs`
    + `?license_id=eq.${encodeURIComponent(r.license_id)}`
    + `&license_source=eq.${r.license_source}`
    + `&tpl_code=eq.${tpl_code}`
    + `&stage=eq.${encodeURIComponent(stage)}`
    + `&success=eq.true&select=id&limit=1`;
  const res = await fetch(url, { headers: SUPA_HEADERS });
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function logSend(opts: {
  recipient:   Recipient;
  tpl_code:    string;
  stage:       string;
  payload:     unknown;
  sent_by?:    string;
  success:     boolean;
  error?:      string;
}) {
  const body = {
    license_id:     opts.recipient.license_id,
    license_source: opts.recipient.license_source,
    tpl_code:       opts.tpl_code,
    stage:          opts.stage,
    receiver_phone: opts.recipient.phone,
    receiver_name:  opts.recipient.name,
    payload:        opts.payload,
    sent_by:        opts.sent_by ?? null,
    success:        opts.success,
    error_message:  opts.error ?? null,
  };
  await fetch(`${SUPABASE_URL}/rest/v1/alimtalk_send_logs`, {
    method:  "POST",
    headers: SUPA_HEADERS,
    body:    JSON.stringify(body),
  }).catch(() => {/* swallow */});
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { recipients, tpl_code, stage, sent_by } = await req.json() as SendRequest;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return jsonResp({ error: "recipients가 비어있습니다." }, 400);
    }
    if (tpl_code !== "UD_5369" && tpl_code !== "UH_2821") {
      return jsonResp({ error: `지원하지 않는 tpl_code: ${tpl_code}` }, 400);
    }

    let sent = 0, skipped = 0, failed = 0;
    const details: Detail[] = [];

    for (const r of recipients) {
      if (!r.phone || !r.name) {
        failed++;
        details.push({ license_id: r.license_id, status: "failed", error: "name/phone 누락" });
        continue;
      }

      // 1. 중복 차단
      if (await alreadySent(r, tpl_code, stage)) {
        skipped++;
        details.push({ license_id: r.license_id, status: "skipped" });
        continue;
      }

      // 2. 백엔드 페이로드
      const payload = {
        name:        r.name,
        phone:       formatPhone(r.phone),
        group_name:  r.group_name ?? null,
        user_limit:  String(r.user_limit ?? ""),
        duration:    String(r.duration ?? ""),
        expiry_date: r.expiry_date ?? null,
        coupon_code: r.coupon_code ?? null,
        tpl_code,
      };

      // 3. 백엔드 호출
      try {
        const res = await fetch(ALIMTOK_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`백엔드 ${res.status}: ${errBody.slice(0, 200)}`);
        }
        // 응답은 echo이지만 message=success 확인
        const j = await res.json().catch(() => null);
        if (j?.message !== "success") {
          throw new Error(`백엔드 응답 비정상: ${JSON.stringify(j).slice(0, 200)}`);
        }

        await logSend({ recipient: r, tpl_code, stage, payload, sent_by, success: true });
        sent++;
        details.push({ license_id: r.license_id, status: "sent" });
      } catch (e) {
        await logSend({
          recipient: r, tpl_code, stage, payload, sent_by,
          success: false, error: String(e),
        });
        failed++;
        details.push({ license_id: r.license_id, status: "failed", error: String(e) });
      }
    }

    return jsonResp({ sent, skipped, failed, details });
  } catch (e) {
    console.error(e);
    return jsonResp({ error: String(e) }, 500);
  }
});

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
