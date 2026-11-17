// @vitest-environment jsdom
// LEAD-S7-2b — 화면 렌더 시험 (계약 구역 · 미수금 요약)
//
// DB 를 부르지 않는다 — `partnerContractsApi` 를 가짜로 바꿔 끼운다.
// 보는 것: **빈 상태 문구**, 계약 카드의 숫자, "발급 연결은 S7-3" 표시,
//          미수금 요약의 통화별 줄과 단계 색, 그리고 **기존 파트너가 그대로 작동한다는 안내**.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const contracts = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const purchases = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const licenses = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('@/lib/partnerContractsApi', () => ({
  getContracts: vi.fn(async () => contracts.rows),
  getAllContracts: vi.fn(async () => contracts.rows),
  getPurchases: vi.fn(async () => purchases.rows),
  getPurchasesForContracts: vi.fn(async () => purchases.rows),
  getPartnerLicenseSeats: vi.fn(async () => licenses.rows),
  createContract: vi.fn(), updateContract: vi.fn(), voidContract: vi.fn(),
  createPurchase: vi.fn(), patchBilling: vi.fn(), patchPurchaseNote: vi.fn(),
  voidPurchase: vi.fn(),
}));

import PartnerContractsSection, { STALE_RESERVATION_HINT, UNLINKED_ISSUE_HINT }
  from '@/components/partners/PartnerContractsSection';
import { STALE_RESERVATION_MINUTES } from '@/lib/partnerContract';
import ReceivablesSummary from '@/components/partners/ReceivablesSummary';

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CONTRACT = {
  id: 'c1', partner_id: 'p1', settlement_method: 'wholesale',
  starts_on: '2026-01-01', ends_on: '2026-12-31', renews_on: null,
  contracted_seat_months: 1200, unit_price_per_seat_year: 120, currency: 'USD',
  commission_rate: null, is_grant: false, status: 'active',
  contract_file_id: null, notes: null, voided_at: null, void_reason: null,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => { contracts.rows = []; purchases.rows = []; licenses.rows = []; });
afterEach(() => cleanup());

describe('계약 구역 — 빈 상태', () => {
  it('**계약이 없으면 "기존 방식 그대로 작동"이라고 알려 준다** (요구 5)', async () => {
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText(/아직 계약이 없어요/)).toBeTruthy());
    expect(screen.getByText(/계약이 없는 파트너는 지금 방식 그대로 작동합니다/)).toBeTruthy();
  });

  it('계약 추가 버튼이 있다', async () => {
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText('계약 추가')).toBeTruthy());
  });
});

describe('계약 카드 — 도매형', () => {
  it('방식·상태·기간·수량·단가를 보여 준다', async () => {
    contracts.rows = [CONTRACT];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText('도매 선구매형')).toBeTruthy());
    expect(screen.getByText('유효')).toBeTruthy();
    expect(screen.getByText(/2026-01-01 ~ 2026-12-31/)).toBeTruthy();
    expect(screen.getByText('1,200 인원·개월')).toBeTruthy();
    expect(screen.getByText('120 USD')).toBeTruthy();
  });

  it('**돈의 방향을 글로 적는다** (도매는 수금)', async () => {
    contracts.rows = [CONTRACT];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText(/수금\(선구매 대금\)/)).toBeTruthy());
  });

  it('커미션형은 수수료율을 보여 준다', async () => {
    contracts.rows = [{
      ...CONTRACT, settlement_method: 'commission',
      unit_price_per_seat_year: null, currency: null, commission_rate: 15,
    }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText('커미션형')).toBeTruthy());
    expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getByText(/지급\(수수료\)/)).toBeTruthy();
    // 커미션형에는 구매 원장이 없다
    expect(screen.queryByText(/구매 원장/)).toBeNull();
  });

  it('무상 배정 배지', async () => {
    contracts.rows = [{ ...CONTRACT, is_grant: true, unit_price_per_seat_year: 0 }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText('무상 배정')).toBeTruthy());
  });

  it('무효된 계약은 접힌 목록에 사유와 함께', async () => {
    contracts.rows = [{ ...CONTRACT, voided_at: '2026-11-01T00:00:00Z', void_reason: '조건 재협의' }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText(/무효·취소된 계약 1건/)).toBeTruthy());
    expect(screen.getByText(/사유: 조건 재협의/)).toBeTruthy();
  });
});

