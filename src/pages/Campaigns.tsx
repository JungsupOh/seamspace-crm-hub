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
  Link2, Copy, QrCode, Image as ImageIcon, Loader2, Send, UserPlus,
  Inbox, Ticket,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { apiCreateCoupon, apiSendCoupon } from '@/lib/coupons';
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
  type?: 'trial' | 'coldmail' | 'event' | 'inquiry';
  start_date?: string;
  end_date?: string;
  status: 'active' | 'ended' | 'planned';
  created_at: string;
}

// 리드 상태 정의
const LEAD_STATUSES = ['신규', '1차발송', '응답', '2차발송', '체험발송', '전환', '보류', '이탈', '스팸'] as const;
type LeadStatus = typeof LEAD_STATUSES[number];
const LEAD_STATUS_META: Record<LeadStatus, { color: string }> = {
  '신규':     { color: 'bg-blue-100 text-blue-700' },
  '1차발송':  { color: 'bg-indigo-100 text-indigo-700' },
  '응답':     { color: 'bg-purple-100 text-purple-700' },
  '2차발송':  { color: 'bg-violet-100 text-violet-700' },
  '체험발송':  { color: 'bg-teal-100 text-teal-700' },
  '전환':     { color: 'bg-emerald-100 text-emerald-700' },
  '보류':     { color: 'bg-amber-100 text-amber-700' },
  '이탈':     { color: 'bg-slate-100 text-slate-500' },
  '스팸':     { color: 'bg-red-100 text-red-600' },
};

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

interface CampaignLead {
  id: string;
  campaign_id: string;
  school_name?: string;
  school_kind?: string;
  position?: string;
  name: string;
  phone: string;
  phone_normalized?: string;
  email?: string;
  source?: string;
  source_etc?: string;
  marketing_consent?: boolean;
  status: string;
  is_existing_customer?: boolean;
  converted_contact_id?: string;
  sent_at?: string;
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

async function addCampaignLicense(row: Omit<CampaignLicense, 'id' | 'created_at'>): Promise<CampaignLicense> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || `라이선스 저장 실패 (${r.status})`);
  }
  const inserted = await r.json();
  if (!Array.isArray(inserted) || inserted.length === 0) {
    throw new Error('라이선스 저장 응답이 비어있음 — INSERT 실패 가능성');
  }
  return inserted[0];
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

