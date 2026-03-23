import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import {
  Plus, ChevronDown, ChevronRight, ArrowRight, ExternalLink,
  Calendar, Users, CheckCircle2, XCircle, Clock, Trash2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

// ── Types ─────────────────────────────────────────
interface Event {
  id: string;
  name: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  status: 'active' | 'ended' | 'planned';
  created_at: string;
}

interface EventLicense {
  id: string;
  event_id: string;
  coupon_code?: string;
  contact_name?: string;
  contact_phone?: string;
  org_name?: string;
  duration?: string;
  user_count?: string;
  status: '대기' | '사용중' | '만료';
  service_expire_at?: string;
  created_at: string;
}

// ── API ───────────────────────────────────────────
async function getEvents(): Promise<Event[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/events?order=created_at.desc`, { headers: HEADERS });
  if (!r.ok) throw new Error('이벤트 조회 실패');
  return r.json();
}

async function createEvent(e: Omit<Event, 'id' | 'created_at'>): Promise<Event> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(e),
  });
  if (!r.ok) throw new Error('이벤트 생성 실패');
  const data = await r.json();
  return data[0];
}

async function updateEvent(id: string, e: Partial<Event>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(e),
  });
  if (!r.ok) throw new Error('이벤트 수정 실패');
}

async function deleteEvent(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${id}`, {
    method: 'DELETE', headers: HEADERS,
  });
  if (!r.ok) throw new Error('이벤트 삭제 실패');
}

async function getEventLicenses(eventId: string): Promise<EventLicense[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/event_licenses?event_id=eq.${eventId}&order=created_at.asc`,
    { headers: HEADERS }
  );
  if (!r.ok) throw new Error('이벤트 이용권 조회 실패');
  return r.json();
}

async function addEventLicense(row: Omit<EventLicense, 'id' | 'created_at'>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/event_licenses`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('추가 실패');
}

async function deleteEventLicense(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/event_licenses?id=eq.${id}`, {
    method: 'DELETE', headers: HEADERS,
  });
  if (!r.ok) throw new Error('삭제 실패');
}

async function updateEventLicense(id: string, patch: Partial<EventLicense>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/event_licenses?id=eq.${id}`, {
    method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('수정 실패');
}

async function bulkAddEventLicenses(rows: Omit<EventLicense, 'id' | 'created_at'>[]): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/event_licenses`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error('일괄 추가 실패');
}

// 엑셀 파싱
interface ParsedRow {
  org_name?: string; contact_name?: string; contact_phone?: string;
  coupon_code?: string; duration?: string; user_count?: string;
  service_expire_at?: string; status?: EventLicense['status'];
}

function parseExcel(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
        const rows = raw.map(r => ({
          org_name:          r['학교/기관']   || undefined,
          contact_name:      r['이름']        || undefined,
          contact_phone:     r['전화번호']    || undefined,
          coupon_code:       r['쿠폰코드']    || undefined,
          duration:          r['기간(개월)']  || '1',
          user_count:        r['인원']        || '10',
          service_expire_at: r['만료일']      || undefined,
          status:            (['대기','사용중','만료'].includes(r['상태']) ? r['상태'] : '대기') as EventLicense['status'],
        }));
        resolve(rows);
      } catch {
        reject(new Error('엑셀 파싱 실패'));
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsArrayBuffer(file);
  });
}

// deal_licenses에서 phone 목록 가져와 전환 여부 판별
async function getConvertedPhones(): Promise<Set<string>> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/deal_licenses?select=contact_phone`, { headers: HEADERS });
  if (!r.ok) return new Set();
  const data: { contact_phone: string }[] = await r.json();
  const phones = new Set<string>();
  data.forEach(d => { if (d.contact_phone) phones.add(d.contact_phone.replace(/\D/g, '')); });
  return phones;
}

