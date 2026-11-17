// @vitest-environment jsdom
// LEAD-S7-6 — 마법사 렌더 시험
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PartnerOnboardingWizard from '../components/partners/PartnerOnboardingWizard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function show(initial: Record<string, unknown> | null = null, save = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerOnboardingWizard initial={initial} onClose={vi.fn()}
        onSaved={vi.fn()} save={save} />
    </QueryClientProvider>);
  return save;
}

describe('마법사 화면', () => {
  it('여섯 단계가 모두 보인다', () => {
    show();
    for (const n of ['1. 회사 기본', '2. 계약서와 기간', '3. 수량·단가',
                     '4. 발급 권한과 한도', '5. 첫 관리자 계정', '6. 확인과 완료']) {
      expect(screen.getByText(n)).toBeTruthy();
    }
  });

  it('**어디까지 했는지** 보여 준다', () => {
    show();
    expect(screen.getByText(/6단계 중/)).toBeTruthy();
    expect(screen.getByText(/다음 할 곳: 1단계/)).toBeTruthy();
  });

  it('빈 초안에서는 **완료를 누를 수 없다**', () => {
    show();
    const fin = screen.getByRole('button', { name: '완료' }) as HTMLButtonElement;
    expect(fin.disabled).toBe(true);
  });

  it('이름이 없으면 **작성 중 저장도** 막는다 (빈 행을 만들지 않는다)', () => {
    show();
    const s = screen.getByRole('button', { name: '작성 중으로 저장' }) as HTMLButtonElement;
    expect(s.disabled).toBe(true);
  });

  it('이름을 쓰면 작성 중 저장이 열린다', async () => {
    const save = vi.fn().mockResolvedValue('p1');
    show(null, save);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Eduvision' } });
    const s = screen.getByRole('button', { name: '작성 중으로 저장' }) as HTMLButtonElement;
    expect(s.disabled).toBe(false);
    fireEvent.click(s);
    await waitFor(() => expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ onboarding_status: 'draft', can_issue_licenses: false }), false));
  });

  it('**이어서 쓸 때는 비어 있는 단계부터** 연다', () => {
    show({ name: 'Eduvision', country: 'TR', locale: 'en', currency: 'USD' });
    // 1단계가 찼으니 3단계(수량·단가)로 들어간다
    expect(screen.getByText('정산 방식 *')).toBeTruthy();
  });

  it('단계 조각을 눌러 옮겨 다닐 수 있다', () => {
    show();
    fireEvent.click(screen.getByText('5. 첫 관리자 계정'));
    expect(screen.getByText(/사용자 관리 화면에서 만듭니다/)).toBeTruthy();
    expect(screen.getByText(/계정을 만들지 않고, 메일도 보내지 않습니다/)).toBeTruthy();
  });

  it('4단계에 **작성 중에는 권한이 안 켜진다**고 적혀 있다', () => {
    show();
    fireEvent.click(screen.getByText('4. 발급 권한과 한도'));
    expect(screen.getByText(/이용권 발급 권한이 켜지지 않습니다/)).toBeTruthy();
  });

  it('6단계가 **무엇이 비었는지** 단계 번호로 알려 준다', () => {
    show();
    fireEvent.click(screen.getByText('6. 확인과 완료'));
    expect(screen.getByText('아직 비어 있는 곳이 있습니다:')).toBeTruthy();
    expect(screen.getByText(/1단계 — 회사 이름이 필요합니다/)).toBeTruthy();
  });
});
