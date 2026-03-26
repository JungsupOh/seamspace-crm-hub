import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { Search, ChevronRight, RefreshCw, ExternalLink, Send, Download, Upload as UploadIcon, CheckCircle2, XCircle, Loader2, Info, Users, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getAllLicenses, updateLicenseStatus, updateLicenseDeal, attachCouponToDeal, deleteDealLicense, hideMdiaryCoupon, DealLicenseRecord, LicenseStatus, saveDealLicenses } from '@/lib/storage';
import { toast } from 'sonner';
import { useDeals } from '@/hooks/use-airtable';
import { airtable } from '@/lib/airtable';
import { ContactFields } from '@/types/airtable';
import * as XLSX from 'xlsx';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const STATUS_META: Record<LicenseStatus, { label: string; color: string }> = {
  대기:   { label: '대기',   color: 'bg-slate-100 text-slate-600'   },
  사용중: { label: '사용중', color: 'bg-teal-100 text-teal-700'    },
  만료:   { label: '만료',   color: 'bg-orange-100 text-orange-700' },
  이탈:   { label: '이탈',   color: 'bg-red-100 text-red-700'      },
  삭제:   { label: '삭제',   color: 'bg-zinc-100 text-zinc-400 line-through' },
};

const PIPELINE: LicenseStatus[] = ['대기', '사용중', '만료', '이탈', '삭제'];

// ── 이용권 발송 다이얼로그 ────────────────────────

type SendType = 'buyer' | 'trial';

interface Recipient {
  contact_name: string;
  contact_phone: string;
  org_name: string;
  duration: string;
  user_count: string;
  coupon_code: string;
  status: 'pending' | 'generating' | 'sending' | 'done' | 'error';
  error?: string;
}

async function apiCreateCoupon(description: string, duration: string, user_limit: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-coupon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ description, duration, user_limit }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '쿠폰 생성 실패');
  return data.coupon_code;
}

async function apiSendCoupon(r: Recipient, sendType: SendType): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-coupon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({
      first_name: r.contact_name,
      phone: r.contact_phone,
      coupon_code: r.coupon_code,
      user_limit: r.user_count,
      duration: r.duration,
      send_type: sendType,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '발송 실패');
}

