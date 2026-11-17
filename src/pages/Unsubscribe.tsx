// 공개 수신 거부 화면 — `/unsubscribe/:token` (LEAD-S2)
//
// 로그인 불필요. 영어가 기본이고 `?lang=ko` 로 한국어가 된다(브라우저 언어도 본다).
//
// ⚠️ **버튼을 눌러야 거부 처리**한다. 화면이 열리는 것만으로 처리하면
//    메일 클라이언트의 링크 미리보기 로봇이 사람 대신 거부해 버린다(요구 S2-1).

import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { requestUnsubscribe } from '@/lib/public/unsubscribe';

type Lang = 'en' | 'ko';

const T = {
  en: {
    title: 'Unsubscribe',
    lead: 'Press the button below to stop receiving marketing emails from Seamspace.',
    button: 'Unsubscribe',
    working: 'Processing…',
    done: 'You have been unsubscribed. You will no longer receive marketing emails from us.',
    failed: 'Something went wrong. Please try again in a moment.',
    note: 'This does not affect emails about an existing order or licence.',
  },
  ko: {
    title: '수신 거부',
    lead: '아래 버튼을 누르면 심스페이스의 마케팅 메일을 받지 않습니다.',
    button: '수신 거부',
    working: '처리 중…',
    done: '수신 거부가 처리되었습니다. 앞으로 마케팅 메일을 보내지 않습니다.',
    failed: '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.',
    note: '이미 진행 중인 주문·이용권 관련 안내 메일에는 영향이 없습니다.',
  },
} as const;

export default function Unsubscribe() {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();

  /** `?lang=` 가 우선, 없으면 브라우저 언어, 그래도 없으면 영어. */
  const lang: Lang = useMemo(() => {
    const q = (params.get('lang') ?? '').toLowerCase();
    if (q === 'ko' || q === 'en') return q;
    const nav = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
    return nav.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  }, [params]);

  const t = T[lang];
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');

  const go = async () => {
    if (!token) { setState('failed'); return; }
    setState('working');
    try {
      const r = await requestUnsubscribe(token);
      // 서버는 없는 토큰에도 같은 응답을 준다(열거 방지) — 화면도 구분하지 않는다.
      setState(r?.ok === false ? 'failed' : 'done');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 sm:p-8 space-y-4">
        <h1 className="text-xl font-semibold">{t.title}</h1>

        {state === 'done'
          ? <p className="text-sm">{t.done}</p>
          : state === 'failed'
            ? (
              <>
                <p className="text-sm text-destructive">{t.failed}</p>
                <Button variant="outline" onClick={() => setState('idle')}>
                  {t.button}
                </Button>
              </>
            )
            : (
              <>
                <p className="text-sm text-muted-foreground">{t.lead}</p>
                <Button disabled={state === 'working' || !token} onClick={go}>
                  {state === 'working' ? t.working : t.button}
                </Button>
              </>
            )}

        <p className="text-xs text-muted-foreground pt-2 border-t">{t.note}</p>
      </div>
    </div>
  );
}
