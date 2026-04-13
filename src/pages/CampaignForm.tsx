// 공개 캠페인 신청 폼 — 로그인 불필요
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { formatPhone } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, CheckCircle2, AlertTriangle } from 'lucide-react';
import { searchSchools, type SchoolInfo } from '@/lib/neis';
import { notifyCampaignLead } from '@/lib/telegram';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

interface Campaign {
  id: string;
  name: string;
  title?: string;
  description?: string;
  image_url?: string;
  slug?: string;
  start_date?: string;
  end_date?: string;
  status: 'active' | 'ended' | 'planned';
}

const SOURCE_OPTIONS = ['대면연수', '온라인연수', '전시회(행사)참가', '지인추천', '기타'];

export default function CampaignForm() {
  const { slug } = useParams<{ slug: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 폼 필드
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null);
  const [schoolResults, setSchoolResults] = useState<SchoolInfo[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const schoolRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [position, setPosition] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [sourceEtc, setSourceEtc] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);

  // 1. 캠페인 로드
  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    fetch(`${SUPABASE_URL}/rest/v1/campaigns?slug=eq.${encodeURIComponent(slug)}&select=*`, { headers: HEADERS })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Campaign[]) => {
        if (rows.length === 0) setNotFound(true);
        else setCampaign(rows[0]);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // 2. 학교 검색 (디바운스)
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

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (schoolRef.current && !schoolRef.current.contains(e.target as Node)) {
        setShowSchoolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 3. 기존 고객 판별: contacts에서 phone_normalized 매칭 + campaign_licenses에서 contact_phone 매칭
  const checkExistingCustomer = async (phoneNorm: string): Promise<boolean> => {
    try {
      const [contactsRes, licsRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/contacts?phone_normalized=eq.${encodeURIComponent(phoneNorm)}&select=contact_type`, { headers: HEADERS }),
        fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses?contact_phone=ilike.*${encodeURIComponent(phoneNorm)}*&select=id`, { headers: HEADERS }),
      ]);
      const contacts = contactsRes.ok ? await contactsRes.json() : [];
      const lics = licsRes.ok ? await licsRes.json() : [];
      // 구매고객이거나, 체험권 수령 이력이 있으면 기존 고객
      const isPurchased = Array.isArray(contacts) && contacts.some((c: { contact_type?: string }) => c.contact_type === '구매고객');
      const hasTrialHistory = Array.isArray(lics) && lics.length > 0;
      return isPurchased || hasTrialHistory;
    } catch { return false; }
  };

  // 4. 폼 제출
  const handleSubmit = async () => {
    if (!campaign) return;
    if (!schoolInfo && !schoolQuery.trim()) { alert('학교명을 입력해주세요.'); return; }
    if (!position.trim()) { alert('담당업무를 입력해주세요.'); return; }
    if (!name.trim()) { alert('성함을 입력해주세요.'); return; }
    if (!phone.trim()) { alert('연락처를 입력해주세요.'); return; }
    if (!source) { alert('체험권 소개받으신 경로를 선택해주세요.'); return; }
    if (source === '기타' && !sourceEtc.trim()) { alert('기타 경로를 직접 입력해주세요.'); return; }

    setSubmitting(true);
    try {
      const phoneNorm = phone.replace(/\D/g, '');
      const isExisting = await checkExistingCustomer(phoneNorm);

      const payload = {
        campaign_id:           campaign.id,
        school_name:           schoolInfo?.name || schoolQuery.trim(),
        school_code:           null,
        school_kind:           schoolInfo?.kind || null,
        position:              position.trim(),
        name:                  name.trim(),
        phone:                 phone,
        phone_normalized:      phoneNorm,
        email:                 email.trim() || null,
        source:                source,
        source_etc:            source === '기타' ? sourceEtc.trim() : null,
        marketing_consent:     marketingConsent,
        status:                '신규',
        is_existing_customer:  isExisting,
      };

      const res = await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads`, {
        method: 'POST',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('제출 실패');

      // 텔레그램 알림
      notifyCampaignLead({
        campaignName: campaign.name,
        schoolName: payload.school_name,
        name: payload.name,
        phone: payload.phone,
        position: payload.position,
        source: payload.source === '기타' ? `기타 — ${payload.source_etc ?? ''}` : payload.source,
        isExistingCustomer: isExisting,
      });

      setSubmitted(true);
    } catch {
      alert('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 렌더링 ─────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !campaign) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-2">캠페인을 찾을 수 없습니다</h1>
          <p className="text-sm text-muted-foreground">주소가 올바른지 확인해주세요.</p>
        </div>
      </div>
    );
  }

  if (campaign.status === 'ended') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          {campaign.image_url && <img src={campaign.image_url} alt="" className="max-w-[200px] mx-auto mb-4 rounded" />}
          <h1 className="text-xl font-semibold mb-2">⏰ 종료된 캠페인입니다</h1>
          <p className="text-sm text-muted-foreground mb-1">
            이 캠페인은 {campaign.end_date || '이미'} 종료되었습니다.
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            다른 캠페인에 관심이 있으시면 문의 바랍니다.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">신청이 완료되었습니다</h1>
          <p className="text-sm text-muted-foreground mb-4">
            입력하신 연락처로 이용권이 발송될 예정입니다.
            <br />잠시만 기다려주세요!
          </p>
          <p className="text-xs text-muted-foreground">
            문의: contact@seamspace.co.kr
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 py-6 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        {/* 상단 이미지 */}
        {campaign.image_url && (
          <div className="bg-muted/10">
            <img src={campaign.image_url} alt={campaign.name} className="w-full h-auto" />
          </div>
        )}

        {/* 타이틀 + 설명 */}
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <h1 className="text-xl font-semibold">{campaign.title || campaign.name}</h1>
          {campaign.description && (
            <p className="text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap">{campaign.description}</p>
          )}
        </div>

        {/* 폼 */}
        <div className="px-6 py-5 space-y-4">
          {/* 학교명 (NEIS) */}
          <div ref={schoolRef} className="relative space-y-1.5">
            <Label className="text-xs">학교명 <span className="text-destructive">*</span></Label>
            <div className="relative">
              <Input
                value={schoolQuery}
                onChange={e => handleSchoolSearch(e.target.value)}
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
                  <button key={i} type="button" onClick={() => selectSchool(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
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

          {/* 담당업무 */}
          <div className="space-y-1.5">
            <Label className="text-xs">담당업무 <span className="text-destructive">*</span></Label>
            <Input value={position} onChange={e => setPosition(e.target.value)}
              placeholder="예: 담임, 생활부, 상담교사" className="h-10 text-sm" />
          </div>

          {/* 성함 */}
          <div className="space-y-1.5">
            <Label className="text-xs">성함 <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="홍길동" className="h-10 text-sm" />
          </div>

          {/* 연락처 */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              연락처 <span className="text-destructive">*</span>
              <span className="text-muted-foreground ml-1">(알림톡으로 쿠폰이 발송됩니다)</span>
            </Label>
            <Input value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
              placeholder="010-0000-0000" type="tel" className="h-10 text-sm" />
          </div>

          {/* 이메일 */}
          <div className="space-y-1.5">
            <Label className="text-xs">이메일</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com" type="email" className="h-10 text-sm" />
          </div>

          {/* 소개받으신 경로 */}
          <div className="space-y-1.5">
            <Label className="text-xs">체험권 소개받으신 경로 <span className="text-destructive">*</span></Label>
            <div className="space-y-2">
              {SOURCE_OPTIONS.map(opt => (
                <label key={opt} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="source" value={opt} checked={source === opt}
                    onChange={() => setSource(opt)} className="accent-primary" />
                  <span className="text-sm">{opt}</span>
                </label>
              ))}
            </div>
            {source === '기타' && (
              <Input value={sourceEtc} onChange={e => setSourceEtc(e.target.value)}
                placeholder="경로를 직접 입력해주세요" className="h-9 text-sm mt-2" />
            )}
          </div>

          {/* 마케팅 동의 */}
          <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-border">
            <input type="checkbox" checked={marketingConsent}
              onChange={e => setMarketingConsent(e.target.checked)}
              className="mt-0.5 accent-primary" />
            <span className="text-xs text-muted-foreground">
              마케팅 정보 수신에 동의합니다. 신제품·이벤트·할인 안내 메시지를 받아보실 수 있습니다. (선택)
            </span>
          </label>

          {/* 제출 */}
          <Button className="w-full h-11" disabled={submitting} onClick={handleSubmit}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />제출 중...</> : '신청하기'}
          </Button>

          <p className="text-[10px] text-muted-foreground text-center pt-1">
            입력하신 정보는 체험권 발송과 안내 목적으로만 사용됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