function exportToExcel(recipients: Recipient[], fileName: string) {
  const rows = recipients.map(r => ({
    '휴대폰':     r.contact_phone,
    '고객명':     r.contact_name,
    '이용권코드': r.coupon_code,
    '학교/기관':  r.org_name,
    '기간(개월)': r.duration,
    '인원수':     r.user_count,
    '발송결과':   r.status === 'done' ? '성공' : `실패: ${r.error ?? ''}`,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '이용권발송');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

function downloadTemplate() {
  const ws = XLSX.utils.json_to_sheet([{ '휴대폰': '', '고객명': '', '이용권코드': '', '학교/기관': '', '기간(개월)': '12', '인원수': '40' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '이용권발송');
  XLSX.writeFile(wb, '이용권발송_템플릿.xlsx');
}

interface CouponSendDialogProps {
  open: boolean;
  onClose: () => void;
}

function CouponSendDialog({ open, onClose }: CouponSendDialogProps) {
  const { data: deals } = useDeals();
  const qc = useQueryClient();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sendType, setSendType] = useState<SendType>('buyer');
  const [selectedDealId, setSelectedDealId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 체험권 중복 체크: 고객 DB + 이력 (Airtable + deal_licenses + event_licenses)
  type ContactHistory = {
    name: string;
    lead_stage?: string;
    licenses: { type: '구매' | '체험'; label: string; date: string; status: string }[];
  };

  const { data: contactHistoryMap } = useQuery({
    queryKey: ['contacts_history'],
    queryFn: async () => {
      const [contacts, dealLics, eventLics, eventsRes] = await Promise.all([
        airtable.fetchAll<ContactFields>('01_Contacts'),
        fetch(`${SUPABASE_URL}/rest/v1/deal_licenses?select=contact_phone,org_name,status,created_at`,
          { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }).then(r => r.json()) as Promise<{ contact_phone: string; org_name: string; status: string; created_at: string }[]>,
        fetch(`${SUPABASE_URL}/rest/v1/event_licenses?select=contact_phone,org_name,status,created_at,event_id`,
          { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }).then(r => r.json()) as Promise<{ contact_phone: string; org_name: string; status: string; created_at: string; event_id: string }[]>,
        fetch(`${SUPABASE_URL}/rest/v1/events?select=id,name`,
          { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }).then(r => r.json()) as Promise<{ id: string; name: string }[]>,
      ]);

      const eventNameMap = new Map(eventsRes.map(e => [e.id, e.name]));
      const norm = (p: string) => p.replace(/\D/g, '');

      const map = new Map<string, ContactHistory>();

      contacts.forEach(c => {
        if (!c.fields.Phone) return;
        const key = norm(c.fields.Phone);
        map.set(key, { name: c.fields.Name ?? '', lead_stage: c.fields.Lead_Stage, licenses: [] });
      });

      dealLics.forEach(l => {
        if (!l.contact_phone) return;
        const key = norm(l.contact_phone);
        const entry = map.get(key);
        if (entry) entry.licenses.push({ type: '구매', label: l.org_name || '딜', date: l.created_at.slice(0, 10), status: l.status });
      });

      eventLics.forEach(l => {
        if (!l.contact_phone) return;
        const key = norm(l.contact_phone);
        const entry = map.get(key);
        if (entry) entry.licenses.push({ type: '체험', label: eventNameMap.get(l.event_id) || l.org_name || '이벤트', date: l.created_at.slice(0, 10), status: l.status });
      });

      return map;
    },
    enabled: open && sendType === 'trial',
  });

  const isDuplicate = (phone: string) =>
    sendType === 'trial' && !!phone && !!(contactHistoryMap?.has(phone.replace(/\D/g, '')));

  const duplicateCount = sendType === 'trial'
    ? recipients.filter(r => isDuplicate(r.contact_phone)).length
    : 0;

  const removeTrialDuplicates = () =>
    setRecipients(prev => prev.filter(r => !isDuplicate(r.contact_phone)));

  const importFromExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

        // 여러 컬럼명 형식 지원
        const pick = (row: Record<string, string>, ...keys: string[]) =>
          String(keys.map(k => row[k]).find(v => v !== undefined && v !== '') ?? '').trim();

        const parsed: Recipient[] = rows
          .filter(row => pick(row, '휴대폰', '메시지 수신 휴대폰 번호', 'Phone', '전화번호') ||
                         pick(row, '고객명', '#{고객명}', 'Name', '이름'))
          .map(row => ({
            contact_phone: pick(row, '휴대폰', '메시지 수신 휴대폰 번호', 'Phone', '전화번호'),
            contact_name:  pick(row, '고객명', '#{고객명}', 'Name', '이름').replace(/\s*선생님\s*$/, '').trim(),
            coupon_code:   pick(row, '이용권코드', '#{이용코드}', 'Code'),
            org_name:      pick(row, '학교/기관', '#{그룹이름}', '기관명', 'Org'),
            duration:      pick(row, '기간(개월)', '#{이용기간}', '기간') || '12',
            user_count:    pick(row, '인원수', '#{이용인원}', '인원') || '40',
            status: 'pending' as const,
          }));
        setRecipients(prev => [...prev, ...parsed]);
        toast.success(`${parsed.length}명 불러왔습니다`);
      } catch {
        toast.error('엑셀 파일을 읽을 수 없습니다');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // 이벤트 목록
  const { data: events } = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/events?order=created_at.desc`, {
        headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
      });
      return r.json() as Promise<{ id: string; name: string; status: string }[]>;
    },
    enabled: open,
  });

  const selectedEvent = events?.find(e => e.id === selectedEventId);

  const selectedDeal = deals?.find(d => d.id === selectedDealId);

  // 딜 선택 시 deal_licenses에서 수신자 자동 로드
  const loadRecipientsFromDeal = async (dealId: string) => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/deal_licenses?deal_id=eq.${dealId}&order=created_at.asc`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      const data: DealLicenseRecord[] = await res.json();
      setRecipients(data.map(r => ({
        contact_name:  r.contact_name || '',
        contact_phone: r.contact_phone || '',
        org_name:      r.org_name || '',
        duration:      r.duration || '12',
        user_count:    r.user_count || '40',
        coupon_code:   r.coupon_code || '',
        status: 'pending',
      })));
    } catch { toast.error('수신자 로드 실패'); }
  };

  const addEmptyRecipient = () => setRecipients(prev => [...prev, {
    contact_name: '', contact_phone: '', org_name: '',
    duration: '12', user_count: '40', coupon_code: '', status: 'pending',
  }]);

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  };

  const updateRecipient = (i: number, key: keyof Recipient, val: string) =>
    setRecipients(prev => prev.map((r, idx) =>
      idx === i ? { ...r, [key]: key === 'contact_phone' ? formatPhone(val) : val } : r
    ));

  const removeRecipient = (i: number) =>
    setRecipients(prev => prev.filter((_, idx) => idx !== i));

  const handleRun = async () => {
    setRunning(true);
    const baseName = sendType === 'buyer'
      ? (selectedDeal?.fields.Org_Name || '')
      : (selectedEvent?.name || '');
    const suffix = sendType === 'buyer' ? '구매이용권' : '체험이용권';

    const updated = [...recipients];

    for (let i = 0; i < updated.length; i++) {
      const r = updated[i];
      if (r.status === 'done') continue;

      // 수신자별 description: [기본명] [학교/기관(중복 제외)] [이름]
      const orgPart = r.org_name && r.org_name !== baseName ? r.org_name : null;
      const descParts = [baseName, orgPart, r.contact_name].filter(Boolean);
      const description = (descParts.length > 0 ? descParts.join(' ') : baseName) + ' ' + suffix;

      // 1. 쿠폰 생성 (코드가 이미 있으면 스킵)
      if (!r.coupon_code) {
        updated[i] = { ...r, status: 'generating' };
        setRecipients([...updated]);
        try {
          const code = await apiCreateCoupon(description, r.duration, r.user_count);
          updated[i] = { ...updated[i], coupon_code: code };
        } catch (e) {
          updated[i] = { ...updated[i], status: 'error', error: String(e) };
          setRecipients([...updated]);
          continue;
        }
      }

      // 2. 발송
      updated[i] = { ...updated[i], status: 'sending' };
      setRecipients([...updated]);
      try {
        await apiSendCoupon(updated[i], sendType);
        updated[i] = { ...updated[i], status: 'done' };
      } catch (e) {
        updated[i] = { ...updated[i], status: 'error', error: String(e) };
      }
      setRecipients([...updated]);

      // 3. 수신자 고객 자동 등록 (전화번호가 있고 발송 성공한 경우)
      if (updated[i].status === 'done' && updated[i].contact_phone) {
        try {
          const existing = await airtable.fetchAll<ContactFields>('01_Contacts', {
            filterByFormula: `{Phone} = "${updated[i].contact_phone}"`,
            maxRecords: '1',
          });
          if (existing.length === 0) {
            await airtable.createRecord<ContactFields>('01_Contacts', {
              Name:         updated[i].contact_name || undefined,
              Phone:        updated[i].contact_phone,
              Org_Name:     updated[i].org_name || undefined,
              Lead_Source:  'mDiary 이용권',
            });
          }
        } catch { /* 고객 등록 실패는 무시 */ }
      }
    }

    // 3a. deal_licenses 저장 (딜 타입이고 dealId 있을 때)
    if (sendType === 'buyer' && selectedDealId) {
      const records = updated
        .filter(r => r.status === 'done')
        .map(r => ({
          deal_id: selectedDealId,
          coupon_code: r.coupon_code,
          contact_name: r.contact_name,
          contact_phone: r.contact_phone,
          org_name: r.org_name,
          duration: r.duration,
          user_count: r.user_count,
          status: '대기' as LicenseStatus,
          service_expire_at: null,
        }));
      if (records.length > 0) {
        await saveDealLicenses(records).catch(() => {});
        qc.invalidateQueries({ queryKey: ['licenses'] });
      }
    }

    // 3b. event_licenses 저장 (체험 타입이고 eventId 있을 때)
    if (sendType === 'trial' && selectedEventId) {
      const rows = updated
        .filter(r => r.status === 'done')
        .map(r => ({
          event_id:      selectedEventId,
          coupon_code:   r.coupon_code,
          contact_name:  r.contact_name,
          contact_phone: r.contact_phone,
          org_name:      r.org_name,
          duration:      r.duration,
          user_count:    r.user_count,
          status:        '대기',
        }));
      if (rows.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/event_licenses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(rows),
        }).catch(() => {});
        qc.invalidateQueries({ queryKey: ['event_licenses', selectedEventId] });
        qc.invalidateQueries({ queryKey: ['events'] });
      }
    }

    setRunning(false);
  };

  const doneCount  = recipients.filter(r => r.status === 'done').length;
  const errorCount = recipients.filter(r => r.status === 'error').length;
  const fileName = sendType === 'buyer'
    ? `이용권발송_${selectedDeal?.fields.Org_Name || '딜'}`
    : `체험권발송_${selectedEvent?.name || '이벤트'}`;

  const reset = () => {
    setStep(1); setSendType('buyer'); setSelectedDealId('');
    setSelectedEventId(''); setRecipients([]); setRunning(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>이용권 생성 · 발송</DialogTitle>
        </DialogHeader>

        {/* Step 1: 유형 선택 */}
        {step === 1 && (
          <div className="space-y-6 py-2">
            <div className="space-y-2">
              <Label className="text-xs">발송 유형</Label>
              <div className="grid grid-cols-2 gap-3">
                {(['buyer', 'trial'] as SendType[]).map(t => (
                  <button key={t} onClick={() => setSendType(t)}
                    className={`rounded-lg border-2 p-4 text-left transition-colors
                      ${sendType === t ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80'}`}>
                    <p className="font-semibold">{t === 'buyer' ? '딜 발송' : '체험 발송'}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t === 'buyer' ? '딜과 연결된 구매이용권 발송 (TS_6206)' : '이벤트/무료체험 쿠폰 발송 (TS_6205)'}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {sendType === 'buyer' ? (
              <div className="space-y-2">
                <Label className="text-xs">딜 선택</Label>
                <Select value={selectedDealId} onValueChange={async v => {
                  setSelectedDealId(v);
                  await loadRecipientsFromDeal(v);
                }}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="딜을 선택하세요..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(deals ?? []).map(d => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.fields.Org_Name || d.fields.Deal_Name || d.id.slice(-8)}
                        {d.fields.Contract_Date && ` · ${d.fields.Contract_Date.slice(0, 10)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">이벤트 선택</Label>
                <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="이벤트를 선택하세요..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(events ?? []).map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(!events || events.length === 0) && (
                  <p className="text-xs text-muted-foreground">
                    이벤트가 없습니다. <a href="/trials" className="text-primary underline">이벤트 관리</a>에서 먼저 추가하세요.
                  </p>
                )}
              </div>
            )}

            <Button className="w-full"
              disabled={sendType === 'buyer' ? !selectedDealId : !selectedEventId}
              onClick={() => setStep(2)}>
              다음 — 수신자 확인
            </Button>
          </div>
        )}

        {/* Step 2: 수신자 목록 */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-medium">수신자 목록 ({recipients.length}명)</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <UploadIcon className="h-3.5 w-3.5 mr-1" />엑셀 업로드
                </Button>
                <Button size="sm" variant="ghost" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5 mr-1" />템플릿
                </Button>
                <Button size="sm" variant="outline" onClick={addEmptyRecipient}>+ 추가</Button>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importFromExcel} />
            </div>

            {duplicateCount > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <p className="text-xs text-amber-700">
                  이미 체험권을 받은 수신자 <span className="font-semibold">{duplicateCount}명</span>이 포함되어 있습니다.
                </p>
                <Button size="sm" variant="outline" className="h-6 text-xs border-amber-300 text-amber-700 hover:bg-amber-100"
                  onClick={removeTrialDuplicates}>
                  중복 제거
                </Button>
              </div>
            )}

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {recipients.map((r, i) => {
                const dup = isDuplicate(r.contact_phone);
                return (
                <div key={i} className={`grid grid-cols-12 gap-1.5 items-center rounded-lg border p-2 ${dup ? 'border-amber-300 bg-amber-50/60' : 'border-border bg-muted/20'}`}>
                  <Input value={r.org_name} onChange={e => updateRecipient(i, 'org_name', e.target.value)}
                    placeholder="학교/기관" className="col-span-3 h-7 text-xs" />
                  <Input value={r.contact_name} onChange={e => updateRecipient(i, 'contact_name', e.target.value)}
                    placeholder="이름" className="col-span-2 h-7 text-xs" />
                  <Input value={r.contact_phone} onChange={e => updateRecipient(i, 'contact_phone', e.target.value)}
                    placeholder="전화번호" className="col-span-3 h-7 text-xs" />
                  <Input value={r.duration} onChange={e => updateRecipient(i, 'duration', e.target.value)}
                    placeholder="기간" className="col-span-1 h-7 text-xs" />
                  <Input value={r.user_count} onChange={e => updateRecipient(i, 'user_count', e.target.value)}
                    placeholder="인원" className="col-span-1 h-7 text-xs" />
                  <div className="col-span-1 flex items-center justify-center gap-0.5">
                    {dup ? (() => {
                      const hist = contactHistoryMap?.get(r.contact_phone.replace(/\D/g, ''));
                      return (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="flex items-center gap-0.5 text-[9px] text-amber-600 font-medium hover:text-amber-700">
                              <Info className="h-3 w-3" />중복
                            </button>
                          </PopoverTrigger>
                          <PopoverContent side="left" className="w-64 p-3 text-xs space-y-2">
                            <div>
                              <p className="font-semibold text-sm">{hist?.name || r.contact_name}</p>
                              {hist?.lead_stage && (
                                <span className="inline-block mt-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {hist.lead_stage}
                                </span>
                              )}
                            </div>
                            {hist && hist.licenses.length > 0 ? (
                              <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">활동 이력</p>
                                {hist.licenses.map((l, li) => (
                                  <div key={li} className="flex items-center justify-between gap-2 rounded bg-muted/60 px-2 py-1">
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${l.type === '구매' ? 'bg-teal-100 text-teal-700' : 'bg-blue-100 text-blue-700'}`}>
                                      {l.type}
                                    </span>
                                    <span className="flex-1 truncate">{l.label}</span>
                                    <span className="text-muted-foreground shrink-0">{l.date}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-muted-foreground text-[11px]">이력 없음 (연락처만 등록됨)</p>
                            )}
                          </PopoverContent>
                        </Popover>
                      );
                    })() : null}
                    <button onClick={() => removeRecipient(i)}
                      className="text-muted-foreground/40 hover:text-red-500 text-xs">✕</button>
                  </div>
                </div>
              );})}
              {recipients.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">수신자가 없습니다. 추가 버튼을 눌러 직접 입력하세요.</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">이전</Button>
              <Button onClick={() => setStep(3)} disabled={recipients.length === 0} className="flex-1">
                다음 — 생성 · 발송
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: 실행 & 결과 */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {running ? '처리 중...' : doneCount + errorCount === recipients.length && recipients.length > 0
                  ? `완료: ${doneCount}건 성공 · ${errorCount}건 실패`
                  : `준비: ${recipients.length}명`}
              </p>
              {!running && doneCount + errorCount === 0 && (
                <Button size="sm" onClick={handleRun}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />이용권 생성 · 발송 시작
                </Button>
              )}
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {recipients.map((r, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="shrink-0">
                    {r.status === 'pending'    && <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />}
                    {r.status === 'generating' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                    {r.status === 'sending'    && <Loader2 className="h-4 w-4 animate-spin text-amber-500" />}
                    {r.status === 'done'       && <CheckCircle2 className="h-4 w-4 text-teal-500" />}
                    {r.status === 'error'      && <XCircle className="h-4 w-4 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{r.org_name}</span>
                    <span className="text-muted-foreground ml-2">{r.contact_name}</span>
                    {r.coupon_code && <span className="ml-2 font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{r.coupon_code}</span>}
                    {r.status === 'generating' && <span className="text-xs text-blue-500 ml-2">코드 생성 중...</span>}
                    {r.status === 'sending'    && <span className="text-xs text-amber-500 ml-2">발송 중...</span>}
                    {r.status === 'error'      && <span className="text-xs text-red-500 ml-2">{r.error}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{r.duration}개월·{r.user_count}명</span>
                </div>
              ))}
            </div>

            {doneCount + errorCount === recipients.length && recipients.length > 0 && !running && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button variant="outline" className="flex-1"
                  onClick={() => exportToExcel(recipients, fileName)}>
                  <Download className="h-4 w-4 mr-1.5" />엑셀 다운로드
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => { reset(); onClose(); }}>
                  닫기
                </Button>
              </div>
            )}

            {doneCount + errorCount === 0 && (
              <Button variant="outline" onClick={() => setStep(2)} className="w-full">이전</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// 클라이언트 사이드 상태 계산 (Supabase 저장값 기준)
function computeStatus(lic: DealLicenseRecord): LicenseStatus {
  if (lic.status === '이탈') return '이탈'; // 수동 설정값 유지
  if (lic.status === '삭제') return '삭제'; // 운영DB 삭제 — 유지
  if (lic.status === '대기')  return '대기';
  // 사용중/만료: service_expire_at으로 재계산
  if (lic.service_expire_at) {
    const today = new Date().toISOString().split('T')[0];
    if (lic.service_expire_at < today) return '만료';
  }
  return lic.status;
}

export default function Licenses() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [autoMatchProgress, setAutoMatchProgress] = useState('');
  const [autoMatchResult, setAutoMatchResult] = useState<{
    linked: number; created: number; skipped_multi: number; skipped_unused: number;
  } | null>(null);

  const { data: licenses, isLoading } = useQuery({
    queryKey: ['licenses'],
    queryFn: getAllLicenses,
  });

  // 자동 고객 매칭
  const handleAutoMatch = async () => {
    setAutoMatching(true);
    setAutoMatchResult(null);
    const headers = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' };

    try {
      // 1. Airtable 전체 고객 로드 → 이름별 Map
      setAutoMatchProgress('Airtable 고객 목록 불러오는 중...');
      const contacts = await airtable.fetchAll<ContactFields>('01_Contacts');
      const nameMap = new Map<string, string[]>(); // name → [airtable_record_id]
      for (const c of contacts) {
        const name = c.fields.Name?.trim();
        if (!name) continue;
        const arr = nameMap.get(name) ?? [];
        arr.push(c.id);
        nameMap.set(name, arr);
      }

      // 2. 미연결 mdiary_coupons (link_confirmed IS NULL, extracted_name 있는 것)
      setAutoMatchProgress('미연결 쿠폰 목록 불러오는 중...');
      const cRes = await fetch(
        `${SUPABASE_URL}/rest/v1/mdiary_coupons?link_confirmed=is.null&extracted_name=not.is.null` +
        `&select=id,coupon_code,extracted_name,is_used,group_name,edu_office_name,descript,created_at&limit=5000`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      const unlinked: Array<{
        id: number; coupon_code: string; extracted_name: string; is_used: boolean;
        group_name: string | null; edu_office_name: string | null;
        descript: string | null; created_at: string;
      }> = cRes.ok ? await cRes.json() : [];

      // 3. 이름별로 그룹핑
      const byName = new Map<string, typeof unlinked>();
      for (const c of unlinked) {
        const name = c.extracted_name.trim();
        const arr = byName.get(name) ?? [];
        arr.push(c);
        byName.set(name, arr);
      }

      let linked = 0, created = 0, skipped_multi = 0, skipped_unused = 0;
      const total = byName.size;
      let processed = 0;

      for (const [name, coupons] of byName) {
        processed++;
        if (processed % 10 === 0) setAutoMatchProgress(`처리 중... ${processed}/${total}`);

        const matches = nameMap.get(name) ?? [];

        if (matches.length === 1) {
          // 정확히 1명 매칭 → 전체 연결
          const contactId = matches[0];
          await Promise.all(coupons.map(c =>
            fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons?id=eq.${c.id}`, {
              method: 'PATCH', headers,
              body: JSON.stringify({ link_confirmed: true, linked_contact_id: contactId }),
            })
          ));
          linked += coupons.length;

        } else if (matches.length === 0) {
          // Airtable에 없음 → 사용중인 쿠폰이 있으면 신규 고객 생성
          const usedCoupon = coupons.find(c => c.is_used);
          if (!usedCoupon) { skipped_unused += coupons.length; continue; }

          // Airtable 신규 고객 생성
          const newContact = await airtable.createRecord<ContactFields>('01_Contacts', {
            Name: name,
            Org_Name: usedCoupon.group_name || usedCoupon.descript || undefined,
            Lead_Stage: '체험',
            Notes: `[mDiary 체험권] 코드: ${usedCoupon.coupon_code} | 발급: ${usedCoupon.created_at.slice(0, 10)}${usedCoupon.edu_office_name ? ` | ${usedCoupon.edu_office_name}` : ''}`,
          });
          created++;

          // 같은 이름의 모든 쿠폰 연결
          await Promise.all(coupons.map(c =>
            fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons?id=eq.${c.id}`, {
              method: 'PATCH', headers,
              body: JSON.stringify({ link_confirmed: true, linked_contact_id: newContact.id }),
            })
          ));

        } else {
          // 동명이인 → 수동 검토
          skipped_multi += coupons.length;
        }
      }

      setAutoMatchResult({ linked, created, skipped_multi, skipped_unused });
      qc.invalidateQueries({ queryKey: ['licenses'] });
      toast.success(`자동 매칭 완료 — 연결 ${linked}건 · 신규 ${created}건`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '자동 매칭 실패');
    } finally {
      setAutoMatching(false);
      setAutoMatchProgress('');
    }
  };

  // 운영DB 동기화: 1) 새 쿠폰 추가 → 2) 상태/만료일/인원 갱신
  const handleSync = async () => {
    setSyncing(true);
    try {
      // 1단계: 새 쿠폰 추가
      const addRes = await fetch(`${SUPABASE_URL}/functions/v1/sync-new-coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      const addData = addRes.ok ? await addRes.json() : { inserted: 0 };
      const inserted: number = addData.inserted ?? 0;

      // 2단계: 상태 동기화 — 15개씩 페이지네이션 (Supabase CPU 제한 우회)
      const PAGE = 15;
      let offset = 0;
      let totalUpdated = 0;
      let totalDeleted = 0;
      let totalCount = 0;
      while (true) {
        const syncRes = await fetch(`${SUPABASE_URL}/functions/v1/get-coupon-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
          body: JSON.stringify({ offset, limit: PAGE }),
        });
        if (!syncRes.ok) throw new Error(`동기화 실패: ${syncRes.status}`);
        const data = await syncRes.json();
        totalUpdated += data.updated ?? 0;
        totalDeleted += data.deleted ?? 0;
        totalCount    = data.total   ?? totalCount;
        if (!data.hasMore) break;
        offset += PAGE;
      }

      qc.invalidateQueries({ queryKey: ['licenses'] });
      const parts: string[] = [];
      if (inserted > 0) parts.push(`새 쿠폰 ${inserted}건 추가`);
      parts.push(`${totalCount}건 조회 · ${totalUpdated}건 업데이트`);
      if (totalDeleted > 0) parts.push(`${totalDeleted}건 삭제 감지`);
      toast.success(`운영DB 동기화 완료 — ${parts.join(' · ')}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '동기화 실패');
    } finally {
      setSyncing(false);
    }
  };

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LicenseStatus }) =>
      updateLicenseStatus(id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['licenses'] }); toast.success('상태 변경됨'); },
    onError:   () => toast.error('상태 변경 실패'),
  });

  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LicenseStatus>('all');
  const [linkingId, setLinkingId]       = useState<string | null>(null);
  const [linkingDealId, setLinkingDealId] = useState('');
  const [checkedIds, setCheckedIds]     = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [linkLoading, setLinkLoading]   = useState(false);

  const { data: deals } = useDeals();
  const { widths: colW, startResize } = useResizableColumns('licenses_col_widths', {
    상태: 90, '쿠폰 코드': 120, 담당자: 100, '학교/기관': 140, 전화번호: 110, 기간: 80, 만료일: 100, 딜: 70,
  });

  const all = (licenses ?? []).map(lic => ({ ...lic, displayStatus: computeStatus(lic) }));
  const q   = search.toLowerCase();
  const filtered = all.filter(l => {
    const matchSearch = !q || [l.coupon_code, l.contact_name, l.org_name, l.contact_phone]
      .some(v => v?.toLowerCase().includes(q));
    return matchSearch && (statusFilter === 'all' || l.displayStatus === statusFilter);
  });

  const pipelineCounts = PIPELINE.map(s => ({
    status: s,
    count: all.filter(l => l.displayStatus === s).length,
  }));

  // 마지막 동기화 시점 (created_at 기준 최신)
  const lastSync = licenses && licenses.length > 0
    ? licenses.reduce((a, b) => a.created_at > b.created_at ? a : b).created_at.slice(0, 10)
    : null;

  const handleLinkDeal = async (lic: DealLicenseRecord, dealId: string) => {
    if (!dealId) return;
    setLinkLoading(true);
    try {
      if (lic.id.startsWith('mdiary_')) {
        // mdiary 쿠폰 → 새 deal_licenses 레코드 생성
        await attachCouponToDeal(lic.coupon_code, dealId, {
          contact_name:  lic.contact_name,
          contact_phone: lic.contact_phone,
          org_name:      lic.org_name,
          duration:      lic.duration,
          user_count:    lic.user_count,
        });
      } else {
        await updateLicenseDeal(lic.id, dealId);
      }
      qc.invalidateQueries({ queryKey: ['licenses'] });
      setLinkingId(null);
      setLinkingDealId('');
      toast.success('딜 연결 완료');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '딜 연결 실패');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (checkedIds.size === 0) return;
    if (!confirm(`선택한 ${checkedIds.size}건의 이용권을 목록에서 삭제하시겠습니까?`)) return;
    setBulkDeleting(true);
    try {
      const ids = [...checkedIds];
      await Promise.all(ids.map(async id => {
        const lic = all.find(l => l.id === id);
        if (!lic) return;
        if (id.startsWith('mdiary_')) {
          // mdiary 전용 레코드 → link_confirmed=false 로 숨김
          await hideMdiaryCoupon(lic.coupon_code);
        } else {
          await deleteDealLicense(id);
        }
      }));
      setCheckedIds(new Set());
      qc.invalidateQueries({ queryKey: ['licenses'] });
      toast.success(`${ids.length}건 삭제 완료`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setBulkDeleting(false);
    }
  };

  if (isLoading) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">이용권 관리</h1>
      <DataTableSkeleton columns={7} />
    </div>
  );

  const pendingCount = all.filter(l => l.displayStatus === '대기').length;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">이용권 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {all.length.toLocaleString()}건
            {lastSync && <span className="ml-2">· 최근등록 {lastSync}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && checkedIds.size > 0 && (
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              선택 삭제 ({checkedIds.size}건)
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setSendDialogOpen(true)}>
              <Send className="h-4 w-4 mr-1.5" />이용권 발송
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleAutoMatch}
            disabled={autoMatching || syncing}
            title="Airtable 고객과 자동 매칭 · 미등록 사용자 신규 등록">
            <Users className={`h-4 w-4 mr-1.5 ${autoMatching ? 'animate-pulse' : ''}`} />
            {autoMatching ? autoMatchProgress || '매칭 중...' : '고객 자동 매칭'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing || autoMatching}
            title="새 쿠폰 추가 + 사용 상태·만료일·인원 갱신">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '동기화 중...' : '운영DB 동기화'}
          </Button>
        </div>
        <CouponSendDialog open={sendDialogOpen} onClose={() => setSendDialogOpen(false)} />
      </div>

      {/* 자동 매칭 결과 */}
      {autoMatchResult && (
        <div className="flex items-center gap-4 rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-2.5 text-sm">
          <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
          <span className="text-teal-800 font-medium">자동 매칭 완료</span>
          <span className="text-teal-700">기존 고객 연결 <b>{autoMatchResult.linked}</b>건</span>
          <span className="text-teal-700">신규 고객 등록 <b>{autoMatchResult.created}</b>건</span>
          {autoMatchResult.skipped_multi > 0 && (
            <span className="text-amber-700">동명이인 <b>{autoMatchResult.skipped_multi}</b>건 (수동 검토 필요)</span>
          )}
          {autoMatchResult.skipped_unused > 0 && (
            <span className="text-muted-foreground">미사용 건너뜀 <b>{autoMatchResult.skipped_unused}</b>건</span>
          )}
          <button onClick={() => setAutoMatchResult(null)} className="ml-auto text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}


      {/* 파이프라인 */}
      <div className="surface-card ring-container p-4">
        <p className="text-xs text-muted-foreground font-medium mb-3">이용권 파이프라인</p>
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => setStatusFilter('all')}
            className={`flex flex-col items-center rounded-lg px-4 py-2.5 min-w-[72px] transition-colors
              ${statusFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}>
            <span className="text-lg font-bold">{all.length}</span>
            <span className="text-[10px] mt-0.5">전체</span>
          </button>
          {pipelineCounts.map(p => (
            <div key={p.status} className="flex items-center gap-1 flex-shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
              <button
                onClick={() => setStatusFilter(statusFilter === p.status ? 'all' : p.status)}
                className={`flex flex-col items-center rounded-lg px-4 py-2.5 min-w-[80px] transition-colors border
                  ${statusFilter === p.status
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : 'border-transparent hover:border-border bg-muted/50'}`}>
                <span className={`text-lg font-bold ${p.count === 0 ? 'text-muted-foreground/40' : ''}`}>
                  {p.count}
                </span>
                <span className={`text-[10px] mt-0.5 whitespace-nowrap
                  ${statusFilter === p.status ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {STATUS_META[p.status].label}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="코드, 담당자, 학교 검색..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 w-64 text-sm" />
        </div>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {PIPELINE.map(s => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground self-center">{filtered.length}건</span>
      </div>

      {/* 테이블 */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted/60 backdrop-blur">
                {canEdit && (
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" className="rounded border-border"
                      checked={filtered.length > 0 && filtered.every(l => checkedIds.has(l.id))}
                      onChange={e => {
                        if (e.target.checked) setCheckedIds(new Set(filtered.map(l => l.id)));
                        else setCheckedIds(new Set());
                      }} />
                  </th>
                )}
                {['상태', '쿠폰 코드', '담당자', '학교/기관', '전화번호', '기간', '만료일', '딜'].map(h => (
                  <th key={h} style={{ width: colW[h] }}
                    className="relative px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">
                    {h}
                    <div onMouseDown={e => startResize(h, e)}
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 z-10" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 9 : 8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    {all.length === 0
                      ? '이용권이 없습니다. 딜에서 이용권 템플릿을 업로드하면 자동으로 등록됩니다.'
                      : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              ) : filtered.map(lic => {
                const today = new Date().toISOString().split('T')[0];
                const isExpired = lic.service_expire_at && lic.service_expire_at < today;
                const meta = STATUS_META[lic.displayStatus];
                const isChecked = checkedIds.has(lic.id);
                return (
                  <tr key={lic.id} className={`hover:bg-muted/30 transition-colors ${isChecked ? 'bg-primary/5' : ''}`}>
                    {canEdit && (
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-border"
                          checked={isChecked}
                          onChange={e => setCheckedIds(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(lic.id);
                            else next.delete(lic.id);
                            return next;
                          })} />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.color}`}>
                          {meta.label}
                        </span>
                        {/* 이탈 수동 처리 (deal 연결 레코드만) */}
                        {lic.deal_id !== 'mdiary' && lic.displayStatus !== '이탈' && lic.displayStatus !== '대기' && (
                          <button
                            onClick={() => updateStatus.mutate({ id: lic.id, status: '이탈' })}
                            className="text-[10px] text-muted-foreground/50 hover:text-red-500 transition-colors"
                            title="이탈 처리">
                            이탈
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{lic.coupon_code || '-'}</span>
                    </td>
                    <td className="px-4 py-3 truncate overflow-hidden" title={lic.contact_name || lic.org_name || undefined}>
                      {lic.contact_name ? (
                        <span className="font-medium">{lic.contact_name}</span>
                      ) : lic.org_name ? (
                        <span className="text-muted-foreground text-xs">{lic.org_name}</span>
                      ) : (
                        <span className="text-muted-foreground/40">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 overflow-hidden" title={[lic.group_name || (lic.org_name !== lic.contact_name ? lic.org_name : null), lic.edu_office_name].filter(Boolean).join(' · ') || undefined}>
                      {(() => {
                        const displayOrg = lic.group_name || (lic.org_name && lic.org_name !== lic.contact_name ? lic.org_name : null);
                        return displayOrg ? (
                          <div>
                            <div className="truncate font-medium text-sm">{displayOrg}</div>
                            {lic.edu_office_name && (
                              <div className="text-[11px] text-muted-foreground truncate">{lic.edu_office_name}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">-</span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate overflow-hidden" title={lic.contact_phone || undefined}>{lic.contact_phone || '-'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap"
                      title={[
                        lic.duration ? `기간: ${lic.duration}개월` : null,
                        lic.user_count ? `허용인원: ${lic.user_count}명` : null,
                        (lic.member_count ?? 0) > 0 ? `실제등록: ${lic.member_count}명` : null,
                        lic.service_expire_at ? `만료: ${lic.service_expire_at}` : null,
                      ].filter(Boolean).join(' / ') || undefined}>
                      {lic.duration ? `${lic.duration}개월` : '-'}
                      {lic.user_count ? ` · ${lic.user_count}명` : ''}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {lic.service_expire_at ? (
                        <div>
                          <div className={`text-xs ${isExpired ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
                            {lic.service_expire_at}{isExpired ? ' 만료' : ''}
                          </div>
                          {(lic.member_count ?? 0) > 0 && (
                            <div className="text-[11px] text-teal-700 font-medium">{lic.member_count}명 등록</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">미등록</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lic.deal_id === 'mdiary' ? (
                        linkingId === lic.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              className="text-[11px] border rounded px-1 py-0.5 max-w-[120px]"
                              value={linkingDealId}
                              onChange={e => setLinkingDealId(e.target.value)}
                            >
                              <option value="">딜 선택</option>
                              {(deals ?? []).map(d => (
                                <option key={d.id} value={d.id}>
                                  {d.fields.Deal_Name || d.fields.Org_Name || d.id.slice(-6)}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-5 text-[10px] px-1.5"
                              disabled={!linkingDealId || linkLoading}
                              onClick={() => handleLinkDeal(lic, linkingDealId)}
                            >
                              {linkLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : '확인'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 text-[10px] px-1"
                              onClick={() => { setLinkingId(null); setLinkingDealId(''); }}
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-primary"
                            onClick={() => { setLinkingId(lic.id); setLinkingDealId(''); }}
                          >
                            딜 연결
                          </Button>
                        )
                      ) : (
                        <a
                          href={`/deals?id=${lic.deal_id}`}
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                          title="딜로 이동"
                        >
                          <ExternalLink className="h-3 w-3" />
                          딜 보기
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
