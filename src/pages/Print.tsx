// /print — 일기 제본 PDF 생성 (관리자 전용)
//
// 흐름: 관리자 로그인 → 사용자 아이디 입력 → 일기 현황·견적 확인 → PDF 생성·다운로드
//
// /shop 처럼 공개 라우트지만, 심스페이스 일기 서버 관리자 계정으로만 들어올 수 있다.
// 서버(api/print/login.py)가 허용목록으로 한 번 더 거른다 — 일기 조회 API가 대상
// 사용자를 요청 본문의 username으로 정하기 때문에 화면 단속만으로는 부족하다.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, CalendarDays, CalendarClock, Download,
  FileText, Loader2, LogOut, Scissors, Search, TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { StatCard } from '@/components/StatCard';
import {
  fetchStats, formatWon, formatYm, generateVolume, loadSession, login,
  requote, saveSession,
  type DiaryStats, type GeneratedFile, type PrintSession, type Quote,
} from '@/lib/print';

export default function Print() {
  const [session, setSession] = useState<PrintSession | null>(() => loadSession());

  // 로그인
  const [adminId, setAdminId] = useState('');
  const [adminPw, setAdminPw] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // 조회
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<DiaryStats | null>(null);

  // 구간·분책
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [splits, setSplits] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [showSplitEditor, setShowSplitEditor] = useState(false);

  // 생성
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [files, setFiles] = useState<GeneratedFile[]>([]);

  const monthsInRange = useMemo(() => {
    if (!stats || !range) return [];
    return stats.monthly.filter(m => m.ym >= range.from && m.ym <= range.to);
  }, [stats, range]);

  const maxCount = useMemo(
    () => monthsInRange.reduce((acc, m) => Math.max(acc, m.count), 0),
    [monthsInRange],
  );

  async function handleLogin() {
    if (!adminId.trim() || !adminPw) {
      toast.error('아이디와 비밀번호를 입력해주세요.');
      return;
    }
    setLoggingIn(true);
    try {
      const s = await login(adminId.trim(), adminPw);
      setSession(s);
      saveSession(s);
      setAdminPw('');
      toast.success(`${s.name || s.username}님, 환영합니다.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '로그인에 실패했습니다.');
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    setSession(null);
    saveSession(null);
    resetQuery();
    setAdminId('');
    setAdminPw('');
  }

  function resetQuery() {
    setStats(null);
    setRange(null);
    setSplits([]);
    setQuote(null);
    setFiles([]);
    setProgress('');
    setShowSplitEditor(false);
  }

  async function handleSearch() {
    if (!session) return;
    if (!target.trim()) {
      toast.error('조회할 사용자 아이디를 입력해주세요.');
      return;
    }
    setLoading(true);
    resetQuery();
    try {
      const s = await fetchStats(session.token, target.trim());
      setStats(s);
      if (s.monthly.length > 0) {
        setRange({ from: s.monthly[0].ym, to: s.monthly[s.monthly.length - 1].ym });
        setQuote(s.quote);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '조회에 실패했습니다.';
      toast.error(message);
      // 토큰 만료면 다시 로그인시킨다.
      if (message.includes('만료') || message.includes('로그인이 필요')) handleLogout();
    } finally {
      setLoading(false);
    }
  }

  /** 구간이나 분책 경계가 바뀌면 견적만 다시 계산한다(일기 재조회 없음). */
  async function refreshQuote(next: { from: string; to: string }, nextSplits: string[]) {
    if (!stats) return;
    setQuoting(true);
    setFiles([]);
    try {
      const inRange = nextSplits.filter(ym => ym >= next.from && ym <= next.to);
      const q = await requote(stats.monthly, next.from, next.to, inRange.length ? inRange : undefined);
      setQuote(q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '견적 계산에 실패했습니다.');
    } finally {
      setQuoting(false);
    }
  }

  function changeRange(part: 'from' | 'to', ym: string) {
    if (!range) return;
    let next = { ...range, [part]: ym };
    if (next.from > next.to) next = part === 'from' ? { from: ym, to: ym } : { from: ym, to: ym };
    setRange(next);
    const kept = splits.filter(s => s >= next.from && s < next.to);
    setSplits(kept);
    void refreshQuote(next, kept);
  }

  function toggleSplit(ym: string) {
    if (!range) return;
    const next = splits.includes(ym) ? splits.filter(s => s !== ym) : [...splits, ym].sort();
    setSplits(next);
    void refreshQuote(range, next);
  }

  async function handleGenerate() {
    if (!session || !stats || !quote || !quote.printable) return;
    setGenerating(true);
    setFiles([]);
    const made: GeneratedFile[] = [];
    try {
      for (const v of quote.volumes) {
        setProgress(`${quote.volumes.length}권 중 ${v.volume}권 만드는 중… (${v.pages}페이지)`);
        const file = await generateVolume(session.token, stats.username, v.from, v.to);
        made.push(file);
        setFiles([...made]);
      }
      setProgress('');
      toast.success(`PDF ${made.length}권을 만들었습니다.`);
      // 한 권이면 바로 받게 해준다. 여러 권을 동시에 열면 브라우저가 막는다.
      if (made.length === 1) triggerDownload(made[0]);
    } catch (e) {
      setProgress('');
      toast.error(e instanceof Error ? e.message : 'PDF 생성에 실패했습니다.');
    } finally {
      setGenerating(false);
    }
  }

  function downloadUrl(file: GeneratedFile) {
    // Supabase signed URL에 download 파라미터를 붙이면 브라우저가 저장한다.
    return `${file.url}&download=${encodeURIComponent(file.name)}`;
  }

  function triggerDownload(file: GeneratedFile) {
    const a = document.createElement('a');
    a.href = downloadUrl(file);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center">
          <Link to="/shop" className="flex items-center gap-2 text-sm hover:text-primary">
            <ArrowLeft className="h-4 w-4" />스토어
          </Link>
          <span className="flex-1 text-center font-bold">일기 제본 PDF 생성</span>
          <span className="w-16 flex justify-end">
            {session && (
              <button onClick={handleLogout} title="로그아웃"
                className="text-muted-foreground hover:text-foreground">
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {!session ? (
          /* ── 1단계: 관리자 로그인 ─────────────────────────────── */
          <div className="bg-white rounded-2xl border border-border p-5 space-y-4 max-w-md mx-auto">
            <div>
              <p className="text-sm font-medium">관리자 로그인</p>
              <p className="text-xs text-muted-foreground mt-1">
                심스페이스 일기 서버의 관리자 계정으로 로그인합니다.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">아이디</Label>
              <Input value={adminId} onChange={e => setAdminId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleLogin(); }}
                autoComplete="username" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">비밀번호</Label>
              <Input type="password" value={adminPw} onChange={e => setAdminPw(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleLogin(); }}
                autoComplete="current-password" className="h-11" />
            </div>
            <Button onClick={() => void handleLogin()} disabled={loggingIn} className="w-full h-11">
              {loggingIn ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />확인 중…</> : '로그인'}
            </Button>
          </div>
        ) : (
          <>
            {/* ── 2단계: 사용자 조회 ───────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">출력할 사용자</p>
                <p className="text-xs text-muted-foreground">
                  {session.name || session.username} 님으로 로그인됨
                </p>
              </div>
              <div className="flex gap-2">
                <Input value={target} onChange={e => setTarget(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleSearch(); }}
                  placeholder="일기 사용자 아이디 (예: 2026kcnc4319)" className="h-11" />
                <Button onClick={() => void handleSearch()} disabled={loading} className="h-11 px-5">
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <><Search className="h-4 w-4 mr-1.5" />조회</>}
                </Button>
              </div>
              {loading && (
                <p className="text-xs text-muted-foreground">
                  전체 기간을 훑는 중입니다. 일기가 많으면 시간이 걸립니다.
                </p>
              )}
            </div>

            {/* ── 3단계: 현황 + 견적 ──────────────────────────────── */}
            {stats && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StatCard title="일기 수" value={`${stats.renderable}편`}
                    icon={<BookOpen className="h-5 w-5" />}
                    subtitle={stats.renderable === 1 ? '1페이지' : `${stats.renderable}페이지`} />
                  <StatCard title="최초 작성일" value={stats.firstDate ?? '-'}
                    icon={<CalendarDays className="h-5 w-5" />} />
                  <StatCard title="최근 작성일" value={stats.lastDate ?? '-'}
                    icon={<CalendarClock className="h-5 w-5" />} />
                </div>

                {stats.skippedCount > 0 && (
                  <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">
                        일기 {stats.skippedCount}편은 인쇄할 수 없어 제외했습니다.
                      </p>
                      <p className="text-xs mt-1 text-amber-800">
                        마음신호등 값이 없거나 날짜 형식이 올바르지 않은 일기입니다.
                        전체 {stats.total}편 중 {stats.renderable}편이 인쇄 대상이며,
                        위 페이지 수와 가격은 인쇄되는 분량만 센 것입니다.
                      </p>
                    </div>
                  </div>
                )}

                {stats.monthly.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-border p-5 text-sm text-muted-foreground">
                    인쇄할 수 있는 일기가 없습니다.
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-border p-5 space-y-5">
                    {/* 인쇄 구간 */}
                    <div>
                      <p className="text-sm font-medium mb-3">인쇄할 구간</p>
                      <div className="flex items-center gap-2">
                        <Select value={range?.from} onValueChange={v => changeRange('from', v)}>
                          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {stats.monthly.map(m => (
                              <SelectItem key={m.ym} value={m.ym}>{formatYm(m.ym)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-muted-foreground shrink-0">~</span>
                        <Select value={range?.to} onValueChange={v => changeRange('to', v)}>
                          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {stats.monthly.map(m => (
                              <SelectItem key={m.ym} value={m.ym}>{formatYm(m.ym)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* 월별 분포 */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">월별 일기 수</p>
                      <div className="flex items-end gap-1 overflow-x-auto pb-1">
                        {monthsInRange.map(m => (
                          <div key={m.ym} className="flex flex-col items-center gap-1 shrink-0 w-9"
                            title={`${formatYm(m.ym)} ${m.count}편`}>
                            <span className="text-[10px] text-muted-foreground tabular">{m.count}</span>
                            <div className="w-5 rounded-t bg-primary/70"
                              style={{ height: `${Math.max(4, (m.count / (maxCount || 1)) * 48)}px` }} />
                            <span className="text-[10px] text-muted-foreground">
                              {m.ym.slice(2).replace('-', '.')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 견적 */}
                    {quoting ? (
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />견적 계산 중…
                      </p>
                    ) : quote && (
                      <div className="space-y-3">
                        {!quote.printable && quote.reason && (
                          <p className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                            {quote.reason}
                          </p>
                        )}
                        {quote.warnings.map((w, i) => (
                          <p key={i} className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                            {w}
                          </p>
                        ))}

                        {quote.volumes.length > 0 && (
                          <>
                            <div className="rounded-xl border border-border overflow-hidden">
                              {quote.volumes.map(v => (
                                <div key={v.volume}
                                  className="flex items-center justify-between px-4 py-3 border-b last:border-b-0 text-sm">
                                  <div>
                                    <span className="font-medium">{v.volume}권</span>
                                    <span className="text-muted-foreground ml-2">
                                      {formatYm(v.from)}
                                      {v.from !== v.to && ` ~ ${formatYm(v.to)}`}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <span className="tabular text-muted-foreground">{v.pages}p</span>
                                    <span className="tabular font-medium w-20 text-right">
                                      {v.price === null ? '—' : formatWon(v.price)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between text-muted-foreground">
                                <span>상품 금액 ({quote.volumes.length}권 · {quote.totalPages}페이지)</span>
                                <span className="tabular">{formatWon(quote.productTotal)}</span>
                              </div>
                              <div className="flex justify-between text-muted-foreground">
                                <span>배송비</span>
                                <span className="tabular">{formatWon(quote.shippingFee)}</span>
                              </div>
                              <div className="flex justify-between font-bold text-base pt-1 border-t">
                                <span>합계</span>
                                <span className="tabular">{formatWon(quote.grandTotal)}</span>
                              </div>
                            </div>
                          </>
                        )}

                        {/* 분책 경계 직접 지정 */}
                        {monthsInRange.length > 1 && (
                          <div className="pt-1">
                            <button onClick={() => setShowSplitEditor(v => !v)}
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
                              <Scissors className="h-3.5 w-3.5" />
                              분책 경계 직접 정하기
                              {splits.length > 0 && ` (${splits.length}곳 지정됨)`}
                            </button>
                            {showSplitEditor && (
                              <div className="mt-3 rounded-xl border border-border p-3">
                                <p className="text-xs text-muted-foreground mb-2">
                                  각 달 뒤에서 권을 나눕니다. 한 권은 36~300페이지여야 합니다.
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {monthsInRange.slice(0, -1).map(m => (
                                    <button key={m.ym} onClick={() => toggleSplit(m.ym)}
                                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                                        splits.includes(m.ym)
                                          ? 'bg-primary text-primary-foreground border-primary'
                                          : 'bg-background hover:bg-muted border-border'
                                      }`}>
                                      {m.ym.slice(2).replace('-', '.')} 뒤
                                    </button>
                                  ))}
                                </div>
                                {splits.length > 0 && (
                                  <button onClick={() => { setSplits([]); if (range) void refreshQuote(range, []); }}
                                    className="text-xs text-muted-foreground hover:text-foreground mt-2">
                                    자동 분권으로 되돌리기
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── 4단계: 생성 ──────────────────────────────── */}
                {quote?.printable && (
                  <div className="bg-white rounded-2xl border border-border p-5 space-y-4">
                    <Button onClick={() => void handleGenerate()}
                      disabled={generating || quoting} className="w-full h-12 text-base">
                      {generating
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{progress || '생성 중…'}</>
                        : <><FileText className="h-4 w-4 mr-2" />
                            PDF 만들기 ({quote.volumes.length}권 · {quote.totalPages}페이지)</>}
                    </Button>

                    {generating && (
                      <p className="text-xs text-muted-foreground text-center">
                        페이지가 많으면 한 권에 1분 가까이 걸릴 수 있습니다. 창을 닫지 마세요.
                      </p>
                    )}

                    {files.length > 0 && (
                      <div className="space-y-2">
                        {files.map(f => (
                          <a key={f.name} href={downloadUrl(f)}
                            className="flex items-center justify-between rounded-xl border border-border px-4 py-3 hover:bg-muted/50 transition-colors">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{f.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {f.pages}페이지 · {(f.bytes / 1024 / 1024).toFixed(1)}MB
                              </p>
                            </div>
                            <Download className="h-4 w-4 shrink-0 ml-3" />
                          </a>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          다운로드 링크는 30분 뒤 만료됩니다. 만료되면 다시 만들어 주세요.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
