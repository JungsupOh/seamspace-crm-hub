// 다운로드 페이지 — 메일 링크가 가리키는 곳
// 이메일 입력 → apk-download-verify Edge Function 검증 → signed URL → 다운로드
// 친화적 한국어 에러 메시지 (403 코드 노출 X)

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Download, AlertCircle, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface VerifyResponse {
  ok: boolean;
  reason?: 'missing' | 'invalid_email' | 'version_not_found' | 'not_subscribed' | 'paused' | 'unsubscribed' | 'inactive' | 'limit_exceeded' | 'internal';
  message?: string;
  signup_url?: string;
  last_downloaded_at?: string;
  downloaded_count?: number;
  download_url?: string;
  expires_in?: number;
  remaining?: number;
  file_name?: string;
}

export default function ApkDownload() {
  const { versionId } = useParams<{ versionId: string }>();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);

  const handleVerify = async () => {
    if (!email.trim()) { alert('이메일을 입력해 주세요.'); return; }
    if (!versionId) { setResult({ ok: false, message: '잘못된 다운로드 링크입니다.' }); return; }
    setSubmitting(true);
    setResult(null);
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/apk-download-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ version_id: versionId, email: email.trim() }),
      });
      const data = await r.json() as VerifyResponse;
      setResult(data);
      if (data.ok && data.download_url) {
        // 자동 다운로드 트리거 (a 태그 클릭)
        const a = document.createElement('a');
        a.href = data.download_url;
        a.download = data.file_name || 'seamspace.apk';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      setResult({ ok: false, message: '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setSubmitting(false);
    }
  };

  // 성공 화면
  if (result?.ok && result.download_url) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <Download className="h-16 w-16 text-teal-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">다운로드 시작</h1>
          <p className="text-sm text-muted-foreground mb-4">
            다운로드가 자동으로 시작됩니다.<br />
            시작되지 않으면 아래 버튼을 클릭해 주세요.
          </p>
          <a href={result.download_url} download={result.file_name}
            className="inline-block bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:bg-primary/90">
            다운로드 다시 시작
          </a>
          <p className="text-xs text-muted-foreground mt-4">
            남은 다운로드 횟수: <strong>{result.remaining ?? 0}회</strong>
          </p>
          <div className="text-left mt-6 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">설치 안내</p>
            <p>1. 다운로드한 APK 파일 실행</p>
            <p>2. "출처를 알 수 없는 앱 설치" 권한 허용 (안드로이드 설정)</p>
            <p>3. 설치 완료 후 학교 코드 입력</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 py-8 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border bg-gradient-to-br from-indigo-50 to-purple-50">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-indigo-600" />
            <h1 className="text-xl font-semibold">심스페이스 Android 앱 다운로드</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            메일 받으신 이메일을 입력해 주세요.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">이메일 <span className="text-destructive">*</span></Label>
            <Input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@school.kr" type="email" className="h-10 text-sm"
              onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }} />
          </div>

          {result && !result.ok && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="whitespace-pre-wrap">{result.message}</span>
              </div>
              {result.last_downloaded_at && (
                <p className="text-rose-700 pl-6">
                  이전 다운로드: {result.last_downloaded_at}
                </p>
              )}
              {result.signup_url && (
                <Link to={result.signup_url}
                  className="inline-block ml-6 mt-1 text-rose-700 underline hover:text-rose-900 font-medium">
                  지금 신청하기 →
                </Link>
              )}
            </div>
          )}

          <Button className="w-full h-11" disabled={submitting} onClick={handleVerify}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />확인 중...</> : <><Download className="h-4 w-4 mr-2" />다운로드</>}
          </Button>

          <p className="text-[11px] text-muted-foreground text-center pt-1 space-y-1">
            <span className="block">동일 이메일당 최대 2회까지 다운로드 가능합니다.</span>
            <span className="block">문의: info@tebahsoft.com</span>
          </p>
        </div>
      </div>
    </div>
  );
}
