// @vitest-environment jsdom
// 마운트 스모크 — **첫 렌더에서 데이터가 아직 없을 때 터지지 않는가** (M030)
//
// 왜 이 시험이 필요한가
//   2026-11-18 새벽, 파트너 포털이 운영에서 **흰 화면**이었다(`5da227c` 로 핫픽스).
//   `partner` 가 첫 렌더에서 null 인데 본문이 `partner.id` 를 읽어 터진 것이다.
//   그때 **vitest·build·tsc 가 전부 통과하고 있었다.** 순수 함수 시험과 타입 검사는
//   "값이 아직 없는 순간"을 보지 못한다. 그래서 **마운트해 본다.**
//
// 네 상태로 마운트한다
//   (a) 첫 렌더 — 응답이 **영영 오지 않음**(로딩 중에 멈춰 있는 상태)
//   (b) **빈 응답** — 조회는 됐는데 줄이 0개
//   (c) **실패 응답** — fetch 가 거부됨
//   (d) 정상
//
// 터졌는지 어떻게 아나
//   React 는 렌더 예외를 `console.error` 로 뱉고 트리를 비운다. 그래서
//   **`console.error` 를 가로채** 예외 흔적이 있는지 보고, **DOM 이 비지 않았는지**도 본다.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// ───────────────────────── 틀 ─────────────────────────

/** 영영 오지 않는 응답 — "아직 로딩 중"을 그대로 흉내 낸다 */
const PENDING = () => new Promise<never>(() => { /* 끝나지 않는다 */ });

let errors: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = [];
  spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(' '));
  });
});
afterEach(() => { spy.mockRestore(); vi.clearAllMocks(); });

/** React 가 렌더 중 터졌다는 흔적 */
function renderCrash(): string | null {
  const bad = errors.find(e =>
    /The above error occurred in|Consider adding an error boundary|Cannot read propert|is not a function|undefined is not an object/i
      .test(e));
  return bad ?? null;
}

async function mount(el: ReactElement): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  // 라우터도 함께 — 화면 안에서 `useLocation`·`<Link>` 를 쓴다
  const { container } = render(
    <MemoryRouter><QueryClientProvider client={qc}>{el}</QueryClientProvider></MemoryRouter>);
  // 한 박자 기다려 effect·query 가 돌게 한다
  await waitFor(() => expect(container).toBeTruthy());
  await new Promise(r => setTimeout(r, 0));
  return container;
}

/** 네 상태를 한 번에 돌린다. `setup(state)` 가 가짜를 꽂는다. */
function fourStates(
  name: string,
  setup: (state: 'pending' | 'empty' | 'failed' | 'ok') => void,
  el: () => ReactElement,
  opts: { allowEmptyDom?: boolean } = {},
) {
  describe(name, () => {
    for (const state of ['pending', 'empty', 'failed', 'ok'] as const) {
      it(`${state} — 렌더 중 터지지 않는다`, async () => {
        setup(state);
        // ⚠️ `expect(async () => …).not.toThrow()` 는 **기다리지 않는다** —
        //    비동기 예외도 DOM 도 못 본다. 그래서 그냥 await 하고 잡는다.
        let c: HTMLElement | null = null;
        let thrown: unknown = null;
        try { c = await mount(el()); } catch (e) { thrown = e; }
        expect(thrown, `마운트가 던졌다: ${String(thrown)}`).toBeNull();
        const crash = renderCrash();
        expect(crash, `렌더 예외:\n${crash}`).toBeNull();
        // 트리가 통째로 비면 흰 화면이다(비어도 되는 구역은 예외)
        if (!opts.allowEmptyDom && state === 'ok') {
          expect(c?.innerHTML.length ?? 0, '정상인데 DOM 이 비었다').toBeGreaterThan(0);
        }
      });
    }
  });
}

// ───────────────────────── 가짜 API ─────────────────────────

const api = {
  getMyContracts: vi.fn(), getMyPurchases: vi.fn(), getMyRequests: vi.fn(),
  getPartnerAccounts: vi.fn(), getPartnerAuditLog: vi.fn(),
  getMyLeads: vi.fn(),
  getPartnerRequests: vi.fn(),
  getAllContracts: vi.fn(), getPurchasesForContracts: vi.fn(),
};

