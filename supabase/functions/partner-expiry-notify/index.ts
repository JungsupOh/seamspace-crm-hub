// Supabase Edge Function: partner-expiry-notify
// 파트너 경유 딜의 고객 이용권 만기 안내를 파트너 등록 메일로 자동 발송.
// 트리거: 기관(org)별 "최소 남은 일수"가 임계치(기본 D-7) 이하가 되는 시점에
//         그 기관의 파트너 딜 이용권을 통합하여 1회 발송 (멱등: partner_expiry_emails).
// 호출: pg_cron(매일) 또는 수동. body 옵션:
//   { threshold?: number=7, dry_run?: boolean, test_email?: string, only_org?: string, force?: boolean }
// 사용자 노출 텍스트는 '심스페이스', 문의 sales@tebahsoft.com.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const SALES_CC     = "sales@tebahsoft.com";
const LOGO = "https://awosikecivzhwisqzlds.supabase.co/storage/v1/object/public/assets/logo.png";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};
const DB_HEADERS = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

interface License {
  id: string; deal_id: string; org_name: string;
  contact_name: string | null; user_count: string | null;
  duration: string | null; service_expire_at: string | null; status: string;
}

// KST 기준 오늘과의 일수 차 (만기일 - 오늘)
function dday(expire: string): number {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const today = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
  const [y, m, d] = expire.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}

