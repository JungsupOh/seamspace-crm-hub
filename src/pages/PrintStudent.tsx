// 고객용 — 본인이 직접 자기 일기책을 주문한다. (/shop/print/student)
//
// 관리자용 /print 와 달리 **남의 일기는 볼 수 없다**. 로그인할 때 서버가 아이디를
// 세션에 서명해 묶고, 이후 요청에서 아이디를 아예 받지 않는다.
//
// 단계: 로그인 → 장수 확인 → 기간·분권 → 배송지 → 최종확인·결제
// 입력이 많은 흐름이라 마법사로 나눈다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, BookOpen, Loader2, Lock, Package, Truck, CreditCard, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhone } from '@/lib/utils';
import {
  customerLogin, fetchCustomerStats, fetchPreview, prepareBooks, placeCustomerOrder,
  loadCustomerSession, saveCustomerSession,
  type CustomerSession, type CustomerStats, type PreviewResult, type PreparedOrder,
} from '@/lib/print-customer';
import {
  formatWon, formatYm, requote, SPLIT_MODE_LABEL,
  type Quote, type ShippingInput, type SplitMode,
} from '@/lib/print';

const STEPS = ['로그인', '내 글 확인', '기간·분권', '배송지', '결제'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY ?? '';
/** 결제창을 거치면 페이지가 새로 뜬다. 완료 페이지가 주문을 마저 넣도록 넘겨 둔다. */
export const PENDING_KEY = 'print_student_pending';

const nanoid = (n = 16) =>
  crypto.getRandomValues(new Uint8Array(n)).reduce((s, b) => s + (b & 63).toString(36), '');

type TossWindow = Window & {
  TossPayments?: (key: string) => {
    requestPayment: (method: string, opts: Record<string, unknown>) => Promise<void>;
  };
};

export default function PrintStudent() {
  const navigate = useNavigate();
  const [step, setStep] = useState<StepIndex>(0);

  // ① 로그인
  const [session, setSession] = useState<CustomerSession | null>(() => loadCustomerSession());
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  // ② 통계
  const [stats, setStats] = useState<CustomerStats | null>(null);
  const [includeSecret, setIncludeSecret] = useState(true);

  // ③ 기간·분권
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [mode, setMode] = useState<SplitMode>('cheapest');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // ④ 배송지
  const [shipping, setShipping] = useState<ShippingInput>({
    recipientName: '', recipientPhone: '', postalCode: '', address1: '', address2: '', memo: '',
  });
  const addrDetailRef = useRef<HTMLInputElement>(null);

  // ⑤ 결제
  const [prepared, setPrepared] = useState<PreparedOrder | null>(null);
  const [placing, setPlacing] = useState(false);

  // 세션이 살아 있으면 로그인 단계를 건너뛴다
  useEffect(() => {
    if (session && step === 0) void loadStats(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthly = useMemo(
    () => (includeSecret ? stats?.monthly : stats?.monthlyPublic ?? stats?.monthly) ?? [],
    [stats, includeSecret],
  );

  // ── 단계별 동작 ────────────────────────────────
  async function handleLogin() {
    if (!id.trim() || !pw) { toast.error('아이디와 비밀번호를 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const s = await customerLogin(id.trim(), pw);
      setSession(s);
      saveCustomerSession(s);
      setPw('');
      await loadStats(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '로그인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function loadStats(s: CustomerSession) {
    setBusy(true);
    try {
      const st = await fetchCustomerStats(s.session, mode);
      setStats(st);
      // 비밀글을 가려낼 수 없으면 '제외' 선택지를 주면 안 된다 — 끄더라도 안 빠진다.
      if (!st.secret.detectable) setIncludeSecret(true);
      const last = st.monthly[st.monthly.length - 1];
      if (last) setRange({ from: st.monthly[0].ym, to: last.ym });
      setStep(1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '조회에 실패했습니다.';
      toast.error(msg);
      if (/로그인/.test(msg)) logout();
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setSession(null); saveCustomerSession(null);
    setStats(null); setQuote(null); setPreview(null); setPrepared(null);
    setStep(0);
  }

  async function refreshQuote(next: { from: string; to: string }, nextMode = mode) {
    if (!monthly.length) return;
    setQuoting(true);
    try {
      const q = await requote(monthly, next.from, next.to, undefined, nextMode, 'sweetbook');
      setQuote(q);
      setPrepared(null);        // 구간이 바뀌면 이미 만든 책은 쓸 수 없다
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '견적 계산에 실패했습니다.');
    } finally {
      setQuoting(false);
    }
  }

  async function loadPreview() {
    if (!session || !range) return;
    setPreviewing(true);
    try {
      setPreview(await fetchPreview(session.session, range.from, range.to, includeSecret));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '미리보기를 만들지 못했습니다.');
    } finally {
      setPreviewing(false);
    }
  }

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
        setTimeout(() => addrDetailRef.current?.focus(), 50);
      },
    }).open();
  };

  /** 책을 만들어 두고 결제 단계로. 여기까지는 과금되지 않는다. */
  async function handlePrepare() {
    if (!session || !quote?.printable) return;
    setBusy(true);
    try {
      const p = await prepareBooks(session.session, quote.volumes, includeSecret);
      setPrepared(p);
      setStep(4);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '책 만들기에 실패했습니다.', { duration: 15000 });
    } finally {
      setBusy(false);
    }
  }

  /**
   * 결제 → 주문.
   *
   * 결제가 열려 있으면(운영) 토스 결제창을 띄우고, 승인 결과를 들고 완료 페이지가
   * 주문을 넣는다. Sandbox 는 서버가 결제를 거부하므로 결제 없이 바로 주문한다 —
   * 테스트가 막히지 않으면서 실결제도 안 일어난다.
   */
  async function handleOrder() {
    if (!session || !prepared) return;
    setPlacing(true);
    try {
      // 완료 페이지가 이어받을 정보. 결제창을 거치면 페이지가 새로 뜬다.
      const pending = {
        session: session.session,
        bookTicket: prepared.bookTicket,
        shipping,
        includeSecret,
        amount: prepared.totalAmount,
        name: session.name || session.username,
        books: prepared.books,
      };
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

      if (!prepared.paymentEnabled) {
        const res = await placeCustomerOrder({
          session: session.session,
          bookTicket: prepared.bookTicket,
          shipping,
          includeSecret,
        });
        sessionStorage.removeItem(PENDING_KEY);
        saveCustomerSession(null);
        navigate('/shop/print/student/complete', { state: { order: res, name: pending.name } });
        return;
      }

      if (!TOSS_CLIENT_KEY) {
        toast.error('결제 설정이 없습니다. 고객센터로 문의해 주세요.');
        return;
      }
      if (!(window as TossWindow).TossPayments) {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1';
        await new Promise((resolve, reject) => {
          script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
        });
      }
      const volumes = prepared.books.length;
      await (window as TossWindow).TossPayments!(TOSS_CLIENT_KEY).requestPayment('카드', {
        amount: prepared.totalAmount,
        orderId: `PRINT-${nanoid()}`,
        orderName: `나의 이야기 출력${volumes > 1 ? ` ${volumes}권` : ''}`,
        customerName: shipping.recipientName,
        customerMobilePhone: shipping.recipientPhone.replace(/\D/g, ''),
        successUrl: `${window.location.origin}/shop/print/student/complete`,
        failUrl: `${window.location.origin}/shop/print/student/fail`,
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'USER_CANCEL') {
        toast.error(e instanceof Error ? e.message : '주문에 실패했습니다.', { duration: 20000 });
      }
    } finally {
      setPlacing(false);
    }
  }

  const shippingReady =
    shipping.recipientName.trim() && shipping.recipientPhone.trim()
    && shipping.postalCode.trim() && shipping.address1.trim();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2.5">
          <Link to="/shop/diary" className="flex items-center gap-2.5 min-w-0">
            <img src="/logo2.png" alt="Seamspace" className="h-7 w-auto" />
            <span className="font-semibold text-sm truncate">나의 이야기 출력</span>
          </Link>
          {session && (
            <button onClick={logout} className="ml-auto text-xs text-muted-foreground hover:underline">
              {session.name || session.username}님 · 로그아웃
            </button>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Stepper step={step} />

        {step === 0 && (
          <Section icon={<Lock className="h-4 w-4" />} title="마음일기 계정으로 로그인">
            <p className="text-sm text-muted-foreground mb-4">
              내가 쓴 일기로 책을 만듭니다. 평소 쓰던 마음일기 아이디로 로그인해 주세요.
              <span className="block mt-1">다른 사람의 일기는 볼 수 없습니다.</span>
            </p>
            <div className="space-y-3 max-w-sm">
              <div>
                <Label htmlFor="id">아이디</Label>
                <Input id="id" value={id} onChange={e => setId(e.target.value)} autoComplete="username" />
              </div>
              <div>
                <Label htmlFor="pw">비밀번호</Label>
                <Input id="pw" type="password" value={pw} autoComplete="current-password"
                  onChange={e => setPw(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleLogin(); }} />
              </div>
              <Button onClick={handleLogin} disabled={busy} className="w-full">
                {busy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />확인 중…</> : '로그인'}
              </Button>
            </div>
          </Section>
        )}

        {step === 1 && stats && (
          <Section icon={<BookOpen className="h-4 w-4" />} title="내가 쓴 글">
            <p className="text-lg">
              <b>{stats.name || stats.username}</b>님이 쓰신 글은{' '}
              <b className="text-primary">{stats.renderable}편</b>입니다.
            </p>
            {stats.firstDate && (
              <p className="text-sm text-muted-foreground mt-1">
                {stats.firstDate} ~ {stats.lastDate}
              </p>
            )}

            <MonthBars monthly={stats.monthly} />

            {stats.secret.detectable && stats.secret.count + stats.secret.unknown > 0 && (
              <label className="flex items-start gap-2.5 cursor-pointer mt-5 rounded-lg border p-3 bg-amber-50/60">
                <input type="checkbox" checked={includeSecret} className="mt-0.5 h-4 w-4 accent-primary"
                  onChange={e => { setIncludeSecret(e.target.checked); setQuote(null); setPreview(null); setPrepared(null); }} />
                <span className="text-sm">
                  <span className="font-medium">비밀글 {stats.secret.count}편도 책에 넣기</span>
                  {stats.secret.unknown > 0 && (
                    <span className="text-muted-foreground"> (공개 여부를 알 수 없는 {stats.secret.unknown}편 포함)</span>
                  )}
                  <span className="block text-[11px] text-muted-foreground mt-1">
                    만든 책은 배송지로 배달됩니다. 가족이 볼 수 있다는 점을 생각해 주세요.
                  </span>
                </span>
              </label>
            )}

            <Nav
              onNext={() => { setStep(2); if (range) void refreshQuote(range); }}
              nextLabel="기간 고르기"
              disabled={stats.renderable < stats.vendor.minDiaries}
              hint={stats.renderable < stats.vendor.minDiaries
                ? `책으로 만들려면 글이 ${stats.vendor.minDiaries}편 이상 필요합니다.`
                : undefined}
            />
          </Section>
        )}

        {step === 2 && stats && (
          <Section icon={<Package className="h-4 w-4" />} title="인쇄할 기간 고르기">
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <MonthSelect label="시작" months={monthly.map(m => m.ym)} value={range?.from}
                onChange={v => { const r = { from: v, to: range?.to ?? v }; setRange(r); setPreview(null); void refreshQuote(r); }} />
              <MonthSelect label="끝" months={monthly.map(m => m.ym)} value={range?.to}
                onChange={v => { const r = { from: range?.from ?? v, to: v }; setRange(r); setPreview(null); void refreshQuote(r); }} />
            </div>

            {quoting && <p className="text-sm text-muted-foreground mt-4"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" />계산 중…</p>}

            {quote && !quoting && (
              <div className="mt-5 space-y-4">
                {!quote.printable && quote.reason && (
                  <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">{quote.reason}</p>
                )}

                {quote.volumes.length > 1 && (
                  <div className="rounded-lg border p-3">
                    <p className="text-sm font-medium mb-2">
                      글이 많아 {quote.volumes.length}권으로 나눠 만듭니다
                    </p>
                    <div className="flex gap-2">
                      {(['cheapest', 'balanced'] as SplitMode[]).map(m => (
                        <button key={m} onClick={() => { setMode(m); if (range) void refreshQuote(range, m); }}
                          className={`flex-1 rounded-md border px-3 py-2 text-sm ${mode === m ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/40'}`}>
                          {SPLIT_MODE_LABEL[m]}로 나누기
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {quote.volumes.length > 0 && (
                  <div className="rounded-lg border divide-y">
                    {quote.volumes.map(v => (
                      <div key={v.volume} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>
                          {quote.volumes.length > 1 && <b className="mr-1.5">{v.volume}권</b>}
                          {formatYm(v.from)} ~ {formatYm(v.to)}
                          <span className="text-muted-foreground"> · {v.pages}페이지</span>
                        </span>
                        <span className="tabular-nums">{v.price != null ? formatWon(v.price) : '-'}</span>
                      </div>
                    ))}
                    <div className="px-3 py-2 text-sm flex justify-between text-muted-foreground">
                      <span>배송비</span><span className="tabular-nums">{formatWon(quote.shippingFee)}</span>
                    </div>
                    <div className="px-3 py-2.5 flex justify-between font-semibold">
                      <span>결제 금액</span><span className="tabular-nums">{formatWon(quote.grandTotal)}</span>
                    </div>
                  </div>
                )}

                <div>
                  <Button variant="outline" size="sm" onClick={loadPreview} disabled={previewing || !quote.printable}>
                    {previewing ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />만드는 중…</>
                      : <><Eye className="h-4 w-4 mr-1" />미리보기</>}
                  </Button>
                  {preview && <Preview preview={preview} />}
                </div>
              </div>
            )}

            <Nav onPrev={() => setStep(1)} onNext={() => setStep(3)}
              nextLabel="배송지 입력" disabled={!quote?.printable} />
          </Section>
        )}

        {step === 3 && (
          <Section icon={<Truck className="h-4 w-4" />} title="배송지">
            <div className="space-y-3 max-w-lg">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>받는 분</Label>
                  <Input value={shipping.recipientName}
                    onChange={e => setShipping(p => ({ ...p, recipientName: e.target.value }))} />
                </div>
                <div>
                  <Label>연락처</Label>
                  <Input value={shipping.recipientPhone} inputMode="numeric" placeholder="010-0000-0000"
                    onChange={e => setShipping(p => ({ ...p, recipientPhone: formatPhone(e.target.value) }))} />
                </div>
              </div>
              <div>
                <Label>우편번호</Label>
                <div className="flex gap-2">
                  <Input value={shipping.postalCode} readOnly onClick={openPostcode}
                    className="w-32 cursor-pointer bg-muted/40" />
                  <Button type="button" variant="outline" onClick={openPostcode}>우편번호 찾기</Button>
                </div>
              </div>
              <div>
                <Label>주소</Label>
                <Input value={shipping.address1} readOnly onClick={openPostcode} className="cursor-pointer bg-muted/40" />
              </div>
              <div>
                <Label>상세주소</Label>
                <Input ref={addrDetailRef} value={shipping.address2 ?? ''}
                  onChange={e => setShipping(p => ({ ...p, address2: e.target.value }))} />
              </div>
              <div>
                <Label>배송 메모 <span className="text-muted-foreground font-normal">(선택)</span></Label>
                <Input value={shipping.memo ?? ''}
                  onChange={e => setShipping(p => ({ ...p, memo: e.target.value }))} />
              </div>
            </div>
            <Nav onPrev={() => setStep(2)} onNext={handlePrepare}
              nextLabel={busy ? '책 만드는 중…' : '주문 내용 확인'}
              disabled={!shippingReady || busy} />
          </Section>
        )}

        {step === 4 && prepared && (
          <Section icon={<CreditCard className="h-4 w-4" />} title="주문 확인">
            <div className="rounded-lg border divide-y text-sm">
              {prepared.books.map(b => (
                <div key={b.volume} className="flex justify-between px-3 py-2">
                  <span>
                    {prepared.books.length > 1 && <b className="mr-1.5">{b.volume}권</b>}
                    {formatYm(b.from)} ~ {formatYm(b.to)}
                    <span className="text-muted-foreground"> · {b.pages}페이지</span>
                  </span>
                  <span className="tabular-nums">
                    {formatWon(prepared.items.find(i => i.volume === b.volume)?.price ?? 0)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between px-3 py-2 text-muted-foreground">
                <span>배송비</span><span className="tabular-nums">{formatWon(prepared.shippingFee)}</span>
              </div>
              <div className="flex justify-between px-3 py-2.5 font-semibold text-base">
                <span>결제 금액</span><span className="tabular-nums">{formatWon(prepared.totalAmount)}</span>
              </div>
            </div>

            <div className="rounded-lg border p-3 mt-4 text-sm">
              <p className="font-medium mb-1">배송지</p>
              <p>{shipping.recipientName} · {shipping.recipientPhone}</p>
              <p className="text-muted-foreground">
                ({shipping.postalCode}) {shipping.address1} {shipping.address2}
              </p>
              {shipping.memo && <p className="text-muted-foreground mt-1">메모: {shipping.memo}</p>}
            </div>

            <p className="text-[11px] text-muted-foreground mt-3">
              제작·배송에는 영업일 기준 약 10일이 걸립니다. 주문 후에는 내용을 바꿀 수 없습니다.
            </p>

            <Nav onPrev={() => setStep(3)} onNext={handleOrder}
              nextLabel={placing ? '주문 중…' : '주문하기'} disabled={placing} />
          </Section>
        )}
      </main>
    </div>
  );
}

// ── 조각들 ──────────────────────────────────────────
function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1 text-[11px]">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1 flex-1">
          <span className={`h-6 w-6 shrink-0 rounded-full grid place-items-center font-medium
            ${i < step ? 'bg-primary/15 text-primary' : i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {i + 1}
          </span>
          <span className={`truncate ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>{label}</span>
          {i < STEPS.length - 1 && <span className="flex-1 h-px bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold mb-4">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Nav({ onPrev, onNext, nextLabel, disabled, hint }: {
  onPrev?: () => void; onNext: () => void; nextLabel: string; disabled?: boolean; hint?: string;
}) {
  return (
    <div className="mt-6 pt-4 border-t">
      {hint && <p className="text-sm text-amber-800 mb-3">{hint}</p>}
      <div className="flex gap-2 justify-end">
        {onPrev && (
          <Button variant="outline" onClick={onPrev}>
            <ArrowLeft className="h-4 w-4 mr-1" />이전
          </Button>
        )}
        <Button onClick={onNext} disabled={disabled}>
          {nextLabel}<ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function MonthSelect({ label, months, value, onChange }: {
  label: string; months: string[]; value?: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
        {months.map(m => <option key={m} value={m}>{formatYm(m)}</option>)}
      </select>
    </div>
  );
}

function MonthBars({ monthly }: { monthly: { ym: string; count: number }[] }) {
  const max = monthly.reduce((a, m) => Math.max(a, m.count), 1);
  return (
    <div className="mt-4 flex items-end gap-1 h-24 overflow-x-auto">
      {monthly.map(m => (
        <div key={m.ym} className="flex flex-col items-center gap-1 min-w-[26px]" title={`${formatYm(m.ym)} ${m.count}편`}>
          <span className="text-[9px] text-muted-foreground tabular-nums">{m.count}</span>
          <div className="w-4 rounded-sm bg-primary/70" style={{ height: `${Math.max(4, (m.count / max) * 64)}px` }} />
          <span className="text-[9px] text-muted-foreground">{m.ym.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/** 표지와 앞 2페이지만. 나머지는 생략임을 같은 크기 카드로 분명히 알린다. */
function Preview({ preview }: { preview: PreviewResult }) {
  return (
    <div className="mt-3">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {preview.cover && <PreviewCard src={preview.cover} caption="표지" />}
        {preview.pages.map((src, i) => <PreviewCard key={i} src={src} caption={`${i + 1}페이지`} />)}
        {preview.truncated && (
          <div className="shrink-0 w-[148px] aspect-[148/210] rounded-lg border-2 border-dashed
                          grid place-items-center text-center px-3 bg-muted/30">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <b className="block text-foreground mb-1">{preview.shownPages + 1}페이지부터는</b>
              미리보기에서 생략됩니다
              <span className="block mt-1.5">전체 {preview.totalPages}페이지</span>
            </p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        실제 책은 전체 {preview.totalPages}페이지입니다. 미리보기는 앞부분만 보여 드립니다.
      </p>
    </div>
  );
}

function PreviewCard({ src, caption }: { src: string; caption: string }) {
  return (
    <figure className="shrink-0">
      <img src={src} alt={caption} className="w-[148px] aspect-[148/210] object-cover rounded-lg border shadow-sm" />
      <figcaption className="text-[11px] text-center text-muted-foreground mt-1">{caption}</figcaption>
    </figure>
  );
}
