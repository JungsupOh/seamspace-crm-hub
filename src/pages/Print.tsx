// /print — 일기 제본 PDF 생성 (관리자 전용)
//
// 흐름: 관리자 로그인 → 사용자 아이디 입력 → 일기 현황·견적 확인 → PDF 생성·다운로드
//
// /shop 처럼 공개 라우트지만, 심스페이스 일기 서버 관리자 계정으로만 들어올 수 있다.
// 서버(api/print/login.py)가 허용목록으로 한 번 더 거른다 — 일기 조회 API가 대상
// 사용자를 요청 본문의 username으로 정하기 때문에 화면 단속만으로는 부족하다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, CalendarClock, CalendarDays, CheckCircle2, Download, FileText, Loader2, LogOut, Scissors, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { formatPhone } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { StatCard } from '@/components/StatCard';
import {
  fetchStats, formatWon, formatYm, generateVolume, loadSession, login,
  requote, saveSession, SPLIT_MODE_LABEL,
  type DiaryStats, type GeneratedFile, type PrintSession, type Quote,
  estimateOrder, placeOrder,
  type SplitMode,
  type Vendor,
  type ShippingInput,
  type SweetbookEstimate,
  type PlacedOrder,
} from '@/lib/print';

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? '';

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
  // 자동 분권 방식 — 최저가(기본) / 균등. 분책 경계를 직접 지정하면 무시된다.
  const [splitMode, setSplitMode] = useState<SplitMode>('cheapest');
  // 제작 업체. 페이지 규칙과 단가가 다르므로 바꾸면 견적을 다시 계산한다.
  const [vendor, setVendor] = useState<Vendor>('ddukddak');
  // 비밀글 포함 여부. 기본 포함 — 본인 일기를 본인 책으로 만드는 것이므로.
  const [includeSecret, setIncludeSecret] = useState(true);
  // 로그인 계정 본인의 일기인지. 남의 일기면 비밀글 기본값과 안내 문구가 달라진다.
  const [isOwnDiary, setIsOwnDiary] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [showSplitEditor, setShowSplitEditor] = useState(false);

  // 생성
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [files, setFiles] = useState<GeneratedFile[]>([]);

  // 주문 — PDF 를 만들고 나면 스위트북 책이 이미 FINALIZED 로 올라가 있다.
  const [ordering, setOrdering] = useState(false);
  const [showShipping, setShowShipping] = useState(false);
  const [shipping, setShipping] = useState<ShippingInput>({
    recipientName: '', recipientPhone: '', postalCode: '', address1: '', address2: '', memo: '',
  });
  const [estimate, setEstimate] = useState<SweetbookEstimate | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const addressDetailRef = useRef<HTMLInputElement>(null);

  // 스위트북 책이 다 올라간 상태여야 주문할 수 있다
  const bookUids = files.map(f => f.book?.bookUid).filter(Boolean) as string[];
  const canOrder = vendor === 'sweetbook' && files.length > 0 && bookUids.length === files.length;

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
      const s = await fetchStats(session.token, target.trim(), splitMode, vendor);
      setStats(s);
      // 비밀글 기본값은 '포함'. 남의 일기를 뽑는 경우(슈퍼유저 권한)에도 기본은 같고,
      // 대신 안내 문구를 바꿔 포함 여부를 의식적으로 고르게 한다.
      setIsOwnDiary(
        s.username.trim().toLowerCase() === session.username.trim().toLowerCase(),
      );
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

  /** 구간·분책 경계·분권 방식이 바뀌면 견적만 다시 계산한다(일기 재조회 없음). */
  async function refreshQuote(
    next: { from: string; to: string }, nextSplits: string[], mode: SplitMode = splitMode,
    withSecret: boolean = includeSecret, nextVendor: Vendor = vendor,
  ) {
    if (!stats) return;
    setQuoting(true);
    setFiles([]);
    try {
      const inRange = nextSplits.filter(ym => ym >= next.from && ym <= next.to);
      // 비밀글을 빼면 월별 편수가 달라져 분권·가격이 모두 달라진다.
      // 서버가 두 집계를 다 내려주므로 일기를 다시 조회하지 않는다.
      const monthly = withSecret ? stats.monthly : (stats.monthlyPublic ?? stats.monthly);
      const q = await requote(
        monthly, next.from, next.to, inRange.length ? inRange : undefined, mode, nextVendor,
      );
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

  function changeSplitMode(mode: SplitMode) {
    if (mode === splitMode) return;
    setSplitMode(mode);
    // 분책 경계를 직접 지정한 상태면 자동 분권이 적용되지 않으므로 경계를 비운다.
    setSplits([]);
    if (range) void refreshQuote(range, [], mode);
  }

  function changeVendor(next: Vendor) {
    if (next === vendor) return;
    setVendor(next);
    // 업체마다 페이지 상한이 달라 분책 경계가 그대로면 범위를 벗어날 수 있다.
    setSplits([]);
    if (range) void refreshQuote(range, [], splitMode, includeSecret, next);
  }

  function changeIncludeSecret(next: boolean) {
    if (next === includeSecret) return;
    setIncludeSecret(next);
    if (range) void refreshQuote(range, splits, splitMode, next);
  }

  async function handleGenerate() {
    if (!session || !stats || !quote || !quote.printable) return;
    setGenerating(true);
    setFiles([]);
    const made: GeneratedFile[] = [];
    try {
      for (const v of quote.volumes) {
        setProgress(`${quote.volumes.length}권 중 ${v.volume}권 만드는 중… (${v.pages}페이지)`);
        const file = await generateVolume(
          session.token, stats.username, v.from, v.to, includeSecret, vendor,
          { volume: v.volume, volumeCount: quote.volumes.length, name: stats.name },
        );
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

  const PENDING_KEY = 'print_pending_order';

  /** Daum 우편번호 검색. /shop 과 같은 스크립트를 쓴다. */
  const openPostcode = () => {
    const daum = (window as unknown as { daum?: { Postcode?: unknown } }).daum;
    if (!daum?.Postcode) {
      const script = document.createElement('script');
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = () => openPostcode();
      document.head.appendChild(script);
      return;
    }
    new (window as unknown as {
      daum: { Postcode: new (o: { oncomplete: (d: { zonecode: string; address: string }) => void }) => { open: () => void } };
    }).daum.Postcode({
      oncomplete: (data) => {
        setShipping(p => ({ ...p, postalCode: data.zonecode, address1: data.address }));
        // 상세주소로 자연스럽게 넘어가게 포커스를 옮긴다
        setTimeout(() => addressDetailRef.current?.focus(), 50);
      },
    }).open();
  };

  /** 결제창을 띄우기 전에 원가(충전금 차감 예정액)를 확인한다. */
  async function openShipping() {
    if (!canOrder) return;
    setOrdering(true);
    try {
      const est = await estimateOrder(bookUids);
      setEstimate(est);
      if (!est.creditSufficient) {
        toast.error('스위트북 충전금이 부족합니다. 충전 후 다시 시도해 주세요.');
      }
      setShowShipping(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '견적 조회에 실패했습니다.');
    } finally {
      setOrdering(false);
    }
  }

  /**
   * Sandbox 전용 — 결제 없이 주문만 넣는다.
   * 책이 실제로 만들어지지 않는데 돈만 진짜로 빠지는 조합을 막기 위한 것이고,
   * 서버(order.py)에서도 같은 조건으로 막는다.
   */
  async function placeWithoutPayment() {
    const miss = (['recipientName', 'recipientPhone', 'postalCode', 'address1'] as const)
      .filter(k => !shipping[k].trim());
    if (miss.length) {
      toast.error('받는 분, 연락처, 우편번호, 주소를 입력해 주세요.');
      return;
    }
    setOrdering(true);
    try {
      const res = await placeOrder({ bookUids, shipping });
      setPlaced(res);
      setShowShipping(false);
      toast.success('테스트 주문이 접수되었습니다 (결제 없음).');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '주문에 실패했습니다.');
    } finally {
      setOrdering(false);
    }
  }

  /** 토스 결제창. 리다이렉트로 돌아오므로 주문에 필요한 값은 sessionStorage 에 둔다. */
  async function startPayment() {
    if (!quote || !stats) return;
    const miss = (['recipientName', 'recipientPhone', 'postalCode', 'address1'] as const)
      .filter(k => !shipping[k].trim());
    if (miss.length) {
      toast.error('받는 분, 연락처, 우편번호, 주소를 입력해 주세요.');
      return;
    }
    setOrdering(true);
    try {
      const orderId = `PRINT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        orderId, bookUids, shipping, amount: quote.grandTotal,
      }));

      if (!window.TossPayments) {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1';
        await new Promise((resolve, reject) => {
          script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
        });
      }
      const toss = window.TossPayments(TOSS_CLIENT_KEY);
      await toss.requestPayment('카드', {
        amount: quote.grandTotal,
        orderId,
        orderName: `일기 제본 ${quote.volumes.length}권 (${stats.name})`,
        customerName: shipping.recipientName,
        customerMobilePhone: shipping.recipientPhone.replace(/\D/g, ''),
        successUrl: `${window.location.origin}/print`,
        failUrl: `${window.location.origin}/print?payfail=1`,
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== 'USER_CANCEL') {
        toast.error('결제 창을 여는 중 오류가 발생했습니다.');
        console.error(e);
      }
      sessionStorage.removeItem(PENDING_KEY);
      setOrdering(false);
    }
  }

  /** 결제 후 돌아왔을 때 — 승인 + 제작 주문을 한 번에 처리한다. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payfail')) {
      toast.error('결제가 취소되었거나 실패했습니다.');
      sessionStorage.removeItem(PENDING_KEY);
      window.history.replaceState({}, '', '/print');
      return;
    }
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = params.get('amount');
    if (!paymentKey || !orderId || !amount) return;

    const raw = sessionStorage.getItem(PENDING_KEY);
    window.history.replaceState({}, '', '/print');
    if (!raw) {
      toast.error('주문 정보를 찾지 못했습니다. 결제 내역을 확인해 주세요.');
      return;
    }
    const pending = JSON.parse(raw) as {
      orderId: string; bookUids: string[]; shipping: ShippingInput; amount: number;
    };
    if (pending.orderId !== orderId) {
      toast.error('주문 정보가 일치하지 않습니다.');
      return;
    }

    setOrdering(true);
    placeOrder({
      bookUids: pending.bookUids,
      shipping: pending.shipping,
      paymentKey, orderId, amount: Number(amount),
    })
      .then(res => {
        sessionStorage.removeItem(PENDING_KEY);
        setPlaced(res);
        setShowShipping(false);
        toast.success('제작 주문이 접수되었습니다.');
      })
      .catch(e => {
        // 결제는 됐는데 주문이 실패했을 수 있다. 메시지를 지우지 않는다.
        toast.error(e instanceof Error ? e.message : '주문 처리에 실패했습니다.', { duration: 20000 });
      })
      .finally(() => setOrdering(false));
    // 최초 진입 시 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {/* 프리뷰 주소와 운영 주소가 눈으로 구분이 안 돼 옛 배포를 보고 있는 일이 잦다.
            임시 배포면 대놓고 알려 준다. */}
        {__BUILD_INFO__.env !== 'production' && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">임시 배포(프리뷰) 화면입니다.</p>
            <p className="text-xs mt-1">
              최신 기능은 운영 주소에서 확인하세요 —{' '}
              <a href="https://seamspace-crm-hub.vercel.app/print"
                className="underline font-medium">seamspace-crm-hub.vercel.app/print</a>
            </p>
          </div>
        )}
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

                        {/* 제작 업체 — 페이지 규칙과 단가가 다르다.
                            바꾸면 분권·금액이 모두 다시 계산된다. */}
                        {stats.vendors?.length > 1 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5">제작 업체</p>
                            <div className="grid grid-cols-2 gap-2">
                              {stats.vendors.map(v => {
                                const active = vendor === v.vendor;
                                return (
                                  <button key={v.vendor} type="button"
                                    onClick={() => changeVendor(v.vendor)}
                                    className={`relative rounded-xl border-2 p-3 text-left transition-all
                                      ${active ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/40'}`}>
                                    <p className="font-semibold text-sm">{v.label}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5 tabular">
                                      {v.pageMin}~{v.pageMax}p
                                      {v.pageIncrement > 1 && ` · ${v.pageIncrement}의 배수`}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground tabular">
                                      {formatWon(v.bands[0].price)}부터 · 배송 {formatWon(v.shippingFee)}
                                    </p>
                                    {active && <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 비밀글 — 본인 일기를 본인 책으로 만드는 것이므로 기본은 포함.
                            다만 책은 배송지로 가므로(부모가 사주는 경우가 많다) 끌 수 있어야 한다.
                            판별이 안 되는 상태면 선택지 자체를 막는다 — 끈 줄 알았는데
                            인쇄되는 것이 제일 나쁘다. */}
                        {stats.secret.count > 0 || stats.secret.unknown > 0 || !stats.secret.detectable ? (
                          <div className="rounded-xl border border-border p-3">
                            {stats.secret.detectable ? (
                              <>
                                <label className="flex items-start gap-2.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={includeSecret}
                                    onChange={e => changeIncludeSecret(e.target.checked)}
                                    className="mt-0.5 h-4 w-4 accent-primary"
                                  />
                                  <span className="text-sm">
                                    <span className="font-medium">비밀글 {stats.secret.count}편 포함</span>
                                    {stats.secret.unknown > 0 && (
                                      <span className="text-muted-foreground">
                                        {' '}(공개 여부를 알 수 없는 {stats.secret.unknown}편도 함께)
                                      </span>
                                    )}
                                    <span className={`block text-[11px] mt-0.5 ${isOwnDiary ? 'text-muted-foreground' : 'text-amber-700'}`}>
                                      {isOwnDiary
                                        ? '제작된 책은 배송지로 전달됩니다. 가족이 볼 수 있다는 점을 고려해 주세요.'
                                        : '본인이 아닌 사용자의 일기입니다. 비밀글은 혼자 보려고 쓴 글이므로, 본인 동의 없이 포함하지 마세요.'}
                                    </span>
                                  </span>
                                </label>
                                {!includeSecret && (
                                  <p className="text-[11px] text-muted-foreground mt-2 pl-6">
                                    {stats.secret.count + stats.secret.unknown}편을 빼고 계산했습니다.
                                    편수가 줄어 분권과 금액이 달라질 수 있습니다.
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-sm text-amber-900">
                                비밀글을 가려낼 수 없어 <span className="font-medium">전부 포함</span>해 만듭니다.
                                {stats.secret.observedFields.length > 0 && (
                                  <span className="block text-[11px] text-muted-foreground mt-1">
                                    응답에 들어온 필드: {stats.secret.observedFields.join(', ')}
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        ) : null}

                        {/* 분권 방식 — 두 안의 금액을 같이 보여주고 고르게 한다.
                            가격이 구간제라 '균등'이 '최저가'보다 비쌀 수 있다. */}
                        {(quote.options?.length ?? 0) > 1 && quote.options!.some(o => o.volumeCount > 1) && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1.5">분권 방식</p>
                            <div className="grid grid-cols-2 gap-2">
                              {quote.options!.map(opt => {
                                const active = splits.length === 0 && splitMode === opt.mode;
                                const cheapest = Math.min(
                                  ...quote.options!.filter(o => o.printable).map(o => o.grandTotal),
                                );
                                const diff = opt.grandTotal - cheapest;
                                return (
                                  <button key={opt.mode} type="button"
                                    disabled={!opt.printable}
                                    onClick={() => changeSplitMode(opt.mode)}
                                    className={`relative rounded-xl border-2 p-3 text-left transition-all disabled:opacity-50
                                      ${active ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/40'}`}>
                                    <p className="font-semibold text-sm">{SPLIT_MODE_LABEL[opt.mode]}</p>
                                    {opt.printable ? (
                                      <>
                                        <p className="text-[11px] text-muted-foreground mt-0.5 tabular">
                                          {opt.volumeCount}권 · {opt.pages.join(' / ')}p
                                        </p>
                                        <p className="text-sm font-bold mt-1 tabular">
                                          {formatWon(opt.grandTotal)}
                                          {diff > 0 && (
                                            <span className="text-[11px] font-normal text-amber-600 ml-1">
                                              +{formatWon(diff)}
                                            </span>
                                          )}
                                        </p>
                                      </>
                                    ) : (
                                      <p className="text-[11px] text-muted-foreground mt-0.5">사용 불가</p>
                                    )}
                                    {active && <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-primary" />}
                                  </button>
                                );
                              })}
                            </div>
                            {splits.length > 0 && (
                              <p className="text-[11px] text-muted-foreground mt-1.5">
                                분책 경계를 직접 지정해 두어 자동 분권이 적용되지 않습니다.
                              </p>
                            )}
                          </div>
                        )}

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
                                    <span className="tabular text-muted-foreground">
                                      {v.pages}p
                                      {v.blanks > 0 && (
                                        <span className="text-amber-600 ml-1">(빈 {v.blanks})</span>
                                      )}
                                    </span>
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

                        {/* 주문 — 스위트북 모드에서만. PDF 를 만들 때 책이 이미
                            FINALIZED 로 올라가 있어 여기서는 결제와 주문만 남는다. */}
                        {canOrder && !placed && !showShipping && (
                          <Button className="w-full h-12" onClick={openShipping} disabled={ordering}>
                            {ordering
                              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />금액 확인 중…</>
                              : <>주문하기 · {formatWon(quote?.grandTotal ?? 0)}</>}
                          </Button>
                        )}

                        {canOrder && !placed && showShipping && (
                          <div className="rounded-xl border border-border p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-sm">배송지</p>
                              {estimate && (
                                <span className={`text-[11px] rounded px-1.5 py-0.5 ${
                                  estimate.env === 'live'
                                    ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                                  {estimate.env === 'live' ? '운영 · 실제 제작·결제' : '테스트(Sandbox) · 결제 없음'}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <Input placeholder="받는 분 *" value={shipping.recipientName}
                                onChange={e => setShipping(p => ({ ...p, recipientName: e.target.value }))} />
                              <Input placeholder="연락처 *" inputMode="numeric"
                                value={shipping.recipientPhone}
                                onChange={e => setShipping(p => ({ ...p, recipientPhone: formatPhone(e.target.value) }))} />
                            </div>
                            <div className="flex gap-2">
                              <Input placeholder="우편번호 *" value={shipping.postalCode} readOnly
                                onClick={openPostcode} className="w-32 cursor-pointer bg-muted/40" />
                              <Button type="button" variant="outline" onClick={openPostcode}>
                                <Search className="h-4 w-4 mr-1.5" />우편번호 찾기
                              </Button>
                            </div>
                            <Input placeholder="주소 * (우편번호 찾기로 입력)" value={shipping.address1} readOnly
                              onClick={openPostcode} className="cursor-pointer bg-muted/40" />
                            <Input ref={addressDetailRef} placeholder="상세주소 (동·호수)" value={shipping.address2 ?? ''}
                              onChange={e => setShipping(p => ({ ...p, address2: e.target.value }))} />
                            <Input placeholder="배송 메모 (선택)" value={shipping.memo ?? ''}
                              onChange={e => setShipping(p => ({ ...p, memo: e.target.value }))} />

                            {estimate?.env === 'live' && (
                              <p className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-800">
                                운영 환경입니다. 결제가 <b>실제로 승인</b>되고 책이 <b>인쇄·배송</b>됩니다.
                              </p>
                            )}
                            {estimate && (
                              <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">결제 금액 (판매가)</span>
                                  <span className="tabular font-medium">{formatWon(quote?.grandTotal ?? 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">제작 원가 (충전금 차감)</span>
                                  <span className="tabular">{formatWon(estimate.paidCreditAmount)}</span>
                                </div>
                                <div className="flex justify-between border-t pt-1 mt-1">
                                  <span className="text-muted-foreground">충전금 잔액</span>
                                  <span className={`tabular ${estimate.creditSufficient ? '' : 'text-red-600 font-medium'}`}>
                                    {formatWon(estimate.creditBalance)}
                                    {!estimate.creditSufficient && ' (부족)'}
                                  </span>
                                </div>
                              </div>
                            )}

                            <div className="flex gap-2">
                              <Button variant="outline" className="flex-1"
                                onClick={() => setShowShipping(false)} disabled={ordering}>취소</Button>
                              <Button className="flex-[2]"
                                onClick={estimate?.env === 'live' ? startPayment : placeWithoutPayment}
                                disabled={ordering || !estimate?.creditSufficient}>
                                {ordering
                                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />처리 중…</>
                                  : estimate?.env === 'live'
                                    ? <>결제하고 주문 · {formatWon(quote?.grandTotal ?? 0)}</>
                                    : <>테스트 주문 (결제 없음)</>}
                              </Button>
                            </div>
                          </div>
                        )}

                        {placed && (
                          <div className="rounded-xl border-2 border-teal-200 bg-teal-50/50 p-4 space-y-2">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-5 w-5 text-teal-600" />
                              <p className="font-medium text-sm">제작 주문 접수됨</p>
                              {placed.env !== 'live' && (
                                <span className="text-[11px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-800">
                                  테스트(Sandbox)
                                </span>
                              )}
                            </div>
                            <div className="text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">주문번호</span>
                                <span className="font-mono">{placed.order.orderUid}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">상태</span>
                                <span>{placed.order.orderStatusDisplay}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">결제</span>
                                <span className="tabular">{formatWon(placed.payment.totalAmount)}</span>
                              </div>
                            </div>
                            {placed.payment.receiptUrl && (
                              <a href={placed.payment.receiptUrl} target="_blank" rel="noreferrer"
                                className="text-xs text-primary underline">영수증 보기</a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <p className="text-center text-[11px] text-muted-foreground pt-2">
          빌드 {__BUILD_INFO__.sha} · {__BUILD_INFO__.env} · {__BUILD_INFO__.at}
        </p>
      </main>
    </div>
  );
}