vi.mock('@/lib/partnerPortalContracts', () => ({
  getMyContracts: (...a: unknown[]) => api.getMyContracts(...a),
  getMyPurchases: (...a: unknown[]) => api.getMyPurchases(...a),
  getMyRequests: (...a: unknown[]) => api.getMyRequests(...a),
  sendPartnerRequest: vi.fn(),
}));
vi.mock('@/lib/partnerAccounts', async () => {
  const real = await vi.importActual<typeof import('../lib/partnerAccounts')>('../lib/partnerAccounts');
  return { ...real,
    getPartnerAccounts: (...a: unknown[]) => api.getPartnerAccounts(...a),
    getPartnerAuditLog: (...a: unknown[]) => api.getPartnerAuditLog(...a),
    callPartnerAccounts: vi.fn() };
});
vi.mock('@/lib/partnerPortalLeads', async () => {
  const real = await vi.importActual<typeof import('../lib/partnerPortalLeads')>('../lib/partnerPortalLeads');
  return { ...real,
    getMyLeads: (...a: unknown[]) => api.getMyLeads(...a),
    createLead: vi.fn(), recordContact: vi.fn() };
});
vi.mock('@/lib/partnerContractsApi', async () => {
  const real = await vi.importActual<typeof import('../lib/partnerContractsApi')>('../lib/partnerContractsApi');
  return { ...real,
    getPartnerRequests: (...a: unknown[]) => api.getPartnerRequests(...a),
    getAllContracts: (...a: unknown[]) => api.getAllContracts(...a),
    getPurchasesForContracts: (...a: unknown[]) => api.getPurchasesForContracts(...a),
    markRequestHandled: vi.fn() };
});

/** 상태에 맞는 응답을 모든 가짜에 꽂는다 */
function feed(state: 'pending' | 'empty' | 'failed' | 'ok', okValue: unknown = []) {
  for (const k of Object.keys(api) as (keyof typeof api)[]) {
    api[k].mockReset();
    if (state === 'pending') api[k].mockImplementation(PENDING);
    else if (state === 'failed') api[k].mockRejectedValue(new Error('network'));
    else if (state === 'empty') api[k].mockResolvedValue([]);
    else api[k].mockResolvedValue(okValue);
  }
}

// ───────────────────────── 포털 구역 ─────────────────────────

import PortalContracts from '../components/partner-portal/PortalContracts';
import PortalAccounts from '../components/partner-portal/PortalAccounts';
import PortalLeads from '../components/partner-portal/PortalLeads';
import PartnerRequests from '../components/partners/PartnerRequests';
import ReceivablesSummary from '../components/partners/ReceivablesSummary';
import SettlementStatus from '../components/partners/SettlementStatus';

fourStates('PortalContracts', s => feed(s), () => (
  <PortalContracts partnerId="p1" locale="en" licenses={[]} canRequest />
), { allowEmptyDom: true });   // 계약이 없으면 통째로 안 보이는 것이 정상

fourStates('PortalAccounts', s => feed(s), () => (
  <PortalAccounts partnerId="p1" locale="en" myId="u1" isPartnerAdmin />
), { allowEmptyDom: true });

fourStates('PortalLeads', s => feed(s), () => (
  <PortalLeads locale="en" country="TR" role="partner_member" />
));

fourStates('PartnerRequests', s => feed(s), () => (
  <PartnerRequests adminId="u1" partnerNames={new Map()} />
), { allowEmptyDom: true });

fourStates('ReceivablesSummary', s => feed(s), () => (
  <ReceivablesSummary partnerNames={new Map()} />
), { allowEmptyDom: true });

// ───────────────────────── SettlementStatus (authedFetch 직접) ─────────────────────────

const authedFetch = vi.fn();
vi.mock('@/lib/authedFetch', () => ({ authedFetch: (...a: unknown[]) => authedFetch(...a) }));

