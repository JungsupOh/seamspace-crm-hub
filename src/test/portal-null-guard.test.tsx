// @vitest-environment jsdom
// 포털이 `partner` 없이도 **터지지 않는다** (M024)
//
// 무엇이 잘못돼 있었나
//   본문의 가드는 `userProfile?.partner_id`(로그인 정보)만 봤는데, 본문은
//   `partner.id`(따로 받아 오는 것)를 읽었다. `partner` 는 **첫 렌더에서 null**
//   이므로, 받아 오기 전·실패했을 때 렌더 중에 터지고 **파트너에게 흰 화면**이
//   떴다. 조회는 `.catch(() => {})` 로 실패를 삼키고 빈 응답도 조용히 넘겼다.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf-8');
const SRC = read('src/pages/PartnerPortal.tsx');

// ── 바깥 것들을 모두 가짜로 ──
const authState = {
  userProfile: { id: 'u1', partner_id: 'p1', role: 'partner_admin' },
  partnerLocale: 'en', partnerCurrency: 'USD', partnerCountry: 'TR',
  canIssueLicenses: true, canEditPartnerDeals: true, canManageLicenses: true,
};
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/useDeals', () => ({ useDeals: () => ({ data: [] }) }));
vi.mock('@/lib/partner-deals', () => ({
  getPartnerDeals: () => Promise.resolve([]), getDealBuyers: () => Promise.resolve([]),
  createPartnerDeal: vi.fn(), updatePartnerDeal: vi.fn(), deletePartnerDeal: vi.fn(),
  createDealBuyers: vi.fn(), deleteDealBuyers: vi.fn(), deleteDealBuyersByIds: vi.fn(),
  updateDealBuyer: vi.fn(), calcCommission: () => ({ commission: 0, settlement: 0 }),
}));
vi.mock('@/lib/partner-licenses', () => ({
  getPartnerLicenses: () => Promise.resolve([]), issueLicense: vi.fn(),
  resendLicenseEmail: vi.fn(), revokeLicense: vi.fn(), expireLicenseGroup: vi.fn(),
  getCouponGroupInfo: () => Promise.resolve(null), setLicenseBuyer: vi.fn(),
}));
vi.mock('@/components/partner-portal/PortalContracts', () => ({
  default: ({ partnerId }: { partnerId: string }) => <div>계약:{partnerId}</div>,
}));
vi.mock('@/components/partner-portal/PortalAccounts', () => ({
  default: ({ partnerId }: { partnerId: string }) => <div>계정:{partnerId}</div>,
}));
vi.mock('@/components/partner-portal/PortalLeads', () => ({
  default: () => <div>리드</div>,
}));

const authedFetch = vi.fn();
vi.mock('@/lib/authedFetch', () => ({ authedFetch: (...a: unknown[]) => authedFetch(...a) }));

import PartnerPortal from '../pages/PartnerPortal';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><PartnerPortal /></QueryClientProvider>);
}

beforeEach(() => {
  authedFetch.mockReset();
  authState.userProfile = { id: 'u1', partner_id: 'p1', role: 'partner_admin' };
});
afterEach(() => { vi.restoreAllMocks(); });

const okPartner = () => Promise.resolve({
  ok: true, json: () => Promise.resolve([{ id: 'p1', name: 'Eduvision', commission_rate: 15 }]),
});

describe('`partner` 가 없을 때 — **터지지 않는다**', () => {
  it('**받아 오는 중**: 안내만 보이고 본문은 안 그린다', async () => {
    authedFetch.mockReturnValue(new Promise(() => { /* 영원히 응답 없음 */ }));
    expect(() => show()).not.toThrow();
    expect(await screen.findByText('Loading…')).toBeTruthy();
    expect(screen.queryByText(/^계정:/)).toBeNull();
    expect(screen.queryByText(/^계약:/)).toBeNull();
  });

  it('**조회 실패**: 안내와 [다시 시도]', async () => {
    authedFetch.mockReturnValue(Promise.reject(new Error('network')));
    expect(() => show()).not.toThrow();
    expect(await screen.findByText('Could not load your partner information.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByText(/contact your account manager/)).toBeTruthy();
  });

  it('**빈 응답도 실패로 본다** (예전에는 조용히 넘어가 흰 화면이 됐다)', async () => {
    authedFetch.mockReturnValue(Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
    expect(() => show()).not.toThrow();
    expect(await screen.findByText('Could not load your partner information.')).toBeTruthy();
  });

  it('응답이 이상해도 터지지 않는다', async () => {
    authedFetch.mockReturnValue(Promise.resolve({ ok: true, json: () => Promise.resolve(null) }));
    expect(() => show()).not.toThrow();
    expect(await screen.findByText('Could not load your partner information.')).toBeTruthy();
  });

  it('파트너 계정이 아예 아니면 **기존 안내 그대로**', async () => {
    authState.userProfile = { id: 'u1', partner_id: null as never, role: 'guest' };
    authedFetch.mockReturnValue(okPartner());
    show();
    expect(await screen.findByText(/No partner account linked/)).toBeTruthy();
  });
});

describe('`partner` 가 있으면 — **지금과 똑같이** 동작한다', () => {
  it('본문이 그려지고 하위 구역에 id 가 간다', async () => {
    authedFetch.mockReturnValue(okPartner());
    show();
    await waitFor(() => expect(screen.getByText('계약:p1')).toBeTruthy());
    expect(screen.getByText('계정:p1')).toBeTruthy();
    expect(screen.getByText(/Eduvision/)).toBeTruthy();
    // 안내 문구는 사라진다
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('Could not load your partner information.')).toBeNull();
  });
});

describe('고친 모양이 코드에 남아 있다', () => {
  it('`partner` 를 보는 가드가 있다', () => {
    expect(SRC).toMatch(/if \(!partner\) \{/);
  });

  it('**가드가 본문보다 먼저** 나온다', () => {
    const guard = SRC.indexOf('if (!partner) {');
    const body = SRC.indexOf('partnerId={partner.id}');
    expect(guard).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body);
  });

  it('**파트너 조회가 실패를 삼키지 않는다**', () => {
    // 파트너 조회 덩어리만 본다. 다른 `.catch(() => {})` 들은 **이용권 새로고침**
    // 이라 실패해도 렌더가 터지지 않는다(묵은 값이 남을 뿐) — 결과 문서에 목록.
    const i = SRC.indexOf('// 파트너 정보 로드');
    const block = SRC.slice(i, SRC.indexOf('// 파트너 딜 로드', i));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toContain('.catch(() => {})');
    expect(block).toContain(".catch(() => setPartnerLoad('failed'))");
    expect(block).toContain("else setPartnerLoad('failed')");
  });

  it('`partner.id` 를 `?.` 로 가리지 않았다 (가려도 하위 구역이 깨진다)', () => {
    expect(SRC).not.toContain('partnerId={partner?.id}');
    expect(SRC).not.toContain('partnerId={partner!.id}');
  });

  it('안내가 세 언어', () => {
    for (const probe of ['불러오지 못했습니다', '読み込めませんでした',
                         'Could not load your partner information',
                         '다시 시도', '再試行', 'Try again']) {
      expect(SRC, probe).toContain(probe);
    }
  });
});
