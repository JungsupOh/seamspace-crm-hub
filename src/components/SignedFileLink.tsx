import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { getSignedFileUrl, toPublicUrl } from '@/lib/storageSignedUrl';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  /** 저장된 값(공개 URL 또는 `<버킷>/<경로>`) */
  stored: string;
  resolve?: (stored: string) => Promise<string>;
};

/** 눌렀을 때 서명 URL 을 받아 새 탭으로 연다. href 는 공개 URL(우클릭 복사·폴백). */
export function SignedFileLink({ stored, resolve = getSignedFileUrl, onClick, children, ...rest }: Props) {
  const handle = async (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    // 팝업 차단을 피하려고 클릭 안에서 먼저 탭을 연다
    const w = window.open('', '_blank');
    if (w) w.opener = null;
    const url = await resolve(stored);
    if (w) w.location.href = url; else window.location.assign(url);
  };
  return <a {...rest} href={toPublicUrl(stored, import.meta.env.VITE_SUPABASE_URL as string)} target="_blank" rel="noreferrer" onClick={handle}>{children}</a>;
}
