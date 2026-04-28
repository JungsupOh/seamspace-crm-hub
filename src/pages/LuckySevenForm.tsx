// 럭키세븐 이벤트 공개 신청 폼 — 4-step 마법사
// /event/lucky-seven
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { formatPhone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, CheckCircle2, AlertTriangle, Plus, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import { searchSchools, type SchoolInfo } from '@/lib/neis';
import { notifyLuckySevenGroup } from '@/lib/telegram';
import {
  fetchLuckySevenCampaign,
  submitLuckySevenGroup,
  validatePaymentGroups,
  isValidEmail,
  normalizePhone,
  LS_UNIT_PRICE,
  type LSMemberInput,
  type LSPaymentGroupInput,
} from '@/lib/luckySeven';
import { issueQuoteForPaymentGroup } from '@/lib/luckySevenEmail';

const SOURCE_OPTIONS = ['대면연수', '온라인연수', '전시회(행사)참가', '지인추천', '기타'];
const MIN_MEMBERS = 7;
const MAX_MEMBERS = 10;

type PaymentMode = 'leader_all' | 'each_alone' | 'custom';

interface MemberRow {
  schoolName: string;
  name: string;
  phone: string;
  email: string;
}

interface PaymentGroupDraft {
  payerName: string;
  payerPhone: string;
  payerEmail: string;
  taxInvoiceRequired: boolean;
  buyerOrgName: string;
  buyerBusinessNo: string;
  buyerOrgAddr: string;
  buyerOrgCeo: string;
  buyerContact: string;
  memberIndices: number[];
}

function emptyMember(): MemberRow {
  return { schoolName: '', name: '', phone: '', email: '' };
}

function emptyPaymentGroup(memberIndices: number[]): PaymentGroupDraft {
  return {
    payerName: '',
    payerPhone: '',
    payerEmail: '',
    taxInvoiceRequired: false,
    buyerOrgName: '',
    buyerBusinessNo: '',
    buyerOrgAddr: '',
    buyerOrgCeo: '',
    buyerContact: '',
    memberIndices,
  };
}

export default function LuckySevenForm() {
  const slug = 'lucky-seven';
  const [campaign, setCampaign] = useState<{ id: string; name: string; title?: string; description?: string; image_url?: string; end_date?: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState<{ groupCode: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [step, setStep] = useState(1);

  // ── Step 1: 대표자 ──
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null);
  const [schoolResults, setSchoolResults] = useState<SchoolInfo[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const schoolRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [position, setPosition] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [leaderPhone, setLeaderPhone] = useState('');
  const [leaderEmail, setLeaderEmail] = useState('');
  const [source, setSource] = useState('');
  const [sourceEtc, setSourceEtc] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);

  // ── Step 2: 멤버 ──
  // 0번이 대표자 (Step 1에서 자동 채움)
  const [members, setMembers] = useState<MemberRow[]>(() => {
    const arr: MemberRow[] = [];
    for (let i = 0; i < MIN_MEMBERS; i++) arr.push(emptyMember());
    return arr;
  });

  // ── Step 3: 결제 묶음 ──
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('leader_all');
  const [paymentGroups, setPaymentGroups] = useState<PaymentGroupDraft[]>([]);

  // ── 캠페인 로드 ──
  useEffect(() => {
    fetchLuckySevenCampaign(slug)
      .then((row) => {
        if (!row) setNotFound(true);
        else setCampaign(row);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, []);

  // ── 학교 검색 (디바운스) ──
  const handleSchoolSearch = useCallback((query: string) => {
    setSchoolQuery(query);
    setSchoolInfo(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) {
      setSchoolResults([]);
      setShowSchoolDropdown(false);
      return;
    }
    setSchoolSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchSchools(query);
        setSchoolResults(results.slice(0, 20));
        setShowSchoolDropdown(true);
      } catch {
        setSchoolResults([]);
      } finally {
        setSchoolSearching(false);
      }
    }, 300);
  }, []);

  const selectSchool = (s: SchoolInfo) => {
    setSchoolInfo(s);
    setSchoolQuery(s.name);
    setShowSchoolDropdown(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (schoolRef.current && !schoolRef.current.contains(e.target as Node)) {
        setShowSchoolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Step 1 → Step 2: 대표자 정보를 0번 멤버에 동기화 ──
  useEffect(() => {
    setMembers((prev) => {
      const next = [...prev];
      next[0] = {
        schoolName: schoolInfo?.name || schoolQuery.trim(),
        name: leaderName,
        phone: leaderPhone,
        email: leaderEmail,
      };
      return next;
    });
  }, [schoolInfo, schoolQuery, leaderName, leaderPhone, leaderEmail]);

  // ── 멤버 조작 ──
  const addMember = () => {
    if (members.length >= MAX_MEMBERS) return;
    setMembers((prev) => [...prev, emptyMember()]);
  };
  const removeMember = (idx: number) => {
    if (idx === 0) return; // 대표자 삭제 불가
    if (members.length <= MIN_MEMBERS) return;
    setMembers((prev) => prev.filter((_, i) => i !== idx));
  };
  const updateMember = (idx: number, patch: Partial<MemberRow>) => {
    setMembers((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  // ── 결제 묶음 자동 생성 (모드 변경 시) ──
  useEffect(() => {
    if (step !== 3) return;
    if (paymentMode === 'leader_all') {
      const all = members.map((_, i) => i);
      setPaymentGroups([
        {
          ...emptyPaymentGroup(all),
          payerName: members[0]?.name || '',
          payerPhone: members[0]?.phone || '',
          payerEmail: members[0]?.email || '',
        },
      ]);
    } else if (paymentMode === 'each_alone') {
      setPaymentGroups(
        members.map((m, i) => ({
          ...emptyPaymentGroup([i]),
          payerName: m.name,
          payerPhone: m.phone,
          payerEmail: m.email,
        })),
      );
    } else {
      // custom: 빈 묶음 1개로 시작
      setPaymentGroups([emptyPaymentGroup([])]);
    }
  }, [paymentMode, step]);  // members는 의존성 X — 모드 변경 시에만 리셋

  const updatePaymentGroup = (idx: number, patch: Partial<PaymentGroupDraft>) => {
    setPaymentGroups((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const togglePaymentGroupMember = (groupIdx: number, memberIdx: number) => {
    setPaymentGroups((prev) => {
      const next = prev.map((g, gi) => {
        if (gi === groupIdx) {
          const has = g.memberIndices.includes(memberIdx);
          return {
            ...g,
            memberIndices: has ? g.memberIndices.filter((m) => m !== memberIdx) : [...g.memberIndices, memberIdx].sort((a, b) => a - b),
          };
        }
        // 다른 묶음에서 제거 (한 멤버는 한 묶음만)
        return { ...g, memberIndices: g.memberIndices.filter((m) => m !== memberIdx) };
      });
      return next;
    });
  };

  const addCustomPaymentGroup = () => {
    setPaymentGroups((prev) => [...prev, emptyPaymentGroup([])]);
  };
  const removeCustomPaymentGroup = (idx: number) => {
    setPaymentGroups((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Step 검증 ──
  function validateStep1(): string | null {
    if (!schoolInfo && !schoolQuery.trim()) return '학교명을 입력해주세요.';
    if (!position.trim()) return '담당업무를 입력해주세요.';
    if (!leaderName.trim()) return '성함을 입력해주세요.';
    if (!leaderPhone.trim()) return '연락처를 입력해주세요.';
    if (!leaderEmail.trim() || !isValidEmail(leaderEmail)) return '이메일이 유효하지 않습니다.';
    if (!source) return '체험권 소개받으신 경로를 선택해주세요.';
    if (source === '기타' && !sourceEtc.trim()) return '기타 경로를 직접 입력해주세요.';
    return null;
  }

  function validateStep2(): string | null {
    if (members.length < MIN_MEMBERS) return `최소 ${MIN_MEMBERS}명이 필요합니다.`;
    if (members.length > MAX_MEMBERS) return `최대 ${MAX_MEMBERS}명까지 가능합니다.`;
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const label = `${i + 1}번 선생님`;
      if (!m.schoolName.trim()) return `${label}: 소속(학교명)을 입력해주세요.`;
      if (!m.name.trim()) return `${label}: 이름을 입력해주세요.`;
      if (!m.phone.trim()) return `${label}: 휴대폰을 입력해주세요.`;
      if (!m.email.trim() || !isValidEmail(m.email)) return `${label}: 이메일이 유효하지 않습니다.`;
      const ph = normalizePhone(m.phone);
      if (phones.has(ph)) return `${label}: 휴대폰이 다른 멤버와 중복됩니다.`;
      phones.add(ph);
      const em = m.email.trim().toLowerCase();
      if (emails.has(em)) return `${label}: 이메일이 다른 멤버와 중복됩니다.`;
      emails.add(em);
    }
    return null;
  }

  function validateStep3(): string | null {
    const inputs: LSPaymentGroupInput[] = paymentGroups.map((g) => ({
      payerName: g.payerName,
      payerPhone: g.payerPhone,
      payerEmail: g.payerEmail,
      buyerOrgName: g.taxInvoiceRequired ? g.buyerOrgName || null : null,
      buyerBusinessNo: g.taxInvoiceRequired ? g.buyerBusinessNo || null : null,
      buyerOrgAddr: g.taxInvoiceRequired ? g.buyerOrgAddr || null : null,
      buyerOrgCeo: g.taxInvoiceRequired ? g.buyerOrgCeo || null : null,
      buyerContact: g.taxInvoiceRequired ? g.buyerContact || null : null,
      taxInvoiceRequired: g.taxInvoiceRequired,
      memberIndices: g.memberIndices,
    }));
    const err = validatePaymentGroups(members.length, inputs);
    if (err) return err;
    for (const g of paymentGroups) {
      if (g.taxInvoiceRequired) {
        if (!g.buyerOrgName.trim()) return '세금계산서 발급을 선택한 묶음의 인수자명을 입력해주세요.';
        if (!g.buyerBusinessNo.trim()) return '세금계산서 발급을 선택한 묶음의 사업자등록번호를 입력해주세요.';
      }
    }
    return null;
  }

  function validateStep4(): string | null {
    if (!privacyConsent) return '개인정보 수집·이용에 동의해주세요.';
    return null;
  }

  const goNext = () => {
    let err: string | null = null;
    if (step === 1) err = validateStep1();
    else if (step === 2) err = validateStep2();
    else if (step === 3) err = validateStep3();
    if (err) {
      alert(err);
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // ── 제출 ──
  const handleSubmit = async () => {
    const err = validateStep4();
    if (err) {
      alert(err);
      return;
    }
    if (!campaign) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const memberInputs: LSMemberInput[] = members.map((m) => ({
        name: m.name.trim(),
        phone: m.phone.trim(),
        email: m.email.trim(),
        schoolName: m.schoolName.trim(),
      }));
      const pgInputs: LSPaymentGroupInput[] = paymentGroups.map((g) => ({
        payerName: g.payerName.trim(),
        payerPhone: g.payerPhone.trim(),
        payerEmail: g.payerEmail.trim(),
        buyerOrgName: g.taxInvoiceRequired ? g.buyerOrgName.trim() || null : null,
        buyerBusinessNo: g.taxInvoiceRequired ? g.buyerBusinessNo.trim() || null : null,
        buyerOrgAddr: g.taxInvoiceRequired ? g.buyerOrgAddr.trim() || null : null,
        buyerOrgCeo: g.taxInvoiceRequired ? g.buyerOrgCeo.trim() || null : null,
        buyerContact: g.taxInvoiceRequired ? g.buyerContact.trim() || null : null,
        taxInvoiceRequired: g.taxInvoiceRequired,
        memberIndices: g.memberIndices,
      }));

      const result = await submitLuckySevenGroup(
        {
          campaignId: campaign.id,
          leader: {
            schoolName: schoolInfo?.name || schoolQuery.trim(),
            schoolCode: null,
            schoolKind: schoolInfo?.kind || null,
            position: position.trim(),
            name: leaderName.trim(),
            phone: leaderPhone.trim(),
            email: leaderEmail.trim(),
            source,
            sourceEtc: source === '기타' ? sourceEtc.trim() : null,
            marketingConsent,
          },
          members: memberInputs,
        },
        pgInputs,
      );

      // 견적서 PDF 생성 + Storage 업로드 + 이메일 발송 (묶음별)
      for (const pg of result.paymentGroups) {
        const pgMembers = result.leads.filter((l) => l.ls_payment_group_id === pg.id);
        try {
          await issueQuoteForPaymentGroup({
            group: result.group,
            paymentGroup: pg,
            members: pgMembers,
            leaderName: leaderName.trim(),
            leaderSchoolName: schoolInfo?.name || schoolQuery.trim(),
          });
        } catch (e) {
          console.warn('견적서 발송 실패 (묶음)', pg.quote_number, e);
          // 일부 묶음 실패는 어드민에서 재발송으로 복구 가능 — 그룹 신청 자체는 성공으로 처리
        }
      }

      // 그룹 status='견적발송'으로 업데이트
      try {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
        const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_groups?id=eq.${result.group.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ status: '견적발송' }),
        });
      } catch { /* 무시 */ }

      // 텔레그램 알림
      notifyLuckySevenGroup({
        groupCode: result.group.group_code,
        campaignName: campaign.name,
        leaderName: leaderName.trim(),
        leaderSchoolName: schoolInfo?.name || schoolQuery.trim(),
        memberCount: members.length,
        paymentGroupCount: result.paymentGroups.length,
        totalAmount: result.group.total_amount,
      });

      setSubmitted({ groupCode: result.group.group_code });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '제출 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 렌더 ──
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-muted/20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (notFound || !campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">이벤트를 찾을 수 없습니다</h1>
          <p className="text-sm text-muted-foreground">잠시 후 다시 시도해주세요.</p>
        </div>
      </div>
    );
  }

  if (campaign.status === 'ended') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          {campaign.image_url && <img src={campaign.image_url} alt="" className="max-w-[200px] mx-auto mb-4 rounded" />}
          <h1 className="text-xl font-semibold mb-2">⏰ 종료된 이벤트입니다</h1>
          <p className="text-sm text-muted-foreground">이 이벤트는 {campaign.end_date || '이미'} 종료되었습니다.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">신청이 완료되었습니다 🎉</h1>
          <p className="text-sm text-muted-foreground mb-3">그룹 코드</p>
          <p className="text-2xl font-mono font-bold text-foreground mb-4 tracking-wider">{submitted.groupCode}</p>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            각 결제자분 이메일로 견적서가 발송되었습니다.<br />
            견적서의 <strong>"결제하러 가기"</strong> 버튼으로 결제를 진행해 주세요.
          </p>
          <Link to={`/event/lucky-seven/status`}>
            <Button variant="outline" className="w-full">결제 진행 상황 조회</Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-4">문의: sales@tebahsoft.com</p>
        </div>
      </div>
    );
  }

  const total = members.length * LS_UNIT_PRICE;

  return (
    <div className="min-h-screen bg-muted/20 py-6 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        {/* 상단 이미지 */}
        {campaign.image_url && step === 1 && (
          <div className="bg-muted/10">
            <img src={campaign.image_url} alt={campaign.name} className="w-full h-auto" />
          </div>
        )}

        {/* 진행 표시기 */}
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-base font-semibold">{campaign.title || campaign.name}</h1>
            <span className="text-xs text-muted-foreground">Step {step} / 4</span>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-primary' : 'bg-muted'}`} />
            ))}
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* ── Step 1 — 대표자 선생님 ── */}
          {step === 1 && (
            <>
              {campaign.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-2">{campaign.description}</p>
              )}

              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <h2 className="text-sm font-semibold text-primary">👤 대표자 선생님 정보</h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  먼저 신청을 주도하시는 <strong>대표자 선생님</strong>의 정보를 입력해주세요. 다음 단계에서 함께 신청하실 동료 선생님을 추가하게 됩니다.
                </p>
              </div>

              <div ref={schoolRef} className="relative space-y-1.5">
                <Label className="text-xs">대표자 선생님 학교명 <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    value={schoolQuery}
                    onChange={(e) => handleSchoolSearch(e.target.value)}
                    onFocus={() => { if (schoolResults.length > 0) setShowSchoolDropdown(true); }}
                    placeholder="학교명을 입력하세요 (2자 이상)"
                    className="h-10 text-sm pr-9"
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    {schoolSearching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
                {showSchoolDropdown && schoolResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                    {schoolResults.map((s, i) => (
                      <button key={i} type="button" onClick={() => selectSchool(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.kind} · {s.eduOffice}</div>
                      </button>
                    ))}
                  </div>
                )}
                {schoolInfo && (
                  <p className="text-xs text-teal-700 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {schoolInfo.name} ({schoolInfo.kind})
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">대표자 선생님 담당업무 <span className="text-destructive">*</span></Label>
                <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="예: 담임, 생활부, 상담교사" className="h-10 text-sm" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">대표자 선생님 성함 <span className="text-destructive">*</span></Label>
                <Input value={leaderName} onChange={(e) => setLeaderName(e.target.value)} placeholder="홍길동" className="h-10 text-sm" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">대표자 선생님 연락처 <span className="text-destructive">*</span></Label>
                <Input value={leaderPhone} onChange={(e) => setLeaderPhone(formatPhone(e.target.value))} placeholder="010-0000-0000" type="tel" className="h-10 text-sm" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">대표자 선생님 이메일 <span className="text-destructive">*</span></Label>
                <Input value={leaderEmail} onChange={(e) => setLeaderEmail(e.target.value)} placeholder="email@example.com" type="email" className="h-10 text-sm" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">유입 경로 <span className="text-destructive">*</span></Label>
                <div className="space-y-2">
                  {SOURCE_OPTIONS.map((opt) => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="source" value={opt} checked={source === opt} onChange={() => setSource(opt)} className="accent-primary" />
                      <span className="text-sm">{opt}</span>
                    </label>
                  ))}
                </div>
                {source === '기타' && (
                  <Input value={sourceEtc} onChange={(e) => setSourceEtc(e.target.value)} placeholder="경로를 직접 입력해주세요" className="h-9 text-sm mt-2" />
                )}
              </div>
            </>
          )}

          {/* ── Step 2 — 멤버 ── */}
          {step === 2 && (
            <>
              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground leading-relaxed">
                대표자 포함 <strong className="text-foreground">{MIN_MEMBERS}~{MAX_MEMBERS}명</strong>의 동료 선생님 정보를 입력해주세요. 모든 멤버는 소속/이름/휴대폰/이메일이 필요합니다.
              </div>

              <div className="space-y-3">
                {members.map((m, idx) => (
                  <div key={idx} className={`rounded-lg border p-3 space-y-2 ${idx === 0 ? 'bg-primary/5 border-primary/30' : 'border-border'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">
                        {idx === 0 ? <span className="text-primary">대표자 선생님 (1번)</span> : `${idx + 1}번 선생님`}
                      </span>
                      {idx > 0 && members.length > MIN_MEMBERS && (
                        <button type="button" onClick={() => removeMember(idx)} className="text-destructive hover:opacity-80">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <Input
                      value={m.schoolName}
                      onChange={(e) => updateMember(idx, { schoolName: e.target.value })}
                      placeholder="소속 학교"
                      className="h-9 text-sm"
                      disabled={idx === 0}
                    />
                    <Input
                      value={m.name}
                      onChange={(e) => updateMember(idx, { name: e.target.value })}
                      placeholder="이름"
                      className="h-9 text-sm"
                      disabled={idx === 0}
                    />
                    <Input
                      value={m.phone}
                      onChange={(e) => updateMember(idx, { phone: formatPhone(e.target.value) })}
                      placeholder="010-0000-0000"
                      type="tel"
                      className="h-9 text-sm"
                      disabled={idx === 0}
                    />
                    <Input
                      value={m.email}
                      onChange={(e) => updateMember(idx, { email: e.target.value })}
                      placeholder="email@example.com"
                      type="email"
                      className="h-9 text-sm"
                      disabled={idx === 0}
                    />
                  </div>
                ))}
              </div>

              {members.length < MAX_MEMBERS && (
                <Button type="button" variant="outline" className="w-full" onClick={addMember}>
                  <Plus className="h-4 w-4 mr-2" /> 선생님 추가
                </Button>
              )}

              <div className="bg-primary/5 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">현재 {members.length}명</p>
                <p className="text-lg font-bold">{total.toLocaleString()}원</p>
                <p className="text-[10px] text-muted-foreground">1인당 {LS_UNIT_PRICE.toLocaleString()}원</p>
              </div>
            </>
          )}

          {/* ── Step 3 — 결제 묶음 ── */}
          {step === 3 && (
            <>
              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground leading-relaxed">
                결제는 어떻게 나누어 진행할까요? 견적서가 묶음 단위로 발급됩니다.
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer p-2 rounded-md hover:bg-muted/30">
                  <input type="radio" name="paymentMode" checked={paymentMode === 'leader_all'} onChange={() => setPaymentMode('leader_all')} className="mt-0.5 accent-primary" />
                  <span className="text-sm">대표자가 일괄 결제 <span className="text-xs text-muted-foreground">(1건)</span></span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer p-2 rounded-md hover:bg-muted/30">
                  <input type="radio" name="paymentMode" checked={paymentMode === 'each_alone'} onChange={() => setPaymentMode('each_alone')} className="mt-0.5 accent-primary" />
                  <span className="text-sm">각자 결제 <span className="text-xs text-muted-foreground">({members.length}건)</span></span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer p-2 rounded-md hover:bg-muted/30">
                  <input type="radio" name="paymentMode" checked={paymentMode === 'custom'} onChange={() => setPaymentMode('custom')} className="mt-0.5 accent-primary" />
                  <span className="text-sm">임의 묶음 <span className="text-xs text-muted-foreground">(예: 2~3명씩)</span></span>
                </label>
              </div>

              <div className="space-y-3 pt-2">
                {paymentGroups.map((pg, gi) => (
                  <div key={gi} className="rounded-lg border border-border p-3 space-y-2 bg-muted/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">결제 묶음 {gi + 1}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{pg.memberIndices.length}명 × {LS_UNIT_PRICE.toLocaleString()}원</span>
                        <span className="text-sm font-semibold">{(pg.memberIndices.length * LS_UNIT_PRICE).toLocaleString()}원</span>
                        {paymentMode === 'custom' && paymentGroups.length > 1 && (
                          <button type="button" onClick={() => removeCustomPaymentGroup(gi)} className="text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {paymentMode === 'custom' && (
                      <div className="grid grid-cols-2 gap-1 pt-1">
                        {members.map((m, mi) => {
                          const inThis = pg.memberIndices.includes(mi);
                          const inOther = !inThis && paymentGroups.some((g, gi2) => gi2 !== gi && g.memberIndices.includes(mi));
                          return (
                            <button
                              key={mi}
                              type="button"
                              disabled={inOther}
                              onClick={() => togglePaymentGroupMember(gi, mi)}
                              className={`text-[11px] px-2 py-1 rounded border ${inThis ? 'bg-primary text-primary-foreground border-primary' : inOther ? 'opacity-30 cursor-not-allowed' : 'border-border'}`}
                            >
                              {mi + 1}. {m.name || `(${mi + 1}번)`}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <Input value={pg.payerName} onChange={(e) => updatePaymentGroup(gi, { payerName: e.target.value })} placeholder="결제자 이름" className="h-9 text-sm" />
                    <Input value={pg.payerPhone} onChange={(e) => updatePaymentGroup(gi, { payerPhone: formatPhone(e.target.value) })} placeholder="결제자 휴대폰" type="tel" className="h-9 text-sm" />
                    <Input value={pg.payerEmail} onChange={(e) => updatePaymentGroup(gi, { payerEmail: e.target.value })} placeholder="결제자 이메일 (견적서 수신)" type="email" className="h-9 text-sm" />

                    <label className="flex items-center gap-2 cursor-pointer pt-1">
                      <input type="checkbox" checked={pg.taxInvoiceRequired} onChange={(e) => updatePaymentGroup(gi, { taxInvoiceRequired: e.target.checked })} className="accent-primary" />
                      <span className="text-xs">세금계산서 발급 / 사업자정보 입력</span>
                    </label>

                    {pg.taxInvoiceRequired && (
                      <div className="space-y-2 pt-1">
                        <Input value={pg.buyerOrgName} onChange={(e) => updatePaymentGroup(gi, { buyerOrgName: e.target.value })} placeholder="인수자명 (학교/교육청)" className="h-9 text-sm" />
                        <Input value={pg.buyerBusinessNo} onChange={(e) => updatePaymentGroup(gi, { buyerBusinessNo: e.target.value })} placeholder="사업자등록번호" className="h-9 text-sm" />
                        <Input value={pg.buyerOrgAddr} onChange={(e) => updatePaymentGroup(gi, { buyerOrgAddr: e.target.value })} placeholder="주소" className="h-9 text-sm" />
                        <Input value={pg.buyerOrgCeo} onChange={(e) => updatePaymentGroup(gi, { buyerOrgCeo: e.target.value })} placeholder="대표자" className="h-9 text-sm" />
                        <Input value={pg.buyerContact} onChange={(e) => updatePaymentGroup(gi, { buyerContact: e.target.value })} placeholder="담당자 (선택)" className="h-9 text-sm" />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {paymentMode === 'custom' && (
                <Button type="button" variant="outline" className="w-full" onClick={addCustomPaymentGroup}>
                  <Plus className="h-4 w-4 mr-2" /> 결제 묶음 추가
                </Button>
              )}
            </>
          )}

          {/* ── Step 4 — 확인 + 동의 ── */}
          {step === 4 && (
            <>
              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground leading-relaxed">
                신청 직후 각 결제자분 이메일로 견적서가 자동 발송됩니다. 견적서의 <strong>"결제하러 가기"</strong> 버튼으로 결제를 진행해 주세요.
              </div>

              <div className="rounded-lg border border-border p-3 space-y-2">
                <h3 className="text-sm font-semibold">📋 그룹 정보</h3>
                <div className="text-xs space-y-1">
                  <div>대표자 선생님: <strong>{leaderName}</strong> ({schoolInfo?.name || schoolQuery.trim()})</div>
                  <div>멤버 {members.length}명 / 총 {total.toLocaleString()}원</div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3 space-y-2">
                <h3 className="text-sm font-semibold">💳 결제 묶음 ({paymentGroups.length}건)</h3>
                {paymentGroups.map((g, gi) => (
                  <div key={gi} className="text-xs border-t border-border pt-2 first:border-0 first:pt-0">
                    <div><strong>{g.payerName}</strong> ({g.payerEmail})</div>
                    <div>멤버 {g.memberIndices.length}명 / {(g.memberIndices.length * LS_UNIT_PRICE).toLocaleString()}원 {g.taxInvoiceRequired && <span className="text-primary">· 세금계산서</span>}</div>
                  </div>
                ))}
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} className="mt-0.5 accent-primary" />
                <span className="text-xs text-muted-foreground">개인정보 수집·이용에 동의합니다. <span className="text-destructive">(필수)</span></span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} className="mt-0.5 accent-primary" />
                <span className="text-xs text-muted-foreground">마케팅 정보 수신에 동의합니다. (선택)</span>
              </label>

              {submitError && (
                <div className="bg-destructive/10 text-destructive text-xs rounded p-2">{submitError}</div>
              )}
            </>
          )}

          {/* ── 네비게이션 ── */}
          <div className="flex gap-2 pt-2 border-t border-border">
            {step > 1 && (
              <Button type="button" variant="outline" onClick={goBack} disabled={submitting} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-1" /> 뒤로
              </Button>
            )}
            {step < 4 ? (
              <Button type="button" onClick={goNext} className="flex-1">
                다음 <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" onClick={handleSubmit} disabled={submitting} className="flex-1">
                {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />제출 중...</> : '신청하기'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
