import { useState, useRef } from 'react';
import { formatPhone } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import {
  Plus, ChevronDown, ChevronRight, ArrowRight, ExternalLink,
  Calendar, Users, CheckCircle2, XCircle, Clock, Trash2, Upload,
  Link2, Copy, QrCode, Image as ImageIcon, Loader2,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

// ── Types ─────────────────────────────────────────
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
  created_at: string;
}

interface CampaignLicense {
  id: string;
  campaign_id: string;
  lead_id?: string;
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
async function getCampaigns(): Promise<Campaign[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?order=created_at.desc`, { headers: HEADERS });
  if (!r.ok) throw new Error('캠페인 조회 실패');
  return r.json();
}

async function createCampaign(c: Omit<Campaign, 'id' | 'created_at'>): Promise<Campaign> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaigns`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(c),
  });
  if (!r.ok) throw new Error('캠페인 생성 실패');
  const data = await r.json();
  return data[0];
}

async function updateCampaign(id: string, c: Partial<Campaign>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(c),
  });
  if (!r.ok) throw new Error('캠페인 수정 실패');
}

async function deleteCampaign(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${id}`, {
    method: 'DELETE', headers: HEADERS,
  });
  if (!r.ok) throw new Error('캠페인 삭제 실패');
}

async function getCampaignLicenses(campaignId: string): Promise<CampaignLicense[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_licenses?campaign_id=eq.${campaignId}&order=created_at.asc`,
    { headers: HEADERS }
  );
  if (!r.ok) throw new Error('캠페인 이용권 조회 실패');
  return r.json();
}

async function addCampaignLicense(row: Omit<CampaignLicense, 'id' | 'created_at'>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('추가 실패');
}

