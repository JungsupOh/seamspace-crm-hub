// 미수금 알림 — 순수 로직 (LEAD-S7-8)
//
// 셈은 **하지 않는다.** 경과일·단계·통화별 합계는 `partnerLedger` 가 이미 하고
// 있고, 그걸 여기서 다시 쓰면 관리자 화면과 알림이 **다른 숫자**를 말하게 된다.
// 이 파일이 정하는 것은 **보낼까 말까**뿐이다.
//
// 세 가지를 지킨다
//   ① 같은 구매·같은 단계·같은 상대에게 **두 번 보내지 않는다**
//   ② **파트너에게 가는 메일은 기본 꺼짐** — James 가 켜기 전에는 0건
//   ③ 우리에게 가는 알림에 **개인정보가 없다**

export type Stage = 'd30' | 'd60';
export type SentTo = 'internal' | 'partner';

/**
 * **파트너 담당자 메일은 기본 꺼짐.**
 * 환경값이 정확히 `'true'` 일 때만 켜진다 — `'1'`·`'yes'`·`'TRUE'` 는 켜지 않는다.
 * 실수로 켜지는 쪽보다 실수로 안 켜지는 쪽이 낫다(외부 발송이다).
 */
export const PARTNER_MAIL_FLAG = 'PARTNER_RECEIVABLE_MAIL_ENABLED';

export function partnerMailEnabled(env: string | undefined | null): boolean {
  return env === 'true';
}

// ───────────────────────── 어느 단계인가 ─────────────────────────

/** `partnerLedger.receivableStage` 와 **같은 경계**. 30·60일. */
export const D30 = 30;
export const D60 = 60;

export function stageOf(daysElapsed: number | null): Stage | null {
  if (daysElapsed === null || !Number.isFinite(daysElapsed)) return null;
  if (daysElapsed >= D60) return 'd60';
  if (daysElapsed >= D30) return 'd30';
  return null;
}

/** 그 단계에서 **누구에게** 가야 하나. */
export function recipientsFor(stage: Stage): SentTo[] {
  // 60일이면 우리에게도 **다시** 간다 — 30일 알림을 놓쳤을 수 있다.
  return stage === 'd60' ? ['internal', 'partner'] : ['internal'];
}

// ───────────────────────── 보낼까 말까 ─────────────────────────

export interface AlertRow {
  purchase_id: string;
  stage: string;
  sent_to: string;
  voided_at?: unknown;
}

/** 이미 보낸 것을 빠르게 찾기 위한 열쇠. */
export function alertKey(purchaseId: string, stage: string, sentTo: string): string {
  return `${purchaseId}|${stage}|${sentTo}`;
}

export function sentKeys(rows: readonly AlertRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    // 무효 처리한 기록은 **보낸 것으로 치지 않는다**(다시 보낼 수 있어야 한다)
    if (r.voided_at) continue;
    s.add(alertKey(r.purchase_id, r.stage, r.sent_to));
  }
  return s;
}

export interface Candidate {
  purchaseId: string;
  contractId: string | null;
  partnerId: string;
  partnerName: string;
  contactEmail: string | null;
  locale: string;
  daysElapsed: number;
  outstanding: number;
  currency: string;
  /**
   * 적어 둔 이름표(`billing_status`)가 금액과 어긋나는가.
   *
   * 셈은 **돈을 따른다**(`partnerLedger` 와 같게). 하지만 누군가 '입금 완료'로
   * 적어 둔 줄에 **독촉 메일**을 보내는 것은 다른 문제다 — 우리 기록이 엇갈린
   * 상태에서 파트너에게 나가면 안 된다. 그래서 **우리에게는 알리고
   * 파트너에게는 보내지 않는다.** 먼저 기록을 맞추는 것이 순서다.
   */
  labelDisagrees?: boolean;
}

export interface Plan {
  candidate: Candidate;
  stage: Stage;
  sentTo: SentTo;
  /** 보내지 않을 이유. 있으면 **보내지 않는다.** */
  skip: null | 'already_sent' | 'mail_disabled' | 'no_contact_email' | 'label_disagrees';
}

/**
 * 무엇을 누구에게 보낼지 정한다. **아무것도 보내지 않는다** — 정하기만 한다.
 * (보내는 일은 `index.ts` 가 하고, 그래서 이 판단을 전부 시험할 수 있다.)
 */
export function planAlerts(
  candidates: readonly Candidate[],
  already: ReadonlySet<string>,
  mailEnabled: boolean,
): Plan[] {
  const out: Plan[] = [];
  for (const c of candidates) {
    const stage = stageOf(c.daysElapsed);
    if (!stage) continue;
    for (const sentTo of recipientsFor(stage)) {
      let skip: Plan['skip'] = null;
      if (already.has(alertKey(c.purchaseId, stage, sentTo))) skip = 'already_sent';
      else if (sentTo === 'partner' && !mailEnabled) skip = 'mail_disabled';
      else if (sentTo === 'partner' && !c.contactEmail) skip = 'no_contact_email';
      // **기록이 엇갈리면 파트너에게 보내지 않는다** — 먼저 맞추는 것이 순서다
      else if (sentTo === 'partner' && c.labelDisagrees) skip = 'label_disagrees';
      out.push({ candidate: c, stage, sentTo, skip });
    }
  }
  return out;
}