async function dbGet<T>(path: string): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: DB_HEADERS });
  return r.ok ? (await r.json() as T[]) : [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const body = await req.json().catch(() => ({})) as {
      threshold?: number; dry_run?: boolean; test_email?: string;
      only_org?: string; force?: boolean;
    };
    const threshold = body.threshold ?? 7;
    const dryRun = !!body.dry_run;
    const force  = !!body.force;

    // 1) 파트너 경유 딜 맵 + 파트너 정보
    const pds = await dbGet<{ linked_deal_id: string; partner_id: string }>(
      "partner_deals?linked_deal_id=not.is.null&select=linked_deal_id,partner_id");
    const partners = await dbGet<{ id: string; name: string; contact_name: string | null; contact_email: string | null }>(
      "partners?select=id,name,contact_name,contact_email");
    const partnerById = new Map(partners.map(p => [p.id, p]));
    const dealToPartner = new Map<string, string>();
    for (const pd of pds) if (pd.linked_deal_id) dealToPartner.set(pd.linked_deal_id, pd.partner_id);

    // 2) 사용중 + 만기일 있는 이용권
    const lics = await dbGet<License>(
      "deal_licenses?status=eq.%EC%82%AC%EC%9A%A9%EC%A4%91&service_expire_at=not.is.null"
      + "&select=id,deal_id,org_name,contact_name,user_count,duration,service_expire_at,status&limit=5000");

    // 3) 파트너 경유 + (partner_id, org) 그룹화
    type Group = { partner_id: string; org_name: string; lics: License[] };
    const groups = new Map<string, Group>();
    for (const l of lics) {
      const pid = dealToPartner.get(l.deal_id);
      if (!pid) continue;                       // 파트너 경유 아님
      if (!l.service_expire_at) continue;
      const org = (l.org_name ?? "").trim();
      if (!org) continue;
      if (body.only_org && org !== body.only_org) continue;
      const key = `${pid}::${org}`;
      if (!groups.has(key)) groups.set(key, { partner_id: pid, org_name: org, lics: [] });
      groups.get(key)!.lics.push(l);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const g of groups.values()) {
      const partner = partnerById.get(g.partner_id);
      // 30일 이내만 메일에 포함, 최소 남은일수 산정
      const upcoming = g.lics
        .filter(l => { const dd = dday(l.service_expire_at!); return dd >= 0 && dd <= 30; })
        .sort((a, b) => a.service_expire_at!.localeCompare(b.service_expire_at!));
      if (upcoming.length === 0) continue;
      const soonest = upcoming[0].service_expire_at!;
      const soonestDd = dday(soonest);

      // 트리거: 최소 남은일수 <= threshold (cron 누락 대비 이하 포함). force면 무시.
      if (!force && soonestDd > threshold) {
        results.push({ org: g.org_name, partner: partner?.name, skipped: "not_due", soonestDd });
        continue;
      }
      // 멱등: 같은 (partner, org, soonest) 성공 발송 존재 시 skip (force/test 제외)
      if (!force && !body.test_email && !dryRun) {
        const dup = await dbGet<{ id: string }>(
          `partner_expiry_emails?partner_id=eq.${g.partner_id}`
          + `&org_name=eq.${encodeURIComponent(g.org_name)}`
          + `&soonest_expire_at=eq.${soonest}&status=eq.sent&select=id&limit=1`);
        if (dup.length > 0) { results.push({ org: g.org_name, partner: partner?.name, skipped: "already_sent" }); continue; }
      }

      const to = body.test_email || partner?.contact_email || "";
      const { subject, html } = buildEmail(partner?.name ?? "파트너", partner?.contact_name, g.org_name, upcoming);

      if (dryRun) { results.push({ org: g.org_name, partner: partner?.name, to, soonestDd, count: upcoming.length, dry_run: true }); continue; }

      if (!to) {
        await logEmail(g, partner, soonest, soonestDd, upcoming, subject, html, "skipped", "파트너 이메일 없음", null, body.test_email ? "test" : "cron");
        results.push({ org: g.org_name, partner: partner?.name, skipped: "no_partner_email" });
        continue;
      }

      // 4) 발송
      let status = "sent", error: string | null = null, resendId: string | null = null;
      try {
        const sr = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ to, subject, html, cc: SALES_CC, reply_to: SALES_CC }),
        });
        const sd = await sr.json().catch(() => ({}));
        if (!sr.ok || sd.error) { status = "failed"; error = sd.error || `send-email ${sr.status}`; }
        else resendId = sd.id ?? null;
      } catch (e) { status = "failed"; error = String(e); }

      await logEmail(g, partner, soonest, soonestDd, upcoming, subject, html, status, error, resendId,
        body.test_email ? "test" : "cron");
      results.push({ org: g.org_name, partner: partner?.name, to, soonestDd, count: upcoming.length, status, error });
    }

    return json({ ok: true, dry_run: dryRun, threshold, groups: groups.size, results }, 200);
  } catch (e) {
    console.error("[partner-expiry-notify] 오류:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

async function logEmail(
  g: { partner_id: string; org_name: string }, partner: { name: string; contact_email: string | null } | undefined,
  soonest: string, soonestDd: number, lics: License[], subject: string, html: string,
  status: string, error: string | null, resendId: string | null, triggeredBy: string,
) {
  await fetch(`${SUPABASE_URL}/rest/v1/partner_expiry_emails`, {
    method: "POST",
    headers: { ...DB_HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify({
      partner_id: g.partner_id, partner_name: partner?.name ?? null, partner_email: partner?.contact_email ?? null,
      org_name: g.org_name, soonest_expire_at: soonest, soonest_dday: soonestDd,
      license_count: lics.length, license_ids: lics.map(l => l.id),
      subject, html, status, error, resend_id: resendId, triggered_by: triggeredBy,
    }),
  }).catch(e => console.warn("[partner-expiry-notify] 로그 실패:", e));
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function buildEmail(partnerName: string, partnerContact: string | null | undefined, org: string, lics: License[]) {
  // (만기일, 인원, 기간)별 집계
  const agg = new Map<string, { expire: string; users: string; dur: string; count: number; dd: number }>();
  for (const l of lics) {
    const users = l.user_count ?? "-", dur = l.duration ?? "-", exp = l.service_expire_at!;
    const k = `${exp}|${users}|${dur}`;
    if (!agg.has(k)) agg.set(k, { expire: exp, users, dur, count: 0, dd: dday(exp) });
    agg.get(k)!.count++;
  }
  const rows = [...agg.values()].sort((a, b) => a.expire.localeCompare(b.expire));
  const total = lics.length;
  const greet = partnerContact?.trim() || `${partnerName} 담당자님`;

  const trHtml = rows.map(r => {
    const c = r.dd <= 3 ? "#dc2626" : (r.dd <= 7 ? "#d97706" : "#475569");
    return `<tr>
      <td style="border:1px solid #e4e4e7;padding:10px 12px;font-size:13px;">${esc(org)}</td>
      <td style="border:1px solid #e4e4e7;padding:10px 12px;font-size:13px;text-align:center;">${esc(r.users)}명 / ${esc(r.dur)}개월</td>
      <td style="border:1px solid #e4e4e7;padding:10px 12px;font-size:13px;text-align:center;">${r.count}건</td>
      <td style="border:1px solid #e4e4e7;padding:10px 12px;font-size:13px;text-align:center;">${r.expire}</td>
      <td style="border:1px solid #e4e4e7;padding:10px 12px;font-size:13px;text-align:center;font-weight:700;color:${c};">D-${r.dd}</td>
    </tr>`;
  }).join("");

  const subject = `[심스페이스] ${partnerName} 담당 고객 이용권 만기 안내 (${org} ${total}건)`;
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#18181b;">${esc(greet)}, 안녕하세요.</h2>
    <p style="margin:0 0 18px;font-size:14px;color:#3f3f46;line-height:1.75;">
      ${esc(partnerName)}을 통해 도입된 <strong>${esc(org)}</strong> 고객의 심스페이스 이용권 만기가 다가오고 있어 안내드립니다.<br/>
      아래 고객의 연장 안내를 부탁드립니다. (총 <strong>${total}건</strong>)
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;">
      <tr style="background:#f4f4f5;">
        <th style="border:1px solid #e4e4e7;padding:10px 12px;font-size:12px;color:#52525b;text-align:left;">기관/학교</th>
        <th style="border:1px solid #e4e4e7;padding:10px 12px;font-size:12px;color:#52525b;">플랜</th>
        <th style="border:1px solid #e4e4e7;padding:10px 12px;font-size:12px;color:#52525b;">건수</th>
        <th style="border:1px solid #e4e4e7;padding:10px 12px;font-size:12px;color:#52525b;">만료일</th>
        <th style="border:1px solid #e4e4e7;padding:10px 12px;font-size:12px;color:#52525b;">잔여</th>
      </tr>
      ${trHtml}
    </table>
    <p style="margin:0 0 6px;font-size:13px;color:#3f3f46;line-height:1.75;">
      연장·재구매 진행 또는 고객 안내가 필요하시면 회신 부탁드립니다. 심스페이스 측에서 직접 연락드리지 않고 ${esc(partnerName)}을 통해 진행됩니다.
    </p>
    <p style="margin:18px 0 0;font-size:14px;color:#18181b;line-height:1.8;">감사합니다.<br/>테바소프트 드림</p>`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
<tr><td style="background:#0f172a;padding:24px 40px;text-align:center;"><img src="${LOGO}" alt="Seamspace" width="200" style="display:inline-block;height:auto;max-width:200px;"/></td></tr>
<tr><td style="background:#7c3aed;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 40px;">${content}</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid #e4e4e7;background:#fafafa;">
<p style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.6;">본 메일은 Seamspace CRM 파트너 알림 시스템에서 발송되었습니다.<br/>문의: <a href="mailto:${SALES_CC}" style="color:#7c3aed;text-decoration:none;">${SALES_CC}</a></p>
</td></tr></table></td></tr></table></body></html>`;

  return { subject, html };
}

function json(b: unknown, status: number): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
