// LEAD-S7-2b — 계약·구매 입력 폼의 순수 부분
//
// 지켜야 하는 약속
//   ① 빈 칸은 `null` 로 보낸다. **`''` 를 0 으로 바꾸지 않는다**(단가 미입력 ≠ 무상 0원).
//   ② 인원·개월은 두 칸으로 받아 **곱해서** 저장한다.
//   ③ 검사 규칙이 **DB CHECK 와 같다** — 화면에서 막히면 서버에서도 막힌다.
//   ④ 방식과 무관한 칸은 **null 로 비워 보낸다**(커미션 계약에 단가가 남으면 헷갈린다).
//   ⑤ 정산 방식은 수정 화면에서 잠긴다.
//   ⑥ 원장은 고치지 않는다 — 메모·청구서 번호만 고칠 수 있다.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BILLING_STATUSES, EDITABLE_PURCHASE_FIELDS, METHOD_LOCK_HINT, PURCHASE_EDIT_HINT,
  QUANTITY_HINT, contractSeatMonths, contractToForm, emptyContractForm, emptyPurchaseForm,
  isMethodLocked, money, seatMonthsLabel, toBillingPatch, toContractPayload,
  toPurchasePayload, validateContractForm, validatePurchaseForm, validateVoidReason,
  visibleFields, type ContractForm, type PurchaseForm,
} from '../lib/partnerContractForm';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
/**
 * 주석을 드러낸 코드만. 보안 검사가 주석 속 말("Authorization 은 authedFetch 가
 * 붙인다", "service_role 이 필요한 계정 작업")을 잡으면 없는 결함을 있다고 한다.
 */
const code = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const T = '2026-11-17';
const P = 'partner-1';

const CF = (o: Partial<ContractForm> = {}): ContractForm => ({
  ...emptyContractForm(T), settlement_method: 'wholesale',
  seats: '100', months: '12', unit_price_per_seat_year: '120', currency: 'USD', ...o,
});
const PF = (o: Partial<PurchaseForm> = {}): PurchaseForm => ({
  ...emptyPurchaseForm(T), seats: '100', months: '12', amount: '12000', ...o,
});

// ══════════════════════ 수량 두 칸 ══════════════════════
describe('인원 × 개월 → 인원·개월', () => {
  it('100명 12개월 = 1,200', () => {
    expect(contractSeatMonths({ seats: '100', months: '12' })).toBe(1200);
  });

  it('40명 1개월 = 40', () => {
    expect(contractSeatMonths({ seats: '40', months: '1' })).toBe(40);
  });

  it('공백을 다듬는다', () => {
    expect(contractSeatMonths({ seats: ' 40 ', months: ' 3 ' })).toBe(120);
  });

  it('**한 칸만 채우면 null** (셀 수 없다)', () => {
    expect(contractSeatMonths({ seats: '40', months: '' })).toBeNull();
    expect(contractSeatMonths({ seats: '', months: '12' })).toBeNull();
    expect(contractSeatMonths({ seats: '', months: '' })).toBeNull();
  });

  it('반 달·0·음수는 받지 않는다', () => {
    expect(contractSeatMonths({ seats: '40', months: '0.5' })).toBeNull();
    expect(contractSeatMonths({ seats: '0', months: '12' })).toBeNull();
    expect(contractSeatMonths({ seats: '-1', months: '12' })).toBeNull();
  });

  it('글자는 받지 않는다', () => {
    expect(contractSeatMonths({ seats: '백명', months: '12' })).toBeNull();
  });

  it('무엇을 세는지 설명이 있다', () => {
    expect(QUANTITY_HINT).toContain('1,200');
  });
});

