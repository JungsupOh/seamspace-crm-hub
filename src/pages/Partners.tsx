import { useState, useRef, useEffect, useCallback, Component } from 'react';
import { formatPhone } from '@/lib/utils';
import type { ErrorInfo, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Upload, Scan, FileText, Trash2, ExternalLink, Building2, Search, TrendingUp, Pencil, Link2, X, Loader2, UserPlus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDeals, useCreateDeal, useContacts } from '@/hooks/use-airtable';
import type { AirtableRecord, DealFields, ContactFields } from '@/types/airtable';
import { airtable } from '@/lib/airtable';
import { getPartnerDeals, getAllPartnerDeals, createPartnerDeal, updatePartnerDeal, deletePartnerDeal, calcCommission, autoLinkPartnerDeals, createDealBuyers, getDealBuyers, deleteDealBuyers } from '@/lib/partner-deals';
import type { PartnerDeal, PartnerDealBuyer } from '@/lib/partner-deals';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { searchSchools, type SchoolInfo } from '@/lib/neis';
import { saveDealUsers } from '@/lib/deal-users';
import { saveDealQuote } from '@/lib/storage';
import { Users } from 'lucide-react';
import { sendInviteEmail } from '@/lib/email';
import { PeriodFilter } from '@/components/PeriodFilter';
import { getPeriodRange, matchesPeriod, sumByPeriod, type PeriodValue } from '@/lib/period';
import { PARTNER_PLAN_LIST, getUnitPrice, getS2BNumber, type QuoteLineItem } from '@/lib/pricing';

const PARTNER_DURATION_OPTIONS = [1, 4, 6, 12];
import { supabase } from '@/lib/supabase';
import { notifyPartnerDeal } from '@/lib/telegram';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const BUCKET = 'partner-files';

const DB_HEADERS = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// ── 타입 ──────────────────────────────────────────
interface Partner {
  id: string;
  name: string;
  business_number: string | null;
  representative: string | null;
  address: string | null;
  business_type: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  commission_rate: number | null;
  notes: string | null;
  status: 'active' | 'inactive';
  created_at: string;
}

interface PartnerFile {
  id: string;
  partner_id: string;
  file_type: FileType;
  file_name: string;
  file_url: string;
  uploaded_at: string;
}

type FileType = 'business_reg' | 'bank_account' | 'contract';
type PartnerFields = Omit<Partner, 'id' | 'created_at'>;

const FILE_META: Record<FileType, { label: string; ocr: boolean }> = {
  business_reg: { label: '사업자등록증', ocr: true },
  bank_account: { label: '통장사본',     ocr: true },
  contract:     { label: '파트너계약서', ocr: false },
};

// ── API ──────────────────────────────────────────
const PARTNER_URL      = `${SUPABASE_URL}/rest/v1/partners`;
const PARTNER_FILE_URL = `${SUPABASE_URL}/rest/v1/partner_files`;

async function getPartners(): Promise<Partner[]> {
  const res = await fetch(`${PARTNER_URL}?order=created_at.asc`, { headers: DB_HEADERS });
  if (!res.ok) throw new Error(`파트너 조회 실패: ${res.status}`);
  return res.json();
}

async function createPartner(fields: Partial<PartnerFields>): Promise<Partner> {
  const res = await fetch(PARTNER_URL, {
    method: 'POST',
    headers: { ...DB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ ...fields, status: fields.status ?? 'active' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `파트너 등록 실패: ${res.status}`);
  }
  const [row] = await res.json();
  return row;
}

async function updatePartner(id: string, fields: Partial<PartnerFields>): Promise<void> {
  const res = await fetch(`${PARTNER_URL}?id=eq.${id}`, {
    method: 'PATCH',
    headers: DB_HEADERS,
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`파트너 수정 실패: ${res.status}`);
}

async function deletePartner(id: string): Promise<void> {
  const res = await fetch(`${PARTNER_URL}?id=eq.${id}`, { method: 'DELETE', headers: DB_HEADERS });
  if (!res.ok) throw new Error(`파트너 삭제 실패: ${res.status}`);
}

async function getPartnerFiles(partnerId: string): Promise<PartnerFile[]> {
  const res = await fetch(
    `${PARTNER_FILE_URL}?partner_id=eq.${encodeURIComponent(partnerId)}&order=uploaded_at.asc`,
    { headers: DB_HEADERS },
  );
  if (!res.ok) throw new Error(`파일 목록 조회 실패: ${res.status}`);
  return res.json();
}

async function deletePartnerFile(id: string): Promise<void> {
  const res = await fetch(`${PARTNER_FILE_URL}?id=eq.${id}`, { method: 'DELETE', headers: DB_HEADERS });
  if (!res.ok) throw new Error(`파일 삭제 실패: ${res.status}`);
}

async function uploadPartnerFile(partnerId: string, fileType: FileType, file: File): Promise<PartnerFile> {
  const ts   = Date.now();
  const ext  = file.name.split('.').pop() || 'bin';
  const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'hwp', 'hwpx', 'zip', 'csv', 'txt']);
  if (!ALLOWED_EXTENSIONS.has(ext.toLowerCase())) {
    throw new Error(`허용되지 않는 파일 형식입니다: .${ext}`);
  }
  const path = `${partnerId}/${fileType}-${ts}.${ext}`;

  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.message || `업로드 실패: ${uploadRes.status}`);
  }

  const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  const dbRes = await fetch(PARTNER_FILE_URL, {
    method: 'POST',
    headers: { ...DB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ partner_id: partnerId, file_type: fileType, file_name: file.name, file_url: fileUrl }),
  });
  if (!dbRes.ok) throw new Error(`파일 메타데이터 저장 실패: ${dbRes.status}`);
  const [row] = await dbRes.json();
  return row;
}

// PDF 첫 페이지 → JPEG Blob 변환 (브라우저 Canvas 사용)
// pdfjs-dist는 ESM-only라 Rollup이 번들링 불가 → CDN에서 동적 로드
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

async function pdfToJpeg(file: File): Promise<Blob> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // eslint-disable-next-line prefer-const
  const pdfjsLib = await import(/* @vite-ignore */ PDFJS_CDN);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const arrayBuffer = await file.arrayBuffer();
  const pdf      = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page     = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob 실패')), 'image/jpeg', 0.92)
  );
}

async function runOcr(file: File, docType: 'business_reg' | 'bank_account'): Promise<Record<string, string | null>> {
  // PDF → JPEG 변환 후 OCR
  const ocrFile = file.type === 'application/pdf'
    ? new File([await pdfToJpeg(file)], file.name.replace(/\.pdf$/i, '.jpg'), { type: 'image/jpeg' })
    : file;

  const buf   = await ocrFile.arrayBuffer();
  const uint8 = new Uint8Array(buf);
  let binary  = '';
  const chunk = 8192;
  for (let i = 0; i < uint8.length; i += chunk) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
  }
  const base64   = btoa(binary);
  const VALID_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
  type ValidType = typeof VALID_TYPES[number];
  const rawType = ocrFile.type ?? '';
  const normalized = rawType === 'image/jpg' ? 'image/jpeg' : rawType;
  const mediaType: ValidType = (VALID_TYPES as readonly string[]).includes(normalized)
    ? normalized as ValidType
    : 'image/jpeg';

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ocr-partner-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ image_base64: base64, media_type: mediaType, doc_type: docType }),
  });
  if (!res.ok) throw new Error(`OCR 실패: ${res.status}`);
  return res.json();
}

