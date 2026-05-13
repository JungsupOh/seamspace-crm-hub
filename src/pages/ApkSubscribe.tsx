// 공개 신청 폼 — 심스페이스 Android 앱 (APK) 메일링 리스트 등록
// 학교명은 NEIS 검색 결과에서만 선택 가능 (자유입력 차단)
// 등록 즉시 최신 버전 메일 발송 (Edge Function apk-subscribe)

import { useState, useEffect, useRef } from 'react';
import { Loader2, Search, CheckCircle2, AlertCircle, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhone } from '@/lib/utils';
import { searchSchools, type SchoolInfo } from '@/lib/neis';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export default function ApkSubscribe() {
  const [email, setEmail] = useState('');
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null);
  const [schoolResults, setSchoolResults] = useState<SchoolInfo[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const schoolRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [memo, setMemo] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 학교 검색 (디바운스)
  const handleSchoolSearch = (q: string) => {
    setSchoolQuery(q);
    setSchoolInfo(null);  // 입력 변경 시 선택 무효화
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (q.trim().length < 2) { setSchoolResults([]); setShowSchoolDropdown(false); return; }
    setSchoolSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchSchools(q);
        setSchoolResults(results);
        setShowSchoolDropdown(results.length > 0);
      } catch {
        setSchoolResults([]);
      } finally {
        setSchoolSearching(false);
      }
    }, 300);
  };

  const selectSchool = (s: SchoolInfo) => {
    setSchoolInfo(s);
    setSchoolQuery(s.name);
    setShowSchoolDropdown(false);
  };

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (schoolRef.current && !schoolRef.current.contains(e.target as Node)) {
        setShowSchoolDropdown(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      alert('이메일을 정확히 입력해 주세요.'); return;
    }
    if (!schoolInfo) {
      alert('학교명을 검색해서 선택해 주세요. (자유 입력 불가)'); return;
    }
    if (!contactName.trim()) {
      alert('담당자명을 입력해 주세요.'); return;
    }
    if (!consent) {
      alert('약관 및 개인정보 수집 동의가 필요합니다.'); return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/apk-subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          email: email.trim(),
          school_name: schoolInfo.name,
          school_code: null,  // neis.ts SchoolInfo에 코드 미포함 (kind만 보존)
          school_kind: schoolInfo.kind,
          contact_name: contactName.trim(),
          phone: phone.trim() || null,
          memo: memo.trim() || null,
          consent: true,
        }),
      });
      const data = await r.json() as { ok: boolean; message: string };
      setResult(data);
    } catch (e) {
      setResult({ ok: false, message: '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-md w-full bg-card rounded-xl p-8 text-center shadow-lg ring-1 ring-border">
          <CheckCircle2 className="h-16 w-16 text-teal-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">등록이 완료되었습니다</h1>
          <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">{result.message}</p>
          <p className="text-xs text-muted-foreground">
            문의: info@tebahsoft.com
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 py-6 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border bg-gradient-to-br from-indigo-50 to-purple-50">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="h-5 w-5 text-indigo-600" />
            <h1 className="text-xl font-semibold">심스페이스 Android 앱 구독 신청</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Google Play 접근이 차단된 MDM 환경에서 사용하실 학교 IT 담당자분을 위한 sideload 패키지 안내 채널입니다.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">이메일 <span className="text-destructive">*</span></Label>
            <Input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@school.kr" type="email" className="h-10 text-sm" />
          </div>

          <div ref={schoolRef} className="relative space-y-1.5">
            <Label className="text-xs">
              학교명 <span className="text-destructive">*</span>
              <span className="text-muted-foreground ml-1">(NEIS 검색 결과에서 선택)</span>
            </Label>
            <div className="relative">
              <Input
                value={schoolQuery}
                onChange={e => handleSchoolSearch(e.target.value)}
                onFocus={() => { if (schoolResults.length > 0 && !schoolInfo) setShowSchoolDropdown(true); }}
                placeholder="학교명 입력 (2자 이상)"
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
            {!schoolInfo && schoolQuery && !schoolSearching && (
              <p className="text-[10px] text-amber-700">
                ⚠ 학교명을 검색 결과에서 선택해 주세요. 자유 입력으로는 신청이 불가합니다.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">담당자명 <span className="text-destructive">*</span></Label>
            <Input value={contactName} onChange={e => setContactName(e.target.value)}
              placeholder="홍길동" className="h-10 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">연락처 (선택)</Label>
            <Input value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
              placeholder="010-0000-0000" type="tel" className="h-10 text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">메모 (선택)</Label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)}
              placeholder="MDM 환경 / 학년·반 등 참고 사항"
              rows={2}
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2" />
          </div>

          <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-border">
            <input type="checkbox" checked={consent}
              onChange={e => setConsent(e.target.checked)}
              className="mt-0.5 accent-primary" />
            <span className="text-xs text-muted-foreground">
              앱 배포 안내를 받기 위해 입력한 정보(이메일·학교명·담당자명·연락처)의 수집 및 이용에 동의합니다.
              언제든 메일의 '구독 취소' 링크로 수신을 중단할 수 있습니다.
            </span>
          </label>

          {result && !result.ok && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2 text-xs text-rose-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{result.message}</span>
            </div>
          )}

          <Button className="w-full h-11" disabled={submitting} onClick={handleSubmit}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />등록 중...</> : '신청하기'}
          </Button>

          <p className="text-[10px] text-muted-foreground text-center pt-1">
            문의: info@tebahsoft.com
          </p>
        </div>
      </div>
    </div>
  );
}