// ══════════════════════ 계약 폼 → DB ══════════════════════
describe('계약 폼 → 보낼 모양', () => {
  it('도매형', () => {
    expect(toContractPayload(CF(), P)).toEqual({
      partner_id: P, settlement_method: 'wholesale',
      starts_on: T, ends_on: null, renews_on: null,
      contracted_seat_months: 1200, unit_price_per_seat_year: 120, currency: 'USD',
      commission_rate: null, is_grant: false, status: 'draft',
      contract_file_id: null, notes: null,
    });
  });

  it('**커미션형이면 단가·통화를 null 로 비운다** (남아 있으면 나중에 헷갈린다)', () => {
    const r = toContractPayload(
      CF({ settlement_method: 'commission', commission_rate: '15' }), P)!;
    expect(r.unit_price_per_seat_year).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.commission_rate).toBe(15);
    expect(r.is_grant).toBe(false);
  });

  it('**도매형이면 수수료율을 null 로 비운다**', () => {
    const r = toContractPayload(CF({ commission_rate: '15' }), P)!;
    expect(r.commission_rate).toBeNull();
  });

  it('무상 배정은 단가를 **0 으로 박는다** (미입력과 구분)', () => {
    const r = toContractPayload(CF({ is_grant: true, unit_price_per_seat_year: '' }), P)!;
    expect(r.unit_price_per_seat_year).toBe(0);
    expect(r.is_grant).toBe(true);
  });

  it('무상을 커미션형에 켜도 저장 모양에서는 꺼진다', () => {
    const r = toContractPayload(CF({ settlement_method: 'commission', is_grant: true }), P)!;
    expect(r.is_grant).toBe(false);
  });

  it('**빈 칸은 null 이다 — 0 이나 빈 문자열이 아니다**', () => {
    const r = toContractPayload(
      CF({ unit_price_per_seat_year: '', currency: '  ', ends_on: '', notes: '  ' }), P)!;
    expect(r.unit_price_per_seat_year).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.ends_on).toBeNull();
    expect(r.notes).toBeNull();
  });

  it('수량을 비우면 null (계약 수량 미정)', () => {
    const r = toContractPayload(CF({ seats: '', months: '' }), P)!;
    expect(r.contracted_seat_months).toBeNull();
  });

  it('정산 방식을 안 고르면 보낼 수 없다', () => {
    expect(toContractPayload(CF({ settlement_method: '' }), P)).toBeNull();
  });
});

describe('계약 폼 검사 — DB CHECK 와 같은 규칙', () => {
  const f = (o: Partial<ContractForm> = {}) => validateContractForm(CF(o)).map(p => p.field);

  it('정상이면 문제 없음', () => {
    expect(f()).toEqual([]);
  });

  it('정산 방식과 시작일은 필수', () => {
    expect(f({ settlement_method: '' })).toContain('settlement_method');
    expect(f({ starts_on: '' })).toContain('starts_on');
  });

  it('종료일이 시작일보다 앞서면 막는다', () => {
    expect(f({ starts_on: '2026-11-17', ends_on: '2026-11-16' })).toContain('ends_on');
    expect(f({ starts_on: '2026-11-17', ends_on: '2026-11-17' })).not.toContain('ends_on');
  });

  it('인원·개월 중 하나만 채우면 막는다', () => {
    expect(f({ seats: '40', months: '' })).toContain('seats');
    expect(f({ seats: '', months: '' })).not.toContain('seats');
  });

  // 처음에는 "칸 이름"만 봤다. 그러면 한 칸만 적은 사람에게
  // "1 이상 정수여야 합니다"라고 **동부었생인 안내**를 해도 통과한다
  // (변이 시험에서 드러났다). 사람이 보는 **문구**를 고정한다.
  it('한 칸만 적으면 "함께 적으세요"라고 한다 (엉뚱한 안내 금지)', () => {
    const one = validateContractForm(CF({ seats: '40', months: '' }));
    expect(one).toHaveLength(1);
    expect(one[0].message).toContain('함께 적으세요');

    const two = validateContractForm(CF({ seats: '', months: '12' }));
    expect(two[0].message).toContain('함께');

    // 둘 다 채우고 값이 이상할 때는 **다른** 문구다
    const half = validateContractForm(CF({ seats: '40', months: '1.5' }));
    expect(half[0].message).toContain('1 이상 정수');
    expect(half[0].message).not.toContain('함께');
  });

  it('빈 칸은 수량으로 세지지 않는다 (불변식: 빈 칸은 0 이 되고 0 은 거부된다)', () => {
    expect(contractSeatMonths({ seats: '40', months: '' })).toBeNull();
    expect(contractSeatMonths({ seats: '', months: '12' })).toBeNull();
    expect(contractSeatMonths({ seats: '  ', months: '12' })).toBeNull();
  });

  it('반 달은 막는다', () => {
    expect(validateContractForm(CF({ seats: '40', months: '1.5' }))[0].message)
      .toContain('반 달은 없습니다');
  });

  it('단가·수수료율 범위', () => {
    expect(f({ unit_price_per_seat_year: '-1' })).toContain('unit_price_per_seat_year');
    expect(f({ settlement_method: 'commission', commission_rate: '101' }))
      .toContain('commission_rate');
    expect(f({ settlement_method: 'commission', commission_rate: '0' }))
      .not.toContain('commission_rate');
  });

  it('무상 배정은 도매형에서만', () => {
    expect(f({ settlement_method: 'commission', is_grant: true })).toContain('is_grant');
  });

  it('**draft 는 비어 있어도 된다** (마법사 중간 저장)', () => {
    expect(validateContractForm({
      ...emptyContractForm(T), settlement_method: 'wholesale',
    })).toEqual([]);
  });

  it('**active 로 올릴 때만 방식별 필수값을 따진다**', () => {
    // 도매: 단가 + 통화
    expect(f({ status: 'active', unit_price_per_seat_year: '', currency: '' }))
      .toEqual(expect.arrayContaining(['unit_price_per_seat_year', 'currency']));
    // 무상이면 단가는 안 물어도 된다
    expect(f({ status: 'active', is_grant: true, unit_price_per_seat_year: '' }))
      .not.toContain('unit_price_per_seat_year');
    // 커미션: 수수료율
    expect(f({ status: 'active', settlement_method: 'commission', commission_rate: '' }))
      .toContain('commission_rate');
  });
});