// ── Status badge ──────────────────────────────────
const EVENT_STATUS: Record<Event['status'], { label: string; color: string }> = {
  active:  { label: '진행중', color: 'bg-teal-100 text-teal-700' },
  ended:   { label: '종료',   color: 'bg-slate-100 text-slate-500' },
  planned: { label: '예정',   color: 'bg-blue-100 text-blue-700' },
};

const LIC_STATUS: Record<EventLicense['status'], { label: string; color: string }> = {
  대기:   { label: '대기',   color: 'bg-slate-100 text-slate-600' },
  사용중: { label: '사용중', color: 'bg-teal-100 text-teal-700' },
  만료:   { label: '만료',   color: 'bg-orange-100 text-orange-700' },
};

// ── EventFormDialog ───────────────────────────────
interface EventFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: Event;
}

function EventFormDialog({ open, onClose, initial }: EventFormDialogProps) {
  const qc = useQueryClient();
  const isEdit = !!initial;

  const [form, setForm] = useState({
    name:        initial?.name        ?? '',
    description: initial?.description ?? '',
    start_date:  initial?.start_date  ?? '',
    end_date:    initial?.end_date    ?? '',
    status:      (initial?.status     ?? 'active') as Event['status'],
  });

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...form, status: form.status as Event['status'] };
      if (isEdit) await updateEvent(initial!.id, body);
      else        await createEvent(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      toast.success(isEdit ? '이벤트 수정됨' : '이벤트 생성됨');
      onClose();
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '이벤트 수정' : '이벤트 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">이벤트명 *</Label>
            <Input value={form.name} onChange={e => f('name', e.target.value)} placeholder="예: 2026 봄학기 체험" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">설명</Label>
            <Input value={form.description} onChange={e => f('description', e.target.value)} placeholder="간략한 설명" className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">시작일</Label>
              <Input type="date" value={form.start_date} onChange={e => f('start_date', e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">종료일</Label>
              <Input type="date" value={form.end_date} onChange={e => f('end_date', e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">상태</Label>
            <Select value={form.status} onValueChange={v => f('status', v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">예정</SelectItem>
                <SelectItem value="active">진행중</SelectItem>
                <SelectItem value="ended">종료</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? '저장 중...' : (isEdit ? '수정 저장' : '이벤트 추가')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── AddLicenseRow ─────────────────────────────────
const EMPTY_ROW = { org_name: '', contact_name: '', contact_phone: '', coupon_code: '', duration: '1', user_count: '10', status: '대기' as EventLicense['status'], service_expire_at: '' };

interface AddLicenseRowProps {
  eventId: string;
  onDone: () => void;
}
function AddLicenseRow({ eventId, onDone }: AddLicenseRowProps) {
  const qc = useQueryClient();
  const [row, setRow] = useState({ ...EMPTY_ROW });
  const r = (k: keyof typeof row, v: string) => setRow(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => addEventLicense({
      event_id: eventId,
      org_name: row.org_name || undefined,
      contact_name: row.contact_name || undefined,
      contact_phone: row.contact_phone || undefined,
      coupon_code: row.coupon_code || undefined,
      duration: row.duration,
      user_count: row.user_count,
      status: row.status,
      service_expire_at: row.service_expire_at || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event_licenses', eventId] });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast.success('추가됨');
      onDone();
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <div className="grid grid-cols-12 gap-1.5 items-center px-2 py-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5">
      <Input value={row.org_name} onChange={e => r('org_name', e.target.value)}
        placeholder="학교/기관" className="col-span-3 h-7 text-xs" />
      <Input value={row.contact_name} onChange={e => r('contact_name', e.target.value)}
        placeholder="이름" className="col-span-2 h-7 text-xs" />
      <Input value={row.contact_phone} onChange={e => r('contact_phone', e.target.value)}
        placeholder="전화번호" className="col-span-2 h-7 text-xs" />
      <Input value={row.coupon_code} onChange={e => r('coupon_code', e.target.value)}
        placeholder="쿠폰코드" className="col-span-2 h-7 text-xs font-mono" />
      <Input value={row.service_expire_at} onChange={e => r('service_expire_at', e.target.value)}
        type="date" className="col-span-2 h-7 text-xs" />
      <div className="col-span-1 flex gap-1">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="text-xs text-primary hover:text-primary/80 font-medium">저장</button>
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>
    </div>
  );
}

// ── EventDetail ───────────────────────────────────
interface EventDetailProps {
  event: Event;
  convertedPhones: Set<string>;
}

function EventDetail({ event, convertedPhones }: EventDetailProps) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Partial<EventLicense>>({});
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const rows = await parseExcel(file);
      if (rows.length === 0) { toast.error('데이터가 없습니다'); return; }
      await bulkAddEventLicenses(rows.map(r => ({ ...r, event_id: event.id, status: r.status ?? '대기' })));
      qc.invalidateQueries({ queryKey: ['event_licenses', event.id] });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast.success(`${rows.length}건 가져오기 완료`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const { data: licenses, isLoading } = useQuery({
    queryKey: ['event_licenses', event.id],
    queryFn: () => getEventLicenses(event.id),
  });

  const normalize = (p?: string) => (p ?? '').replace(/\D/g, '');
  const isConverted = (phone?: string) => phone ? convertedPhones.has(normalize(phone)) : false;

  const delMut = useMutation({
    mutationFn: deleteEventLicense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event_licenses', event.id] });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast.success('삭제됨');
    },
    onError: () => toast.error('삭제 실패'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EventLicense> }) => updateEventLicense(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event_licenses', event.id] });
      setEditingId(null);
      toast.success('수정됨');
    },
    onError: () => toast.error('수정 실패'),
  });

  if (isLoading) return <div className="py-6 text-center text-sm text-muted-foreground">로딩 중...</div>;

  return (
    <div className="space-y-1.5 py-1">
      {/* 툴바 */}
      <div className="flex justify-between items-center px-1 pb-1">
        <span className="text-xs text-muted-foreground">{licenses?.length ?? 0}명</span>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs px-3"
            disabled={importing}
            onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1" />{importing ? '처리 중...' : '엑셀 가져오기'}
          </Button>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs px-3" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />수동 추가
          </Button>
        </div>
      </div>

      {/* 추가 폼 */}
      {adding && <AddLicenseRow eventId={event.id} onDone={() => setAdding(false)} />}

      {/* 목록 */}
      {(!licenses || licenses.length === 0) && !adding ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          발송된 체험권이 없습니다.<br />
          <span className="text-xs">위 "수신자 추가" 버튼으로 기존 발송 내역을 등록하거나,<br />이용권 관리 → 이용권 발송 → 체험 발송에서 이 이벤트로 발송하세요.</span>
        </div>
      ) : licenses?.map(lic => {
        const converted = isConverted(lic.contact_phone);
        const today = new Date().toISOString().split('T')[0];
        const expired = lic.service_expire_at && lic.service_expire_at < today;
        const statusMeta = LIC_STATUS[lic.status];
        const isEditing = editingId === lic.id;

        if (isEditing) {
          const er = (k: keyof EventLicense, v: string) => setEditRow(p => ({ ...p, [k]: v }));
          return (
            <div key={lic.id} className="grid grid-cols-12 gap-1.5 items-center px-2 py-2 rounded-lg border-2 border-dashed border-amber-400/50 bg-amber-50/30">
              <Input defaultValue={lic.org_name} onChange={e => er('org_name', e.target.value)}
                placeholder="학교/기관" className="col-span-3 h-7 text-xs" />
              <Input defaultValue={lic.contact_name} onChange={e => er('contact_name', e.target.value)}
                placeholder="이름" className="col-span-2 h-7 text-xs" />
              <Input defaultValue={lic.contact_phone} onChange={e => er('contact_phone', e.target.value)}
                placeholder="전화번호" className="col-span-2 h-7 text-xs" />
              <Input defaultValue={lic.coupon_code} onChange={e => er('coupon_code', e.target.value)}
                placeholder="쿠폰코드" className="col-span-2 h-7 text-xs font-mono" />
              <Input defaultValue={lic.service_expire_at} onChange={e => er('service_expire_at', e.target.value)}
                type="date" className="col-span-2 h-7 text-xs" />
              <div className="col-span-1 flex gap-1">
                <button onClick={() => editMut.mutate({ id: lic.id, patch: editRow })}
                  disabled={editMut.isPending}
                  className="text-xs text-primary hover:text-primary/80 font-medium">저장</button>
                <button onClick={() => setEditingId(null)}
                  className="text-xs text-muted-foreground hover:text-foreground">✕</button>
              </div>
            </div>
          );
        }

        return (
          <div key={lic.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-muted/10 hover:bg-muted/20 transition-colors group">
            {/* 전환 여부 */}
            <div className="shrink-0 w-5 flex justify-center" title={converted ? '딜 전환됨' : '미전환'}>
              {converted
                ? <CheckCircle2 className="h-4 w-4 text-teal-500" />
                : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />}
            </div>

            {/* 기관 · 이름 · 전화번호 */}
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">{lic.org_name || '-'}</span>
              <span className="text-muted-foreground text-sm ml-2">{lic.contact_name}</span>
              {lic.contact_phone && (
                <span className="text-xs text-muted-foreground ml-2">{lic.contact_phone}</span>
              )}
            </div>

            {lic.coupon_code && (
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded shrink-0">{lic.coupon_code}</span>
            )}
            <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
              {lic.duration ? `${lic.duration}개월` : ''}{lic.user_count ? `·${lic.user_count}명` : ''}
            </span>
            {lic.service_expire_at && (
              <span className={`text-xs shrink-0 whitespace-nowrap ${expired ? 'text-red-500' : 'text-muted-foreground'}`}>
                {lic.service_expire_at}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${statusMeta.color}`}>
              {statusMeta.label}
            </span>

            {converted ? (
              <a href="/deals" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0">
                <ExternalLink className="h-3 w-3" />딜 보기
              </a>
            ) : lic.status === '사용중' && (
              <a
                href={`/deals?new=1&name=${encodeURIComponent(lic.org_name || '')}&phone=${encodeURIComponent(lic.contact_phone || '')}`}
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline shrink-0"
              >
                <ArrowRight className="h-3 w-3" />딜 생성
              </a>
            )}

            {/* 수정/삭제 — hover 시 표시 */}
            <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => { setEditingId(lic.id); setEditRow({}); }}
                className="text-[11px] text-muted-foreground hover:text-foreground px-1">수정</button>
              <button onClick={() => delMut.mutate(lic.id)}
                className="text-muted-foreground hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── EventCard ─────────────────────────────────────
interface EventCardProps {
  event: Event;
  convertedPhones: Set<string>;
  onEdit: (e: Event) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
}

function EventCard({ event, convertedPhones, onEdit, onDelete, canEdit }: EventCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: licenses } = useQuery({
    queryKey: ['event_licenses', event.id],
    queryFn: () => getEventLicenses(event.id),
  });

  const normalize = (p?: string) => (p ?? '').replace(/\D/g, '');
  const total      = licenses?.length ?? 0;
  const active     = licenses?.filter(l => l.status === '사용중').length ?? 0;
  const expired    = licenses?.filter(l => l.status === '만료').length ?? 0;
  const converted  = licenses?.filter(l => convertedPhones.has(normalize(l.contact_phone))).length ?? 0;
  const convRate   = total > 0 ? Math.round((converted / total) * 100) : 0;

  const statusMeta = EVENT_STATUS[event.status];

  return (
    <div className="surface-card ring-container overflow-hidden">
      {/* 카드 헤더 */}
      <div
        className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <button className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{event.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.color}`}>
              {statusMeta.label}
            </span>
          </div>
          {(event.start_date || event.end_date) && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {event.start_date ?? '?'} ~ {event.end_date ?? '?'}
            </div>
          )}
          {event.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
          )}
        </div>

        {/* 통계 */}
        <div className="flex items-center gap-5 shrink-0">
          <Stat icon={<Users className="h-3.5 w-3.5" />} label="발송" value={total} />
          <Stat icon={<Clock className="h-3.5 w-3.5" />} label="사용중" value={active} accent="teal" />
          <Stat icon={<XCircle className="h-3.5 w-3.5" />} label="만료" value={expired} accent="orange" />
          <Stat icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="전환" value={`${converted} (${convRate}%)`} accent="blue" />
        </div>

        {/* 수정/삭제 */}
        {canEdit && (
          <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit(event)}>수정</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={() => onDelete(event.id)}>삭제</Button>
          </div>
        )}
      </div>

      {/* 펼쳐진 수신자 목록 */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-2">
          <EventDetail event={event} convertedPhones={convertedPhones} />
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, accent }: {
  icon: React.ReactNode; label: string; value: string | number; accent?: string;
}) {
  const color = accent === 'teal'   ? 'text-teal-600'
              : accent === 'orange' ? 'text-orange-500'
              : accent === 'blue'   ? 'text-blue-600'
              : 'text-foreground';
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[52px]">
      <div className={`flex items-center gap-1 ${color}`}>
        {icon}
        <span className="text-sm font-semibold">{value}</span>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────
export default function Trials() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [formOpen, setFormOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState<Event | undefined>();

  const { data: events, isLoading } = useQuery({
    queryKey: ['events'],
    queryFn: getEvents,
  });

  const { data: convertedPhones = new Set<string>() } = useQuery({
    queryKey: ['converted_phones'],
    queryFn: getConvertedPhones,
    staleTime: 1000 * 60 * 5,
  });

  const del = useMutation({
    mutationFn: deleteEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      toast.success('이벤트 삭제됨');
    },
    onError: () => toast.error('삭제 실패'),
  });

  const handleDelete = (id: string) => {
    if (!confirm('이벤트와 모든 체험권 기록이 삭제됩니다. 계속할까요?')) return;
    del.mutate(id);
  };

  const activeCount  = events?.filter(e => e.status === 'active').length ?? 0;
  const plannedCount = events?.filter(e => e.status === 'planned').length ?? 0;

  if (isLoading) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">이벤트(무료체험) 관리</h1>
      <DataTableSkeleton columns={4} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">이벤트(무료체험) 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {events?.length ?? 0}개
            {activeCount > 0   && <span className="ml-2 text-teal-600">· 진행중 {activeCount}개</span>}
            {plannedCount > 0  && <span className="ml-2 text-blue-600">· 예정 {plannedCount}개</span>}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => { setEditTarget(undefined); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />이벤트 추가
          </Button>
        )}
      </div>

      {/* 안내 */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
        체험권 발송은 <strong>이용권 관리 → 이용권 발송 → 체험 발송</strong>에서 진행합니다.
        여기서는 이벤트별 현황 및 전환 추적을 확인하세요.
      </div>

      {/* 이벤트 목록 */}
      {(!events || events.length === 0) ? (
        <div className="surface-card ring-container py-16 text-center text-muted-foreground text-sm">
          등록된 이벤트가 없습니다. 이벤트 추가 버튼으로 새 이벤트를 만드세요.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(ev => (
            <EventCard
              key={ev.id}
              event={ev}
              convertedPhones={convertedPhones}
              onEdit={e => { setEditTarget(e); setFormOpen(true); }}
              onDelete={handleDelete}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {/* 이벤트 생성/수정 다이얼로그 */}
      <EventFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(undefined); }}
        initial={editTarget}
      />
    </div>
  );
}