// LEAD-S7-3 에서 발급이 계약에 이어졌다. 이 구역의 테스트는 "비워 둔다"에서
// "실제로 센다"로 **목적이 바뀌었다** — 같은 것을 확인하려면 이제 숫자를 봐야 한다.
describe('도매 현황 — 계약별 발급·잔량 (S7-3)', () => {
  const PURCHASE = {
    id: 'pu1', contract_id: 'c1', purchased_on: '2026-09-01', seat_months: 1200,
    unit_price_per_seat_year: 120, currency: 'USD', amount: 12000,
    invoice_no: 'INV-1', billing_status: 'billed', invoiced_on: '2026-09-02',
    paid_on: null, paid_amount: null, memo: null, voided_at: null, void_reason: null,
    created_at: '2026-09-01T00:00:00Z',
  };

  it('구매 수량이 요약에 실제로 들어온다', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [PURCHASE];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    // 계약 수량(1,200)과 구매 합계(1,200)와 잔량(1,200) 세 군데에 나온다.
    await waitFor(() => expect(screen.getAllByText('1,200 인원·개월').length).toBe(3));
  });

  it('**이 계약의 발급만** 빼서 잔량을 센다', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [PURCHASE];
    licenses.rows = [
      { id: 'l1', partner_id: 'p1', contract_id: 'c1', status: 'issued',
        seat_months: 480, user_count: '40', duration: '12', revoked_at: null, created_at: 'x' },
      // 무효화해도 수량은 돌려주지 않는다
      { id: 'l2', partner_id: 'p1', contract_id: 'c1', status: 'revoked',
        seat_months: 120, user_count: '10', duration: '12', revoked_at: 'y', created_at: 'x' },
      // 다른 계약 것은 이 잔량에 넣지 않는다
      { id: 'l3', partner_id: 'p1', contract_id: 'c-other', status: 'issued',
        seat_months: 600, user_count: '50', duration: '12', revoked_at: null, created_at: 'x' },
    ];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    // 발급 480+120 = 600, 잔량 1200-600 = 600 → **두 군데**에 600 이 나오는 것이 증거다.
    // (다른 계약의 600 을 넣었다면 발급이 1,200 이 되어 잔량이 0 이 됐을 것이다.)
    await waitFor(() => expect(screen.getAllByText('600 인원·개월').length).toBe(2));
    expect(screen.queryByText('0 인원·개월'), '다른 계약 발급이 섞이면 안 된다').toBeNull();
  });

  it('**계약 전 발급(연결 안 됨)은 잔량에 넣지 않고 따로 알린다**', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [PURCHASE];
    licenses.rows = [
      { id: 'l1', partner_id: 'p1', contract_id: null, status: 'issued',
        seat_months: null, user_count: '40', duration: '1', revoked_at: null, created_at: 'x' },
    ];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText(/계약 전 발급 1건 \(연결 안 됨\)/)).toBeTruthy());
    // 괄호가 든 문구라 정규식을 쓰지 않는다. 부모 요소까지 잡히므로 **존재만** 본다.
    expect(screen.getAllByText(
      (_t, el) => (el?.textContent ?? '').includes(UNLINKED_ISSUE_HINT.slice(0, 20)),
    ).length).toBeGreaterThan(0);
    // 잔량은 구매 그대로 1,200 (계약 수량·구매·잔량 세 군데)
    expect(screen.getAllByText('1,200 인원·개월').length).toBe(3);
  });

  it('**예약으로 오래 남은 줄을 경고한다** (그만큼 잔량이 줄어 있다)', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [PURCHASE];
    licenses.rows = [{
      id: 'l1', partner_id: 'p1', contract_id: 'c1', status: 'reserved',
      seat_months: 100, user_count: '100', duration: '1', revoked_at: null,
      created_at: new Date(Date.now() - 60 * 60_000).toISOString(),   // 1시간 전
    }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText(/예약 상태로 15분 넘게 남은 발급 1건/)).toBeTruthy());
    // 괄호가 든 문구라 정규식 대신 함수로 찾는다(괄호가 그룹으로 읽히면 터진다).
    // 괄호가 든 문구라 정규식을 쓰지 않는다. 부모 요소까지 잡히므로 **존재만** 본다.
    expect(screen.getAllByText(
      (_t, el) => (el?.textContent ?? '').includes(STALE_RESERVATION_HINT.slice(0, 15)),
    ).length).toBeGreaterThan(0);
  });

  it('방금 만든 예약은 경고하지 않는다 (진행 중일 수 있다)', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [PURCHASE];
    licenses.rows = [{
      id: 'l1', partner_id: 'p1', contract_id: 'c1', status: 'reserved',
      seat_months: 100, user_count: '100', duration: '1', revoked_at: null,
      created_at: new Date().toISOString(),
    }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText('100 인원·개월')).toBeTruthy());
    expect(screen.queryByText(/예약 상태로/)).toBeNull();
  });

  it('잔량이 0 이면 "더 발급할 수 없습니다"', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [{ ...PURCHASE, seat_months: 480 }];
    licenses.rows = [{
      id: 'l1', partner_id: 'p1', contract_id: 'c1', status: 'issued',
      seat_months: 480, user_count: '40', duration: '12', revoked_at: null, created_at: 'x',
    }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText(/더 발급할 수 없습니다/)).toBeTruthy());
  });

  it('초과 발급이면 음수를 **감추지 않고** 경고색으로', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [{ ...PURCHASE, seat_months: 100 }];
    licenses.rows = [{
      id: 'l1', partner_id: 'p1', contract_id: 'c1', status: 'issued',
      seat_months: 150, user_count: '150', duration: '1', revoked_at: null, created_at: 'x',
    }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText('-50 인원·개월')).toBeTruthy());
    expect(screen.getByText(/\(초과 발급\)/)).toBeTruthy();
  });

  it('수량을 알 수 없는 발급이 있으면 **발급이 막힌다고 알린다**', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [PURCHASE];
    licenses.rows = [{
      id: 'l1', partner_id: 'p1', contract_id: 'c1', status: 'issued',
      seat_months: null, user_count: null, duration: null, revoked_at: null, created_at: 'x',
    }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    await waitFor(() => expect(screen.getByText(/수량을 알 수 없는 발급 기록 1건/)).toBeTruthy());
    expect(screen.getByText(/발급이 막힙니다/)).toBeTruthy();
  });

  it('**`failed` 는 발급으로 세지 않는다** (쿠폰이 안 만들어진 줄)', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [PURCHASE];
    licenses.rows = [{
      id: 'l1', partner_id: 'p1', contract_id: 'c1', status: 'failed',
      seat_months: 1000, user_count: '1000', duration: '1', revoked_at: null, created_at: 'x',
    }];
    render(<Wrap><PartnerContractsSection partnerId="p1" /></Wrap>);
    // 잔량이 그대로 1,200 이어야 한다(계약 수량·구매·잔량 세 군데)
    await waitFor(() => expect(screen.getAllByText('1,200 인원·개월').length).toBe(3));
  });
});