describe('방식에 따라 보여 줄 칸', () => {
  it('도매는 단가·통화·무상, 커미션은 수수료율', () => {
    expect(visibleFields('wholesale')).toEqual(
      { price: true, currency: true, grant: true, rate: false, quantity: true });
    expect(visibleFields('commission')).toEqual(
      { price: false, currency: false, grant: false, rate: true, quantity: true });
  });

  it('안 골랐으면 수량 칸도 숨긴다', () => {
    expect(visibleFields('').quantity).toBe(false);
  });
});

describe('정산 방식은 만든 뒤 잠근다', () => {
  it('수정 화면에서 잠긴다', () => {
    expect(isMethodLocked(true)).toBe(true);
    expect(isMethodLocked(false)).toBe(false);
  });

  it('왜 잠그는지 설명한다', () => {
    expect(METHOD_LOCK_HINT).toContain('새 계약');
  });

  it('**보내는 쪽에서도 방식을 뺀다** (두 겹으로 막는다)', () => {
    const api = read('src/lib/partnerContractsApi.ts');
    expect(api).toContain("Omit<ContractPayload, 'partner_id' | 'settlement_method'>");
    const sec = read('src/components/partners/PartnerContractsSection.tsx');
    expect(sec).toContain('settlement_method: _m');
  });
});

describe('저장된 계약 → 폼 (수정 화면)', () => {
  it('값을 되돌린다', () => {
    const form = contractToForm({
      id: 'c1', settlement_method: 'commission', starts_on: '2026-01-01',
      ends_on: '2026-12-31', renews_on: '2026-12-01', contracted_seat_months: 1200,
      unit_price_per_seat_year: null, currency: null, commission_rate: 15,
      is_grant: false, status: 'active', contract_file_id: 'f1', notes: '메모',
    }, T);
    expect(form).toMatchObject({
      settlement_method: 'commission', starts_on: '2026-01-01', ends_on: '2026-12-31',
      renews_on: '2026-12-01', commission_rate: '15', status: 'active',
      contract_file_id: 'f1', notes: '메모',
    });
  });

  it('**수량은 곱한 값만 저장돼 있어 인원 칸에 전부 넣고 개월을 1 로 둔다**', () => {
    const form = contractToForm(
      { id: 'c1', settlement_method: 'wholesale', contracted_seat_months: 1200 }, T);
    expect(form.seats).toBe('1200');
    expect(form.months).toBe('1');
    // 다시 보내도 같은 수량이다
    expect(contractSeatMonths(form)).toBe(1200);
  });

  it('비어 있는 값은 빈 문자열이다 (0 이 아니다)', () => {
    const form = contractToForm(
      { id: 'c1', settlement_method: 'wholesale', unit_price_per_seat_year: null }, T);
    expect(form.unit_price_per_seat_year).toBe('');
    expect(form.seats).toBe('');
  });

  it('ISO 시각이 와도 날짜만 쓴다', () => {
    const form = contractToForm(
      { id: 'c1', settlement_method: 'wholesale', starts_on: '2026-01-01T00:00:00Z' }, T);
    expect(form.starts_on).toBe('2026-01-01');
  });
});