// ── 리드 API ──────────────────────────────────────
async function getCampaignLeads(campaignId: string): Promise<CampaignLead[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_leads?campaign_id=eq.${campaignId}&order=created_at.desc`,
    { headers: HEADERS }
  );
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

async function updateCampaignLead(id: string, patch: Partial<CampaignLead>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${id}`, {
    method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('리드 업데이트 실패');
}

async function deleteCampaignLead(id: string): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${id}`, {
    method: 'DELETE', headers: HEADERS,
  });
  if (!r.ok) throw new Error('리드 삭제 실패');
}

// 비동기 함수 재시도 헬퍼 — 지수 백오프
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
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
      const body: Partial<Campaign> = { ...form, status: form.status as Campaign['status'] };
      if (isEdit) {
        // 기존 캠페인에 slug 없으면 자동 생성 (구 events에서 마이그레이션된 경우 대응)
        if (!initial!.slug) body.slug = generateSlug();
        await updateCampaign(initial!.id, body);
      } else {
        await createCampaign({ ...(body as Omit<Campaign, 'id' | 'created_at'>), slug: generateSlug() });
      }
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
  const [activeTab, setActiveTab] = useState<'leads' | 'licenses'>('leads');

  // 캠페인 펼칠 때 즉시 쿠폰 상태 동기화
  // 1. Edge Function으로 mDiary → mdiary_coupons 동기화
  // 2. mdiary_coupons에서 상태 읽어와 campaign_licenses 직접 업데이트 (프론트에서)
  const { data: syncDone } = useQuery({
    queryKey: ['campaign_license_sync', campaign.id],
    queryFn: async () => {
      const lics = await getCampaignLicenses(campaign.id);
      const pendingCodes = lics
        .filter(l => l.coupon_code && (l.status === '대기' || l.status === '사용중'))
        .map(l => l.coupon_code!);
      if (pendingCodes.length === 0) return true;

      // Step 1: Edge Function → mDiary MySQL 조회 → mdiary_coupons 업데이트
      await fetch(`${SUPABASE_URL}/functions/v1/get-coupon-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ codes: pendingCodes, limit: pendingCodes.length }),
      }).catch(() => {});

      // Step 2: mdiary_coupons에서 최신 상태 읽기
      const mdiaryRes = await fetch(
        `${SUPABASE_URL}/rest/v1/mdiary_coupons?coupon_code=in.(${pendingCodes.map(c => `"${c}"`).join(',')})&select=coupon_code,is_used,service_expire_at`,
        { headers: HEADERS }
      );
      if (!mdiaryRes.ok) return true;
      const mdiaryData: { coupon_code: string; is_used: boolean; service_expire_at?: string }[] = await mdiaryRes.json();
      if (!Array.isArray(mdiaryData) || mdiaryData.length === 0) return true;

      // Step 3: campaign_licenses 직접 업데이트 (프론트에서)
      const today = new Date().toISOString().slice(0, 10);
      await Promise.all(mdiaryData.map(m => {
        const status = !m.is_used ? '대기'
          : (m.service_expire_at && m.service_expire_at < today) ? '만료'
          : '사용중';
        return fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses?coupon_code=eq.${encodeURIComponent(m.coupon_code)}`, {
          method: 'PATCH',
          headers: HEADERS,
          body: JSON.stringify({ status, service_expire_at: m.service_expire_at ?? null }),
        }).catch(() => {});
      }));

      qc.invalidateQueries({ queryKey: ['campaign_licenses', campaign.id] });
      return true;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  // 동기화 후 라이선스 통계 (동기화 완료 시만 표시)
  const { data: syncedLicenses } = useQuery({
    queryKey: ['campaign_licenses', campaign.id],
    queryFn: () => getCampaignLicenses(campaign.id),
  });
  const normalize = (p?: string) => (p ?? '').replace(/\D/g, '');
  const licTotal    = syncedLicenses?.length ?? 0;
  const licActive   = syncedLicenses?.filter(l => l.status === '사용중').length ?? 0;
  const licExpired  = syncedLicenses?.filter(l => l.status === '만료').length ?? 0;
  const licConverted = syncedLicenses?.filter(l => convertedPhones.has(normalize(l.contact_phone))).length ?? 0;
  const convRate    = licTotal > 0 ? Math.round((licConverted / licTotal) * 100) : 0;

  return (
    <div>
      {/* 동기화 후 이용권 통계 */}
      {syncDone && licTotal > 0 && (
        <div className="flex items-center gap-5 px-2 py-2.5 mb-3 rounded-lg bg-muted/20 border border-border">
          <Stat icon={<Ticket className="h-3.5 w-3.5" />} label="발송" value={licTotal} />
          <Stat icon={<Clock className="h-3.5 w-3.5" />} label="사용중" value={licActive} accent="teal" />
          <Stat icon={<XCircle className="h-3.5 w-3.5" />} label="만료" value={licExpired} accent="orange" />
          <Stat icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="딜 전환" value={`${licConverted} (${convRate}%)`} accent="blue" />
        </div>
      )}
      <div className="flex border-b border-border mb-3">
        <button onClick={() => setActiveTab('leads')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5
            ${activeTab === 'leads' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Inbox className="h-3.5 w-3.5" />리드
        </button>
        <button onClick={() => setActiveTab('licenses')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5
            ${activeTab === 'licenses' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Ticket className="h-3.5 w-3.5" />발송된 체험권
        </button>
      </div>
      {activeTab === 'leads' ? (
        <CampaignLeadsTab campaign={campaign} />
      ) : (
        <CampaignLicensesTab campaign={campaign} convertedPhones={convertedPhones} />
      )}
    </div>
  );
}

// ── 통합 리드 행 타입 (campaign_leads + orphan campaign_licenses) ──
// customerTier: 이 참여자가 이번 캠페인에 들어오기 *이전* 상태
//   'new'        — 처음 심스페이스를 접함
//   'retrial'    — 다른 캠페인에서 체험권 받은 이력 있음
//   'purchased'  — 실제 구매한 고객 (VIP)
type CustomerTier = 'new' | 'retrial' | 'purchased';

interface ParticipantRow {
  id: string;                             // lead id or license id
  origin: 'form' | 'manual';              // form = 공개 폼, manual = 수동 체험권 등록
  leadRef?: CampaignLead;                 // origin=form인 경우 원본
  name: string;
  school_name?: string;
  school_kind?: string;
  phone: string;
  phone_normalized?: string;
  email?: string;
  position?: string;
  source?: string;
  source_etc?: string;
  status: string;
  customerTier: CustomerTier;
  created_at: string;
  // 재발송용 — 이미 발송된 경우에만 존재
  coupon_code?: string;
  duration?: string;
  user_count?: string;
}

// ── 리드 탭 — 캠페인 참여자 통합 뷰 ───────────────────
function CampaignLeadsTab({ campaign }: { campaign: Campaign }) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ['campaign_leads', campaign.id],
    queryFn: () => getCampaignLeads(campaign.id),
  });
  const { data: licenses, isLoading: licensesLoading } = useQuery({
    queryKey: ['campaign_licenses', campaign.id],
    queryFn: () => getCampaignLicenses(campaign.id),
  });
  // 전체 캠페인별 라이선스 + 구매고객 contacts 로드 (이력 판별용)
  //   phone(normalized) → { otherCampaignTrial: boolean, purchased: boolean }
  //   otherCampaignTrial: 현재 캠페인 *외* 다른 캠페인에서 체험권 수령 이력 있는지
  const { data: historyMap } = useQuery({
    queryKey: ['campaign_history_phones', campaign.id],
    queryFn: async (): Promise<Map<string, { otherCampaignTrial: boolean; purchased: boolean }>> => {
      const map = new Map<string, { otherCampaignTrial: boolean; purchased: boolean }>();
      const [allLicsRes, purchasedRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/campaign_licenses?select=contact_phone,campaign_id`, { headers: HEADERS }),
        fetch(`${SUPABASE_URL}/rest/v1/contacts?contact_type=eq.${encodeURIComponent('구매고객')}&select=phone_normalized`, { headers: HEADERS }),
      ]);
      const allLics: { contact_phone?: string; campaign_id?: string }[] = allLicsRes.ok ? await allLicsRes.json() : [];
      const purchased: { phone_normalized?: string }[] = purchasedRes.ok ? await purchasedRes.json() : [];
      if (Array.isArray(allLics)) {
        allLics.forEach(l => {
          const p = (l.contact_phone ?? '').replace(/\D/g, '');
          if (!p) return;
          const entry = map.get(p) ?? { otherCampaignTrial: false, purchased: false };
          if (l.campaign_id && l.campaign_id !== campaign.id) entry.otherCampaignTrial = true;
          map.set(p, entry);
        });
      }
      if (Array.isArray(purchased)) {
        purchased.forEach(c => {
          const p = c.phone_normalized ?? '';
          if (!p) return;
          const entry = map.get(p) ?? { otherCampaignTrial: false, purchased: false };
          entry.purchased = true;
          map.set(p, entry);
        });
      }
      return map;
    },
    staleTime: 1000 * 60 * 2,
  });

  const isLoading = leadsLoading || licensesLoading;

  // campaign_leads + orphan campaign_licenses(lead_id 없음) 병합
  const participants: ParticipantRow[] = (() => {
    const rows: ParticipantRow[] = [];
    // 리드별 대응 라이선스 매핑 (재발송용 쿠폰정보 조회)
    const licensesByLeadId = new Map<string, CampaignLicense>();
    (licenses ?? []).forEach(lic => {
      if (lic.lead_id) licensesByLeadId.set(lic.lead_id, lic);
    });
    // 참여자별 customerTier 계산
    //   purchased > retrial > new 우선순위
    const tierOf = (phoneNorm: string): CustomerTier => {
      if (!phoneNorm) return 'new';
      const h = historyMap?.get(phoneNorm);
      if (!h) return 'new';
      if (h.purchased) return 'purchased';
      if (h.otherCampaignTrial) return 'retrial';
      return 'new';
    };
    (leads ?? []).forEach(l => {
      const lic = licensesByLeadId.get(l.id);
      const phoneNorm = l.phone_normalized || l.phone.replace(/\D/g, '');
      rows.push({
        id: `lead:${l.id}`,
        origin: 'form',
        leadRef: l,
        name: l.name,
        school_name: l.school_name,
        school_kind: l.school_kind,
        phone: l.phone,
        phone_normalized: phoneNorm,
        email: l.email,
        position: l.position,
        source: l.source,
        source_etc: l.source_etc,
        status: l.status,
        customerTier: tierOf(phoneNorm),
        created_at: l.created_at,
        coupon_code: lic?.coupon_code,
        duration: lic?.duration,
        user_count: lic?.user_count,
      });
    });
    (licenses ?? []).filter(lic => !lic.lead_id).forEach(lic => {
      const phoneNorm = (lic.contact_phone ?? '').replace(/\D/g, '');
      rows.push({
        id: `license:${lic.id}`,
        origin: 'manual',
        name: lic.contact_name ?? '-',
        school_name: lic.org_name,
        phone: lic.contact_phone ?? '',
        phone_normalized: phoneNorm,
        status: '발송완료',
        customerTier: tierOf(phoneNorm),
        created_at: lic.created_at,
        coupon_code: lic.coupon_code,
        duration: lic.duration,
        user_count: lic.user_count,
      });
    });
    // 최신순
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  })();

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(p => p.id)));
    }
  };

  const handleSend = async () => {
    // 선택된 id는 "lead:{leadId}" 형식 — form origin만 발송 대상
    const targets = (leads ?? []).filter(l => selectedIds.has(`lead:${l.id}`));
    if (targets.length === 0) { toast.error('발송할 리드를 선택하세요'); return; }

    setSending(true);
    setSendProgress({ done: 0, total: targets.length });

    let successCount = 0;
    let partialCount = 0; // 알림톡은 갔으나 DB 일부 누락
    for (let i = 0; i < targets.length; i++) {
      const lead = targets[i];

      // ─── Phase 1: 알림톡 발송까지 (실패 시 사용자에게 안 감 → '실패') ───
      let code: string;
      try {
        // 1. 쿠폰 생성
        const description = `${campaign.name} ${lead.school_name ?? ''} ${lead.name} 체험이용권`.trim();
        code = await apiCreateCoupon(description, '1', '40');

        // 2. 알림톡 발송 — 이 단계까지 통과하면 사용자에게 메시지가 이미 전송됨
        await apiSendCoupon({
          first_name: lead.name,
          phone: lead.phone,
          coupon_code: code,
          user_limit: '40',
          duration: '1',
          send_type: 'trial',
        });
      } catch (e) {
        // 알림톡 발송 전 실패 → 사용자에게 메시지 안 갔으므로 안전하게 '실패' 처리 후 재시도 가능
        await updateCampaignLead(lead.id, { status: '실패' }).catch(() => {});
        console.warn(`[알림톡 발송 실패] ${lead.name}:`, e);
        setSendProgress({ done: i + 1, total: targets.length });
        continue;
      }

      // ─── Phase 2: DB 저장 (실패 시 자동 재시도 3회까지) ───
      let licenseSaved = false;
      let contactId: string | null = null;

      // 3. campaign_licenses 저장 (재시도)
      try {
        await withRetry(() => addCampaignLicense({
          campaign_id:   campaign.id,
          lead_id:       lead.id,
          coupon_code:   code,
          contact_name:  lead.name,
          contact_phone: lead.phone,
          org_name:      lead.school_name,
          duration:      '1',
          user_count:    '40',
          status:        '대기',
        }));
        licenseSaved = true;
      } catch (e) {
        console.warn(`[campaign_licenses 3회 재시도 모두 실패] ${lead.name} (코드: ${code}):`, e);
        toast.error(`${lead.name}: 알림톡 발송됨, DB 저장 실패. 쿠폰 코드: ${code} (수동 등록 필요)`, { duration: 12000 });
      }

      // 4. contacts upsert — phone_normalized 기준 (재시도)
      try {
        const phoneNorm = (lead.phone_normalized || lead.phone.replace(/\D/g, ''));
        contactId = await withRetry(async (): Promise<string | null> => {
          const existingRes = await fetch(
            `${SUPABASE_URL}/rest/v1/contacts?phone_normalized=eq.${encodeURIComponent(phoneNorm)}&select=id`,
            { headers: HEADERS }
          );
          if (!existingRes.ok) throw new Error('contacts 조회 실패');
          const existing = await existingRes.json();
          if (Array.isArray(existing) && existing.length > 0) return existing[0].id;

          const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
            method: 'POST',
            headers: { ...HEADERS, Prefer: 'return=representation' },
            body: JSON.stringify({
              name:             lead.name,
              phone:            lead.phone,
              phone_normalized: phoneNorm,
              email:            lead.email ?? null,
              org_name:         lead.school_name ?? null,
              lead_source:      campaign.name,
              lead_stage:       '관심',
              notes:            `[${new Date().toISOString().slice(0,10)}] 캠페인 "${campaign.name}" 체험이용권 발송 (코드: ${code})`,
            }),
          });
          if (!insertRes.ok) throw new Error('contacts 생성 실패');
          const data = await insertRes.json();
          return Array.isArray(data) && data[0] ? data[0].id : null;
        });
      } catch (e) {
        console.warn(`[contacts upsert 3회 재시도 모두 실패] ${lead.name}:`, e);
      }

      // 5. 리드 상태 업데이트 → '체험발송' (알림톡 발송 사실이 가장 중요)
      await updateCampaignLead(lead.id, {
        status: '체험발송',
        converted_contact_id: contactId ?? undefined,
        sent_at: new Date().toISOString(),
      }).catch(() => {});

      if (licenseSaved && contactId) successCount++;
      else partialCount++;
      setSendProgress({ done: i + 1, total: targets.length });
    }

    setSending(false);
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey: ['campaign_leads', campaign.id] });
    qc.invalidateQueries({ queryKey: ['campaign_licenses', campaign.id] });
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    if (partialCount > 0) {
      toast.warning(`${targets.length}건 알림톡 발송 완료 — 그중 ${partialCount}건은 DB 저장 일부 누락 (콘솔 확인)`);
    } else {
      toast.success(`${successCount}/${targets.length}건 발송 완료`);
    }
  };

  // 일괄 상태 변경
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const handleBulkStatusChange = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    const leadIds = [...selectedIds]
      .filter(id => id.startsWith('lead:'))
      .map(id => id.replace(/^lead:/, ''));
    if (leadIds.length === 0) { toast.error('폼 출처 리드만 상태 변경 가능합니다'); return; }
    try {
      await Promise.all(leadIds.map(id => updateCampaignLead(id, { status: bulkStatus })));
      toast.success(`${leadIds.length}건 상태를 '${bulkStatus}'로 변경`);
      setSelectedIds(new Set());
      setBulkStatus('');
      qc.invalidateQueries({ queryKey: ['campaign_leads', campaign.id] });
    } catch { toast.error('상태 변경 실패'); }
  };

  // 엑셀 다운로드
  const handleDownload = () => {
    const targets = statusFilter === '전체'
      ? participants
      : participants.filter(p => p.status === statusFilter);
    if (targets.length === 0) { toast.error('다운로드할 데이터가 없습니다'); return; }
    const rows = targets.map(p => ({
      '이름':     p.name,
      '학교':     p.school_name ?? '',
      '연락처':   p.phone,
      '이메일':   p.email ?? '',
      '담당업무':  p.position ?? '',
      '경로':     p.source === '기타' ? (p.source_etc ?? '기타') : (p.source ?? ''),
      '출처':     p.origin === 'form' ? '폼' : '수동',
      '구분':     p.customerTier === 'purchased' ? '구매고객' : p.customerTier === 'retrial' ? '재신청' : '신규',
      '쿠폰코드':  p.coupon_code ?? '',
      '상태':     p.status,
      '등록일':   p.created_at.slice(0, 10),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '리드');
    const filterLabel = statusFilter === '전체' ? '' : `_${statusFilter}`;
    XLSX.writeFile(wb, `${campaign.name}_리드${filterLabel}_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast.success(`${targets.length}건 다운로드`);
  };

  // 상태 필터
  const [statusFilter, setStatusFilter] = useState<string>('전체');

  if (isLoading) return <div className="py-6 text-center text-sm text-muted-foreground">로딩 중...</div>;

  const filtered = statusFilter === '전체'
    ? participants.filter(p => p.status !== '스팸') // 스팸은 기본 숨김
    : participants.filter(p => p.status === statusFilter);

  // 통계 (전체 기준)
  const statusCounts = new Map<string, number>();
  participants.forEach(p => statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1));

  // 이용권 발송 가능 수 (form 출처 + 신규 + 기존고객 아님)
  const sendableCount = filtered.filter(p => p.origin === 'form' && p.status === '신규' && p.customerTier === 'new').length;

  const selectAllNew = () => {
    const selectable = filtered.filter(p => p.origin === 'form' && p.status === '신규' && p.customerTier === 'new');
    setSelectedIds(new Set(selectable.map(p => p.id)));
  };

  // 리드 삭제
  const [deleteTarget, setDeleteTarget] = useState<ParticipantRow | null>(null);
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.origin === 'form') {
        const leadId = deleteTarget.id.replace(/^lead:/, '');
        // 연결된 licenses도 함께 삭제 (FK ON DELETE SET NULL이면 lead_id만 끊김 — 여기선 함께 제거)
        const licsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/campaign_licenses?lead_id=eq.${leadId}`,
          { method: 'DELETE', headers: HEADERS }
        ).catch(() => null);
        await deleteCampaignLead(leadId);
      } else {
        const licId = deleteTarget.id.replace(/^license:/, '');
        await deleteCampaignLicense(licId);
      }
      toast.success(`${deleteTarget.name} 리드 삭제됨`);
      qc.invalidateQueries({ queryKey: ['campaign_leads', campaign.id] });
      qc.invalidateQueries({ queryKey: ['campaign_licenses', campaign.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e) {
      toast.error(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleteTarget(null);
    }
  };

  // 동일한 쿠폰코드로 알림톡 재발송
  const [resendingId, setResendingId] = useState<string | null>(null);
  const handleResend = async (p: ParticipantRow) => {
    if (!p.coupon_code || !p.phone) {
      toast.error('쿠폰코드 또는 연락처가 없어 재발송할 수 없습니다');
      return;
    }
    setResendingId(p.id);
    try {
      await apiSendCoupon({
        first_name: p.name,
        phone: p.phone,
        coupon_code: p.coupon_code,
        user_limit: p.user_count || '40',
        duration: p.duration || '1',
        send_type: 'trial',
      });
      toast.success(`${p.name}님에게 재발송 완료 (코드 ${p.coupon_code})`);
    } catch (e) {
      toast.error(`재발송 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="space-y-2">
      {/* 상단: 상태 통계 */}
      <div className="flex flex-wrap gap-1.5 px-1 text-xs">
        <button onClick={() => setStatusFilter('전체')}
          className={`px-2 py-1 rounded-full border transition-colors ${statusFilter === '전체' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted/50'}`}>
          전체 {participants.filter(p => p.status !== '스팸').length}
        </button>
        {LEAD_STATUSES.filter(s => statusCounts.has(s)).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-2 py-1 rounded-full border transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted/50'}`}>
            {s} {statusCounts.get(s)}
          </button>
        ))}
      </div>

      {/* 툴바: 액션 */}
      <div className="flex items-center justify-between px-1 flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {/* 일괄 상태 변경 */}
          {selectedIds.size > 0 && !sending && (
            <>
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="상태 변경" /></SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
              {bulkStatus && (
                <Button size="sm" variant="outline" onClick={handleBulkStatusChange}
                  className="h-7 text-xs px-2">
                  {selectedIds.size}건 변경
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {sendableCount > 0 && !sending && (
            <Button size="sm" variant="outline" onClick={selectAllNew}
              className="h-7 text-xs px-2.5">
              신규 전체 선택 ({sendableCount})
            </Button>
          )}
          <Button size="sm"
            disabled={selectedIds.size === 0 || sending}
            onClick={handleSend}
            className="h-7 text-xs px-3">
            {sending
              ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />발송 중 {sendProgress.done}/{sendProgress.total}</>
              : <><Send className="h-3 w-3 mr-1" />선택한 {selectedIds.size}명 이용권 발송</>}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownload}
            className="h-7 text-xs px-2.5">
            <Upload className="h-3 w-3 mr-1 rotate-180" />다운로드
          </Button>
        </div>
      </div>

      {/* 목록 */}
      {filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          아직 수집된 리드가 없습니다.<br />
          <span className="text-xs">공개 폼 URL을 공유해서 리드를 받거나, "발송된 체험권" 탭에서 수동 등록하세요.</span>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 w-8">
                  <input type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                    disabled={filtered.length === 0}
                    className="accent-primary" />
                </th>
                <th className="p-2 text-left">이름</th>
                <th className="p-2 text-left">학교</th>
                <th className="p-2 text-left">연락처</th>
                <th className="p-2 text-left">담당</th>
                <th className="p-2 text-left">경로</th>
                <th className="p-2 text-left">출처</th>
                <th className="p-2 text-left">쿠폰</th>
                <th className="p-2 text-left">상태</th>
                <th className="p-2 text-left">등록일</th>
                <th className="p-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(p => {
                const statusColor = LEAD_STATUS_META[p.status as LeadStatus]?.color ?? 'bg-slate-100 text-slate-600';
                return (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="p-2 text-center">
                      <input type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="accent-primary" />
                    </td>
                    <td className="p-2 font-medium">
                      {p.name}
                      {p.customerTier === 'purchased' ? (
                        <span className="ml-1.5 inline-block bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded text-[10px] font-semibold">구매고객</span>
                      ) : p.customerTier === 'retrial' ? (
                        <span className="ml-1.5 inline-block bg-amber-100 text-amber-700 px-1 py-0.5 rounded text-[10px]">재신청</span>
                      ) : (
                        <span className="ml-1.5 inline-block bg-blue-50 text-blue-700 px-1 py-0.5 rounded text-[10px]">신규</span>
                      )}
                    </td>
                    <td className="p-2">
                      {p.school_name || '-'}
                      {p.school_kind && <span className="text-muted-foreground ml-1">({p.school_kind})</span>}
                    </td>
                    <td className="p-2 font-mono">{p.phone || '-'}</td>
                    <td className="p-2">{p.position || '-'}</td>
                    <td className="p-2">{p.source === '기타' ? (p.source_etc || '기타') : (p.source || '-')}</td>
                    <td className="p-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.origin === 'form' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                        {p.origin === 'form' ? '폼' : '수동'}
                      </span>
                    </td>
                    <td className="p-2">
                      {p.coupon_code ? (
                        <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{p.coupon_code}</span>
                      ) : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusColor}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="p-2 text-muted-foreground">{p.created_at.slice(0, 10)}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {p.coupon_code && p.phone && (
                          <button onClick={() => handleResend(p)}
                            disabled={resendingId === p.id}
                            title="같은 쿠폰코드로 알림톡 재발송"
                            className="text-[10px] text-primary hover:underline disabled:opacity-50 flex items-center gap-1">
                            {resendingId === p.id
                              ? <><Loader2 className="h-3 w-3 animate-spin" />재발송</>
                              : <><Send className="h-3 w-3" />재발송</>}
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget(p)}
                          title="리드 삭제"
                          className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 리드 삭제 확인 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>리드 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> ({deleteTarget?.phone}) 리드를 삭제할까요?
              {deleteTarget?.origin === 'form' && deleteTarget?.coupon_code && (
                <span className="block mt-2 text-amber-600">
                  ⚠️ 발송된 쿠폰({deleteTarget.coupon_code}) 기록도 함께 삭제됩니다.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── 체험권 탭 (기존 목록) ──────────────────────────
function CampaignLicensesTab({ campaign, convertedPhones }: { campaign: Campaign; convertedPhones: Set<string> }) {
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

  // 동기화는 CampaignDetail 레벨에서 실행 (캠페인 펼칠 때 즉시)

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

  const { data: leads } = useQuery({
    queryKey: ['campaign_leads', campaign.id],
    queryFn: () => getCampaignLeads(campaign.id),
  });
  const { data: licenses } = useQuery({
    queryKey: ['campaign_licenses', campaign.id],
    queryFn: () => getCampaignLicenses(campaign.id),
  });

  const newLeads = leads?.filter(l => l.status === '신규').length ?? 0;
  const total    = licenses?.length ?? 0;

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

        {/* 통계 (동기화 전에도 정확한 것만 표시) */}
        <div className="flex items-center gap-5 shrink-0">
          <Stat icon={<Inbox className="h-3.5 w-3.5" />} label="신규 리드" value={newLeads} accent="purple" />
          <Stat icon={<Ticket className="h-3.5 w-3.5" />} label="발송" value={total} />
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
              : accent === 'purple' ? 'text-purple-600'
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
        캠페인 공개 폼 URL/QR을 공유해 리드를 수집하고, <strong>리드 탭에서 선택 → 이용권 발송</strong>하면 자동으로 고객 DB로 전환됩니다.
        캠페인별 참여자와 전환 현황을 한눈에 확인하세요.
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
