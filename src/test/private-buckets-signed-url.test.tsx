// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  parseStorageRef, toPublicUrl, createSignedUrlResolver, encodeStoragePath,
} from '../lib/storageSignedUrl';
import { SignedFileLink } from '../components/SignedFileLink';

const BASE = 'https://x.supabase.co';
const PUB = `${BASE}/storage/v1/object/public`;

describe('parseStorageRef', () => {
  it('공개 URL', () => {
    expect(parseStorageRef(`${PUB}/partner-files/p1/biz-1.pdf`)).toEqual({ bucket: 'partner-files', path: 'p1/biz-1.pdf' });
  });
  it('한글·공백 인코딩을 풀어 원문 경로로', () => {
    expect(parseStorageRef(`${PUB}/partner-files/p1/${encodeURIComponent('사업자 등록증.pdf')}`))
      .toEqual({ bucket: 'partner-files', path: 'p1/사업자 등록증.pdf' });
  });
  it('상대 경로', () => {
    expect(parseStorageRef('lucky_seven_school_id_files/1-a.png')).toEqual({ bucket: 'lucky_seven_school_id_files', path: '1-a.png' });
  });
  it('쿼리 문자열 제거', () => {
    expect(parseStorageRef(`${PUB}/b/a.pdf?download=1`)?.path).toBe('a.pdf');
  });
  it.each([null, undefined, '', 'nopath', 'bucket/', 'https://evil.com/a.pdf', 'b/../x'])('잘못된 입력 %s', v => {
    expect(parseStorageRef(v as string)).toBeNull();
  });
});

describe('toPublicUrl', () => {
  it('URL 은 그대로, 상대 경로는 공개 URL 로', () => {
    expect(toPublicUrl(`${PUB}/b/a.pdf`, BASE)).toBe(`${PUB}/b/a.pdf`);
    expect(toPublicUrl('b/한 글.pdf', BASE)).toBe(`${PUB}/b/${encodeStoragePath('한 글.pdf')}`);
  });
});

function deps(over: Partial<Parameters<typeof createSignedUrlResolver>[0]> = {}) {
  const authedFetch = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ signedURL: '/object/sign/partner-files/p1/a.pdf?token=T' }), { status: 200 }));
  let t = 0;
  return { authedFetch, d: { authedFetch, supabaseUrl: BASE, apiKey: 'k', now: () => t, ...over }, tick: (ms: number) => { t += ms; } };
}

describe('createSignedUrlResolver', () => {
  it('서명 URL 을 받아 돌려주고 POST expiresIn 600', async () => {
    const { authedFetch, d } = deps();
    const r = createSignedUrlResolver(d);
    expect(await r(`${PUB}/partner-files/p1/a.pdf`)).toBe(`${BASE}/storage/v1/object/sign/partner-files/p1/a.pdf?token=T`);
    const [url, init] = authedFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/storage/v1/object/sign/partner-files/p1/a.pdf`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ expiresIn: 600 });
    expect(init.headers.Authorization).toBeUndefined();
  });
  it('캐시: 같은 파일은 한 번만, 만료 임박하면 다시', async () => {
    const { authedFetch, d, tick } = deps();
    const r = createSignedUrlResolver(d);
    await r(`${PUB}/partner-files/p1/a.pdf`); await r('partner-files/p1/a.pdf');
    expect(authedFetch).toHaveBeenCalledTimes(1);
    tick(600_000 - 10_000);
    await r(`${PUB}/partner-files/p1/a.pdf`);
    expect(authedFetch).toHaveBeenCalledTimes(2);
  });
  it('폴백: 서명 4xx → 공개 URL', async () => {
    const { d } = deps({ authedFetch: vi.fn().mockResolvedValue(new Response('{}', { status: 400 })) });
    expect(await createSignedUrlResolver(d)(`${PUB}/b/a.pdf`)).toBe(`${PUB}/b/a.pdf`);
  });
  it('폴백: 네트워크·세션 오류 → 공개 URL, 실패는 캐시하지 않음', async () => {
    const f = vi.fn().mockRejectedValue(new Error('로그인이 필요합니다.'));
    const r = createSignedUrlResolver(deps({ authedFetch: f }).d);
    expect(await r(`${PUB}/b/a.pdf`)).toBe(`${PUB}/b/a.pdf`);
    await r(`${PUB}/b/a.pdf`);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('폴백: 응답에 서명이 없음 / 파싱 불가 값', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const r = createSignedUrlResolver(deps({ authedFetch: f }).d);
    expect(await r(`${PUB}/b/a.pdf`)).toBe(`${PUB}/b/a.pdf`);
    expect(await r('https://other.com/x.pdf')).toBe('https://other.com/x.pdf');
  });
});

describe('SignedFileLink (렌더)', () => {
  it('첫 렌더는 공개 URL href, 클릭하면 resolve 를 부르고 새 탭을 서명 URL 로', async () => {
    const resolve = vi.fn().mockResolvedValue('https://signed/x?token=1');
    const win = { opener: 'x', location: { href: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    render(<SignedFileLink stored={`${PUB}/partner-files/a.pdf`} resolve={resolve}>열기</SignedFileLink>);
    const a = screen.getByText('열기') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(`${PUB}/partner-files/a.pdf`);
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(a);
    await waitFor(() => expect(win.location.href).toBe('https://signed/x?token=1'));
    expect(resolve).toHaveBeenCalledWith(`${PUB}/partner-files/a.pdf`);
    expect(win.opener).toBeNull();
    open.mockRestore();
  });
  it('stopPropagation 같은 호출부 onClick 이 먼저 돈다', async () => {
    const onClick = vi.fn();
    const resolve = vi.fn().mockResolvedValue('u');
    vi.spyOn(window, 'open').mockReturnValue({ location: { href: '' } } as unknown as Window);
    render(<SignedFileLink stored="b/a.pdf" resolve={resolve} onClick={onClick}>x</SignedFileLink>);
    fireEvent.click(screen.getByText('x'));
    expect(onClick).toHaveBeenCalled();
    await waitFor(() => expect(resolve).toHaveBeenCalled());
  });
});

// 변이 시험: Partners 화면이 서류 링크에 SignedFileLink 를 계속 쓰는지(원래 <a href=file_url> 로 돌아가면 실패)
import { readFileSync } from 'node:fs';
describe('Partners 화면 연결', () => {
  const src = readFileSync('src/pages/Partners.tsx', 'utf8');
  it('서류 링크가 SignedFileLink 이고 file_url 직접 href 가 없다', () => {
    expect(src).toContain('<SignedFileLink stored={existing.file_url}');
    expect(src).not.toMatch(/href=\{existing\.file_url\}/);
  });
});