async function deleteCampaignLicense(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses?id=eq.${id}`, {
    method: 'DELETE', headers: HEADERS,
  });
  if (!r.ok) throw new Error('삭제 실패');
}

async function updateCampaignLicense(id: string, patch: Partial<CampaignLicense>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses?id=eq.${id}`, {
    method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('수정 실패');
}

async function bulkAddCampaignLicenses(rows: Omit<CampaignLicense, 'id' | 'created_at'>[]): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses`, {
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
  service_expire_at?: string; status?: CampaignLicense['status'];
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
          status:            (['대기','사용중','만료'].includes(r['상태']) ? r['상태'] : '대기') as CampaignLicense['status'],
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
const CAMPAIGN_STATUS: Record<Campaign['status'], { label: string; color: string }> = {
  active:  { label: '진행중', color: 'bg-teal-100 text-teal-700' },
  ended:   { label: '종료',   color: 'bg-slate-100 text-slate-500' },
  planned: { label: '예정',   color: 'bg-blue-100 text-blue-700' },
};

const LIC_STATUS: Record<CampaignLicense['status'], { label: string; color: string }> = {
  대기:   { label: '대기',   color: 'bg-slate-100 text-slate-600' },
  사용중: { label: '사용중', color: 'bg-teal-100 text-teal-700' },
  만료:   { label: '만료',   color: 'bg-orange-100 text-orange-700' },
};

// ── CampaignFormDialog ────────────────────────────
interface CampaignFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: Campaign;
}

function CampaignFormDialog({ open, onClose, initial }: CampaignFormDialogProps) {
  const qc = useQueryClient();
  const isEdit = !!initial;

  const [form, setForm] = useState({
    name:        initial?.name        ?? '',
    title:       initial?.title       ?? '',
    description: initial?.description ?? '',
    image_url:   initial?.image_url   ?? '',
    start_date:  initial?.start_date  ?? '',
    end_date:    initial?.end_date    ?? '',
    status:      (initial?.status     ?? 'active') as Campaign['status'],
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const f = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadCampaignImage(file);
      f('image_url', url);
      toast.success('이미지 업로드됨');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...form, status: form.status as Campaign['status'] };
      if (isEdit) await updateCampaign(initial!.id, body);
      else        await createCampaign({ ...body, slug: generateSlug() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(isEdit ? '캠페인 수정됨' : '캠페인 생성됨');
      onClose();
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '캠페인 수정' : '캠페인 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">캠페인명 * <span className="text-muted-foreground">(내부 관리용)</span></Label>
            <Input value={form.name} onChange={e => f('name', e.target.value)} placeholder="예: 2026 봄학기 체험" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">공개 폼 제목 <span className="text-muted-foreground">(사용자 노출)</span></Label>
            <Input value={form.title} onChange={e => f('title', e.target.value)} placeholder="예: 2026 봄학기 심스페이스 체험 신청" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">공개 폼 이미지</Label>
            <div className="flex items-start gap-2">
              {form.image_url ? (
                <div className="relative group">
                  <img src={form.image_url} alt="캠페인 이미지" className="w-20 h-20 object-cover rounded border border-border" />
                  <button type="button" onClick={() => f('image_url', '')}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
                  className="w-20 h-20 border-2 border-dashed border-border rounded flex items-center justify-center hover:border-primary/50 transition-colors disabled:opacity-50">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                </button>
              )}
              <div className="flex-1 text-xs text-muted-foreground pt-1">
                공개 폼 상단에 표시됩니다. 권장 크기: 600×600px 이상.<br />
                JPG, PNG, WebP (5MB 이하)
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) handleImageUpload(file); }} />
            </div>
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
            {save.isPending ? '저장 중...' : (isEdit ? '수정 저장' : '캠페인 추가')}
          </Button>

          {/* 수정 모드에서만 공개 URL + QR 노출 */}
          {isEdit && initial?.slug && (
            <div className="pt-3 border-t border-border">
              <CampaignShareSection campaign={initial} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 공개 폼 slug 생성 — 8자리 랜덤 해시
function generateSlug(): string {
  return Math.random().toString(36).slice(2, 10);
}

// 캠페인 이미지 업로드 (Supabase Storage)
async function uploadCampaignImage(file: File): Promise<string> {
  const ts = Date.now();
  const dotIdx = file.name.lastIndexOf('.');
  const rawExt = dotIdx >= 0 ? file.name.slice(dotIdx + 1) : 'png';
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'png';
  const path = `${ts}-${crypto.randomUUID()}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/campaign-images/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || `이미지 업로드 실패 (${r.status})`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/campaign-images/${path}`;
}

// ── AddLicenseRow ─────────────────────────────────
const EMPTY_ROW = { org_name: '', contact_name: '', contact_phone: '', coupon_code: '', duration: '1', user_count: '10', status: '대기' as CampaignLicense['status'], service_expire_at: '' };

interface AddLicenseRowProps {
  campaignId: string;
  onDone: () => void;
}
function AddLicenseRow({ campaignId, onDone }: AddLicenseRowProps) {
  const qc = useQueryClient();
  const [row, setRow] = useState({ ...EMPTY_ROW });
  const r = (k: keyof typeof row, v: string) => setRow(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => addCampaignLicense({
      campaign_id: campaignId,
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
      qc.invalidateQueries({ queryKey: ['campaign_licenses', campaignId] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
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
      <Input value={row.contact_phone} onChange={e => r('contact_phone', formatPhone(e.target.value))}
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

// ── CampaignDetail ────────────────────────────────
interface CampaignDetailProps {
  campaign: Campaign;
  convertedPhones: Set<string>;
}

function CampaignDetail({ campaign, convertedPhones }: CampaignDetailProps) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Partial<CampaignLicense>>({});
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const rows = await parseExcel(file);
      if (rows.length === 0) { toast.error('데이터가 없습니다'); return; }
      await bulkAddCampaignLicenses(rows.map(r => ({ ...r, campaign_id: campaign.id, status: r.status ?? '대기' })));
      qc.invalidateQueries({ queryKey: ['campaign_licenses', campaign.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`${rows.length}건 가져오기 완료`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const { data: licenses, isLoading } = useQuery({
    queryKey: ['campaign_licenses', campaign.id],
    queryFn: () => getCampaignLicenses(campaign.id),
  });

  const normalize = (p?: string) => (p ?? '').replace(/\D/g, '');
  const isConverted = (phone?: string) => phone ? convertedPhones.has(normalize(phone)) : false;

  const delMut = useMutation({
    mutationFn: deleteCampaignLicense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign_licenses', campaign.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('삭제됨');
    },
    onError: () => toast.error('삭제 실패'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CampaignLicense> }) => updateCampaignLicense(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign_licenses', campaign.id] });
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
      {adding && <AddLicenseRow campaignId={campaign.id} onDone={() => setAdding(false)} />}

      {/* 목록 */}
      {(!licenses || licenses.length === 0) && !adding ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          발송된 체험권이 없습니다.<br />
          <span className="text-xs">위 "수신자 추가" 버튼으로 기존 발송 내역을 등록하거나,<br />이용권 관리 → 이용권 발송 → 체험 발송에서 이 캠페인으로 발송하세요.</span>
        </div>
      ) : licenses?.map(lic => {
        const converted = isConverted(lic.contact_phone);
        const today = new Date().toISOString().split('T')[0];
        const expired = lic.service_expire_at && lic.service_expire_at < today;
        const statusMeta = LIC_STATUS[lic.status];
        const isEditing = editingId === lic.id;

        if (isEditing) {
          const er = (k: keyof CampaignLicense, v: string) => setEditRow(p => ({ ...p, [k]: v }));
          return (
            <div key={lic.id} className="grid grid-cols-12 gap-1.5 items-center px-2 py-2 rounded-lg border-2 border-dashed border-amber-400/50 bg-amber-50/30">
              <Input defaultValue={lic.org_name} onChange={e => er('org_name', e.target.value)}
                placeholder="학교/기관" className="col-span-3 h-7 text-xs" />
              <Input defaultValue={lic.contact_name} onChange={e => er('contact_name', e.target.value)}
                placeholder="이름" className="col-span-2 h-7 text-xs" />
              <Input defaultValue={lic.contact_phone} onChange={e => er('contact_phone', formatPhone(e.target.value))}
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

// ── CampaignCard ──────────────────────────────────
interface CampaignCardProps {
  campaign: Campaign;
  convertedPhones: Set<string>;
  onEdit: (c: Campaign) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
}

function CampaignCard({ campaign, convertedPhones, onEdit, onDelete, canEdit }: CampaignCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: licenses } = useQuery({
    queryKey: ['campaign_licenses', campaign.id],
    queryFn: () => getCampaignLicenses(campaign.id),
  });

  const normalize = (p?: string) => (p ?? '').replace(/\D/g, '');
  const total      = licenses?.length ?? 0;
  const active     = licenses?.filter(l => l.status === '사용중').length ?? 0;
  const expired    = licenses?.filter(l => l.status === '만료').length ?? 0;
  const converted  = licenses?.filter(l => convertedPhones.has(normalize(l.contact_phone))).length ?? 0;
  const convRate   = total > 0 ? Math.round((converted / total) * 100) : 0;

  const statusMeta = CAMPAIGN_STATUS[campaign.status];

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
            <span className="font-semibold">{campaign.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.color}`}>
              {statusMeta.label}
            </span>
          </div>
          {(campaign.start_date || campaign.end_date) && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {campaign.start_date ?? '?'} ~ {campaign.end_date ?? '?'}
            </div>
          )}
          {campaign.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{campaign.description}</p>
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
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit(campaign)}>수정</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={() => onDelete(campaign.id)}>삭제</Button>
          </div>
        )}
      </div>

      {/* 펼쳐진 수신자 목록 */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-2 space-y-3">
          {campaign.slug && <CampaignShareSection campaign={campaign} />}
          <CampaignDetail campaign={campaign} convertedPhones={convertedPhones} />
        </div>
      )}
    </div>
  );
}

