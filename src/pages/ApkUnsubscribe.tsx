// 1-click 구독 취소 — 메일의 footer 링크가 가리키는 페이지
// 토큰 매칭으로 즉시 status='unsubscribed' 처리. 로그인 불필요.

import { publicApkUnsubscribe } from '@/lib/public/apkPublic';
import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export default function ApkUnsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('잘못된 구독 취소 링크입니다. 토큰이 누락되었습니다.');
      return;
    }
    (async () => {
      try {
        // 서버 함수 apk-lookup 이 토큰 조회와 상태 변경을 한 번에 한다 (HARD-B2b).
        // 브라우저는 더 이상 apk_subscribers 를 직접 읽고 쓰지 않는다.
        const r = await publicApkUnsubscribe(token);
        if (r.email) setEmail(r.email);
        if (r.state === 'notfound' || r.state === 'error') {
          setStatus('error');
          setMessage(r.message);
          return;
        }
        setStatus('success');
        setMessage(r.message);
      } catch (e) {
        setStatus('error');
        setMessage('처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
        console.error(e);
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
        {status === 'loading' && (
          <>
            <Loader2 className="h-16 w-16 text-muted-foreground mx-auto mb-4 animate-spin" />
            <h1 className="text-xl font-semibold mb-2">처리 중...</h1>
            <p className="text-sm text-muted-foreground">구독 취소를 처리하고 있습니다.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">구독 취소 완료</h1>
            <p className="text-sm text-muted-foreground mb-4">{message}</p>
            {email && (
              <p className="text-xs text-muted-foreground mb-4">취소된 이메일: <strong>{email}</strong></p>
            )}
            <p className="text-xs text-muted-foreground">
              다시 받으시려면 <Link to="/apk/subscribe" className="text-primary underline">재신청</Link> 해 주세요.<br />
              문의: info@tebahsoft.com
            </p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="h-16 w-16 text-amber-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold mb-2">처리 실패</h1>
            <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">{message}</p>
            <p className="text-xs text-muted-foreground">
              문의: info@tebahsoft.com
            </p>
          </>
        )}
      </div>
    </div>
  );
}
