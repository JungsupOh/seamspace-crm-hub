import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { toast } from 'sonner';
import { Plus, Upload, Scan, FileText, Trash2, ExternalLink, Building2, Search, TrendingUp } from 'lucide-react';
import { useDeals } from '@/hooks/use-airtable';
import type { AirtableRecord, DealFields } from '@/types/airtable';

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
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
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

async function runOcr(file: File, docType: 'business_reg' | 'bank_account'): Promise<Record<string, string | null>> {
  const buf   = await file.arrayBuffer();
  const uint8 = new Uint8Array(buf);
  let binary  = '';
  const chunk = 8192;
  for (let i = 0; i < uint8.length; i += chunk) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  const mediaType = (file.type?.startsWith('image/') ? file.type : 'image/jpeg') as
    'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

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

// ── 파트너 Sheet ─────────────────────────────────
const EMPTY: Partial<PartnerFields> = {
  name: '', business_number: null, representative: null,
  address: null, business_type: null, bank_name: null,
  bank_account: null, account_holder: null,
  contact_name: null, contact_phone: null, contact_email: null, notes: null, status: 'active',
};

interface PartnerSheetProps {
  open: boolean;
  onClose: () => void;
  initial: Partner | null;
  onSaved: () => void;
}

function PartnerSheet({ open, onClose, initial, onSaved }: PartnerSheetProps) {
  const qc = useQueryClient();
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
        if (!file.type?.startsWith('image/')) {
          toast.success('파일 업로드 완료 (이미지 파일만 OCR 가능)');
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
    try {
      await deletePartnerFile(fileId);
      setFiles(prev => prev.filter(x => x.id !== fileId));
    } catch { toast.error('파일 삭제 실패'); }
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
    if (!confirm(`"${initial.name}" 파트너를 삭제하시겠습니까?`)) return;
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

          {/* 담당자 연락처 */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">담당자 연락처</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">담당자 이름</Label>
                <Input value={n('contact_name')} onChange={e => set('contact_name', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">전화번호</Label>
                <Input value={n('contact_phone')} onChange={e => set('contact_phone', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">이메일</Label>
                <Input value={n('contact_email')} onChange={e => set('contact_email', e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
            </div>
          </section>

          {/* 연관 딜 & 월별 매출 */}
          {isEdit && partnerDeals.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" />
                연관 딜 ({partnerDeals.length}건)
              </h3>

              {/* 월별 매출 요약 */}
              <MonthlySummary deals={partnerDeals} />

              {/* 딜 목록 — 스크롤 */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="overflow-y-auto max-h-56">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-muted/90 backdrop-blur border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">학교/기관</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">담당자</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">계약일</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">금액(원)</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">단계</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...partnerDeals]
                        .sort((a, b) => (b.fields.Contract_Date ?? '').localeCompare(a.fields.Contract_Date ?? ''))
                        .map(d => (
                          <tr key={d.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium">{d.fields.Org_Name || '-'}</td>
                            <td className="px-3 py-2 text-muted-foreground">{d.fields.Contact_Name || '-'}</td>
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                              {d.fields.Contract_Date?.slice(0, 7) || '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {d.fields.Final_Contract_Value
                                ? d.fields.Final_Contract_Value.toLocaleString()
                                : '-'}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{d.fields.Deal_Stage || '-'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {partnerDeals.length > 8 && (
                  <div className="px-3 py-1.5 bg-muted/30 border-t border-border text-center text-xs text-muted-foreground">
                    총 {partnerDeals.length}건 · 스크롤하여 더 보기
                  </div>
                )}
              </div>
            </section>
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
              const accept = ft === 'contract' ? 'image/*,application/pdf' : 'image/*';

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
    </Sheet>
  );
}

// ── 메인 페이지 ──────────────────────────────────
export default function Partners() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const { data: partners, isLoading } = useQuery({ queryKey: ['partners'], queryFn: getPartners });
  const { data: allDeals } = useDeals();
  const [selected, setSelected] = useState<Partner | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');

  const handleAdd  = () => { setSelected(null); setSheetOpen(true); };
  const handleEdit = (p: Partner) => { setSelected(p); setSheetOpen(true); };
  const handleClose = () => { setSheetOpen(false); };

  if (isLoading) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">파트너 관리</h1>
      <DataTableSkeleton columns={5} />
    </div>
  );

  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const list = partners ?? [];
  const q = search.toLowerCase();
  const filtered = list.filter(p =>
    !q || [p.name, p.representative, p.business_number, p.contact_phone]
      .some(v => v?.toLowerCase().includes(q))
  );

  // 파트너별 이달 매출 계산
  const monthlyByPartner: Record<string, number> = {};
  let totalThisMonth = 0;
  let totalThisMonthDeals = 0;
  for (const d of allDeals ?? []) {
    const src = d.fields.Lead_Source?.trim();
    const date = d.fields.Contract_Date || d.fields.Payment_Date;
    if (!src || !date || date.slice(0, 7) !== thisMonth) continue;
    const amount = d.fields.Final_Contract_Value ?? 0;
    monthlyByPartner[src] = (monthlyByPartner[src] ?? 0) + amount;
    totalThisMonth += amount;
    totalThisMonthDeals++;
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

      {/* 이달 매출 요약 */}
      <div className="surface-card ring-container p-4">
        <p className="text-xs text-muted-foreground font-medium mb-3">{thisMonth} 매출 현황</p>
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
                {['파트너명', '사업자번호', '대표자', '정산 계좌', '담당자', '이달 매출', '서류', '상태'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
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
                <tr key={p.id} onClick={() => handleEdit(p)}
                  className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                      {p.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.business_number || '-'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.representative || '-'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {p.bank_name && p.bank_account
                      ? <><span className="font-medium text-foreground">{p.bank_name}</span> {p.bank_account}</>
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <div>{p.contact_name || '-'}</div>
                    {(p.contact_phone || p.contact_email) && (
                      <div className="text-muted-foreground/60">{p.contact_phone || p.contact_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums">
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

      <PartnerSheet
        open={sheetOpen}
        onClose={handleClose}
        initial={selected}
        onSaved={() => qc.invalidateQueries({ queryKey: ['partners'] })}
      />
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
