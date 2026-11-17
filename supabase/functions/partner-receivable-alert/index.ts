// Supabase Edge Function: partner-receivable-alert (LEAD-S7-8)
//
// 도매 계약의 미수금을 보고 **30일·60일에 한 번씩만** 알린다.
//
// 이 함수가 **셈을 하지 않는다.** 경과일·미수액은 `_shared/receivable.ts` 가 내는데,
// 그건 관리자 화면이 쓰는 `src/lib/partnerLedger.ts` 와 같은 규칙이다. 두 벌로
// 만들면 화면과 알림이 다른 숫자를 말하게 되고, 그건 파트너와 다투는 자리가 된다.
//
// **파트너에게 가는 메일은 기본 꺼짐.** `PARTNER_RECEIVABLE_MAIL_ENABLED` 가
// 정확히 'true' 일 때만 나간다. 그전까지 외부 발송은 **0건**이다.
//
// 예약 실행(cron)은 **붙이지 않았다** — 언제 돌릴지는 James·제시카가 정한다.
// 호출 방법은 결과 문서에 적었다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegram } from '../_shared/telegram.ts';
import { candidatesFrom } from '../_shared/receivable.ts';
import {
  PARTNER_MAIL_FLAG, alertRow, callerAllowed, internalText, outbound,
  partnerMail, partnerMailEnabled, planAlerts, sentKeys, toSend,
} from './logic.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

/** 오늘(KST). 경과일을 세는 기준이다. */
function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  try {
    // ── 1) **사람이 부르는 함수가 아니다** ──
    if (!callerAllowed({
      authHeader: req.headers.get('Authorization'),
      internalHeader: req.headers.get('X-Internal-Secret'),
      serviceRoleKey: SERVICE_ROLE_KEY,
      internalSecret: Deno.env.get('INTERNAL_CALL_SECRET') ?? '',
    })) {
      return json({ error: 'Forbidden' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // 돌려만 보고 보내지 않는 모드 — 처음 켤 때 무엇이 나갈지 확인하는 데 쓴다
    const dryRun = body.dryRun === true;
    const today = typeof body.today === 'string' ? body.today : todayKst();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 2) 도매 계약의 구매 줄 ──
    const { data: purchases, error: pErr } = await admin
      .from('partner_purchases')
      .select('id, contract_id, purchased_on, invoiced_on, paid_on, amount, currency, '
            + 'billing_status, seat_months, unit_price_per_seat_year, voided_at');
    if (pErr) return json({ error: 'LOAD_PURCHASES_FAILED' }, 500);

    const { data: contracts } = await admin
      .from('partner_contracts')
      .select('id, partner_id, settlement_method, status, voided_at');

    const { data: partners } = await admin
      .from('partners')
      .select('id, name, contact_email, locale');

    const candidates = candidatesFrom({
      purchases: (purchases ?? []) as never,
      contracts: (contracts ?? []) as never,
      partners: (partners ?? []) as never,
      today,
    });

    // ── 3) 이미 보낸 것 ──
    const { data: sent } = await admin
      .from('partner_receivable_alerts')
      .select('purchase_id, stage, sent_to, voided_at');

    const mailEnabled = partnerMailEnabled(Deno.env.get(PARTNER_MAIL_FLAG));
    const plans = planAlerts(candidates, sentKeys((sent ?? []) as never), mailEnabled);
    const will = toSend(plans);

    if (dryRun) {
      return json({
        ok: true, dryRun: true, today,
        mailEnabled,
        candidates: candidates.length,
        willSend: will.length,
        outbound: outbound(plans).length,
        skipped: plans.filter(p => p.skip !== null)
          .reduce((m, p) => ({ ...m, [p.skip!]: (m[p.skip!] ?? 0) + 1 }),
                  {} as Record<string, number>),
      });
    }

    // ── 4) 우리에게 (텔레그램 한 통으로 묶는다 — 건마다 보내면 묻힌다) ──
    let internalOk = true;
    const text = internalText(plans);
    if (text) {
      internalOk = await sendTelegram(text).then(() => true).catch(() => false);
    }

    // ── 5) 파트너 담당자에게 — **플래그가 켜졌을 때만 여기까지 온다** ──
    const mails = outbound(plans);
    const rows: Record<string, unknown>[] = [];
    for (const p of will) {
      if (p.sentTo === 'internal') {
        rows.push(alertRow(p, internalOk, internalOk ? undefined : 'telegram failed'));
        continue;
      }
      let ok = false;
      let note: string | null = null;
      try {
        const m = partnerMail(p, p.candidate.locale);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            'X-Internal-Secret': Deno.env.get('INTERNAL_CALL_SECRET') ?? '',
          },
          body: JSON.stringify({
            to: p.candidate.contactEmail,
            subject: m.subject,
            text: m.body,
          }),
        });
        ok = res.ok;
        if (!ok) note = `send-email ${res.status}`;
      } catch (_e) {
        note = 'send-email threw';
      }
      // **실패해도 기록은 남긴다** — 실패도 사실이다.
      rows.push(alertRow(p, ok, note ?? undefined));
    }

    if (rows.length > 0) {
      // 유일 인덱스가 두 번째를 막는다. 겹쳐 돌아도 터지지 않게 무시한다.
      const { error: insErr } = await admin
        .from('partner_receivable_alerts')
        .insert(rows);
      if (insErr) console.error('[receivable-alert] insert', insErr.code);
    }

    return json({
      ok: true, today, mailEnabled,
      candidates: candidates.length,
      sent: will.length,
      outbound: mails.length,
    });
  } catch (e) {
    console.error('[receivable-alert] unexpected', (e as Error).message);
    return json({ error: 'Internal error' }, 500);
  }
});