// 공개 폼 URL + QR 섹션
function CampaignShareSection({ campaign }: { campaign: Campaign }) {
  const [qrOpen, setQrOpen] = useState(false);
  const formUrl = `${window.location.origin}/c/${campaign.slug}`;
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(formUrl);
      toast.success('URL 복사됨');
    } catch { toast.error('복사 실패'); }
  };

  const downloadQR = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `campaign_qr_${campaign.slug}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="rounded-lg bg-muted/20 border border-border px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate">{formUrl}</span>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={copyUrl}>
            <Copy className="h-3 w-3 mr-1" />URL 복사
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setQrOpen(p => !p)}>
            <QrCode className="h-3 w-3 mr-1" />QR {qrOpen ? '닫기' : '보기'}
          </Button>
        </div>
      </div>
      {qrOpen && (
        <div className="flex flex-col items-center gap-2 py-3 bg-background rounded border border-border">
          <QRCodeCanvas ref={qrCanvasRef} value={formUrl} size={180} level="M" includeMargin={true} />
          <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={downloadQR}>
            QR 이미지 다운로드
          </Button>
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
export default function Campaigns() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [formOpen, setFormOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState<Campaign | undefined>();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: getCampaigns,
  });

  const { data: convertedPhones = new Set<string>() } = useQuery({
    queryKey: ['converted_phones'],
    queryFn: getConvertedPhones,
    staleTime: 1000 * 60 * 5,
  });

  const del = useMutation({
    mutationFn: deleteCampaign,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('캠페인 삭제됨');
    },
    onError: () => toast.error('삭제 실패'),
  });

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (deleteTargetId) del.mutate(deleteTargetId);
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  const activeCount  = campaigns?.filter(c => c.status === 'active').length ?? 0;
  const plannedCount = campaigns?.filter(c => c.status === 'planned').length ?? 0;

  if (isLoading) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">캠페인</h1>
      <DataTableSkeleton columns={4} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">캠페인</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {campaigns?.length ?? 0}개
            {activeCount > 0   && <span className="ml-2 text-teal-600">· 진행중 {activeCount}개</span>}
            {plannedCount > 0  && <span className="ml-2 text-blue-600">· 예정 {plannedCount}개</span>}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => { setEditTarget(undefined); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />캠페인 추가
          </Button>
        )}
      </div>

      {/* 안내 */}
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
        체험권 발송은 <strong>이용권 관리 → 이용권 발송 → 체험 발송</strong>에서 진행합니다.
        여기서는 캠페인별 현황 및 전환 추적을 확인하세요.
      </div>

      {/* 캠페인 목록 */}
      {(!campaigns || campaigns.length === 0) ? (
        <div className="surface-card ring-container py-16 text-center text-muted-foreground text-sm">
          등록된 캠페인이 없습니다. 캠페인 추가 버튼으로 새 캠페인을 만드세요.
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <CampaignCard
              key={c.id}
              campaign={c}
              convertedPhones={convertedPhones}
              onEdit={camp => { setEditTarget(camp); setFormOpen(true); }}
              onDelete={handleDelete}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {/* 캠페인 생성/수정 다이얼로그 — key 부여해 initial 변경 시 폼 상태 리셋 */}
      <CampaignFormDialog
        key={editTarget?.id ?? 'new'}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(undefined); }}
        initial={editTarget}
      />

      {/* 캠페인 삭제 확인 */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>캠페인 삭제</AlertDialogTitle>
            <AlertDialogDescription>캠페인과 모든 체험권 기록이 삭제됩니다. 계속할까요?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