fourStates('SettlementStatus', s => {
  authedFetch.mockReset();
  if (s === 'pending') authedFetch.mockImplementation(PENDING);
  else if (s === 'failed') authedFetch.mockRejectedValue(new Error('network'));
  else if (s === 'empty') authedFetch.mockResolvedValue({ ok: true, json: async () => [] });
  else authedFetch.mockResolvedValue({ ok: true, json: async () => [] });
}, () => <SettlementStatus partnerNames={new Map()} />, { allowEmptyDom: true });

// ───────────────────────── 마법사 ─────────────────────────

import PartnerOnboardingWizard from '../components/partners/PartnerOnboardingWizard';

describe('PartnerOnboardingWizard', () => {
  it('빈 상태로 열어도 터지지 않는다', async () => {
    const c = await mount(
      <PartnerOnboardingWizard initial={null} onClose={vi.fn()} onSaved={vi.fn()}
        save={vi.fn().mockResolvedValue('p1')} />);
    expect(renderCrash()).toBeNull();
    expect(c).toBeTruthy();
  });

  it('**빈 객체로 이어 써도** 터지지 않는다 (NULL 투성이 행)', async () => {
    await mount(
      <PartnerOnboardingWizard initial={{}} onClose={vi.fn()} onSaved={vi.fn()}
        save={vi.fn()} />);
    expect(renderCrash()).toBeNull();
  });

  it('칸이 전부 null 인 행으로도 터지지 않는다', async () => {
    await mount(
      <PartnerOnboardingWizard
        initial={{ name: null, country: null, locale: null, currency: null,
                   commission_rate: null, can_issue_licenses: null, notes: null }}
        onClose={vi.fn()} onSaved={vi.fn()} save={vi.fn()} />);
    expect(renderCrash()).toBeNull();
  });
});

// ───────────────────────── 이 시험이 진짜 잡는지 ─────────────────────────

describe('이 시험이 **진짜 렌더 예외를 잡는가**', () => {
  function Boom(): ReactElement {
    const x = null as unknown as { id: string };
    return <div>{x.id}</div>;          // 흰 화면을 만드는 바로 그 모양
  }

  it('일부러 터뜨리면 **잡힌다**', async () => {
    try { await mount(<Boom />); } catch { /* 렌더 예외는 여기로도 온다 */ }
    expect(renderCrash(), '시험이 렌더 예외를 못 잡고 있다').not.toBeNull();
  });

  it('정상 컴포넌트는 조용하다', async () => {
    await mount(<div>ok</div>);
    expect(renderCrash()).toBeNull();
  });
});

// ───────────────────────── 큰 화면 두 개 ─────────────────────────
//
// `Leads` 와 `Partners` 는 import 가 각각 28·41개라 가짜를 다 꽂기 어렵다.
// 그래서 **데이터 모듈만** 가짜로 두고 마운트해 본다. 여기서 터지면 그게 곧
// 운영에서 터지는 것이다(이번 사고가 정확히 그 모양이었다).

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    userProfile: { id: 'u1', partner_id: null, role: 'admin' },
    canEdit: true, isAdmin: true, canManageLicenses: true, canEditPartnerDeals: true,
    canIssueLicenses: true, partnerLocale: 'ko', partnerCurrency: 'KRW', partnerCountry: 'KR',
  }),
}));

const leadsApi = { getLeads: vi.fn(), getActivities: vi.fn(), getCcLinks: vi.fn() };
vi.mock('@/lib/leadsApi', async () => {
  const real = await vi.importActual<typeof import('../lib/leadsApi')>('../lib/leadsApi');
  return { ...real,
    getLeads: () => leadsApi.getLeads(),
    getActivitiesFor: () => leadsApi.getActivities(),
    getCcLinksFor: () => leadsApi.getCcLinks() };
});