// ── 월별 매출 요약 ────────────────────────────────
function MonthlySummary({ deals }: { deals: AirtableRecord<DealFields>[] }) {
  const monthly: Record<string, number> = {};
  for (const d of deals) {
    const date = d.fields.Contract_Date || d.fields.Payment_Date;
    if (!date) continue;
    const month = date.slice(0, 7); // YYYY-MM
    const amount = d.fields.Final_Contract_Value ?? 0;
    monthly[month] = (monthly[month] ?? 0) + amount;
  }
  const months = Object.keys(monthly).sort().reverse().slice(0, 12);
  if (months.length === 0) return null;
  const total = Object.values(monthly).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">월별 매출</span>
        <span className="text-xs font-bold">총 {total.toLocaleString()}원</span>
      </div>
      <div className="space-y-1">
        {months.map(m => (
          <div key={m} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-16 shrink-0">{m}</span>
            <div className="flex-1 bg-border rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${Math.round((monthly[m] / Math.max(...Object.values(monthly))) * 100)}%` }} />
            </div>
            <span className="text-xs font-mono text-right w-24 shrink-0">{monthly[m].toLocaleString()}원</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 에러 바운더리 ─────────────────────────────────
interface EBState { hasError: boolean; message: string }
class PartnerSheetErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false, message: '' };
  static getDerivedStateFromError(e: Error): EBState {
    return { hasError: true, message: e.message };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error('[PartnerSheet] render error:', e, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-xl bg-background border-l shadow-lg flex items-center justify-center">
          <div className="text-center p-8 space-y-3">
            <p className="text-destructive font-medium">오류가 발생했습니다</p>
            <p className="text-xs text-muted-foreground">{this.state.message}</p>
            <button className="text-xs underline" onClick={() => this.setState({ hasError: false, message: '' })}>
              다시 시도
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── 파트너 Sheet ─────────────────────────────────
const EMPTY: Partial<PartnerFields> = {
  name: '', business_number: null, representative: null,
  address: null, business_type: null, bank_name: null,
  bank_account: null, account_holder: null,
  contact_name: null, contact_phone: null, contact_email: null,
  commission_rate: 15, notes: null, status: 'active',
};

interface PartnerSheetProps {
  open: boolean;
  onClose: () => void;
  initial: Partner | null;
  onSaved: () => void;
}

function PartnerSheet({ open, onClose, initial, onSaved }: PartnerSheetProps) {
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const [f, setF]         = useState<Partial<PartnerFields>>(EMPTY);
  const [files, setFiles] = useState<PartnerFile[]>([]);
  const { data: allDeals } = useDeals();
  const partnerDeals = (allDeals ?? []).filter(
    d => d.fields.Lead_Source && initial?.name &&
      d.fields.Lead_Source.trim() === initial.name.trim()
  );
  const [ocrLoading, setOcrLoading] = useState<Partial<Record<FileType, boolean>>>({});
  const [dragOver, setDragOver]   = useState<FileType | null>(null);
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePartnerConfirmOpen, setDeletePartnerConfirmOpen] = useState(false);
  const [deleteFileConfirmOpen, setDeleteFileConfirmOpen] = useState(false);
  const [deleteFileTargetId, setDeleteFileTargetId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [partnerUsers, setPartnerUsers] = useState<Array<{ id: string; email: string; name: string | null; status: string; last_sign_in_at?: string }>>([]);

  const refBizReg  = useRef<HTMLInputElement>(null);
  const refBank    = useRef<HTMLInputElement>(null);
  const refContract = useRef<HTMLInputElement>(null);
  const fileRefs: Record<FileType, React.RefObject<HTMLInputElement>> = {
    business_reg: refBizReg,
    bank_account: refBank,
    contract:     refContract,
  };

  useEffect(() => {
    setF(initial ? { ...initial } : { ...EMPTY });
  }, [initial, open]);

  useEffect(() => {
    if (!initial?.id) { setFiles([]); return; }
    getPartnerFiles(initial.id).then(setFiles).catch(() => setFiles([]));
  }, [initial?.id]);

  // 파트너에 연결된 사용자 목록 로드
  useEffect(() => {
    if (!initial?.id) { setPartnerUsers([]); return; }
    supabase.from('user_profiles').select('id,email,name,status').eq('partner_id', initial.id)
      .then(({ data }) => setPartnerUsers(data ?? []))
      .catch(() => setPartnerUsers([]));
  }, [initial?.id]);

  const handleInvitePartner = async () => {
    const email = f.contact_email?.trim();
    if (!email) { toast.error('담당자 이메일을 입력해주세요'); return; }
    if (!initial?.id) { toast.error('파트너를 먼저 저장하세요'); return; }
    setInviting(true);
    try {
      // 초대코드 생성
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('로그인이 필요합니다.');

      const edgeFetch = async (action: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-auth`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action, ...params }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Edge Function 호출 실패');
        return data;
      };

      // Edge Function으로 사용자 생성
      let userId: string | null = null;
      try {
        const { user } = await edgeFetch('createUser', {
          email, password: code,
          user_metadata: { name: f.contact_name || email.split('@')[0], role: 'partner', partner_id: initial.id },
        });
        userId = user?.id ?? null;
      } catch (e) {
        // 이미 존재하는 경우 목록에서 ID 조회
        if ((e as Error).message?.includes('already')) {
          const { users } = await edgeFetch('listUsers');
          userId = users?.find((u: { email?: string }) => u.email === email)?.id ?? null;
        } else {
          throw e;
        }
      }
      if (!userId) throw new Error('사용자 생성에 실패했습니다');

      // Edge Function으로 user_profiles 업데이트 (RLS 우회)
      await edgeFetch('updateProfile', {
        userId,
        updates: {
          role: 'partner',
          partner_id: initial.id,
          name: f.contact_name || null,
          status: 'invited',
          is_first_login: true,
        },
      });

      // 초대 이메일 발송
      await sendInviteEmail({
        to: email, name: f.contact_name || '', inviteCode: code,
        role: 'partner', invitedBy: '심스페이스',
      });
      toast.success(`${email}으로 파트너 초대를 발송했습니다`);
      // 새로고침
      const { data } = await supabase.from('user_profiles').select('id,email,name,status').eq('partner_id', initial.id);
      setPartnerUsers(data ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '초대 실패');
    } finally { setInviting(false); }
  };

  const n   = (k: keyof PartnerFields) => (f[k] as string) ?? '';
  const set = (k: keyof PartnerFields, v: string | null) =>
    setF(prev => ({ ...prev, [k]: v || null }));

  const handleFileChange = async (fileType: FileType, file: File) => {
    if (!initial?.id) { toast.error('파트너를 먼저 저장하세요'); return; }
    setOcrLoading(prev => ({ ...prev, [fileType]: true }));
    try {
      const record = await uploadPartnerFile(initial.id, fileType, file);
      setFiles(prev => [...prev.filter(x => x.file_type !== fileType), record]);

      if (fileType === 'business_reg' || fileType === 'bank_account') {
        const isOcrSupported = file.type?.startsWith('image/') || file.type === 'application/pdf';
        if (!isOcrSupported) {
          toast.success('파일 업로드 완료');
          return;
        }
        const data = await runOcr(file, fileType);
        let updatedF = { ...f };
        if (fileType === 'business_reg') {
          if (data.company_name && !n('name'))   updatedF = { ...updatedF, name: data.company_name! };
          if (data.business_number)              updatedF = { ...updatedF, business_number: data.business_number };
          if (data.representative)               updatedF = { ...updatedF, representative: data.representative };
          if (data.address)                      updatedF = { ...updatedF, address: data.address };
          if (data.business_type)                updatedF = { ...updatedF, business_type: data.business_type };
          setF(updatedF);
          await updatePartner(initial.id, updatedF);
          qc.invalidateQueries({ queryKey: ['partners'] });
          toast.success('사업자등록증 OCR 완료 — 정보가 자동 저장되었습니다');
        } else {
          if (data.bank_name)       updatedF = { ...updatedF, bank_name: data.bank_name };
          if (data.account_number)  updatedF = { ...updatedF, bank_account: data.account_number };
          if (data.account_holder)  updatedF = { ...updatedF, account_holder: data.account_holder };
          setF(updatedF);
          await updatePartner(initial.id, updatedF);
          qc.invalidateQueries({ queryKey: ['partners'] });
          toast.success('통장사본 OCR 완료 — 계좌 정보가 자동 저장되었습니다');
        }
      } else {
        toast.success('파일 업로드 완료');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '업로드/OCR 실패');
    } finally {
      setOcrLoading(prev => ({ ...prev, [fileType]: false }));
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    setDeleteFileTargetId(fileId);
    setDeleteFileConfirmOpen(true);
  };

  const confirmDeleteFile = async () => {
    if (!deleteFileTargetId) return;
    try {
      await deletePartnerFile(deleteFileTargetId);
      setFiles(prev => prev.filter(x => x.id !== deleteFileTargetId));
      toast.success('삭제되었습니다');
    } catch { toast.error('파일 삭제 실패'); }
    setDeleteFileConfirmOpen(false);
    setDeleteFileTargetId(null);
  };

  const handleSave = async () => {
    if (!f.name?.trim()) { toast.error('파트너명을 입력하세요'); return; }
    setSaving(true);
    try {
      if (initial?.id) {
        await updatePartner(initial.id, f);
        toast.success('저장됨');
      } else {
        await createPartner(f);
        toast.success('파트너 등록됨');
      }
      qc.invalidateQueries({ queryKey: ['partners'] });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initial?.id) return;
    setDeletePartnerConfirmOpen(true);
  };

  const confirmDeletePartner = async () => {
    if (!initial?.id) return;
    setDeletePartnerConfirmOpen(false);
    setDeleting(true);
    try {
      await deletePartner(initial.id);
      qc.invalidateQueries({ queryKey: ['partners'] });
      toast.success('파트너 삭제됨');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setDeleting(false);
    }
  };

  const isEdit = !!initial?.id;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? (n('name') || '파트너 편집') : '파트너 추가'}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* 기본 정보 */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">기본 정보</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">파트너명 *</Label>
                <Input value={n('name')} onChange={e => set('name', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">사업자등록번호</Label>
                <Input value={n('business_number')} onChange={e => set('business_number', e.target.value)}
                  placeholder="000-00-00000" className="mt-1 h-8 text-sm font-mono" />
              </div>
              <div>
                <Label className="text-xs">대표자</Label>
                <Input value={n('representative')} onChange={e => set('representative', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">주소</Label>
                <Input value={n('address')} onChange={e => set('address', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">업태/종목</Label>
                <Input value={n('business_type')} onChange={e => set('business_type', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
            </div>
          </section>

          {/* 정산 계좌 */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">정산 계좌</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">은행명</Label>
                <Input value={n('bank_name')} onChange={e => set('bank_name', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">예금주</Label>
                <Input value={n('account_holder')} onChange={e => set('account_holder', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">계좌번호</Label>
                <Input value={n('bank_account')} onChange={e => set('bank_account', e.target.value)} className="mt-1 h-8 text-sm font-mono" />
              </div>
            </div>
          </section>

          {/* 수수료 설정 */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">수수료 설정</h3>
            <div className="grid grid-cols-3 gap-2">
              {[15, 17, 20].map(rate => (
                <button key={rate} type="button"
                  onClick={() => setF(prev => ({ ...prev, commission_rate: rate }))}
                  className={`h-8 text-sm rounded-md border transition-colors
                    ${(f.commission_rate ?? 15) === rate
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                  {rate}%
                </button>
              ))}
            </div>
            <div>
              <Label className="text-xs">직접 입력 (%)</Label>
              <Input type="number" min={0} max={100} step={0.5}
                value={f.commission_rate ?? 15}
                onChange={e => setF(prev => ({ ...prev, commission_rate: parseFloat(e.target.value) || 0 }))}
                className="mt-1 h-8 text-sm w-24" />
            </div>
          </section>

          {/* 담당자 연락처 & 초대 */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">담당자 연락처</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">담당자 이름</Label>
                <Input value={n('contact_name')} onChange={e => set('contact_name', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">전화번호</Label>
                <Input value={n('contact_phone')} onChange={e => set('contact_phone', formatPhone(e.target.value))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">이메일 *</Label>
                <Input value={n('contact_email')} onChange={e => set('contact_email', e.target.value)} className="mt-1 h-8 text-sm" placeholder="파트너 로그인용" />
              </div>
            </div>
            {/* 파트너 초대 & 연결된 사용자 */}
            {isEdit && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">파트너 계정</span>
                  {canEdit && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleInvitePartner} disabled={inviting || !n('contact_email')}>
                      {inviting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <UserPlus className="h-3 w-3 mr-1" />}
                      담당자 초대
                    </Button>
                  )}
                </div>
                {partnerUsers.length > 0 ? (
                  <div className="space-y-1">
                    {partnerUsers.map(u => (
                      <div key={u.id} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-muted/30 text-xs">
                        <div>
                          <span className="font-medium">{u.name || u.email}</span>
                          <span className="text-muted-foreground ml-2">{u.email}</span>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium
                          ${u.status === 'active' ? 'bg-teal-100 text-teal-700'
                            : u.status === 'invited' ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-100 text-slate-500'}`}>
                          {u.status === 'active' ? '활성' : u.status === 'invited' ? '초대됨' : u.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/60">연결된 파트너 계정이 없습니다.</p>
                )}
              </div>
            )}
          </section>

          {/* 파트너 딜 관리 */}
          {isEdit && (
            <PartnerDealsSection
              partnerId={initial!.id}
              partnerName={n('name')}
              commissionRate={f.commission_rate ?? 15}
              crmDeals={partnerDeals}
              allCrmDeals={allDeals ?? []}
            />
          )}

          {/* 계약 서류 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">계약 서류</h3>
            {!isEdit && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
                파트너를 먼저 저장한 후 서류를 업로드할 수 있습니다.
              </p>
            )}
            {(Object.keys(FILE_META) as FileType[]).map(ft => {
              const meta     = FILE_META[ft];
              const existing = files.find(x => x.file_type === ft);
              const loading  = ocrLoading[ft];
              const isDragging = dragOver === ft;
              const accept = 'image/*,application/pdf';

              return (
                <div key={ft}
                  className={`relative rounded-lg border-2 border-dashed transition-colors
                    ${isDragging
                      ? 'border-primary bg-primary/5'
                      : existing
                        ? 'border-border bg-muted/20'
                        : 'border-border/60 bg-muted/10 hover:border-border hover:bg-muted/20'}
                    ${isEdit && !loading ? 'cursor-pointer' : ''}`}
                  onClick={() => !existing && isEdit && !loading && fileRefs[ft].current?.click()}
                  onDragOver={e => { e.preventDefault(); if (isEdit) setDragOver(ft); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOver(null);
                    if (!isEdit || loading) return;
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileChange(ft, file);
                  }}
                >
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm">{meta.label}</span>
                      {meta.ocr && (
                        <span className="text-[10px] text-teal-600 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded shrink-0">
                          OCR
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      {loading ? (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Scan className="h-3 w-3 animate-pulse" />처리 중...
                        </span>
                      ) : existing ? (
                        <>
                          <a href={existing.file_url} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-primary hover:underline flex items-center gap-1 max-w-[140px]">
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{existing.file_name}</span>
                          </a>
                          <button onClick={e => { e.stopPropagation(); handleDeleteFile(existing.id); }}
                            className="text-muted-foreground/40 hover:text-red-500 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {isDragging ? '여기에 놓기' : '클릭 또는 드래그'}
                        </span>
                      )}
                    </div>
                  </div>
                  <input ref={fileRefs[ft]} type="file" accept={accept} className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleFileChange(ft, file);
                      e.target.value = '';
                    }} />
                </div>
              );
            })}
          </section>

          {/* 메모 */}
          <section>
            <Label className="text-xs">메모</Label>
            <Textarea value={n('notes')} onChange={e => set('notes', e.target.value)}
              className="mt-1 text-sm resize-none" rows={3} />
          </section>
        </div>

        <div className="mt-6 flex items-center justify-between">
          {isEdit && canEdit ? (
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleting}
              className="text-destructive hover:text-destructive hover:bg-destructive/10">
              {deleting ? '삭제 중...' : '파트너 삭제'}
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '저장 중...' : '저장'}</Button>
          </div>
        </div>
      </SheetContent>

      {/* 파트너 삭제 확인 */}
      <AlertDialog open={deletePartnerConfirmOpen} onOpenChange={setDeletePartnerConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>파트너 삭제</AlertDialogTitle>
            <AlertDialogDescription>"{initial?.name}" 파트너를 삭제하시겠습니까?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePartner} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 파일 삭제 확인 */}
      <AlertDialog open={deleteFileConfirmOpen} onOpenChange={setDeleteFileConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>파일 삭제</AlertDialogTitle>
            <AlertDialogDescription>이 파일을 삭제하시겠습니까?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFile} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ── 파트너 딜 관리 섹션 ──────────────────────────────
function PartnerDealsSection({
  partnerId, partnerName, commissionRate, crmDeals, allCrmDeals,
}: {
  partnerId: string;
  partnerName: string;
  commissionRate: number;
  crmDeals: AirtableRecord<DealFields>[];
  allCrmDeals: AirtableRecord<DealFields>[];
}) {
  const createCrmDeal = useCreateDeal();
  const [deals, setDeals] = useState<PartnerDeal[]>([]);
  const [dealBuyersMap, setDealBuyersMap] = useState<Record<string, PartnerDealBuyer[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [dialogDealId, setDialogDealId] = useState<string | null>(null);
  const [dialogForm, setDialogForm] = useState<Partial<PartnerDeal>>({});
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [deleteDealConfirmOpen, setDeleteDealConfirmOpen] = useState(false);
  const [deleteDealTargetId, setDeleteDealTargetId] = useState<string | null>(null);

  // 구매자
  type BuyerInput = { buyer_name: string; buyer_phone: string; buyer_email: string; student_count: number; month_count: number | ''; plan_name: string };
  const emptyBuyer = (): BuyerInput => ({ buyer_name: '', buyer_phone: '', buyer_email: '', student_count: 0, month_count: '', plan_name: '' });
  const [buyers, setBuyers] = useState<BuyerInput[]>([emptyBuyer()]);

  // 상품 (견적 라인) — 자동 단가/금액 계산
  type ItemInput = { plan: string; duration: number; qty: number };
  const emptyItem = (): ItemInput => ({ plan: '학급플랜', duration: 12, qty: 1 });
  const [items, setItems] = useState<ItemInput[]>([emptyItem()]);
  const [paymentAmountManual, setPaymentAmountManual] = useState(false); // true면 수동 override
  const computeUnit = (it: ItemInput) => getUnitPrice(it.plan, it.duration);
  const computeAmount = (it: ItemInput) => computeUnit(it) * (it.qty || 0);
  const itemsSubtotal = items.reduce((s, it) => s + computeAmount(it), 0);
  const updateItem = (idx: number, patch: Partial<ItemInput>) => setItems(prev => prev.map((x, i) => i === idx ? { ...x, ...patch } : x));
  const addItem = () => setItems(prev => [...prev, emptyItem()]);
  const removeItem = (idx: number) => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  // items 변경 시 결제금액 자동 (override 시 유지)
  useEffect(() => {
    if (!paymentAmountManual && itemsSubtotal > 0) {
      setDialogForm(p => ({ ...p, payment_amount: itemsSubtotal }));
    }
  }, [itemsSubtotal, paymentAmountManual]);

  // 학교 검색
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolResults, setSchoolResults] = useState<SchoolInfo[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const schoolRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSchoolSearch = useCallback((query: string) => {
    setSchoolQuery(query);
    setDialogForm(p => ({ ...p, school_name: query }));
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) { setSchoolResults([]); setShowSchoolDropdown(false); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSchoolSearching(true);
      try {
        const results = await searchSchools(query);
        setSchoolResults(results);
        setShowSchoolDropdown(results.length > 0);
      } catch { setSchoolResults([]); }
      finally { setSchoolSearching(false); }
    }, 300);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (schoolRef.current && !schoolRef.current.contains(e.target as Node)) setShowSchoolDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setLoading(true);
    getPartnerDeals(partnerId).then(async (dealList) => {
      setDeals(dealList);
      const bMap: Record<string, PartnerDealBuyer[]> = {};
      await Promise.all(dealList.map(async d => {
        const b = await getDealBuyers(d.id);
        if (b.length > 0) bMap[d.id] = b;
      }));
      setDealBuyersMap(bMap);
    }).catch(() => setDeals([])).finally(() => setLoading(false));
  }, [partnerId]);

  const [dealPeriod, setDealPeriod] = useState<PeriodValue>('this_month');
  const [dealCustomFrom, setDealCustomFrom] = useState('');
  const [dealCustomTo, setDealCustomTo] = useState('');

  // 통합 행 — partner_deals + crm_only (linked 제외)
  type UnifiedRow = {
    source: 'partner' | 'crm_only';
    rawId: string;
    contract_date?: string;
    school_name?: string;
    buyer_name?: string;
    buyer_phone?: string;
    buyer_email?: string;
    plan_name?: string;
    quantity?: number;
    duration?: number;
    payment_amount: number;
    commission_amount: number;
    settlement_amount: number;
    license_issue_date?: string;
    deposit_date?: string;
    remarks?: string;
    linked_deal_id?: string;
    rawPartner?: PartnerDeal;
    rawCrm?: AirtableRecord<DealFields>;
  };

  // CRM 행 상세 보기 (파트너 관점에서 추린 정보)
  const [crmDetail, setCrmDetail] = useState<UnifiedRow | null>(null);

  const linkedDealIdSet = new Set(
    deals.filter(d => d.linked_deal_id).map(d => d.linked_deal_id!),
  );

  // 추가 dedup — partner_deals에 linked_deal_id가 비어있어도 같은 매출(전화+금액)이면 중복 처리
  const normalizePhone = (s?: string) => (s ?? '').replace(/\D/g, '');
  const partnerSigSet = new Set(
    deals
      .map(d => `${normalizePhone(d.buyer_phone)}::${d.payment_amount ?? 0}`)
      .filter(s => !s.startsWith('::')),
  );

  const unifiedRows: UnifiedRow[] = [
    ...deals.map((d): UnifiedRow => ({
      source: 'partner',
      rawId: d.id,
      contract_date: d.contract_date,
      school_name: d.school_name,
      buyer_name: d.buyer_name,
      buyer_phone: d.buyer_phone,
      buyer_email: d.buyer_email,
      plan_name: d.plan_name,
      quantity: d.quantity,
      duration: d.month_count,
      payment_amount: d.payment_amount ?? 0,
      commission_amount: d.commission_amount ?? 0,
      settlement_amount: d.settlement_amount ?? 0,
      license_issue_date: d.license_issue_date,
      deposit_date: d.deposit_date,
      remarks: d.remarks,
      linked_deal_id: d.linked_deal_id,
      rawPartner: d,
    })),
    ...crmDeals
      .filter(c => !linkedDealIdSet.has(c.id))
      .filter(c => {
        const phone = normalizePhone(c.fields.Contact_Phone);
        const amt = c.fields.Final_Contract_Value ?? 0;
        // 전화번호 모르면 dedup 불가 → keep (수동 검토 대상)
        if (phone.length < 10) return true;
        return !partnerSigSet.has(`${phone}::${amt}`);
      })
      .map((c): UnifiedRow => {
        const amt = c.fields.Final_Contract_Value ?? 0;
        const calc = calcCommission(amt, commissionRate);
        return {
          source: 'crm_only',
          rawId: c.id,
          contract_date: c.fields.Contract_Date,
          school_name: c.fields.Org_Name,
          buyer_name: c.fields.Contact_Name,
          buyer_phone: c.fields.Contact_Phone,
          buyer_email: c.fields.Contact_Email,
          plan_name: c.fields.Quote_Plan,
          quantity: c.fields.Quote_Qty,
          duration: c.fields.License_Duration,
          payment_amount: amt,
          commission_amount: calc.commission,
          settlement_amount: calc.settlement,
          license_issue_date: c.fields.License_Send_Date,
          deposit_date: c.fields.Payment_Date,
          remarks: c.fields.Deal_Stage,
          rawCrm: c,
        };
      }),
  ].sort((a, b) => (b.contract_date ?? '').localeCompare(a.contract_date ?? ''));

  // 4개 카드 합계 — 통합 행 기준, 카드별로 다른 날짜 필드 사용
  const totalContract = sumByPeriod(unifiedRows, r => r.contract_date, r => r.payment_amount, dealPeriod, dealCustomFrom, dealCustomTo);
  const totalPayment = sumByPeriod(unifiedRows, r => r.deposit_date, r => r.payment_amount, dealPeriod, dealCustomFrom, dealCustomTo);
  const totalCommission = sumByPeriod(unifiedRows, r => r.deposit_date, r => r.commission_amount, dealPeriod, dealCustomFrom, dealCustomTo);
  const totalSettlement = sumByPeriod(unifiedRows, r => r.deposit_date, r => r.settlement_amount, dealPeriod, dealCustomFrom, dealCustomTo);

  // 테이블 행 — 계약일 기준 기간 필터
  const filteredUnified = unifiedRows.filter(r => matchesPeriod(r.contract_date, dealPeriod, dealCustomFrom, dealCustomTo));
  const filteredByPeriod = filteredUnified.filter(r => r.source === 'partner').map(r => r.rawPartner!);  // 기존 호환 (편집 다이얼로그용)

  const openAddDialog = () => {
    setDialogMode('add');
    setDialogDealId(null);
    setDialogForm({ quantity: 1 });
    setBuyers([emptyBuyer()]);
    setItems([emptyItem()]);
    setPaymentAmountManual(false);
    setSchoolQuery('');
    setSchoolResults([]);
    setShowSchoolDropdown(false);
    setDialogOpen(true);
  };

  const openEditDialog = (deal: PartnerDeal) => {
    setDialogMode('edit');
    setDialogDealId(deal.id);
    setDialogForm(deal);
    setSchoolQuery(deal.school_name ?? '');
    // 기존 상품 라인 로드 (없으면 빈 라인 1개)
    if (Array.isArray(deal.items) && deal.items.length > 0) {
      setItems(deal.items.map(it => ({ plan: it.plan, duration: Number(it.duration) || 1, qty: Number(it.qty) || 1 })));
    } else {
      setItems([emptyItem()]);
    }
    // 기존 결제금액이 items 합계와 다르면 manual override로 간주
    const computed = (deal.items ?? []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
    setPaymentAmountManual((deal.payment_amount ?? 0) !== computed);
    // 기존 구매자 로드
    const existingBuyers = dealBuyersMap[deal.id];
    if (existingBuyers && existingBuyers.length > 0) {
      setBuyers(existingBuyers.map(b => ({
        buyer_name: b.buyer_name ?? '', buyer_phone: b.buyer_phone ?? '', buyer_email: b.buyer_email ?? '',
        student_count: b.student_count ?? 0, month_count: b.month_count ?? '', plan_name: b.plan_name ?? '',
      })));
    } else {
      setBuyers([{ buyer_name: deal.buyer_name ?? '', buyer_phone: deal.buyer_phone ?? '', buyer_email: '', student_count: 0, month_count: '', plan_name: deal.plan_name ?? '' }]);
    }
    setDialogOpen(true);
  };

  const handleDialogSubmit = async () => {
    const validBuyers = buyers.filter(b => b.buyer_name.trim());
    if (validBuyers.length === 0) { toast.error('구매자를 최소 1명 입력해주세요'); return; }
    setSaving(true);
    try {
      const { commission, settlement } = calcCommission(dialogForm.payment_amount ?? 0, commissionRate);
      const firstBuyer = validBuyers[0];
      // 상품 라인 → 저장용 QuoteLineItem 형태로 변환
      const itemsPayload: QuoteLineItem[] = items
        .filter(it => it.plan && it.duration > 0 && it.qty > 0)
        .map(it => ({
          plan: it.plan,
          duration: it.duration,
          qty: it.qty,
          unit_price: getUnitPrice(it.plan, it.duration),
          amount: getUnitPrice(it.plan, it.duration) * it.qty,
          s2b_number: getS2BNumber(it.plan, it.duration),
        }));
      // plan_name 필드: 첫 상품 라인의 plan을 대표로 (UI 호환), 다중이면 '복수'
      const repPlan = itemsPayload.length === 1 ? itemsPayload[0].plan
                    : itemsPayload.length > 1 ? '복수' : (dialogForm.plan_name || null);
      const totalQty = itemsPayload.reduce((s, it) => s + it.qty, 0) || validBuyers.length;
      const payload = {
        contract_date: dialogForm.contract_date || null,
        school_name: dialogForm.school_name || null,
        buyer_name: firstBuyer.buyer_name || null,
        buyer_phone: firstBuyer.buyer_phone || null,
        plan_name: repPlan,
        quantity: totalQty,
        payment_amount: dialogForm.payment_amount ?? 0,
        commission_amount: commission,
        settlement_amount: settlement,
        items: itemsPayload.length > 0 ? itemsPayload : undefined,
        remarks: dialogForm.remarks || null,
      };

      if (dialogMode === 'add') {
        const seq = deals.length + 1;
        const created = await createPartnerDeal({ partner_id: partnerId, seq_number: seq, ...payload });
        const createdBuyers = await createDealBuyers(created.id, validBuyers.map(b => ({
          buyer_name: b.buyer_name || undefined, buyer_phone: b.buyer_phone || undefined, buyer_email: b.buyer_email || undefined,
          student_count: b.student_count, month_count: b.month_count === '' ? undefined : b.month_count, plan_name: b.plan_name || undefined, quantity: 1,
        })));
        setDeals(prev => [...prev, created]);
        setDealBuyersMap(prev => ({ ...prev, [created.id]: createdBuyers }));
        toast.success('딜이 추가되었습니다');
        if (payload.school_name || payload.payment_amount) {
          notifyPartnerDeal(partnerName, payload.school_name ?? '', payload.buyer_name ?? '', payload.payment_amount as number);
        }
      } else if (dialogDealId) {
        await updatePartnerDeal(dialogDealId, payload);
        await deleteDealBuyers(dialogDealId);
        const createdBuyers = await createDealBuyers(dialogDealId, validBuyers.map(b => ({
          buyer_name: b.buyer_name || undefined, buyer_phone: b.buyer_phone || undefined, buyer_email: b.buyer_email || undefined,
          student_count: b.student_count, month_count: b.month_count === '' ? undefined : b.month_count, plan_name: b.plan_name || undefined, quantity: 1,
        })));
        setDeals(prev => prev.map(d => d.id === dialogDealId ? { ...d, ...payload } as PartnerDeal : d));
        setDealBuyersMap(prev => ({ ...prev, [dialogDealId]: createdBuyers }));
        toast.success('저장되었습니다');
      }
      setDialogOpen(false);
    } catch { toast.error('저장 실패'); }
    finally { setSaving(false); }
  };

  const handleRegisterCrmDeal = async (deal: PartnerDeal) => {
    try {
      const dealBuyers = dealBuyersMap[deal.id] ?? [];
      const fields: Partial<import('@/types/airtable').DealFields> = {
        Deal_Name: `${deal.school_name ?? '파트너'} - ${partnerName}`,
        Deal_Stage: '견적',
        Deal_Type: 'New',
        Lead_Source: partnerName,
      };
      if (deal.school_name) fields.Org_Name = deal.school_name;
      if (deal.buyer_name) fields.Contact_Name = deal.buyer_name;
      if (deal.buyer_phone) fields.Contact_Phone = deal.buyer_phone;
      // 대표 구매자 이메일
      const primaryBuyer = dealBuyers[0];
      if (primaryBuyer?.buyer_email) fields.Contact_Email = primaryBuyer.buyer_email;
      else if (deal.buyer_email) fields.Contact_Email = deal.buyer_email;
      if (deal.plan_name) fields.Quote_Plan = deal.plan_name;
      if (deal.quantity) fields.Quote_Qty = deal.quantity;
      if (deal.payment_amount) fields.Final_Contract_Value = deal.payment_amount;
      if (deal.contract_date) fields.Contract_Date = deal.contract_date;
      const rec = await createCrmDeal.mutateAsync(fields);

      // 상품 라인 → 견적(deal_quotes)으로 자동 등록
      if (Array.isArray(deal.items) && deal.items.length > 0) {
        const subtotal = deal.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
        const supply = Math.round(subtotal / 1.1);
        const tax = subtotal - supply;
        const repItem = deal.items[0];
        try {
          await saveDealQuote({
            deal_id: rec.id,
            quote_date: deal.contract_date ?? undefined,
            plan: repItem.plan,
            duration: Number(repItem.duration),
            qty: deal.items.reduce((s, it) => s + Number(it.qty || 0), 0),
            license_qty: deal.items.reduce((s, it) => s + Number(it.qty || 0), 0),
            unit_price: Number(repItem.unit_price || 0),
            supply_price: supply,
            tax_amount: tax,
            final_value: subtotal,
            items: deal.items as unknown as unknown[],
            discount_amount: 0,
            contact_phone: deal.buyer_phone ?? undefined,
            contact_email: primaryBuyer?.buyer_email ?? deal.buyer_email ?? undefined,
            notes: `파트너(${partnerName}) 등록 자동 견적`,
            is_selected: true,
          });
        } catch (e) { console.warn('견적 자동 등록 실패:', e); }
      }
      // 구매자 → CRM 사용자 등록
      if (dealBuyers.length > 0) {
        await saveDealUsers(rec.id, dealBuyers.map((b, i) => ({
          user_name: b.buyer_name ?? undefined,
          user_phone: b.buyer_phone ?? undefined,
          user_email: b.buyer_email ?? undefined,
          student_count: b.student_count ?? undefined,
          month_count: b.month_count ?? undefined,
          plan_name: b.plan_name ?? undefined,
          is_primary: i === 0,
        }))).catch(e => console.warn('사용자 등록 실패:', e));
      }
      // 구매자 → 고객(Contacts) 등록 (기존 고객이면 스킵)
      for (const b of dealBuyers) {
        if (!b.buyer_name && !b.buyer_phone) continue;
        try {
          const phone = b.buyer_phone?.replace(/\D/g, '') ?? '';
          let exists = false;
          if (phone.length >= 7) {
            const existing = await airtable.fetchAll<ContactFields>('01_Contacts', {
              filterByFormula: `{phone_normalized}="${phone}"`,
              maxRecords: '1',
            });
            exists = existing.length > 0;
          }
          if (!exists) {
            await airtable.createRecord<ContactFields>('01_Contacts', {
              Name: b.buyer_name ?? '',
              Phone: b.buyer_phone ?? '',
              phone_normalized: phone,
              Email: b.buyer_email ?? '',
              Org_Name: deal.school_name ?? '',
              Lead_Stage: '구매',
              Contact_Type: '구매고객',
              Lead_Source: partnerName,
            });
          }
        } catch (e) { console.warn('고객 등록 스킵:', b.buyer_name, e); }
      }
      await updatePartnerDeal(deal.id, { linked_deal_id: rec.id });
      setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, linked_deal_id: rec.id } : d));
      toast.success('CRM 딜이 등록되었습니다');
    } catch (e) {
      console.error('CRM 딜 등록 실패:', e);
      toast.error(e instanceof Error ? e.message : 'CRM 딜 등록 실패');
    }
  };

  const updateBuyer = (idx: number, field: keyof BuyerInput, value: string | number) => {
    setBuyers(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  };
  const addBuyer = () => setBuyers(prev => [...prev, emptyBuyer()]);
  const removeBuyer = (idx: number) => setBuyers(prev => prev.filter((_, i) => i !== idx));

  const handleDelete = (id: string) => {
    setDeleteDealTargetId(id);
    setDeleteDealConfirmOpen(true);
  };

  const confirmDeleteDeal = async () => {
    if (!deleteDealTargetId) return;
    try {
      await deletePartnerDeal(deleteDealTargetId);
      setDeals(prev => prev.filter(d => d.id !== deleteDealTargetId));
      toast.success('삭제되었습니다');
    } catch { toast.error('삭제 실패'); }
    setDeleteDealConfirmOpen(false);
    setDeleteDealTargetId(null);
  };

  const handleAutoLink = async () => {
    setLinking(true);
    try {
      const matches = autoLinkPartnerDeals(deals, allCrmDeals);
      let count = 0;
      for (const [pdId, match] of matches) {
        await updatePartnerDeal(pdId, {
          linked_deal_id: match.dealId,
          license_issue_date: match.licenseDate ?? undefined,
          tax_invoice_date: match.invoiceDate ?? undefined,
          deposit_date: match.depositDate ?? undefined,
        });
        count++;
      }
      if (count > 0) {
        const refreshed = await getPartnerDeals(partnerId);
        setDeals(refreshed);
        toast.success(`${count}건 자동 연결 완료`);
      } else {
        toast.info('새로 연결할 딜이 없습니다');
      }
    } catch { toast.error('자동 연결 실패'); }
    finally { setLinking(false); }
  };

  const df = (k: keyof PartnerDeal) => (dialogForm[k] as string) ?? '';
  const dfn = (k: keyof PartnerDeal) => dialogForm[k] as number | undefined;

  return (
    <section className="space-y-4">
      {/* 기간 필터 + 버튼 — 공용 컴포넌트 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFilter
            value={dealPeriod}
            onChange={setDealPeriod}
            customFrom={dealCustomFrom}
            customTo={dealCustomTo}
            onCustomChange={(from, to) => { setDealCustomFrom(from); setDealCustomTo(to); }}
          />
          <span className="text-xs text-muted-foreground">{filteredByPeriod.length}건</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleAutoLink} disabled={linking}>
            {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Link2 className="h-3.5 w-3.5 mr-1.5" />}
            CRM 자동연결
          </Button>
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />딜 추가
          </Button>
        </div>
      </div>

      {/* 실적 요약 카드 — 4개 (계약금액=계약일 기준 / 매출·수수료·정산=입금일 기준) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface-card ring-container p-4">
          <p className="text-xs text-muted-foreground mb-1">계약금액 <span className="text-[10px] text-muted-foreground/60">· 계약일 기준</span></p>
          <p className="text-2xl font-bold tabular-nums text-slate-700">{totalContract.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
        </div>
        <div className="surface-card ring-container p-4">
          <p className="text-xs text-muted-foreground mb-1">매출 (입금액) <span className="text-[10px] text-muted-foreground/60">· 입금일 기준</span></p>
          <p className="text-2xl font-bold tabular-nums">{totalPayment.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
        </div>
        <div className="surface-card ring-container p-4">
          <p className="text-xs text-muted-foreground mb-1">수수료 <span className="text-[10px] text-muted-foreground/60">· 입금일 기준</span></p>
          <p className="text-2xl font-bold tabular-nums text-amber-600">{totalCommission.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
        </div>
        <div className="surface-card ring-container p-4">
          <p className="text-xs text-muted-foreground mb-1">정산금액 <span className="text-[10px] text-muted-foreground/60">· 입금일 기준</span></p>
          <p className="text-2xl font-bold tabular-nums text-teal-700">{totalSettlement.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
        </div>
      </div>

      {/* 딜 목록 — 통합 (파트너 등록 + CRM-only) */}
      {loading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">로딩 중...</div>
      ) : unifiedRows.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed rounded-md">
          딜이 없습니다. [딜 추가] 버튼으로 등록하거나 CRM 자동연결로 가져오세요.
        </div>
      ) : (
        <div className="surface-card ring-container overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60">
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground w-14">출처</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">계약일</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">학교명</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">구매자</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">연락처</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">플랜</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-muted-foreground">수량</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">결제금액</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">수수료</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">정산금액</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">이용권발급</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">입금일</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">비고</th>
                  <th className="px-3 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUnified.map((r) => {
                  const isPartner = r.source === 'partner';
                  return (
                    <tr
                      key={`${r.source}-${r.rawId}`}
                      className={`${isPartner ? 'hover:bg-muted/30 cursor-pointer' : 'bg-muted/10 hover:bg-muted/30 cursor-pointer'}`}
                      onClick={() => {
                        if (isPartner && r.rawPartner) openEditDialog(r.rawPartner);
                        else if (!isPartner) setCrmDetail(r);
                      }}
                      title={!isPartner ? '클릭하여 상세 정보 보기 (수정은 /deals 메뉴에서)' : undefined}
                    >
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          isPartner ? 'bg-purple-100 text-purple-700' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {isPartner ? '파트너' : '어드민'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-sm whitespace-nowrap">{r.contract_date || '-'}</td>
                      <td className="px-3 py-2.5 font-medium">{r.school_name || '-'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.buyer_name || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.buyer_phone || '-'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.plan_name || '-'}</td>
                      <td className="px-3 py-2.5 text-center">{r.quantity || '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{r.payment_amount > 0 ? r.payment_amount.toLocaleString() : '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-600">{r.commission_amount > 0 ? r.commission_amount.toLocaleString() : '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-teal-700">{r.settlement_amount > 0 ? r.settlement_amount.toLocaleString() : '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.license_issue_date || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.deposit_date || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[120px]">{r.remarks || '-'}</td>
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        {isPartner ? (
                          <button onClick={() => handleDelete(r.rawId)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        ) : (
                          <span className="text-muted-foreground/40 text-[10px]">CRM</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CRM 등록 딜 상세 보기 (어드민 등록 = 파트너관리에서는 read-only) */}
      <Dialog open={!!crmDetail} onOpenChange={(open) => { if (!open) setCrmDetail(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>딜 상세</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">어드민</span>
            </DialogTitle>
          </DialogHeader>
          {crmDetail && (
            <div className="space-y-3 text-sm">
              <div className="bg-muted/30 rounded p-3 space-y-1.5">
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">계약일</span><span>{crmDetail.contract_date || '-'}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">학교</span><span>{crmDetail.school_name || '-'}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">구매자</span><span>{crmDetail.buyer_name || '-'}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">연락처</span><span>{crmDetail.buyer_phone || '-'}</span></div>
                {crmDetail.buyer_email && (
                  <div className="flex justify-between"><span className="text-xs text-muted-foreground">이메일</span><span className="text-xs">{crmDetail.buyer_email}</span></div>
                )}
              </div>

              <div className="bg-muted/30 rounded p-3 space-y-1.5">
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">플랜</span><span>{crmDetail.plan_name || '-'}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">수량</span><span>{crmDetail.quantity ?? '-'}</span></div>
                {crmDetail.duration && (
                  <div className="flex justify-between"><span className="text-xs text-muted-foreground">기간</span><span>{crmDetail.duration}개월</span></div>
                )}
              </div>

              <div className="bg-muted/30 rounded p-3 space-y-1.5">
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">결제금액</span><span className="font-medium">{crmDetail.payment_amount.toLocaleString()}원</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">수수료 ({commissionRate}%)</span><span className="text-amber-600">{crmDetail.commission_amount.toLocaleString()}원</span></div>
                <div className="flex justify-between border-t pt-1.5"><span className="text-xs text-muted-foreground">정산금액</span><span className="font-semibold text-teal-700">{crmDetail.settlement_amount.toLocaleString()}원</span></div>
              </div>

              <div className="bg-muted/30 rounded p-3 space-y-1.5">
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">이용권 발급일</span><span>{crmDetail.license_issue_date || '-'}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">입금일</span><span>{crmDetail.deposit_date || '-'}</span></div>
                <div className="flex justify-between"><span className="text-xs text-muted-foreground">단계</span><span>{crmDetail.remarks || '-'}</span></div>
              </div>

              <p className="text-[10px] text-muted-foreground text-center">
                이 딜은 어드민(CRM)에서 등록되었습니다. 수정은 /deals 메뉴에서 가능합니다.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 딜 추가/수정 팝업 */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) setDialogOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? '새 딜 추가' : '딜 수정'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2 overflow-y-auto flex-1">
            <div className="space-y-1.5">
              <Label className="text-xs">계약일</Label>
              <Input type="date" value={df('contract_date')} onChange={e => setDialogForm(p => ({ ...p, contract_date: e.target.value }))} className="h-9 text-sm w-full" />
            </div>
            <div ref={schoolRef} className="relative space-y-1.5">
              <Label className="text-xs">학교명</Label>
              <div className="relative">
                <Input value={schoolQuery} onChange={e => handleSchoolSearch(e.target.value)}
                  onFocus={() => { if (schoolResults.length > 0) setShowSchoolDropdown(true); }}
                  placeholder="학교명을 입력하세요" className="h-9 text-sm pr-8" />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  {schoolSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Search className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </div>
              {showSchoolDropdown && schoolResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {schoolResults.map((s, i) => (
                    <button key={i} onClick={() => { setSchoolQuery(s.name); setDialogForm(p => ({ ...p, school_name: s.name })); setShowSchoolDropdown(false); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{s.kind} · {s.eduOffice}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs flex items-center gap-1"><Users className="h-3.5 w-3.5" />구매자 ({buyers.length}명)</Label>
                <button onClick={addBuyer} className="text-xs text-primary hover:underline flex items-center gap-0.5"><Plus className="h-3 w-3" />추가</button>
              </div>
              <div className="space-y-2">
                {buyers.map((b, idx) => (
                  <div key={idx} className="border border-border rounded-md p-2.5 bg-muted/30 relative">
                    {buyers.length > 1 && (
                      <button onClick={() => removeBuyer(idx)} className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                    )}
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div><span className="text-[10px] text-muted-foreground">이름 *</span><Input value={b.buyer_name} onChange={e => updateBuyer(idx, 'buyer_name', e.target.value)} placeholder="홍길동" className="h-7 text-xs" /></div>
                      <div><span className="text-[10px] text-muted-foreground">연락처</span><Input value={b.buyer_phone} onChange={e => updateBuyer(idx, 'buyer_phone', formatPhone(e.target.value))} placeholder="010-0000-0000" className="h-7 text-xs" /></div>
                      <div><span className="text-[10px] text-muted-foreground">이메일</span><Input value={b.buyer_email} onChange={e => updateBuyer(idx, 'buyer_email', e.target.value)} placeholder="email@example.com" className="h-7 text-xs" /></div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div><span className="text-[10px] text-muted-foreground">학생 수</span><Input type="number" value={b.student_count} onChange={e => updateBuyer(idx, 'student_count', parseInt(e.target.value) || 0)} className="h-7 text-xs" /></div>
                      <div><span className="text-[10px] text-muted-foreground">개월 수</span><Input type="number" value={b.month_count} onChange={e => updateBuyer(idx, 'month_count', parseInt(e.target.value) || '')} placeholder="12" className="h-7 text-xs" /></div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">플랜</span>
                        <Select
                          value={PARTNER_PLAN_LIST.includes(b.plan_name ?? '') ? (b.plan_name ?? '') : ((b.plan_name ?? '') ? '__custom__' : '')}
                          onValueChange={v => {
                            if (v === '__custom__') {
                              updateBuyer(idx, 'plan_name', PARTNER_PLAN_LIST.includes(b.plan_name ?? '') ? '' : (b.plan_name ?? ''));
                            } else {
                              updateBuyer(idx, 'plan_name', v);
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                          <SelectContent>
                            {PARTNER_PLAN_LIST.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                            <SelectItem value="__custom__" className="text-xs">기타</SelectItem>
                          </SelectContent>
                        </Select>
                        {b.plan_name && !PARTNER_PLAN_LIST.includes(b.plan_name) && (
                          <Input value={b.plan_name} onChange={e => updateBuyer(idx, 'plan_name', e.target.value)} placeholder="직접입력" className="h-6 text-xs mt-1" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* 상품 (자동 단가/금액 계산) */}
            <div className="border border-border rounded-md p-3 bg-muted/20">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold">상품</Label>
                <button onClick={addItem} type="button" className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" />추가
                </button>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => {
                  const unit = computeUnit(it);
                  const amt = computeAmount(it);
                  const s2b = getS2BNumber(it.plan, it.duration);
                  return (
                    <div key={idx} className="border border-border rounded p-2 bg-card relative">
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} type="button" className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                      <div className="grid grid-cols-[1.4fr_0.8fr_0.5fr_auto] gap-2 items-end">
                        <div>
                          <span className="text-[10px] text-muted-foreground">플랜</span>
                          <Select value={it.plan} onValueChange={v => updateItem(idx, { plan: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PARTNER_PLAN_LIST.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">개월</span>
                          <Select value={String(it.duration)} onValueChange={v => updateItem(idx, { duration: Number(v) })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PARTNER_DURATION_OPTIONS.map(d => <SelectItem key={d} value={String(d)} className="text-xs">{d}개월</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">×수량</span>
                          <Input type="number" min={1} value={it.qty} onChange={e => updateItem(idx, { qty: parseInt(e.target.value) || 0 })} className="h-8 text-xs" />
                        </div>
                        <div className="text-right pb-1.5 min-w-[80px]">
                          <div className="text-sm font-medium">{amt.toLocaleString()}원</div>
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1 pl-1">
                        단가 {unit.toLocaleString()}원
                        {s2b && ` · S2B ${s2b}`}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-2 pt-2 border-t border-border text-xs">
                <span className="text-muted-foreground mr-2">소계</span>
                <span className="font-semibold">{itemsSubtotal.toLocaleString()}원</span>
              </div>
            </div>

            {/* 금액 카드 — 결제금액 자동, 수수료/정산 자동 계산 */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1 bg-muted/30 rounded p-2 border border-border">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">결제금액</span>
                  {paymentAmountManual && (
                    <button type="button" onClick={() => { setPaymentAmountManual(false); setDialogForm(p => ({ ...p, payment_amount: itemsSubtotal })); }} className="text-[9px] text-primary hover:underline">자동</button>
                  )}
                </div>
                <Input
                  type="number"
                  value={dfn('payment_amount') ?? ''}
                  onChange={e => { setPaymentAmountManual(true); setDialogForm(p => ({ ...p, payment_amount: parseInt(e.target.value) || 0 })); }}
                  className="h-8 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1 bg-amber-50 rounded p-2 border border-amber-200">
                <span className="text-[10px] text-muted-foreground">수수료 ({commissionRate}%)</span>
                <div className="text-sm font-semibold text-amber-700 h-8 flex items-center">
                  {calcCommission(dfn('payment_amount') ?? 0, commissionRate).commission.toLocaleString()}원
                </div>
              </div>
              <div className="space-y-1 bg-teal-50 rounded p-2 border border-teal-200">
                <span className="text-[10px] text-muted-foreground">정산금액</span>
                <div className="text-sm font-semibold text-teal-700 h-8 flex items-center">
                  {calcCommission(dfn('payment_amount') ?? 0, commissionRate).settlement.toLocaleString()}원
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">비고</Label>
              <Input value={df('remarks')} onChange={e => setDialogForm(p => ({ ...p, remarks: e.target.value }))} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t">
            <div>
              {dialogMode === 'edit' && dialogDealId && (() => {
                const deal = deals.find(d => d.id === dialogDealId);
                if (!deal) return null;
                if (deal.linked_deal_id) return (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-teal-600 flex items-center gap-1"><Link2 className="h-3.5 w-3.5" />CRM 연결됨</span>
                    <button onClick={async () => {
                      await updatePartnerDeal(deal.id, { linked_deal_id: null as unknown as string });
                      setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, linked_deal_id: undefined } : d));
                      toast.success('연결 해제됨');
                    }} className="text-[10px] text-muted-foreground hover:text-destructive underline">해제</button>
                  </div>
                );
                return (
                  <Button variant="outline" size="sm" onClick={async () => { await handleRegisterCrmDeal(deal); setDialogOpen(false); }}
                    disabled={!deal.school_name}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />CRM 딜 등록
                  </Button>
                );
              })()}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>취소</Button>
              <Button size="sm" onClick={handleDialogSubmit} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                {dialogMode === 'add' ? '추가' : '저장'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 딜 삭제 확인 */}
      <AlertDialog open={deleteDealConfirmOpen} onOpenChange={setDeleteDealConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>딜 삭제</AlertDialogTitle>
            <AlertDialogDescription>이 딜을 삭제하시겠습니까?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteDeal} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ── 메인 페이지 ──────────────────────────────────
export default function Partners() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const { data: partners, isLoading } = useQuery({ queryKey: ['partners'], queryFn: getPartners });
  const { data: allDeals } = useDeals();
  const { data: allPartnerDeals } = useQuery({
    queryKey: ['all_partner_deals'],
    queryFn: getAllPartnerDeals,
    staleTime: 60_000,
  });
  const [selected, setSelected] = useState<Partner | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detailPartner, setDetailPartner] = useState<Partner | null>(null);
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodValue>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');

  const handleAdd  = () => { setSelected(null); setSheetOpen(true); };
  const handleEditSheet = (p: Partner) => { setSelected(p); setSheetOpen(true); };
  const handleClose = () => { setSheetOpen(false); };

  if (isLoading) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">파트너 관리</h1>
      <DataTableSkeleton columns={5} />
    </div>
  );

  const { label: periodLabel } = getPeriodRange(periodFilter, customFrom, customTo);
  const matchesPeriodFn = (date: string) => matchesPeriod(date, periodFilter, customFrom, customTo);

  const list = partners ?? [];
  const q = search.toLowerCase();
  const filtered = list.filter(p =>
    !q || [p.name, p.representative, p.business_number, p.contact_phone]
      .some(v => v?.toLowerCase().includes(q))
  );

  // 파트너별 기간 매출 계산 — "매출" = 입금일 기준 (회계 정합성)
  // 1) partner_deals (파트너 포털/어드민이 직접 등록) — partner_id 기준, deposit_date로 매칭
  // 2) CRM 03_Deals (Lead_Source 기준 매핑) — partner_deals.linked_deal_id로 묶인 것 제외, Payment_Date로 매칭
  const monthlyByPartner: Record<string, number> = {};
  let totalThisMonth = 0;
  let totalThisMonthDeals = 0;
  const partnerById = new Map<string, Partner>();
  for (const p of partners ?? []) partnerById.set(p.id, p);
  const linkedDealIds = new Set<string>();
  // 파트너별 전화+금액 시그니처 — linked_deal_id 비어있어도 중복 매출 제거용
  const partnerSigByName = new Map<string, Set<string>>();
  const normPhone = (s?: string) => (s ?? '').replace(/\D/g, '');

  for (const pd of allPartnerDeals ?? []) {
    if (pd.linked_deal_id) linkedDealIds.add(pd.linked_deal_id);
    const partner = partnerById.get(pd.partner_id);
    if (partner) {
      const phone = normPhone(pd.buyer_phone);
      if (phone.length >= 10) {
        const sig = `${phone}::${pd.payment_amount ?? 0}`;
        const set = partnerSigByName.get(partner.name) ?? new Set<string>();
        set.add(sig);
        partnerSigByName.set(partner.name, set);
      }
    }
    if (!pd.deposit_date || !matchesPeriodFn(pd.deposit_date)) continue;
    if (!partner) continue;
    const amount = pd.payment_amount ?? 0;
    if (amount <= 0) continue;
    monthlyByPartner[partner.name] = (monthlyByPartner[partner.name] ?? 0) + amount;
    totalThisMonth += amount;
    totalThisMonthDeals++;
  }

  for (const d of allDeals ?? []) {
    if (linkedDealIds.has(d.id)) continue;  // partner_deal에 이미 카운트됨
    const src = d.fields.Lead_Source?.trim();
    const date = d.fields.Payment_Date;
    if (!src || !date || !matchesPeriodFn(date)) continue;
    const amount = d.fields.Final_Contract_Value ?? 0;
    // 전화+금액 시그니처 매칭 시 중복으로 간주하고 skip
    const phone = normPhone(d.fields.Contact_Phone);
    if (phone.length >= 10) {
      const sigSet = partnerSigByName.get(src);
      if (sigSet?.has(`${phone}::${amount}`)) continue;
    }
    monthlyByPartner[src] = (monthlyByPartner[src] ?? 0) + amount;
    totalThisMonth += amount;
    totalThisMonthDeals++;
  }

  // ── 상세 뷰 (전체 화면) ──
  if (detailPartner) {
    const dp = detailPartner;
    const dpDeals = (allDeals ?? []).filter(d => d.fields.Lead_Source?.trim() === dp.name.trim());
    return (
      <div className="space-y-4">
        {/* 헤더: 뒤로가기 + 파트너명 + 편집 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setDetailPartner(null)}
              className="p-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
            </button>
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                {dp.name}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                수수료율 {dp.commission_rate ?? 15}%
                {dp.business_number && ` · ${dp.business_number}`}
                {dp.representative && ` · ${dp.representative}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => handleEditSheet(dp)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />파트너 정보 편집
            </Button>
          </div>
        </div>

        {/* 파트너 딜 — 전체 너비 */}
        <PartnerDealsSection
          partnerId={dp.id}
          partnerName={dp.name}
          commissionRate={dp.commission_rate ?? 15}
          crmDeals={dpDeals}
          allCrmDeals={allDeals ?? []}
        />

        {/* Sheet (편집용) */}
        {sheetOpen && (
          <PartnerSheetErrorBoundary>
            <PartnerSheet
              open={sheetOpen}
              onClose={handleClose}
              initial={selected}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['partners'] });
                // 상세 파트너 정보 새로고침
                getPartners().then(list => {
                  const updated = list.find(p => p.id === dp.id);
                  if (updated) setDetailPartner(updated);
                });
              }}
            />
          </PartnerSheetErrorBoundary>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">파트너 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {list.length}개 · 활성 {list.filter(p => p.status === 'active').length}개
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1.5" />파트너 추가
          </Button>
        )}
      </div>

      {/* 기간 필터 — 공용 컴포넌트 */}
      <div className="surface-card ring-container p-3">
        <PeriodFilter
          value={periodFilter}
          onChange={setPeriodFilter}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={(from, to) => { setCustomFrom(from); setCustomTo(to); }}
        />
      </div>

      {/* 기간 매출 요약 */}
      <div className="surface-card ring-container p-4">
        <p className="text-xs text-muted-foreground font-medium mb-3">{periodLabel} 현황</p>
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <p className="text-2xl font-bold tabular-nums">{totalThisMonth.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">이달 총 매출 · {totalThisMonthDeals}건</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            {list.filter(p => monthlyByPartner[p.name]).sort((a, b) => (monthlyByPartner[b.name] ?? 0) - (monthlyByPartner[a.name] ?? 0)).map(p => (
              <div key={p.id} className="text-center">
                <p className="text-sm font-semibold tabular-nums">{(monthlyByPartner[p.name] ?? 0).toLocaleString()}<span className="text-xs font-normal text-muted-foreground ml-0.5">원</span></p>
                <p className="text-xs text-muted-foreground">{p.name}</p>
              </div>
            ))}
            {list.every(p => !monthlyByPartner[p.name]) && (
              <p className="text-sm text-muted-foreground self-center">이달 등록된 매출이 없습니다</p>
            )}
          </div>
        </div>
      </div>

      {/* 검색 */}
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="파트너명, 대표자 검색..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm" />
      </div>

      {/* 테이블 */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                {['파트너명', '사업자번호', '대표자', '수수료율', '담당자', periodLabel, '서류', '상태'].map(h => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap ${
                      h === periodLabel ? 'text-right' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    {list.length === 0
                      ? '파트너가 없습니다. SQL로 초기 데이터를 등록하거나 파트너 추가 버튼을 사용하세요.'
                      : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              ) : filtered.map(p => (
                <tr key={p.id} onClick={() => setDetailPartner(p)}
                  className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                      {p.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.business_number || '-'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.representative || '-'}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">
                    {p.commission_rate != null ? `${p.commission_rate}%` : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{p.contact_name || '-'}</div>
                    {(p.contact_phone || p.contact_email) && (
                      <div className="text-muted-foreground/60">{p.contact_phone || p.contact_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums text-right">
                    {monthlyByPartner[p.name]
                      ? <span className="font-medium text-teal-700">{monthlyByPartner[p.name].toLocaleString()}원</span>
                      : <span className="text-muted-foreground/40">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <PartnerDocBadges partnerId={p.id} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium
                      ${p.status === 'active' ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                      {p.status === 'active' ? '활성' : '비활성'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sheetOpen && (
        <PartnerSheetErrorBoundary>
          <PartnerSheet
            open={sheetOpen}
            onClose={handleClose}
            initial={selected}
            onSaved={() => qc.invalidateQueries({ queryKey: ['partners'] })}
          />
        </PartnerSheetErrorBoundary>
      )}
    </div>
  );
}

// 파트너별 서류 등록 현황 뱃지
function PartnerDocBadges({ partnerId }: { partnerId: string }) {
  const { data: files } = useQuery({
    queryKey: ['partner_files', partnerId],
    queryFn: () => getPartnerFiles(partnerId),
    staleTime: 1000 * 60 * 5,
  });
  if (!files) return <span className="text-muted-foreground/40 text-xs">-</span>;

  const types = files.map(f => f.file_type);
  return (
    <div className="flex gap-1">
      {(Object.keys(FILE_META) as FileType[]).map(ft => (
        <span key={ft} title={FILE_META[ft].label}
          className={`w-2 h-2 rounded-full ${types.includes(ft) ? 'bg-teal-500' : 'bg-slate-200'}`} />
      ))}
    </div>
  );
}
