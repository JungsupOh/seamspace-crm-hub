// 자기 정보 확인 페이지 — 이메일 입력 후 받은 버전 이력 표시
// 인증 없음 (이메일 매칭만으로 본인 정보 조회)

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, AlertCircle, Smartphone, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { findSubscriberByEmail, listDownloadsByEmail, type ApkSubscriber, type ApkDownload } from '@/lib/apk';

export default function ApkInfo() {
  const [email, setEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [subscriber, setSubscriber] = useState<ApkSubscriber | null>(null);
  const [downloads, setDownloads] = useState<ApkDownload[]>([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('이메일을 정확히 입력해 주세요.'); return;
    }
    setError('');
    setSearching(true);
    setSearched(false);
    try {
      const sub = await findSubscriberByEmail(email.trim());
      setSubscriber(sub);
      if (sub) {
        const dls = await listDownloadsByEmail(email.trim());
        setDownloads(dls);
      } else {
        setDownloads([]);
      }
      setSearched(true);
    } catch {
      setError('조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSearching(false);
    }
  };

  const statusLabel = (s: string) => s === 'active' ? '구독 중' : s === 'paused' ? '일시중지' : '취소됨';
  const statusColor = (s: string) =>
    s === 'active' ? 'bg-teal-100 text-teal-700' :
    s === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';

  return (
    <div className="min-h-screen bg-muted/20 py-8 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border bg-gradient-to-br from-indigo-50 to-purple-50">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-indigo-600" />
            <h1 className="text-xl font-semibold">내 구독 정보 확인</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            등록한 이메일을 입력하여 구독 상태와 다운로드 이력을 확인합니다.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">이메일 <span className="text-destructive">*</span></Label>
            <Input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@school.kr" type="email" className="h-10 text-sm"
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }} />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button className="w-full h-10" disabled={searching} onClick={handleSearch}>
            {searching ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />조회 중...</> : <><Search className="h-4 w-4 mr-2" />조회</>}
          </Button>

          {searched && !subscriber && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium mb-1">등록되지 않은 이메일입니다.</p>
              <p className="mb-2">먼저 신청해 주세요.</p>
              <Link to="/apk/subscribe" className="text-amber-900 underline font-medium">지금 신청하기 →</Link>
            </div>
          )}

          {subscriber && (
            <div className="space-y-3 pt-3 border-t border-border">
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusColor(subscriber.status)}`}>
                    {statusLabel(subscriber.status)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                  <p><strong className="text-foreground">{subscriber.school_name}</strong> · {subscriber.contact_name}</p>
                  <p>등록일: {subscriber.created_at.slice(0, 10)}</p>
                  {subscriber.phone && <p>연락처: {subscriber.phone}</p>}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3" /> 다운로드 이력 ({downloads.length}건)
                </p>
                {downloads.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3 border border-dashed border-border rounded">
                    아직 다운로드한 이력이 없습니다.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {downloads.map(d => (
                      <div key={d.id} className="rounded border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-mono">{new Date(d.downloaded_at).toLocaleString('ko-KR')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground text-center pt-2">
            문의: info@tebahsoft.com
          </p>
        </div>
      </div>
    </div>
  );
}
