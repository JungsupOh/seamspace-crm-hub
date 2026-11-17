// @vitest-environment jsdom
// LEAD-S7-4 — 포털 "내 계약" 구역 렌더
//
// DB 를 부르지 않는다 — `partnerPortalContracts` 를 가짜로 끼운다.
// 보는 것: **계약이 없으면 아무것도 안 보인다**, 숫자, "셀 수 없다" 안내,
//          잔량 0·음수 문구, 요청 버튼/이미 보낸 요청, 영어 문구.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const store = vi.hoisted(() => ({
  contracts: [] as Record<string, unknown>[],
  purchases: [] as Record<string, unknown>[],
  requests: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/partnerPortalContracts', () => ({
  getMyContracts: vi.fn(async () => store.contracts),
  getMyPurchases: vi.fn(async () => store.purchases),
  getMyRequests: vi.fn(async () => store.requests),
  sendPartnerRequest: vi.fn(async () => ({ ok: true, message: 'sent' })),
}));

import PortalContracts from '@/components/partner-portal/PortalContracts';
import { PORTAL_MSG } from '@/lib/partnerPortalMsg';

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CONTRACT = {
  id: 'c1', partner_id: 'p1', settlement_method: 'wholesale',
  starts_on: '2026-01-01', ends_on: '2026-12-31', renews_on: null,
  contracted_seat_months: 1200, unit_price_per_seat_year: 120, currency: 'USD',
  is_grant: false, status: 'active', voided_at: null,
};
const PURCHASE = {
  id: 'pu1', contract_id: 'c1', purchased_on: '2026-09-01', seat_months: 1200,
  currency: 'USD', amount: 12000, billing_status: 'billed', invoiced_on: '2026-09-02',
  paid_on: null, paid_amount: null, voided_at: null,
};

beforeEach(() => { store.contracts = []; store.purchases = []; store.requests = []; });
afterEach(() => cleanup());

const show = (licenses: Array<Record<string, unknown>> = [], canRequest = true) =>
  render(<Wrap>
    <PortalContracts partnerId="p1" locale="en" licenses={licenses as never} canRequest={canRequest} />
  </Wrap>);

describe('계약이 없으면 **아무것도 보이지 않는다**', () => {
  it('계약 0건', async () => {
    const { container } = show();
    await waitFor(() => expect(container.textContent).not.toContain('My contract'));
  });

  it('커미션형만 있어도 안 보인다 (기존 화면 그대로)', async () => {
    store.contracts = [{ ...CONTRACT, settlement_method: 'commission' }];
    const { container } = show();
    await waitFor(() => expect(container.textContent).not.toContain('My contract'));
  });
});

describe('도매 계약이 있으면 숫자를 보여 준다', () => {
  it('구매·발급·잔량', async () => {
    store.contracts = [CONTRACT];
    store.purchases = [PURCHASE];
    show([{ contract_id: 'c1', seat_months: 480, status: 'issued' }]);
    await waitFor(() => expect(screen.getByText('My contract')).toBeTruthy());
    // 1,200 이 **세 군데** 나온다: 계약 수량 · 구매 합계 · 구매 내역 한 줄.
    //   (접힌 <details> 안도 DOM 에는 있다.)
    expect(screen.getAllByText('1,200 seat-months').length).toBe(3);
    expect(screen.getByText('480 seat-months')).toBeTruthy();     // 발급
    expect(screen.getByText('720 seat-months')).toBeTruthy();     // 잔량 1200-480
    // 단가는 라벨과 한 줄에 있어 글자가 쪼개진다 → 함수 매처로 찾는다
    expect(screen.getAllByText(
      (_t, el) => (el?.textContent ?? '').includes('120 USD'),
    ).length).toBeGreaterThan(0);
  });

  it('**영어 문구로 나온다** (해외 파트너 기본)', async () => {
    store.contracts = [CONTRACT];
    show();
    await waitFor(() => expect(screen.getByText(PORTAL_MSG.balance.en!)).toBeTruthy());
    expect(screen.getByText(PORTAL_MSG.purchased.en!)).toBeTruthy();
  });

  it('잔량 0 이면 **추가 구매를 안내한다**', async () => {
    store.contracts = [CONTRACT];
    store.purchases = [{ ...PURCHASE, seat_months: 480 }];
    show([{ contract_id: 'c1', seat_months: 480, status: 'issued' }]);
    await waitFor(() => expect(screen.getByText(PORTAL_MSG.balanceZero.en!)).toBeTruthy());
  });

  it('초과 발급이면 경고 문구', async () => {
    store.contracts = [CONTRACT];
    store.purchases = [{ ...PURCHASE, seat_months: 100 }];
    show([{ contract_id: 'c1', seat_months: 150, status: 'issued' }]);
    await waitFor(() => expect(screen.getByText(PORTAL_MSG.balanceNegative.en!)).toBeTruthy());
  });

  it('**셀 수 없으면 숫자를 지어내지 않는다**', async () => {
    store.contracts = [CONTRACT];
    store.purchases = [PURCHASE];
    show([{ contract_id: 'c1', seat_months: null, user_count: null, duration: null, status: 'issued' }]);
    await waitFor(() => expect(screen.getByText(PORTAL_MSG.balanceUnknown.en!)).toBeTruthy());
    // 발급·잔량 자리는 '—'
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('구매 내역과 "입금 전이어도 발급된다" 안내', async () => {
    store.contracts = [CONTRACT];
    store.purchases = [PURCHASE];
    show();
    await waitFor(() => expect(screen.getByText(/Purchase history/)).toBeTruthy());
    expect(screen.getByText(PORTAL_MSG.unpaidOk.en!)).toBeTruthy();
    expect(screen.getByText(PORTAL_MSG.billBilled.en!)).toBeTruthy();
  });
});

describe('추가 구매 요청', () => {
  it('버튼이 보인다', async () => {
    store.contracts = [CONTRACT];
    show();
    await waitFor(() => expect(screen.getByText(PORTAL_MSG.requestPurchase.en!)).toBeTruthy());
  });

  it('**게스트에게는 버튼이 없다**', async () => {
    store.contracts = [CONTRACT];
    show([], false);
    await waitFor(() => expect(screen.getByText('My contract')).toBeTruthy());
    expect(screen.queryByText(PORTAL_MSG.requestPurchase.en!)).toBeNull();
  });

  it('**이미 보낸 요청이 있으면 버튼 대신 안내**', async () => {
    store.contracts = [CONTRACT];
    store.requests = [{
      id: 'r1', kind: 'purchase', contract_id: 'c1', license_id: null,
      seat_months: null, status: 'open', requested_at: '2026-11-17', handled_at: null,
    }];
    show();
    await waitFor(() => expect(screen.getByText(PORTAL_MSG.requestOpen.en!)).toBeTruthy());
    expect(screen.queryByText(PORTAL_MSG.requestPurchase.en!)).toBeNull();
  });
});
