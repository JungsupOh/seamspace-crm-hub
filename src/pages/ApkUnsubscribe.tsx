// 1-click 구독 취소 — 메일의 footer 링크가 가리키는 페이지
// 토큰 매칭으로 즉시 status='unsubscribed' 처리. 로그인 불필요.

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
        // 토큰으로 조회 + 이메일 확보
        const findRes = await fetch(
          `${SUPABASE_URL}/rest/v1/apk_subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}&select=id,email,status&limit=1`,
          { headers: HEADERS },
        );
        if (!findRes.ok) throw new Error('토큰 조회 실패');
        const rows = await findRes.json() as Array<{ id: string; email: string; status: string }>;
        if (rows.length === 0) {
          setStatus('error');
          setMessage('해당 토큰에 매칭되는 구독자를 찾을 수 없습니다. 이미 처리된 링크이거나 잘못된 링크일 수 있습니다.');
          return;
        }
        const sub = rows[0];
        setEmail(sub.email);
        if (sub.status === 'unsubscribed') {
          setStatus('success');
          setMessage('이미 구독이 취소되어 있습니다.');
          return;
        }
        // status='unsubscribed' 처리
        const upRes = await fetch(`${SUPABASE_URL}/rest/v1/apk_subscribers?id=eq.${sub.id}`, {
          method: 'PATCH',
          headers: { ...HEADERS, Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'unsubscribed' }),
        });
        if (!upRes.ok) throw new Error('업데이트 실패');
        setStatus('success');
        setMessage('구독이 취소되었습니다. 더 이상 메일을 받지 않습니다.');
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
