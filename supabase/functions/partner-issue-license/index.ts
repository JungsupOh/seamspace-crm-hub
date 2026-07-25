// Supabase Edge Function: partner-issue-license
// 해외 파트너(예: 튀르키예) 셀프 이용권 발급.
// - 국내 issue-license(견적 게이트/알림톡)와 분리. 견적·알림톡·NEIS 없음.
// - JWT 검증 → 발급자의 partner_id 강제(사칭 방지) → partners.can_issue_licenses 확인
// - create-coupon 호출 → partner_licenses 원장 기록 → 텔레그램 통보
// - 이메일은 클라이언트(sendPurchaseLicenseEmailEN)에서 발송 (기존 캠페인 흐름과 동일)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTelegram } from '../_shared/telegram.ts';

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

    const { data: profile } = await admin
      .from('user_profiles')
      .select('role, partner_id')
      .eq('id', caller.id)
      .single();

    const role: string = profile?.role ?? caller.user_metadata?.role ?? '';
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
      .select('id, name, can_issue_licenses, currency, country')
      .eq('id', partnerId)
      .single();

    if (!partner) return json({ error: '파트너를 찾을 수 없습니다' }, 404);
    if (!partner.can_issue_licenses) return json({ error: '이 파트너는 이용권 발급 권한이 없습니다' }, 403);

    // ── 3) 발급 파라미터 ──
    const {
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
      },
      body: JSON.stringify({ description, duration: String(duration), user_limit: String(userCount) }),
    });
    const couponJson = await couponRes.json().catch(() => ({}));
    if (!couponRes.ok || !couponJson.coupon_code) {
      return json({ error: `쿠폰 생성 실패: ${couponJson.error ?? couponRes.status}` }, 502);
    }
    const couponCode: string = couponJson.coupon_code;

    // ── 5) partner_licenses 원장 기록 ──
    const { data: lic, error: insErr } = await admin
      .from('partner_licenses')
      .insert({
        partner_id:       partnerId,
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
        amount:           amount,
        currency:         partner.currency ?? 'USD',
        status:           'issued',
        delivery_channel: 'email',
        email_sent:       false,
        issued_by:        caller.id,
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('[partner-issue-license] 원장 기록 실패', insErr);
      // 쿠폰은 이미 생성됨 → 코드 반환하되 저장 실패 알림
    }

    // ── 6) 텔레그램 통보 (매 발급) ──
    const amountLine = (amount != null) ? `\n💰 ${amount} ${partner.currency ?? 'USD'}` : '';
    await sendTelegram(
      `🎟 <b>파트너 이용권 발급</b>\n\n` +
      `🤝 ${partner.name}${partner.country ? ` (${partner.country})` : ''}\n` +
      `🏫 ${orgName || '(미입력)'}\n` +
      `👤 ${customerName || '(미입력)'} / ${contactEmail}\n` +
      `📦 ${plan || '-'} · ${userCount}명 · ${duration}개월\n` +
      `🎟 ${couponCode}${amountLine}`
    );

    return json({
      ok: true,
      coupon_code: couponCode,
      license_id: lic?.id ?? null,
      ledger_saved: !insErr,
    });
  } catch (e) {
    console.error('[partner-issue-license]', e);
    return json({ error: String(e) }, 500);
  }
});