// ══════════════════════ 구매 폼 ══════════════════════
describe('구매 폼 → 보낼 모양', () => {
  it('수량을 곱해서 보낸다', () => {
    const r = toPurchasePayload(PF(), 'c1')!;
    expect(r.seat_months).toBe(1200);
    expect(r.contract_id).toBe('c1');
    expect(r.amount).toBe(12000);
  });

  it('수량을 셀 수 없으면 보낼 수 없다', () => {
    expect(toPurchasePayload(PF({ seats: '' }), 'c1')).toBeNull();
    expect(toPurchasePayload(PF({ months: '0' }), 'c1')).toBeNull();
  });

  it('**빈 칸은 null** (금액 미입력 ≠ 0원)', () => {
    const r = toPurchasePayload(
      PF({ amount: '', paid_amount: '', invoice_no: '  ', invoiced_on: '' }), 'c1')!;
    expect(r.amount).toBeNull();
    expect(r.paid_amount).toBeNull();
    expect(r.invoice_no).toBeNull();
    expect(r.invoiced_on).toBeNull();
  });

  it('계약의 단가·통화를 기본값으로 가져온다', () => {
    const f = emptyPurchaseForm(T, {
      id: 'c1', unit_price_per_seat_year: 150, currency: 'EUR',
    });
    expect(f.unit_price_per_seat_year).toBe('150');
    expect(f.currency).toBe('EUR');
    expect(f.billing_status).toBe('unbilled');
  });

  it('계약 단가가 없으면 빈 칸이다 (0 이 아니다)', () => {
    expect(emptyPurchaseForm(T, { id: 'c1', unit_price_per_seat_year: null })
      .unit_price_per_seat_year).toBe('');
  });
});

describe('구매 폼 검사', () => {
  const f = (o: Partial<PurchaseForm> = {}) => validatePurchaseForm(PF(o)).map(p => p.field);

  it('정상이면 문제 없음', () => {
    expect(f()).toEqual([]);
  });

  it('구매일·수량은 필수', () => {
    expect(f({ purchased_on: '' })).toContain('purchased_on');
    expect(f({ seats: '' })).toContain('seats');
  });

  it('금액은 음수를 막는다', () => {
    expect(f({ amount: '-1' })).toContain('amount');
    expect(f({ unit_price_per_seat_year: '-1' })).toContain('unit_price_per_seat_year');
    expect(f({ paid_amount: '-1', paid_on: T })).toContain('paid_amount');
  });

  it('0 은 받는다 (무상 배정)', () => {
    expect(f({ amount: '0', unit_price_per_seat_year: '0' })).toEqual([]);
  });

  it('**입금일과 입금액은 짝이어야 한다** (DB CHECK 와 같은 규칙 + 반대 방향도)', () => {
    expect(f({ paid_on: T, paid_amount: '' })).toContain('paid_amount');
    expect(f({ paid_on: '', paid_amount: '5000' })).toContain('paid_on');
    expect(f({ paid_on: T, paid_amount: '5000' })).toEqual([]);
  });

  it('모르는 청구 상태를 막는다', () => {
    expect(f({ billing_status: 'invoiced' as never })).toContain('billing_status');
  });
});

describe('원장은 고치지 않는다', () => {
  it('고칠 수 있는 칸은 메모와 청구서 번호뿐', () => {
    expect([...EDITABLE_PURCHASE_FIELDS]).toEqual(['memo', 'invoice_no']);
  });

  it('왜 그런지 설명한다 — 무효 후 재등록', () => {
    expect(PURCHASE_EDIT_HINT).toContain('무효 처리한 뒤 다시 등록');
  });

  it('청구·입금 처리는 상태 칸만 보낸다 (금액·수량이 섞이지 않는다)', () => {
    const patch = toBillingPatch({
      billing_status: 'partial', invoice_no: 'INV-1',
      invoiced_on: '2026-10-03', paid_on: '2026-11-01', paid_amount: '5000',
    });
    expect(Object.keys(patch).sort()).toEqual(
      ['billing_status', 'invoice_no', 'invoiced_on', 'paid_amount', 'paid_on']);
    expect(patch.paid_amount).toBe(5000);
  });

  it('API 에 DELETE 가 없다 (원장)', () => {
    const api = read('src/lib/partnerContractsApi.ts');
    expect(api).not.toMatch(/method: 'DELETE'/);
    expect(api).toContain('DELETE 를 만들지 않는다');
  });

  it('무효에는 사유가 필요하다 (DB CHECK 와 같은 규칙)', () => {
    expect(validateVoidReason('')).toHaveLength(1);
    expect(validateVoidReason('   ')).toHaveLength(1);
    expect(validateVoidReason('금액 오타')).toEqual([]);
  });
});