describe('미수금 요약', () => {
  it('계약이 없으면 **아무것도 보여 주지 않는다** (기존 파트너만 있는 상태)', async () => {
    const { container } = render(<Wrap><ReceivablesSummary /></Wrap>);
    await waitFor(() => expect(container.textContent).not.toContain('미수금'));
  });

  it('미수금이 없으면 "받을 돈이 없습니다"', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [{
      id: 'pu1', contract_id: 'c1', purchased_on: '2026-09-01', seat_months: 1200,
      currency: 'USD', amount: 12000, billing_status: 'paid',
      invoiced_on: '2026-09-02', paid_on: '2026-09-10', paid_amount: 12000,
      voided_at: null, void_reason: null,
    }];
    render(<Wrap><ReceivablesSummary /></Wrap>);
    await waitFor(() => expect(screen.getByText('받을 돈이 없습니다')).toBeTruthy());
  });

  it('**통화별로 나란히 보여 주고 더하지 않는다**', async () => {
    contracts.rows = [CONTRACT, { ...CONTRACT, id: 'c2' }];
    purchases.rows = [
      { id: 'a', contract_id: 'c1', purchased_on: '2026-09-01', seat_months: 100,
        currency: 'USD', amount: 10000, billing_status: 'billed',
        invoiced_on: '2026-09-01', paid_on: null, paid_amount: null, voided_at: null },
      { id: 'b', contract_id: 'c2', purchased_on: '2026-09-01', seat_months: 100,
        currency: 'KRW', amount: 5000000, billing_status: 'billed',
        invoiced_on: '2026-09-01', paid_on: null, paid_amount: null, voided_at: null },
    ];
    render(<Wrap><ReceivablesSummary /></Wrap>);
    await waitFor(() => expect(screen.getByText('10,000 USD')).toBeTruthy());
    expect(screen.getByText('5,000,000 KRW')).toBeTruthy();
    expect(screen.getByText(/통화가 다른 금액은 더하지 않습니다/)).toBeTruthy();
  });

  it('30일·60일 건수를 센다', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [
      { id: 'a', contract_id: 'c1', purchased_on: '2026-09-01', seat_months: 100,
        currency: 'USD', amount: 1000, billing_status: 'billed',
        invoiced_on: '2026-09-01', paid_on: null, paid_amount: null, voided_at: null },
      { id: 'b', contract_id: 'c1', purchased_on: '2026-10-10', seat_months: 100,
        currency: 'USD', amount: 1000, billing_status: 'billed',
        invoiced_on: '2026-10-10', paid_on: null, paid_amount: null, voided_at: null },
    ];
    render(<Wrap><ReceivablesSummary /></Wrap>);
    await waitFor(() => expect(screen.getByText(/60일 이상/)).toBeTruthy());
    expect(screen.getByText(/30일 이상/)).toBeTruthy();
  });

  it('파트너 이름과 경과일을 보여 준다 (개인정보를 늘리지 않는다 — 회사 이름만)', async () => {
    contracts.rows = [CONTRACT];
    purchases.rows = [{
      id: 'a', contract_id: 'c1', purchased_on: '2026-09-01', seat_months: 100,
      currency: 'USD', amount: 1000, billing_status: 'billed',
      invoiced_on: '2026-09-01', paid_on: null, paid_amount: null, voided_at: null,
    }];
    render(<Wrap>
      <ReceivablesSummary partnerNames={new Map([['p1', 'TechVivid']])} />
    </Wrap>);
    await waitFor(() => expect(screen.getByText('TechVivid')).toBeTruthy());
    expect(screen.getByText(/\d+일 경과/)).toBeTruthy();
  });
});
