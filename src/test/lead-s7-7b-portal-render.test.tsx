// @vitest-environment jsdom
// LEAD-S7-7b — 포털 리드 화면 렌더
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortalLeads from '../components/partner-portal/PortalLeads';
import type { PortalLead } from '../lib/partnerPortalLeads';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const getMyLeads = vi.fn();
const createLead = vi.fn();
vi.mock('../lib/partnerPortalLeads', async () => {
  const real = await vi.importActual<typeof import('../lib/partnerPortalLeads')>(
    '../lib/partnerPortalLeads');
  return { ...real, getMyLeads: () => getMyLeads(), createLead: (f: unknown) => createLead(f) };
});

function show(role = 'partner_member') {
  const qc = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PortalLeads locale="en" country="TR" role={role} />
    </QueryClientProvider>);
}

const LEADS: PortalLead[] = [
  { id: 'l1', school_name: 'Hanoi Int School', country: 'VN', name: 'A Person',
    email: 'a@school.edu', contact_owner: 'end_user',
    partner_claimed_at: '2026-11-01T00:00:00Z', protection_days_left: 73 },
  { id: 'l2', school_name: 'Old Lead', country: 'TR', protection_days_left: 0 },
];

beforeEach(() => {
  getMyLeads.mockReset().mockResolvedValue(LEADS);
  createLead.mockReset().mockResolvedValue({ ok: true, notice: 'none', message: 'Registered.' });
});

describe('내 리드 화면', () => {
  it('목록과 보호 기간을 보여 준다', async () => {
    show();
    expect(await screen.findByText('Hanoi Int School')).toBeTruthy();
    expect(screen.getByText('73 days left')).toBeTruthy();
    expect(screen.getByText('Protection has ended')).toBeTruthy();
  });

  it('**접촉이 없으면 분명히 말한다**', async () => {
    show();
    await screen.findByText('Hanoi Int School');
    expect(screen.getAllByText('No contact recorded').length).toBe(2);
  });

  it('**보기 전용은 등록할 수 없다**', async () => {
    show('partner_viewer');
    await screen.findByText('Hanoi Int School');
    expect(screen.getByText('View-only accounts cannot register leads.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Register a lead/ })).toBeNull();
  });

  it('등록 폼이 열린다', async () => {
    show();
    await screen.findByText('Hanoi Int School');
    fireEvent.click(screen.getByRole('button', { name: /Register a lead/ }));
    expect(screen.getByText('Whose contact details are these? *')).toBeTruthy();
  });

  it('**최종 사용자를 고르면 동의 체크가 나타나고, 그 전에는 보낼 수 없다**', async () => {
    show();
    await screen.findByText('Hanoi Int School');
    fireEvent.click(screen.getByRole('button', { name: /Register a lead/ }));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'New School' } });
    const email = document.querySelector('input[type="email"]')!;
    fireEvent.change(email, { target: { value: 'new@school.edu' } });

    fireEvent.click(screen.getByLabelText(/end user/i, { selector: 'input' })
      ?? screen.getAllByRole('radio')[0]);

    expect(screen.getByText(/I have their consent/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Register' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('파트너 대행이면 동의 없이 보낼 수 있고, 안내가 뜬다', async () => {
    show();
    await screen.findByText('Hanoi Int School');
    fireEvent.click(screen.getByRole('button', { name: /Register a lead/ }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'New School' } });
    fireEvent.change(document.querySelector('input[type="email"]')!,
      { target: { value: 'new@school.edu' } });
    fireEvent.click(screen.getAllByRole('radio')[1]);

    expect(screen.getByText(/will not send customer mailings/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Register' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(createLead).toHaveBeenCalledWith(
      expect.objectContaining({ contactOwner: 'partner', consented: false })));
  });

  it('비어 있으면 안내만 보여 준다', async () => {
    getMyLeads.mockResolvedValue([]);
    show();
    expect(await screen.findByText('You have not registered any leads yet.')).toBeTruthy();
  });
});
