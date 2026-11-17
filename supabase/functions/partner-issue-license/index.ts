// Supabase Edge Function: partner-issue-license
// 해외 파트너(예: 튀르키예) 셀프 이용권 발급.
// - 국내 issue-license(견적 게이트/알림톡)와 분리. 견적·알림톡·NEIS 없음.
// - JWT 검증 → 발급자의 partner_id 강제(사칭 방지) → partners.can_issue_licenses 확인
// - create-coupon 호출 → partner_licenses 원장 기록 → 텔레그램 통보
// - 이메일은 클라이언트(sendPurchaseLicenseEmailEN)에서 발송 (기존 캠페인 흐름과 동일)
//
// LEAD-S7-3 (도매 선구매 차감)
//   도매형 계약이 있으면 **잔량에서 빠진다.** 순서가 중요하다:
//     ① 예약  — DB 함수가 계약 행을 잠그고 잔량을 다시 센 뒤 원장에 reserved 행을 넣는다
//     ② 쿠폰  — create-coupon
//     ③ 확정  — reserved 행에 진짜 쿠폰 코드를 넣고 issued 로 바꾼다
//   쿠폰을 먼저 만들면 "쿠폰은 생겼는데 원장 기록 실패" = **공짜 발급**이 된다.
//   예약을 먼저 하면 최악이 "수량은 빠졌는데 쿠폰이 없다"이고, ②가 실패하면 예약을 지운다.
//
//   계약이 **없는 파트너와 커미션형은 지금 동작 그대로**다(차단 없음).
//   커미션형은 계약 수량을 넘으면 **경고만** 한다(브리프 D항).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegram } from '../_shared/telegram.ts';
import { internalHeaders } from '../_shared/internal.ts';
import {
  blockMessage, issuedSeatMonths, overageWarning, pickLocale, requestedSeatMonths,
  type IssueBlockCode,
} from '../_shared/seat-balance.ts';