// ══════════════════════ 보여 주기 ══════════════════════
describe('금액에는 통화를 같이 (요구 6)', () => {
  it('통화를 붙인다', () => {
    expect(money(12000, 'USD')).toBe('12,000 USD');
    expect(money(12000, 'usd')).toBe('12,000 USD');
  });

  it('통화를 모르면 숫자만', () => {
    expect(money(12000, null)).toBe('12,000');
    expect(money(12000, '  ')).toBe('12,000');
  });

  it('**모르는 금액은 — 이다 (0 이 아니다)**', () => {
    for (const v of [null, undefined, '', 'abc', NaN]) {
      expect(money(v, 'USD'), String(v)).toBe('—');
    }
  });

  it('0 은 0 이다 (무상 배정)', () => {
    expect(money(0, 'USD')).toBe('0 USD');
  });

  it('인원·개월을 사람 말로', () => {
    expect(seatMonthsLabel(1200)).toBe('1,200 인원·개월');
    expect(seatMonthsLabel(null)).toBe('—');
  });
});

// ══════════════════════ 보안·구조 ══════════════════════
describe('보안·구조', () => {
  it('순수 폼 로직은 DB 를 부르지 않는다', () => {
    const s = read('src/lib/partnerContractForm.ts');
    expect(s).not.toContain('rest/v1');
    expect(s).not.toMatch(/\bfetch\(/);
  });

  it('API 는 **authedFetch 만** 쓴다 (공개 키를 Authorization 에 넣지 않는다)', () => {
    const c = code(read('src/lib/partnerContractsApi.ts'));
    expect(c).toContain('import { authedFetch }');
    // 코드에는 Authorization 을 지정하는 자리가 없다(authedFetch 가 붙인다)
    expect(c).not.toMatch(/Authorization/);
    expect(c).toMatch(/apikey: SUPABASE_KEY/);
    // 맨 fetch( 가 아니라 항상 authedFetch( 다
    expect(c.match(/(?<!authed)\bfetch\(/g) ?? []).toHaveLength(0);
    expect((c.match(/authedFetch\(/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('`admin-auth` 를 쓰지 않는다 (RLS 가 admin 만 쓰게 해 두었다)', () => {
    const s = read('src/lib/partnerContractsApi.ts');
    expect(s).not.toContain('functions/v1/admin-auth');
    expect(s).toContain('로그인 토큰만으로 충분');
  });

  it('키·개인정보를 담지 않는다', () => {
    for (const f of ['src/lib/partnerContractForm.ts', 'src/lib/partnerContractsApi.ts',
                     'src/components/partners/PartnerContractsSection.tsx',
                     'src/components/partners/ReceivablesSummary.tsx']) {
      const c = code(read(f));
      expect(c, f).not.toMatch(/eyJ[A-Za-z0-9]|service_role|SUPABASE_SERVICE/);
      expect(c, f).not.toMatch(/@[a-z0-9-]+\.(com|net|org|sg)/i);
    }
  });

  it('**계산을 화면에 다시 만들지 않는다**', () => {
    const sec = read('src/components/partners/PartnerContractsSection.tsx');
    expect(sec).toContain('contractSummary');
    // 잔량·미수액을 화면에서 직접 빼지 않는다
    expect(sec).not.toMatch(/purchased\s*-\s*issued/);
    expect(sec).not.toMatch(/amount\s*-\s*paid_amount/);

    const sum = read('src/components/partners/ReceivablesSummary.tsx');
    expect(sum).toContain('totalsByCurrency');
    expect(sum).not.toMatch(/amount\s*-\s*paid/);
  });

  it('포털을 건드리지 않았다', () => {
    const portal = read('src/pages/PartnerPortal.tsx');
    for (const n of ['partner_contracts', 'partner_purchases', 'PartnerContractsSection']) {
      expect(portal, n).not.toContain(n);
    }
  });

  // LEAD-S7-3 이 발급 함수를 **일부러** 바꿨다(잔량 차감). S7-2b 시점의
  // "발급 함수를 건드리지 않았다"는 더 이상 참이 아니다. 대신 **무엇을 건드리면 안 되는지**
  // 를 지킨다: 구매 원장을 직접 만지지 않고(RPC 를 거친다), 기존 보안을 유지한다.
  it('발급 함수가 구매 원장을 직접 만지지 않는다 (잔량은 RPC 가 센다)', () => {
    const issue = read('supabase/functions/partner-issue-license/index.ts');
    expect(issue).not.toMatch(/from\('partner_purchases'\)/);
    expect(issue).toContain('partner_reserve_license_seats');
    // 기존 보안이 그대로다
    expect(issue).toContain('internalHeaders()');
    expect(issue).toMatch(/if \(isPartner && role !== 'partner_admin'\)/);
  });

  it('파트너 쓰기 권한을 늘리지 않았다', () => {
    const mig = read('supabase/migrations/20261130000000_lead_s7_2a_partner_purchases.sql');
    expect(mig).toMatch(/for insert[\s\S]{0,200}array\['admin','sub_admin'\]/);
  });
});
