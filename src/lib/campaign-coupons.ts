// 캠페인 연동 쿠폰 — 리드 등록 시 자동 발급 + 알림톡
// 1) 동일 phone+캠페인 중복 차단 (기존 코드 재사용)
// 2) max_count 한도 체크
// 3) 코드 생성 ({prefix}-{6자리}) — UNIQUE 충돌 시 최대 5회 재시도
// 4) shop_coupons INSERT (lead_id 연결, applicable_products 보존)
// 5) alimtok_tpl_code 있으면 알림톡 발송 (send-shop-alimtok 경유)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export interface CouponSettings {
  enabled: boolean;
  code_prefix: string;                 // 영문 대문자/숫자 4-10자
  discount_type: 'amount' | 'percent';
  discount_value: number;              // amount=원, percent=%
  applicable_products?: string[];      // ['boardgame','keyring','minddiary']
  expires_in_days: number;             // 발급일 기준 N일 후 만료
  max_count?: number | null;           // null/0 = 무제한
  alimtok_tpl_code?: string;           // 비워두면 알림톡 skip
  min_order?: number;                  // 최소 주문금액 (선택)
}

interface IssueParams {
  campaign: { id: string; name: string; coupon_settings?: CouponSettings | null };
  lead: { id: string; phone_normalized: string; name: string; phone: string };
}

interface IssueResult {
  code: string;
  isNew: boolean;
  alimtokSent: boolean;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 6): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// 발급 후 만료일 계산 (UTC ISO)
function expiresAt(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// 같은 캠페인의 다른 리드(같은 phone) 가운데 이미 발급된 쿠폰 찾기 — 재발송용
async function findExistingCoupon(
  campaignId: string,
  phoneNormalized: string,
  excludeLeadId: string,
): Promise<{ code: string; expires_at: string } | null> {
  const r1 = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?campaign_id=eq.${campaignId}&phone_normalized=eq.${phoneNormalized}&id=not.eq.${excludeLeadId}&select=id`,
    { headers: HEADERS },
  );
  if (!r1.ok) return null;
  const otherLeads: { id: string }[] = await r1.json();
  if (otherLeads.length === 0) return null;

  const leadIds = otherLeads.map(l => `"${l.id}"`).join(',');
  const r2 = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_coupons?lead_id=in.(${leadIds})&campaign_id=eq.${campaignId}&active=eq.true&order=created_at.desc&select=code,expires_at&limit=1`,
    { headers: HEADERS },
  );
  if (!r2.ok) return null;
  const rows: { code: string; expires_at: string }[] = await r2.json();
  return rows[0] ?? null;
}

async function countCampaignCoupons(campaignId: string): Promise<number> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/shop_coupons?campaign_id=eq.${campaignId}&select=id`,
    { headers: { ...HEADERS, Prefer: 'count=exact' } },
  );
  if (!r.ok) return 0;
  // Content-Range: 0-N/TOTAL
  const range = r.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1] ?? '0');
  return Number.isFinite(total) ? total : 0;
}

// 발송 라벨 — '30%' 또는 '5,000원'
function discountLabel(s: CouponSettings): string {
  if (s.discount_type === 'percent') return `${s.discount_value}%`;
  return `${s.discount_value.toLocaleString()}원`;
}

async function sendCouponAlimtok(
  settings: CouponSettings,
  lead: IssueParams['lead'],
  code: string,
  expiresIso: string,
): Promise<boolean> {
  if (!settings.alimtok_tpl_code) return false;
  const expiry = expiresIso.slice(0, 10);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/send-shop-alimtok`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        tpl_code:    settings.alimtok_tpl_code,
        name:        lead.name,
        phone:       lead.phone,
        coupon_code: code,
        expiry_date: expiry,
        // 일부 템플릿은 duration/user_limit 슬롯을 활용할 수 있어 함께 채움
        duration:    discountLabel(settings),
      }),
    });
    return r.ok;
  } catch (e) {
    console.warn('[campaign-coupons] alimtok 실패', e);
    return false;
  }
}

export async function issueCampaignCoupon(params: IssueParams): Promise<IssueResult | null> {
  const settings = params.campaign.coupon_settings;
  if (!settings?.enabled) return null;
  if (!settings.code_prefix) {
    console.warn('[campaign-coupons] code_prefix 누락 — 발급 skip');
    return null;
  }

  // 1) 동일 phone 중복 — 기존 코드 재발송
  const existing = await findExistingCoupon(
    params.campaign.id,
    params.lead.phone_normalized,
    params.lead.id,
  );
  if (existing) {
    const sent = await sendCouponAlimtok(settings, params.lead, existing.code, existing.expires_at);
    return { code: existing.code, isNew: false, alimtokSent: sent };
  }

  // 2) max_count
  if (settings.max_count && settings.max_count > 0) {
    const cnt = await countCampaignCoupons(params.campaign.id);
    if (cnt >= settings.max_count) {
      console.warn(`[campaign-coupons] max_count(${settings.max_count}) 초과 — skip`);
      return null;
    }
  }

  // 3) 코드 생성 + INSERT (UNIQUE 충돌 시 재시도)
  const expIso = expiresAt(settings.expires_in_days || 30);
  let code = '';
  let inserted = false;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    code = `${settings.code_prefix}-${randomCode()}`;
    const body = {
      code,
      batch_name: params.campaign.name,
      campaign_id: params.campaign.id,
      lead_id: params.lead.id,
      discount_type: settings.discount_type,
      discount_value: settings.discount_value,
      min_order: settings.min_order ?? 0,
      expires_at: expIso,
      applicable_products: (settings.applicable_products && settings.applicable_products.length > 0)
        ? settings.applicable_products : null,
      active: true,
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shop_coupons`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      inserted = true;
    } else if (r.status === 409 || r.status === 400) {
      // UNIQUE 충돌 가능 — 재시도
      continue;
    } else {
      console.warn('[campaign-coupons] 쿠폰 INSERT 실패', r.status);
      return null;
    }
  }
  if (!inserted) {
    console.warn('[campaign-coupons] 코드 생성 5회 재시도 모두 실패');
    return null;
  }

  // 4) 알림톡
  const sent = await sendCouponAlimtok(settings, params.lead, code, expIso);
  return { code, isNew: true, alimtokSent: sent };
}