const CORS = {
  'Access-Control-Allow-Origin':  'https://seamspace-crm-hub.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    // ── 1) JWT 검증 ──
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing authorization header' }, 401);
    const jwt = authHeader.replace('Bearer ', '');

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user: caller }, error: authErr } = await anon.auth.getUser(jwt);
    if (authErr || !caller) return json({ error: 'Invalid or expired token' }, 401);

    // ── 2) 발급자 프로필/권한 확인 ──
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile, error: profileErr } = await admin
      .from('user_profiles')
      .select('role, partner_id')
      .eq('id', caller.id)
      .single();

    if (profileErr) {
      // 조회 실패·행 없음 — fail-closed. 아래 role='' 이 403 으로 이어진다.
      console.warn(`[partner-issue-license] user_profiles 조회 실패 user=${caller.id}`);
    }

    // ⚠️ user_metadata 로 폴백하지 않는다 (021-6e B).
    //    user_metadata 는 사용자가 스스로 고칠 수 있는 값이라, 프로필 행이 없는
    //    계정이 role=admin 을 적어 넣으면 아무 파트너나 지정해 발급할 수 있었다.
    const role: string = profile?.role ?? '';
    const isPartner = role.startsWith('partner_');
    if (!isPartner && role !== 'admin' && role !== 'sub_admin') {
      return json({ error: 'Not allowed' }, 403);
    }
    // 파트너 사용자는 partner_admin만 발급 가능 (member/viewer 차단). admin/sub_admin은 제한 없음.
    if (isPartner && role !== 'partner_admin') {
      return json({ error: '이용권 발급 권한이 없습니다 (관리자 역할 필요)' }, 403);
    }

    const body = await req.json();

    // partner면 자기 partner_id 강제 / admin은 명시 partner_id 허용
    const partnerId = isPartner ? profile?.partner_id : (body.partnerId ?? profile?.partner_id);
    if (!partnerId) return json({ error: 'partner_id를 확인할 수 없습니다' }, 400);

    const { data: partner } = await admin
      .from('partners')
      .select('id, name, can_issue_licenses, currency, country, locale')
      .eq('id', partnerId)
      .single();

    if (!partner) return json({ error: '파트너를 찾을 수 없습니다' }, 404);
    if (!partner.can_issue_licenses) return json({ error: '이 파트너는 이용권 발급 권한이 없습니다' }, 403);

    // ── 3) 발급 파라미터 ──
    const {
      contractId = null,
      partnerDealId = null,
      partnerDealBuyerId = null,
      customerName  = '',
      contactEmail  = '',
      contactPhone  = '',
      orgName       = '',
      plan          = '',
      duration      = '12',
      userCount     = '40',
      amount        = null,
    } = body as {
      contractId?: string | null;
      partnerDealId?: string | null;
      partnerDealBuyerId?: string | null;
      customerName?: string;
      contactEmail?: string;
      contactPhone?: string;
      orgName?: string;
      plan?: string;
      duration?: string;
      userCount?: string;
      amount?: number | null;
    };

    if (!contactEmail) return json({ error: '이메일(발송 대상)이 필요합니다' }, 400);

    const locale = pickLocale(partner.locale);
    const block = (code: IssueBlockCode, ctx: Record<string, number> = {}, status = 409) =>
      json({ error: blockMessage(code, ctx, locale), code, ...ctx }, status);

    // ── 3-1) 계약 고르기 (LEAD-S7-3) ──
    //   유효한 계약만 본다. 0건이면 **기존 동작 그대로**(차단 없음).
    const { data: contractRows, error: contractErr } = await admin
      .from('partner_contracts')
      .select('id, settlement_method, status, ends_on, contracted_seat_months, currency')
      .eq('partner_id', partnerId)
      .eq('status', 'active')
      .is('voided_at', null);

    if (contractErr) {
      // 조회 자체가 실패하면 **발급을 막는다.** 잔량을 모르는 채로 내보내면
      // 공짜 발급이 될 수 있다(fail-closed).
      console.error('[partner-issue-license] 계약 조회 실패', contractErr.message);
      return json({ error: '계약을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }

    const contracts = contractRows ?? [];
    const wholesale = contracts.filter(c => c.settlement_method === 'wholesale');
    const commission = contracts.filter(c => c.settlement_method === 'commission');

    let chosen: { id: string; contracted_seat_months: number | null } | null = null;
    if (wholesale.length === 1) {
      chosen = wholesale[0];
    } else if (wholesale.length > 1) {
      const picked = wholesale.find(c => c.id === contractId);
      if (!picked) {
        // 어느 계약에서 빼는지 사람이 정해야 한다 — 틀리면 다른 계약의 잔량이 깎인다.
        return block('CONTRACT_REQUIRED', { contractCount: wholesale.length }, 400);
      }
      chosen = picked;
    }

    // ── 3-2) 도매형이면 예약 (원자적, 계약 행을 잠근다) ──
    let reservedLicenseId: string | null = null;
    let balanceAfter: number | null = null;

    if (chosen) {
      const requested = requestedSeatMonths({ userCount, duration });
      if (requested === null) return block('BAD_REQUEST', {}, 400);

      const { data: reserved, error: rpcErr } = await admin.rpc(
        'partner_reserve_license_seats',
        {
          p_contract_id: chosen.id,
          p_partner_id: partnerId,
          p_user_count: Number(userCount),
          p_duration: Number(duration),
          p_issued_by: caller.id,
          p_partner_deal_id: partnerDealId,
          p_partner_deal_buyer_id: partnerDealBuyerId,
          p_contact_name: customerName || null,
          p_contact_email: contactEmail || null,
          p_contact_phone: contactPhone || null,
          p_org_name: orgName || null,
          p_plan: plan || null,
          p_amount: amount,
          p_currency: partner.currency ?? null,
        },
      );

      if (rpcErr) {
        // 예약에 실패하면 **쿠폰을 만들지 않는다.** 로그에 개인정보를 쓰지 않는다.
        console.error('[partner-issue-license] 예약 실패', rpcErr.message);
        return json({ error: '발급 수량을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
      }

      const r = reserved as {
        ok?: boolean; code?: IssueBlockCode; license_id?: string;
        balance?: number; requested?: number; balance_after?: number; unknown_issues?: number;
      } | null;

      if (!r?.ok) {
        const code = (r?.code ?? 'INSUFFICIENT_BALANCE') as IssueBlockCode;
        return block(code, {
          ...(r?.balance !== undefined ? { balance: r.balance } : {}),
          ...(r?.requested !== undefined ? { requested: r.requested } : {}),
          ...(r?.unknown_issues !== undefined ? { unknownIssues: r.unknown_issues } : {}),
        }, code === 'INSUFFICIENT_BALANCE' ? 409 : 400);
      }

      reservedLicenseId = r.license_id ?? null;
      balanceAfter = r.balance_after ?? null;
    }

    // ── 3-3) 커미션형: **막지 않고 경고만** 한다(브리프 D항) ──
    //   도매 계약이 없고 커미션 계약이 하나면 그 계약에 발급을 **잇는다**.
    //   이어 두지 않으면 다음 발급 때 "이미 얼마나 나갔는지"를 셀 수 없어
    //   초과 경고가 영원히 뜨지 않는다.
    let commissionContractId: string | null = null;
    let overageNote: string | null = null;

    if (!chosen && commission.length === 1) {
      commissionContractId = commission[0].id;
      const requested = requestedSeatMonths({ userCount, duration }) ?? 0;

      // 이미 나간 수량을 **수량으로** 센다(건수가 아니다). 세는 규칙은 공유 모듈과 같다.
      const { data: prior, error: priorErr } = await admin
        .from('partner_licenses')
        .select('seat_months, user_count, duration, status')
        .eq('contract_id', commissionContractId);

      if (priorErr) {
        // 경고를 못 내는 것뿐이라 발급은 막지 않는다(커미션형은 차단 대상이 아니다).
        console.warn('[partner-issue-license] 커미션 계약 발급 집계 실패');
      } else {
        const { total, unknown } = issuedSeatMonths(prior ?? []);
        const over = overageWarning(commission[0].contracted_seat_months, total, requested);
        if (over) {
          overageNote = `계약 수량을 ${over.over.toLocaleString('ko-KR')} 인원·개월 넘습니다`
            + `(커미션형이라 막지 않습니다).`;
        } else if (unknown > 0) {
          overageNote = `수량을 알 수 없는 발급 기록이 ${unknown}건 있어 초과 여부를 셀 수 없습니다.`;
        }
      }
    }

    // ── 4) 쿠폰 생성 (create-coupon, service-role) ──
    // 쿠폰 관리자 화면의 DESCRIPT 표기.
    // 형식: [파트너명] {학교/기관} {구매자명} Purchase
    //   - 대괄호로 파트너를 묶어 해외 파트너 발급 건임이 한눈에 구분되게 한다
    //     (국내 발급은 '[기관] [학교] [수신자] 구매이용권' 형식)
    //   - 기간/인원은 DURATION·USER LIMIT 컬럼에 따로 있으므로 설명에 넣지 않는다
    const descParts = [
      orgName && orgName !== partner.name ? orgName : null,
      customerName || null,
    ].filter(Boolean);
    const description = `[${partner.name}] ${descParts.join(' ')} Purchase`.replace(/\s+/g, ' ').trim();
    const couponRes = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        ...internalHeaders(),
      },
      body: JSON.stringify({ description, duration: String(duration), user_limit: String(userCount) }),
    });
    const couponJson = await couponRes.json().catch(() => ({}));
    if (!couponRes.ok || !couponJson.coupon_code) {
      // 쿠폰이 안 만들어졌으면 **예약을 지운다** — 아무 일도 없었던 것이다.
      // 남겨 두면 그 수량만큼 잔량이 영영 줄어든다.
      if (reservedLicenseId) {
        const { error: relErr } = await admin.rpc(
          'partner_release_license_reservation', { p_license_id: reservedLicenseId });
        if (relErr) {
          // 되돌리기까지 실패했다 — 예약이 남는다. 사람이 치워야 하므로 알린다.
          console.error('[partner-issue-license] 예약 되돌리기 실패', relErr.message);
          await sendTelegram(
            `⚠️ <b>발급 예약이 남았습니다</b>\n\n` +
            `🤝 ${partner.name}\n` +
            `쿠폰 생성이 실패했는데 예약을 지우지 못했습니다.\n` +
            `예약 id: ${reservedLicenseId}\n` +
            `관리자 화면의 "예약 상태로 남은 발급"에서 확인해 주세요.`
          );
        }
      }
      return json({ error: `쿠폰 생성 실패: ${couponJson.error ?? couponRes.status}` }, 502);
    }
    const couponCode: string = couponJson.coupon_code;

    // ── 5) partner_licenses 원장 ──
    //   예약이 있으면 **확정**(그 줄에 진짜 코드를 넣고 issued 로),
    //   없으면(계약 없는 파트너·커미션형) 기존처럼 새로 넣는다.
    let lic: { id: string } | null = null;
    let insErr: { message?: string } | null = null;

    if (reservedLicenseId) {
      const { data, error } = await admin
        .from('partner_licenses')
        .update({ coupon_code: couponCode, status: 'issued' })
        .eq('id', reservedLicenseId)
        .eq('status', 'reserved')     // 이미 확정된 줄을 덮어쓰지 않는다
        .select('id')
        .single();
      lic = data; insErr = error;
      if (error) {
        // 쿠폰은 만들어졌는데 확정이 실패했다. **예약은 지우지 않는다** —
        // 쿠폰이 실제로 나갔으므로 수량은 빠진 것이 맞다. 사람이 코드를 채워야 한다.
        console.error('[partner-issue-license] 예약 확정 실패', error.message);
        await sendTelegram(
          `⚠️ <b>발급 확정 실패</b>\n\n` +
          `🤝 ${partner.name}\n` +
          `쿠폰은 만들어졌는데 원장에 코드를 넣지 못했습니다.\n` +
          `🎟 ${couponCode}\n` +
          `예약 id: ${reservedLicenseId}`
        );
      }
    } else {
      const { data, error } = await admin
        .from('partner_licenses')
        .insert({
          partner_id:       partnerId,
          contract_id:      commissionContractId,
          partner_deal_id:  partnerDealId,
          partner_deal_buyer_id: partnerDealBuyerId,
          coupon_code:      couponCode,
          contact_name:     customerName || null,
          contact_email:    contactEmail || null,
          contact_phone:    contactPhone || null,
          org_name:         orgName || null,
          plan:             plan || null,
          duration:         String(duration),
          user_count:       String(userCount),
          seat_months:      requestedSeatMonths({ userCount, duration }),
          amount:           amount,
          currency:         partner.currency ?? 'USD',
          status:           'issued',
          delivery_channel: 'email',
          email_sent:       false,
          issued_by:        caller.id,
        })
        .select('id')
        .single();
      lic = data; insErr = error;
      if (error) {
        console.error('[partner-issue-license] 원장 기록 실패', error.message);
        // 쿠폰은 이미 생성됨 → 코드 반환하되 저장 실패 알림
      }
    }

    // ── 6) 텔레그램 통보 (매 발급) ──
    const amountLine = (amount != null) ? `\n💰 ${amount} ${partner.currency ?? 'USD'}` : '';
    // 잔량 한 줄 — **개인정보 없이**, 계약은 앞 8자리로만 가리킨다.
    const balanceLine = (chosen && balanceAfter !== null)
      ? `\n📉 잔량 ${balanceAfter.toLocaleString('ko-KR')} 인원·개월 (계약 ${chosen.id.slice(0, 8)})`
      : '';
    const overageLine = overageNote ? `\n⚠️ ${overageNote}` : '';
    await sendTelegram(
      `🎟 <b>파트너 이용권 발급</b>\n\n` +
      `🤝 ${partner.name}${partner.country ? ` (${partner.country})` : ''}\n` +
      `🏫 ${orgName || '(미입력)'}\n` +
      `👤 ${customerName || '(미입력)'} / ${contactEmail}\n` +
      `📦 ${plan || '-'} · ${userCount}명 · ${duration}개월\n` +
      `🎟 ${couponCode}${amountLine}${balanceLine}${overageLine}`
    );

    // 기존 응답 모양을 지키고 **칸만 더한다**(화면 호환).
    return json({
      ok: true,
      coupon_code: couponCode,
      license_id: lic?.id ?? reservedLicenseId,
      ledger_saved: !insErr,
      contract_id: chosen?.id ?? commissionContractId,
      seat_months: requestedSeatMonths({ userCount, duration }),
      balance_after: balanceAfter,
      ...(overageNote ? { overage_warning: overageNote } : {}),
    });
  } catch (e) {
    console.error('[partner-issue-license]', e);
    return json({ error: String(e) }, 500);
  }
});