describe('Leads 페이지', () => {
  for (const state of ['pending', 'empty', 'failed', 'ok'] as const) {
    it(`${state} — 렌더 중 터지지 않는다`, async () => {
      leadsApi.getLeads.mockReset();
      if (state === 'pending') leadsApi.getLeads.mockImplementation(PENDING);
      else if (state === 'failed') leadsApi.getLeads.mockRejectedValue(new Error('x'));
      else if (state === 'empty') leadsApi.getLeads.mockResolvedValue([]);
      else leadsApi.getLeads.mockResolvedValue([
        { id: 'l1', name: '홍길동', school_name: 'A 학교', status: '신규',
          email: 'a@b.com', market: 'KR', created_at: '2026-11-01T00:00:00Z' },
        // **파트너가 넣은 리드** — 칩이 그려진다
        { id: 'l2', name: 'B', school_name: 'B 학교', status: '신규',
          partner_id: 'p1', partner_claimed_at: '2026-11-01T00:00:00Z',
          contact_owner: 'end_user', created_at: '2026-11-01T00:00:00Z' },
        // **칸이 비어 있는 리드** — 옛 자료가 이렇게 생겼다
        { id: 'l3' },
      ]);

      const { default: Leads } = await import('../pages/Leads');
      let thrown: unknown = null;
      let c: HTMLElement | null = null;
      try { c = await mount(<Leads />); } catch (e) { thrown = e; }
      expect(thrown, `마운트가 던졌다: ${String(thrown)}`).toBeNull();
      const crash = renderCrash();
      expect(crash, `렌더 예외:\n${crash}`).toBeNull();
      // ⚠️ **목록 줄까지 실제로 그려졌는지** 본다. 안 그리면 이 시험은
      //    "빈 화면이 안 터진다"만 보는 셈이라 아무것도 지키지 못한다.
      //    기본 탭이 "오늘 할 팔로업"이라 줄이 비어 있다 — **전체 탭으로 바꾼다.**
      if (state === 'ok') {
        await waitFor(() => expect(c!.textContent ?? '').toContain('전체 3건'));
        // Radix 탭은 글자가 아니라 **버튼**을 눌러야 바뀐다
        const tab = screen.getByRole('tab', { name: /전체 \(가능성순\)/ });
        fireEvent.mouseDown(tab);
        fireEvent.click(tab);
        await new Promise(r => setTimeout(r, 30));
        await waitFor(() => expect(c!.textContent ?? '').toContain('A 학교'));
        expect(c!.textContent).toContain('B 학교');   // 파트너 리드 줄(칩이 그려진다)
        // 렌더 예외는 줄을 그린 **뒤에** 다시 본다
        expect(renderCrash(), `줄을 그리다 터졌다:\n${renderCrash()}`).toBeNull();
      }
    });
  }
});

describe('Partners 페이지 (관리자)', () => {
  for (const state of ['pending', 'empty', 'failed', 'ok'] as const) {
    it(`${state} — 렌더 중 터지지 않는다`, async () => {
      // 이 화면은 `authedFetch` 로 여러 표를 직접 읽는다 — 그것만 가짜로 둔다
      authedFetch.mockReset();
      if (state === 'pending') authedFetch.mockImplementation(PENDING);
      else if (state === 'failed') authedFetch.mockRejectedValue(new Error('network'));
      else if (state === 'empty') {
        authedFetch.mockResolvedValue({ ok: true, json: async () => [] });
      } else {
        authedFetch.mockResolvedValue({ ok: true, json: async () => ([
          { id: 'p1', name: '시험 파트너', status: 'active', commission_rate: 15,
            can_issue_licenses: true, locale: 'en', currency: 'USD', country: 'TR',
            created_at: '2026-11-01T00:00:00Z' },
          // **작성 중(마법사)** 파트너 — 배지가 그려진다
          { id: 'p2', name: '작성 중', status: 'active',
            onboarding_status: 'draft', created_at: '2026-11-01T00:00:00Z' },
          // **칸이 비어 있는 파트너** — 옛 자료
          { id: 'p3', created_at: '2026-11-01T00:00:00Z' },
        ]) });
      }
      feed(state);

      const { default: Partners } = await import('../pages/Partners');
      let thrown: unknown = null;
      try { await mount(<Partners />); } catch (e) { thrown = e; }
      expect(thrown, `마운트가 던졌다: ${String(thrown)}`).toBeNull();
      const crash = renderCrash();
      expect(crash, `렌더 예외:\n${crash}`).toBeNull();
    });
  }
});