/** 실제로 보낼 것만. */
export function toSend(plans: readonly Plan[]): Plan[] {
  return plans.filter(p => p.skip === null);
}

/** **외부로 나가는 것**만 — 시험이 "꺼져 있으면 0건"을 이걸로 증명한다. */
export function outbound(plans: readonly Plan[]): Plan[] {
  return toSend(plans).filter(p => p.sentTo === 'partner');
}

// ───────────────────────── 우리에게 가는 알림 ─────────────────────────

function money(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * 텔레그램 문구. **개인정보가 없다** — 파트너 이름·계약 번호·통화별 합계·경과일뿐.
 * 담당자 이름도 이메일도 담지 않는다(기록에 오래 남는다).
 */
export function internalText(plans: readonly Plan[]): string {
  const send = toSend(plans).filter(p => p.sentTo === 'internal');
  if (send.length === 0) return '';

  const byPartner = new Map<string, Plan[]>();
  for (const p of send) {
    const k = p.candidate.partnerName || p.candidate.partnerId;
    byPartner.set(k, [...(byPartner.get(k) ?? []), p]);
  }

  const lines: string[] = ['[파트너 미수금]'];
  for (const [name, ps] of [...byPartner.entries()].sort()) {
    const worst = Math.max(...ps.map(p => p.candidate.daysElapsed));
    const totals = new Map<string, number>();
    for (const p of ps) {
      totals.set(p.candidate.currency,
        (totals.get(p.candidate.currency) ?? 0) + p.candidate.outstanding);
    }
    const sums = [...totals.entries()].sort()
      .map(([c, n]) => money(n, c)).join(' · ');
    const d60 = ps.filter(p => p.stage === 'd60').length;
    lines.push(`· ${name} — ${sums} · 최장 ${worst}일` + (d60 > 0 ? ` · 60일 ${d60}건` : ''));
  }
  const out = outbound(plans).length;
  lines.push(out > 0
    ? `파트너 담당자에게도 ${out}건 발송`
    : '파트너 발송은 꺼져 있습니다 (우리에게만)');
  return lines.join('\n');
}

// ───────────────────────── 파트너에게 가는 메일 ─────────────────────────

/**
 * 60일 알림 메일. **독촉이 아니라 확인 요청**으로 쓴다 —
 * 우리 기록이 틀렸을 수도 있고, 파트너는 이미 보냈을 수도 있다.
 */
export function partnerMail(p: Plan, locale: string): { subject: string; body: string } {
  const L = (ko: string, ja: string, en: string) =>
    locale === 'ko' ? ko : locale === 'ja' ? ja : en;
  const amount = money(p.candidate.outstanding, p.candidate.currency);
  const d = p.candidate.daysElapsed;

  return {
    subject: L(
      `[Tebahsoft] 미수금 확인 요청 (${amount})`,
      `[Tebahsoft] 未入金のご確認のお願い (${amount})`,
      `[Tebahsoft] Payment status check (${amount})`),
    body: L(
      `안녕하세요.\n\n`
      + `청구 후 ${d}일이 지난 건이 있어 확인을 부탁드립니다.\n`
      + `미수 금액: ${amount}\n\n`
      + `이미 보내셨다면 송금 내역을 알려 주시면 저희 기록을 맞추겠습니다.\n`
      + `저희 기록이 틀렸을 수도 있습니다.\n\n`
      + `문의: sales@tebahsoft.com`,
      `お世話になっております。\n\n`
      + `請求から${d}日が経過した件についてご確認をお願いいたします。\n`
      + `未入金額: ${amount}\n\n`
      + `すでにお振込済みの場合は、送金内容をお知らせいただければ記録を照合いたします。\n`
      + `当社の記録に誤りがある可能性もございます。\n\n`
      + `お問い合わせ: contact@tebahsoft.com`,
      `Hello,\n\n`
      + `We have an invoice that is ${d} days past its date and would like to check its status.\n`
      + `Outstanding: ${amount}\n\n`
      + `If you have already sent it, please share the transfer details and we will reconcile our records.\n`
      + `It is also possible our records are out of date.\n\n`
      + `Contact: contact@tebahsoft.com`),
  };
}

/** 기록에 남길 행. */
export function alertRow(p: Plan, delivered: boolean, note?: string): Record<string, unknown> {
  return {
    purchase_id: p.candidate.purchaseId,
    contract_id: p.candidate.contractId,
    partner_id: p.candidate.partnerId,
    stage: p.stage,
    sent_to: p.sentTo,
    days_elapsed: p.candidate.daysElapsed,
    outstanding: p.candidate.outstanding,
    currency: p.candidate.currency,
    delivered,
    note: note ?? null,
  };
}

// ───────────────────────── 호출자 확인 ─────────────────────────

/**
 * 이 함수는 **사람이 부르는 것이 아니다.** service_role 키나 내부 비밀값으로만.
 * 둘 다 없으면 거절한다 — 공개된 함수가 파트너 미수금을 뱉으면 안 된다.
 */
export function callerAllowed(args: {
  authHeader: string | null;
  internalHeader: string | null;
  serviceRoleKey: string;
  internalSecret: string;
}): boolean {
  const bearer = (args.authHeader ?? '').replace(/^Bearer /, '');
  if (args.serviceRoleKey && bearer === args.serviceRoleKey) return true;
  if (args.internalSecret && args.internalHeader === args.internalSecret) return true;
  return false;
}
