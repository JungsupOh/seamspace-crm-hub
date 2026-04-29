import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatPhone } from '@/lib/utils';
import { PeriodFilter } from '@/components/PeriodFilter';
import { getPeriodRange, matchesPeriod, type PeriodValue } from '@/lib/period';
import { useAuth } from '@/contexts/AuthContext';
import * as XLSX from 'xlsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeals, useCreateDeal, useUpdateDeal, useDeleteDeal, useContacts } from '@/hooks/use-airtable';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Plus, Search, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown,
  Paperclip, ExternalLink, Loader2, Upload, User, Building2, Phone, Mail,
  FileText, Receipt, Package, Pencil, Trash2, UserCheck, UserPlus, X, Users,
  FileSpreadsheet, CheckCircle2, AlertCircle, FileDown, Globe,
} from 'lucide-react';
import { airtable, AirtableRecord } from '@/lib/airtable';
import { DealFields, ContactFields } from '@/types/airtable';
import { DEAL_STAGES, ALL_DEAL_STAGES } from '@/lib/grades';
import { uploadDealFile, parseFileLinks, getDealFiles, saveDealFileRecord, deleteDealFileRecord, DealFileRecord, saveDealLicenses, getDealLicenses, DealLicenseRecord, getDealQuotes, saveDealQuote, updateDealQuote, deleteDealQuote, selectDealQuote, DealQuote, attachCouponToDeal, fetchAllDealQuoteNumbers } from '@/lib/storage';
import { searchSchools, SchoolInfo } from '@/lib/neis';
import { generateQuotePdf, generateQuotePdfBlob } from '@/lib/generateQuotePdf';
import { sendQuoteEmail } from '@/lib/email';
import { QuoteLineItem, PLAN_LIST, DURATION_OPTIONS, makeItem, recommendItems, calcQuoteTotals, getS2BNumber } from '@/lib/pricing';
import { notifyNewDeal } from '@/lib/telegram';
import { syncPartnerDealDates } from '@/lib/partner-deals';
import { getDealUsers, saveDealUsers, type DealUserInput } from '@/lib/deal-users';
import { toast } from 'sonner';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── 전화번호 정규화 ───────────────────────────────
function normalizePhone(raw: string): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11) {
    const local = '0' + d.slice(2);
    if (local.length === 11) return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  if (d.length === 11 && d.startsWith('010')) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

// ── 스테이지 메타 ─────────────────────────────────
const STAGE_META: Record<string, { label: string; color: string }> = {
  '체험권':          { label: '체험권',          color: 'bg-yellow-100 text-yellow-700'  },
  '견적':            { label: '견적',            color: 'bg-blue-100 text-blue-700'      },
  '계약체결/구매':   { label: '계약체결/구매',   color: 'bg-violet-100 text-violet-700'  },
  '템플릿 회신대기': { label: '템플릿 회신대기', color: 'bg-orange-100 text-orange-700'  },
  '이용권 발송완료': { label: '이용권 발송완료', color: 'bg-purple-100 text-purple-700'  },
  '결제예정':        { label: '결제예정',        color: 'bg-sky-100 text-sky-700'        },
  '입금대기':        { label: '입금대기',        color: 'bg-amber-100 text-amber-700'    },
  '입금완료':        { label: '입금완료',        color: 'bg-green-100 text-green-700'    },
  '딜취소':          { label: '딜취소',          color: 'bg-red-100 text-red-700'        },
  '계약파기':        { label: '계약파기',        color: 'bg-rose-100 text-rose-700'      },
  // 레거시 Airtable 값 호환
  Lead:        { label: '체험권',          color: 'bg-yellow-100 text-yellow-700' },
  Proposal:    { label: '견적',            color: 'bg-blue-100 text-blue-700'    },
  Contract:    { label: '이용권 발송완료', color: 'bg-purple-100 text-purple-700' },
  Closed_Won:  { label: '입금완료',        color: 'bg-green-100 text-green-700'  },
  Active_User: { label: '사용중',          color: 'bg-teal-100 text-teal-700'    },
  Closed_Lost: { label: '딜취소',          color: 'bg-red-100 text-red-700'      },
};

// 금액 표시할 스테이지
const STAGES_WITH_AMOUNT = new Set([
  '체험권', '견적', '계약체결/구매', '템플릿 회신대기', '이용권 발송완료', '결제예정', '입금대기', '입금완료',
  'Lead', 'Proposal', 'Contract', 'Closed_Won', // 레거시 호환
]);

const PLANS = ['학급플랜', '학년플랜', '학교(소)', '학교(중)', '학교(대)'];

const SLOT_LABELS: Record<string, string> = {
  quote: '견적서', school_id: '고유번호증', license: '이용권템플릿', receipt: '영수증',
};
const LABEL_TO_SLOT: Record<string, string> = Object.fromEntries(
  Object.entries(SLOT_LABELS).map(([k, v]) => [v, k])
);

function StageBadge({ stage }: { stage?: string }) {
  if (!stage) return null;
  const m = STAGE_META[stage];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${m?.color ?? 'bg-muted text-muted-foreground'}`}>
      {m?.label ?? stage}
    </span>
  );
}

function fmt(n?: number) {
  if (n == null || n === 0) return '-';
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

function Section({ icon: Icon, title, children }: {
  icon: React.ElementType; title: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border pb-1.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ── 날짜 입력 (달력 피커) ──────────────────────────
function DateInput({ value, onChange, className }: {
  value?: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <Input
      type="date"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className={className}
    />
  );
}

// ── 숫자 입력 (3자리 콤마) ───────────────────────
function NumericInput({ value, onChange, className, placeholder }: {
  value?: number;
  onChange: (n: number | undefined) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      value={value != null ? value.toLocaleString('ko-KR') : ''}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        onChange(raw ? Number(raw) : undefined);
      }}
      className={className}
      placeholder={placeholder}
    />
  );
}

// ── 인라인 파일 첨부 필드 (드래그앤드롭 + 기존파일 표시) ──
function FileAttachInput({
  label, textValue, onTextChange, placeholder,
  slotKey, file, onFileSelect, inputRef, accept,
  storedFile, onRemoveStored,
}: {
  label: string;
  textValue?: string;
  onTextChange?: (v: string) => void;
  placeholder?: string;
  slotKey: string;
  file?: File;
  onFileSelect: (key: string, f: File | null) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  accept?: string;
  storedFile?: DealFileRecord;
  onRemoveStored?: (key: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const triggerRef = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => { triggerRef.current = el; inputRef(el); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFileSelect(slotKey, dropped);
  };
  const dragProps = {
    onDragOver:  (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop:      handleDrop,
  };

  const showStored = storedFile && !file;

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <input ref={setRef} type="file" className="hidden" accept={accept}
        onChange={e => onFileSelect(slotKey, e.target.files?.[0] ?? null)} />
      <div className="mt-1 space-y-1.5">
        {/* 텍스트 입력 (있을 경우) */}
        {onTextChange !== undefined && (
          <Input value={textValue ?? ''} onChange={e => onTextChange(e.target.value)}
            className="h-8 text-sm" placeholder={placeholder} />
        )}
        {/* 파일 드롭존 */}
        <div
          {...dragProps}
          onClick={() => !file && !showStored && triggerRef.current?.click()}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors
            ${dragOver
              ? 'border-primary bg-primary/5 border-solid'
              : 'border-dashed border-border hover:border-primary/50'}
            ${!file && !showStored ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {file ? (
            <>
              <Paperclip className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span className="flex-1 truncate">{file.name}</span>
              <button type="button" onClick={e => { e.stopPropagation(); onFileSelect(slotKey, null); }}
                className="flex-shrink-0 p-0.5 rounded hover:bg-muted">
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </>
          ) : showStored ? (
            <>
              <Paperclip className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
              <a href={storedFile.file_url} target="_blank" rel="noopener noreferrer"
                className="flex-1 truncate text-green-700 hover:underline underline-offset-2"
                onClick={e => e.stopPropagation()}>
                {storedFile.file_name}
              </a>
              <button type="button" title="다시 업로드"
                onClick={e => { e.stopPropagation(); triggerRef.current?.click(); }}
                className="flex-shrink-0 px-1.5 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground text-[11px]">
                재업로드
              </button>
              <button type="button" title="삭제"
                onClick={e => { e.stopPropagation(); onRemoveStored?.(slotKey); }}
                className="flex-shrink-0 p-0.5 rounded hover:bg-muted">
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </>
          ) : (
            <>
              <Upload className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">
                {dragOver ? '놓아서 첨부' : '클릭하거나 파일을 끌어다 놓기'}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Excel 딜 업로드 ───────────────────────────────
// Excel 날짜 시리얼 → YYYY-MM-DD
function xlDate(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  if (!n || isNaN(n)) return '';
  return new Date((n - 25569) * 86400 * 1000).toISOString().split('T')[0];
}

const DEAL_STAGE_MAP: Record<string, string> = {
  '계약 완료':        '입금완료',
  '세무서류 발급요청': '입금완료',
  '알림톡 발송요청':   '이용권 발송완료',
  '입금 대기':        '입금대기',
  '입금완료':         '입금완료',
  '계약체결 대기':    '계약체결/구매',
  '계약체결':         '계약체결/구매',
  '템플릿 회신대기':  '템플릿 회신대기',
  '견적 문의':        '견적',
  '견적':             '견적',
  '결제 예정':        '결제예정',
  '계약 취소':        '딜취소',
  '취소':             '딜취소',
};
const DEAL_PLAN_MAP: Record<string, string> = {
  '학교플랜 소': '학교(소)',
  '학교플랜 중': '학교(중)',
  '학교플랜 대': '학교(대)',
  '선택안함':    '',
};

function parseExcelRow(row: unknown[]): Partial<DealFields> | null {
  const orgName = String(row[7] || row[4] || '').trim();
  if (!orgName || orgName === '학교명') return null;

  const statusRaw = String(row[1] || '').trim();
  const stage = DEAL_STAGE_MAP[statusRaw] || '체험권';
  const planRaw = String(row[21] || '').trim();
  const planMapped = DEAL_PLAN_MAP[planRaw];
  const plan = planMapped !== undefined ? planMapped : (planRaw === '선택안함' ? '' : planRaw);
  const contactName  = String(row[10] || row[14] || '').trim();
  const contactPhone = String(row[11] || row[15] || '').trim();
  const contactEmail = String(row[13] || row[16] || '').trim();
  const notes = String(row[3] || '').trim().replace(/\r\n/g, '\n');

  const toNum = (v: unknown) => { const n = Number(v); return n && !isNaN(n) ? n : undefined; };

  return {
    Deal_Name:            contactName ? `${contactName} (${orgName})` : orgName,
    Deal_Stage:           stage,
    Org_Name:             orgName,
    Org_Address:          String(row[8] || row[5] || '').trim() || undefined,
    Contact_Name:         contactName  || undefined,
    Contact_Phone:        contactPhone || undefined,
    Contact_Email:        contactEmail || undefined,
    Quote_Date:           xlDate(row[17]) || undefined,
    Quote_Number:         String(row[18] || '').trim() || undefined,
    Quote_Qty:            toNum(row[20]),
    Quote_Plan:           plan           || undefined,
    License_Duration:     toNum(row[22]),
    Unit_Price:           toNum(row[23]),
    Supply_Price:         toNum(row[29]),
    Tax_Amount:           toNum(row[30]),
    Final_Contract_Value: toNum(row[31]),
    License_Code_Count:   toNum(row[35]),
    License_Send_Date:    xlDate(row[37]) || undefined,
    License_Template:     String(row[38] || '').trim() || undefined,
    Contract_Date:        xlDate(row[40]) || undefined,
    Payment_Date:         xlDate(row[41]) || undefined,
    Receipt_Date:         xlDate(row[46]) || undefined,
    Renewal_Date:         xlDate(row[51]) || undefined,
    School_ID_Number:     String(row[45] || '').trim() || undefined,
    Notes:                notes || undefined,
  };
}

function DealUploadDialog({ existingDeals, onDone }: {
  existingDeals?: AirtableRecord<DealFields>[];
  onDone: () => void;
}) {
  const [open, setOpen]         = useState(false);
  const [parsed, setParsed]     = useState<Partial<DealFields>[]>([]);
  const [dupeKeys, setDupeKeys] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult]     = useState<{ ok: number; skip: number; fail: number; errMsg?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 중복 판별 키: 학교명 + 계약일 (계약일 없으면 학교명 + 견적일)
  const makeKey = (d: Partial<DealFields>) => {
    const org  = (d.Org_Name ?? '').trim().toLowerCase();
    const date = d.Contract_Date || d.Quote_Date || '';
    return `${org}||${date}`;
  };

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const deals = rows.slice(1).map(parseExcelRow).filter(Boolean) as Partial<DealFields>[];

    // 기존 딜 키 집합 생성
    const existingKeys = new Set(
      (existingDeals ?? []).map(d => makeKey(d.fields))
    );
    const dupes = new Set(deals.filter(d => existingKeys.has(makeKey(d))).map(makeKey));
    setDupeKeys(dupes);
    setParsed(deals);
    setResult(null);
    setProgress(0);
  };

  const newDeals  = parsed.filter(d => !dupeKeys.has(makeKey(d)));
  const skipCount = parsed.length - newDeals.length;

  const statusSummary = newDeals.reduce<Record<string, number>>((acc, d) => {
    const s = d.Deal_Stage ?? 'Lead';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const DEAL_TO_CONTACT_STAGE: Record<string, string> = {
    '입금완료':        '구매',
    '이용권 발송완료': '구매',
    '계약체결/구매':   '구매',
    '결제예정':        '구매',
    '입금대기':        '구매',
    '견적':            '관심',
    '템플릿 회신대기': '관심',
    '체험권':          '체험',
  };

  const runImport = async () => {
    setImporting(true);
    let ok = 0, fail = 0;
    let lastErr = '';

    // 고객 목록 로드 → 이름+전화번호 기준 Map
    const contacts = await airtable.fetchAll<ContactFields>('01_Contacts').catch(() => []);
    const contactMap = new Map<string, string>(); // "name||phone" → record id
    for (const c of contacts) {
      const key = `${(c.fields.Name ?? '').trim()}||${(c.fields.Phone ?? '').replace(/\D/g, '')}`;
      contactMap.set(key, c.id);
      // 이름만으로도 매칭 (전화번호 없는 경우 대비)
      const nameOnly = `${(c.fields.Name ?? '').trim()}||`;
      if (!contactMap.has(nameOnly)) contactMap.set(nameOnly, c.id);
    }

    for (let i = 0; i < newDeals.length; i++) {
      const deal = newDeals[i];
      try {
        await airtable.createRecord<DealFields>('03_Deals', deal);
        ok++;

        // 매칭 고객 Lead_Stage 업데이트
        const targetStage = DEAL_TO_CONTACT_STAGE[deal.Deal_Stage ?? ''];
        if (targetStage && deal.Contact_Name) {
          const phone = (deal.Contact_Phone ?? '').replace(/\D/g, '');
          const contactId = contactMap.get(`${deal.Contact_Name.trim()}||${phone}`)
            ?? contactMap.get(`${deal.Contact_Name.trim()}||`);
          if (contactId) {
            await airtable.updateRecord<ContactFields>('01_Contacts', contactId, { Lead_Stage: targetStage }).catch(() => {});
          }
        }
      } catch (e) {
        fail++;
        if (!lastErr) lastErr = e instanceof Error ? e.message : String(e);
      }
      setProgress(Math.round(((i + 1) / newDeals.length) * 100));
      if ((i + 1) % 5 === 0 && i + 1 < newDeals.length) await new Promise(r => setTimeout(r, 250));
    }
    setResult({ ok, skip: skipCount, fail, errMsg: lastErr || undefined });
    setImporting(false);
    onDone();
  };

  const reset = () => { setParsed([]); setResult(null); setProgress(0); setImporting(false); };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { reset(); setOpen(true); }}>
        <FileSpreadsheet className="h-4 w-4 mr-1" />Excel 가져오기
      </Button>

      <Dialog open={open} onOpenChange={o => { if (!o && !importing) { setOpen(false); reset(); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0"
          onInteractOutside={e => importing && e.preventDefault()}
          onEscapeKeyDown={e => importing && e.preventDefault()}>
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle>딜 Excel 가져오기</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* 파일 선택 */}
            {!result && (
              <div
                onClick={() => !importing && fileRef.current?.click()}
                className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors
                  ${importing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50 hover:bg-muted/30'}`}>
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {parsed.length > 0 ? `${parsed.length.toLocaleString()}건 파싱됨` : 'Excel 파일 선택'}
                </p>
                <p className="text-xs text-muted-foreground">계약 관리 Excel 파일 (.xlsx)</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
              </div>
            )}

            {/* 파싱 결과 */}
            {parsed.length > 0 && !result && (
              <>
                {/* 스테이지 분포 */}
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(statusSummary).map(([stage, cnt]) => (
                    <div key={stage} className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                      <p className="text-lg font-bold">{cnt}</p>
                      <p className="text-[10px] text-muted-foreground">{STAGE_META[stage]?.label ?? stage}</p>
                    </div>
                  ))}
                </div>

                {/* 미리보기 */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    미리보기 (상위 5건){skipCount > 0 && <span className="ml-2 text-orange-500">{skipCount.toLocaleString()}건 중복</span>}
                  </p>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60">
                        <tr>
                          {['학교명','담당자','플랜','금액','계약일','스테이지'].map(h => (
                            <th key={h} className="px-2.5 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.slice(0, 5).map((d, i) => {
                          const isDupe = dupeKeys.has(makeKey(d));
                          return (
                            <tr key={i} className={`border-t border-border ${isDupe ? 'opacity-40 line-through' : ''}`}>
                              <td className="px-2.5 py-1.5 max-w-[120px] truncate">{d.Org_Name}</td>
                              <td className="px-2.5 py-1.5">{d.Contact_Name || '-'}</td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{d.Quote_Plan || '-'}</td>
                              <td className="px-2.5 py-1.5 tabular-nums text-right">
                                {d.Final_Contract_Value ? d.Final_Contract_Value.toLocaleString('ko-KR') : '-'}
                              </td>
                              <td className="px-2.5 py-1.5 tabular-nums">{d.Contract_Date || '-'}</td>
                              <td className="px-2.5 py-1.5">
                                {isDupe
                                  ? <span className="rounded-full px-1.5 py-0.5 bg-orange-100 text-orange-600 no-underline">중복</span>
                                  : <span className={`rounded-full px-1.5 py-0.5 ${STAGE_META[d.Deal_Stage ?? '']?.color ?? 'bg-muted'}`}>
                                      {STAGE_META[d.Deal_Stage ?? '']?.label ?? d.Deal_Stage}
                                    </span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* 진행 중 */}
            {importing && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm">가져오는 중... {progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  약 {Math.round(parsed.length / 10 * 0.25)}초 소요 예상 · 창을 닫지 마세요
                </p>
              </div>
            )}

            {/* 완료 */}
            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">{result.ok.toLocaleString()}건 추가 완료</p>
                    {result.skip > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">{result.skip.toLocaleString()}건 중복 스킵</p>
                    )}
                    {result.fail > 0 && (
                      <p className="text-xs text-orange-600 mt-0.5 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />{result.fail.toLocaleString()}건 실패
                        {result.errMsg && <span className="ml-1 text-[10px] opacity-70">({result.errMsg})</span>}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 px-6 py-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={importing} className="flex-1">
              {result ? '닫기' : '취소'}
            </Button>
            {parsed.length > 0 && !result && (
              <Button onClick={runImport} disabled={importing || newDeals.length === 0} className="flex-1">
                {importing
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />가져오는 중...</>
                  : skipCount > 0
                    ? `${newDeals.length.toLocaleString()}건 가져오기 (${skipCount.toLocaleString()}건 중복 스킵)`
                    : `${newDeals.length.toLocaleString()}건 가져오기`}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 다중 파일 첨부 (영수증 등) ───────────────────
function MultiFileAttachInput({
  label, pendingFiles, onAdd, onRemoveNew, storedFiles, onRemoveStored,
}: {
  label: string;
  pendingFiles: File[];
  onAdd: (f: File) => void;
  onRemoveNew: (i: number) => void;
  storedFiles: DealFileRecord[];
  onRemoveStored: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    Array.from(e.dataTransfer.files).forEach(f => onAdd(f));
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <input ref={inputRef} type="file" multiple className="hidden"
        onChange={e => { Array.from(e.target.files ?? []).forEach(f => onAdd(f)); e.target.value = ''; }} />
      <div className="mt-1 space-y-1.5">
        {/* 기존 저장 파일 */}
        {storedFiles.map(sf => (
          <div key={sf.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs bg-green-50/50">
            <Paperclip className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
            <a href={sf.file_url} target="_blank" rel="noopener noreferrer"
              className="flex-1 truncate text-green-700 hover:underline underline-offset-2">
              {sf.file_name}
            </a>
            <button type="button" onClick={() => onRemoveStored(sf.id)}
              className="flex-shrink-0 p-0.5 rounded hover:bg-muted">
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
        {/* 새로 선택된 파일 */}
        {pendingFiles.map((f, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-primary/40 px-3 py-2 text-xs bg-primary/5">
            <Paperclip className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="flex-1 truncate">{f.name}</span>
            <button type="button" onClick={() => onRemoveNew(i)}
              className="flex-shrink-0 p-0.5 rounded hover:bg-muted">
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
        {/* 추가 드롭존 */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer transition-colors
            ${dragOver ? 'border-primary bg-primary/5 border-solid' : 'border-dashed border-border hover:border-primary/50'}`}
        >
          <Upload className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground">
            {dragOver ? '놓아서 추가' : '클릭하거나 파일을 끌어다 놓기 (여러 파일 가능)'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 학교 검색 (NEIS API) ─────────────────────────
function SchoolSearchInput({
  value, onChange, onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (school: SchoolInfo) => void;
}) {
  const [results, setResults]   = useState<SchoolInfo[]>([]);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [searched, setSearched] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const doSearch = async (q: string) => {
    if (!q.trim() || q === searched) return;
    setLoading(true);
    setSearched(q);
    try {
      const data = await searchSchools(q);
      setResults(data);
      setOpen(true);
    } catch {
      toast.error('학교 검색 실패. 네트워크를 확인해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(value); } }}
          className="h-8 text-sm flex-1"
          placeholder="서울초등학교"
        />
        <Button
          type="button" size="sm" variant="outline"
          onClick={() => doSearch(value)}
          disabled={loading}
          className="h-8 px-2.5 text-xs flex-shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-background shadow-lg overflow-hidden">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">검색 결과 없음</div>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {results.map((s, i) => (
                <button key={i} type="button"
                  onClick={() => { onSelect(s); setOpen(false); }}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted/60 border-b border-border/50 last:border-0 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{s.kind}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{s.address}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 이용권 템플릿 파싱 ────────────────────────────
interface LicenseContact {
  phone: string;
  name: string;
  org?: string;
  code: string;
  duration: string;
  userCount: string;
}

async function parseLicenseTemplate(file: File): Promise<LicenseContact[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // 헤더 행 찾기
        let headerIdx = 0;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          if (rows[i].some(c => String(c).includes('고객명') || String(c).includes('이용권코드'))) {
            headerIdx = i; break;
          }
        }
        const headers = rows[headerIdx].map(c => String(c));
        const col = (keywords: string[]) =>
          headers.findIndex(h => keywords.some(k => h.includes(k)));

        const phoneCol    = col(['휴대폰', '전화번호', '수신']);
        const nameCol     = col(['고객명', '이름']);
        const codeCol     = col(['이용권코드', '코드']);
        const durationCol = col(['이용기간', '개월수']);
        const countCol    = col(['이용인원', '인원']);

        const contacts: LicenseContact[] = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          const phone = phoneCol >= 0 ? String(r[phoneCol] ?? '').trim() : '';
          const rawName = nameCol >= 0 ? String(r[nameCol] ?? '').trim() : '';
          if (!phone && !rawName) continue;
          // "소속+이름" 형태 감지
          let name = rawName;
          let org: string | undefined;
          if (rawName.includes('+')) {
            const parts = rawName.split('+');
            org  = parts[0].trim() || undefined;
            name = parts.slice(1).join('+').trim() || rawName;
          }
          contacts.push({
            phone,
            name,
            org,
            code:      codeCol     >= 0 ? String(r[codeCol]     ?? '').trim() : '',
            duration:  durationCol >= 0 ? String(r[durationCol] ?? '').trim() : '',
            userCount: countCol    >= 0 ? String(r[countCol]    ?? '').trim() : '',
          });
        }
        resolve(contacts);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── 전화번호 조회 결과 ────────────────────────────
interface PhoneStatus {
  type: 'new' | 'existing' | 'contact_only';
  name?: string;
  email?: string;
  dealCount: number;
  contactRecord?: AirtableRecord<ContactFields>;
}

// ── 딜 폼 ─────────────────────────────────────────
// ── 견적 탭 로컬 타입 ──────────────────────────────
interface QuoteTab {
  id?: string;
  is_selected?: boolean;
  quote_number?: string;
  quote_date?: string;
  plan?: string;
  qty?: number;
  license_qty?: number;
  duration?: number;
  unit_price?: number;
  final_value?: number;
  supply_price?: number;
  tax_amount?: number;
  items?: QuoteLineItem[];
  discount_amount?: number;
  notes?: string;
}

function DealForm({
  initial, onSave, onCancel, saving, contacts, allDeals, initialContact, existingFiles, initialQuotes, initialLicenses, draftKey,
}: {
  initial?: Partial<DealFields>;
  initialContact?: AirtableRecord<ContactFields>;
  existingFiles?: DealFileRecord[];
  initialQuotes?: DealQuote[];
  initialLicenses?: DealLicenseRecord[];
  draftKey?: string;
  onSave: (fields: Partial<DealFields>, files: Record<string, File>, receiptFiles: File[], licenseFiles: File[], licenseContacts: LicenseContact[], contactToUpdate?: AirtableRecord<ContactFields>, removedFileIds?: string[], removedReceiptIds?: string[], removedLicenseIds?: string[], quoteTabs?: QuoteTab[], dealUsers?: DealUserInput[]) => void;
  onCancel: () => void;
  saving: boolean;
  contacts?: AirtableRecord<ContactFields>[];
  allDeals?: AirtableRecord<DealFields>[];
}) {
  // existingFiles(DB)로 슬롯별 파일 초기화 (receipt, license 제외)
  // 구형 슬롯 → quote_file_{id}로 리매핑 (quote, quote_tab_N 호환)
  const initStoredFiles = (): Record<string, DealFileRecord> => {
    const result: Record<string, DealFileRecord> = {};
    for (const rec of existingFiles ?? []) {
      if (!rec.slot_key || rec.slot_key === 'receipt' || rec.slot_key === 'license') continue;
      let key = rec.slot_key;
      // quote_tab_N → quote_file_{id}
      const tabMatch = key.match(/^quote_tab_(\d+)$/);
      if (tabMatch && initialQuotes) {
        const idx = Number(tabMatch[1]);
        if (initialQuotes[idx]?.id) key = `quote_file_${initialQuotes[idx].id}`;
      }
      // 구형 'quote' 슬롯 → 첫 번째 견적의 quote_file_{id}
      if (key === 'quote' && initialQuotes?.[0]?.id) {
        key = `quote_file_${initialQuotes[0].id}`;
      }
      result[key] = rec;
    }
    return result;
  };

  const { data: partners } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['partners'],
    queryFn: async () => {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/partners?select=id,name&status=eq.active&order=name.asc`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
      );
      return res.ok ? res.json() : [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const DRAFT_STORAGE_KEY = draftKey ? `deal_draft_${draftKey}` : null;

  // draft에 의미있는 데이터가 있는지 확인 (initial 대비 변경된 필드)
  const hasMeaningfulData = (fields: Partial<DealFields>): boolean => {
    const init = initial ?? {};
    return Object.keys(fields).some(k => {
      const v = fields[k as keyof DealFields];
      const iv = init[k as keyof DealFields];
      return v !== undefined && v !== null && v !== '' && v !== iv;
    });
  };

  const loadDraft = () => {
    if (!DRAFT_STORAGE_KEY) return null;
    try { return JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null'); }
    catch { return null; }
  };

  const draft = loadDraft();
  const draftIsMeaningful = draft ? hasMeaningfulData(draft.fields ?? {}) : false;
  const [draftRestored, setDraftRestored] = useState(draftIsMeaningful);

  const [f, setF] = useState<Partial<DealFields>>(() => {
    const base = draftIsMeaningful ? (draft?.fields ?? initial ?? {}) : (initial ?? {});
    // deal_licenses에서 이용권 필드 자동 채우기 (Airtable 필드가 비어있는 경우)
    if (!base.License_Code_Count && initialLicenses && initialLicenses.length > 0) {
      base.License_Code_Count = initialLicenses.length;
    }
    return base;
  });
  const [phoneStatus, setPhoneStatus]       = useState<PhoneStatus | null>(null);
  const [showContactNotes, setShowContactNotes] = useState(false);
  const [pendingFiles, setPendingFiles]     = useState<Record<string, File>>({});
  const [storedFiles, setStoredFiles]       = useState<Record<string, DealFileRecord>>(initStoredFiles);
  const [removedFileIds, setRemovedFileIds] = useState<string[]>([]);
  // 영수증 파일 (다중)
  const [pendingReceiptFiles, setPendingReceiptFiles] = useState<File[]>([]);
  const [storedReceiptFiles, setStoredReceiptFiles]   = useState<DealFileRecord[]>(
    (existingFiles ?? []).filter(r => r.slot_key === 'receipt')
  );
  const [removedReceiptIds, setRemovedReceiptIds] = useState<string[]>([]);
  // 이용권 템플릿 파일 (다중)
  const [pendingLicenseFiles, setPendingLicenseFiles] = useState<File[]>([]);
  const [storedLicenseFiles, setStoredLicenseFiles]   = useState<DealFileRecord[]>(
    (existingFiles ?? []).filter(r => r.slot_key === 'license')
  );
  const [removedLicenseIds, setRemovedLicenseIds] = useState<string[]>([]);
  const [licenseContacts, setLicenseContacts] = useState<LicenseContact[]>([]);
  // ── 사용자(이용권 수신자) 상태 ──
  const [dealUsers, setDealUsers] = useState<DealUserInput[]>([]);
  const [dealUsersLoaded, setDealUsersLoaded] = useState(false);
  const [showCustomSource, setShowCustomSource] = useState(false);
  const [parsingTemplate, setParsingTemplate] = useState(false);
  const [pdfGenAttaching, setPdfGenAttaching] = useState(false);
  const [quoteSendPreview, setQuoteSendPreview] = useState<{
    blobUrl: string; base64: string; fileName: string;
  } | null>(null);
  const [quoteSending, setQuoteSending] = useState(false);
  // 일괄 발송 미리보기
  const [quoteBatchPreview, setQuoteBatchPreview] = useState<
    Array<{ blobUrl: string; base64: string; fileName: string; tabLabel: string }> | null
  >(null);
  const [quoteBatchActiveIdx, setQuoteBatchActiveIdx] = useState(0);
  const [quoteBatchSending, setQuoteBatchSending] = useState(false);
  const [quoteNumGenerating, setQuoteNumGenerating] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── 견적 탭 상태 ───────────────────────────────
  const [localTabs, setLocalTabs] = useState<QuoteTab[]>(() => {
    if (draftIsMeaningful && draft?.tabs) return draft.tabs;
    if (initialQuotes && initialQuotes.length > 0) {
      return initialQuotes.map(q => {
        let items = (q.items as QuoteLineItem[] | undefined) ?? [];
        // items가 비어있으면 저장된 단가로 복원 (표준 단가가 아닌 실제 단가 사용)
        if (items.length === 0 && q.plan && q.duration) {
          const lq = q.license_qty || (q.qty ? Math.ceil(q.qty / 40) : 1);
          const unitPrice = q.unit_price || 0;
          items = [{
            plan: q.plan, duration: q.duration, qty: lq,
            unit_price: unitPrice, amount: unitPrice * lq,
            s2b_number: getS2BNumber(q.plan, q.duration),
          }];
        }
        return ({
        id: q.id, is_selected: q.is_selected,
        quote_number: q.quote_number, quote_date: q.quote_date,
        plan: q.plan, qty: q.qty, license_qty: q.license_qty,
        duration: q.duration, unit_price: q.unit_price,
        final_value: q.final_value, supply_price: q.supply_price,
        tax_amount: q.tax_amount, notes: q.notes,
        items,
        discount_amount: q.discount_amount ?? 0,
      });});
    }
    // 구형 딜: Airtable 필드에서 items 복원 (실제 단가 사용)
    const legacyItems: QuoteLineItem[] = [];
    if (initial?.Quote_Plan && initial?.Unit_Price && initial?.License_Duration) {
      const lq = initial?.Quote_Qty ? Math.ceil(initial.Quote_Qty / 40) : 1;
      legacyItems.push({
        plan: initial.Quote_Plan, duration: initial.License_Duration, qty: lq,
        unit_price: initial.Unit_Price, amount: initial.Unit_Price * lq,
        s2b_number: getS2BNumber(initial.Quote_Plan, initial.License_Duration),
      });
    }
    return [{
      quote_number: initial?.Quote_Number, quote_date: initial?.Quote_Date,
      plan: initial?.Quote_Plan, qty: initial?.Quote_Qty,
      license_qty: initial?.Quote_Qty ? Math.ceil(initial.Quote_Qty / 40) : undefined,
      duration: initial?.License_Duration, unit_price: initial?.Unit_Price,
      final_value: initial?.Final_Contract_Value, supply_price: initial?.Supply_Price,
      tax_amount: initial?.Tax_Amount,
      items: legacyItems.length > 0 ? legacyItems : undefined,
    }];
  });
  const [activeTabIdx, setActiveTabIdx] = useState(() => {
    if (draftIsMeaningful && draft?.activeTabIdx != null) return draft.activeTabIdx;
    if (initialQuotes && initialQuotes.length > 0) {
      const sel = initialQuotes.findIndex(q => q.is_selected);
      return sel >= 0 ? sel : 0;
    }
    return 0;
  });

  const upTab = <K extends keyof QuoteTab>(key: K, value: QuoteTab[K]) => {
    setLocalTabs(prev => {
      const next = [...prev];
      next[activeTabIdx] = { ...next[activeTabIdx], [key]: value };
      return next;
    });
  };

  const readCurrentTabData = (): QuoteTab => {
    const tab = localTabs[activeTabIdx];
    const items = tab?.items ?? [];
    const primaryPlan = items[0]?.plan;
    // 견적 식별/요청 정보(quote_number, quote_date, qty, duration)는 활성 탭 자체값 우선.
    // form 값은 fallback (legacy 호환).
    return {
      ...tab,
      quote_number: tab?.quote_number ?? f.Quote_Number ?? undefined,
      quote_date:   tab?.quote_date   ?? f.Quote_Date   ?? undefined,
      plan: primaryPlan ?? f.Quote_Plan ?? undefined,
      qty:      tab?.qty      ?? f.Quote_Qty       ?? undefined,
      duration: tab?.duration ?? f.License_Duration ?? undefined,
      unit_price: items[0]?.unit_price ?? f.Unit_Price ?? undefined,
      final_value: f.Final_Contract_Value ?? undefined,
      supply_price: f.Supply_Price ?? undefined,
      tax_amount: f.Tax_Amount ?? undefined,
      items,
      discount_amount: tab?.discount_amount,
    };
  };

  const applyTabToForm = (tab: QuoteTab) => {
    setF(prev => ({
      ...prev,
      Quote_Number:          tab.quote_number ?? '',
      Quote_Date:            tab.quote_date ?? '',
      Quote_Plan:            tab.plan ?? '',
      Quote_Qty:             tab.qty,
      License_Duration:      tab.duration,
      Unit_Price:            tab.unit_price,
      Final_Contract_Value:  tab.final_value,
      Supply_Price:          tab.supply_price,
      Tax_Amount:            tab.tax_amount,
    }));
  };

  const switchToTab = (idx: number) => {
    if (idx === activeTabIdx) return;
    const newTabs = [...localTabs];
    newTabs[activeTabIdx] = readCurrentTabData();
    setLocalTabs(newTabs);
    applyTabToForm(newTabs[idx]);
    setActiveTabIdx(idx);
  };

  const addQuoteTab = () => {
    const newTabs = [...localTabs];
    newTabs[activeTabIdx] = readCurrentTabData();
    const newTab: QuoteTab = {};
    setLocalTabs([...newTabs, newTab]);
    applyTabToForm(newTab);
    setActiveTabIdx(newTabs.length);
  };

  const removeQuoteTab = (idx: number) => {
    if (localTabs.length <= 1) return;
    const newTabs = localTabs.filter((_, i) => i !== idx);
    const newIdx = Math.min(activeTabIdx > idx ? activeTabIdx - 1 : activeTabIdx, newTabs.length - 1);
    setLocalTabs(newTabs);
    applyTabToForm(newTabs[newIdx]);
    setActiveTabIdx(newIdx);
  };

  const getTabLabel = (t: QuoteTab, idx: number): string => {
    if (t.quote_number) {
      const parts = t.quote_number.split('-');
      return parts[parts.length - 1] ?? t.quote_number;
    }
    if (t.plan) return t.plan.replace('플랜', '').replace('학교(', '학교').replace(')', '');
    if (t.final_value) return `${Math.round(t.final_value / 10000)}만`;
    return `견적 ${idx + 1}`;
  };

  // ── 사용자 로드 (편집 시 DB에서 / 추가 시 담당자로 초기화) ──
  useEffect(() => {
    if (dealUsersLoaded) return;
    const dealId = draftKey?.startsWith('edit_') ? draftKey.slice(5) : null;
    if (dealId) {
      getDealUsers(dealId).then(users => {
        if (users.length > 0) {
          setDealUsers(users.map(u => ({
            user_name: u.user_name, user_phone: u.user_phone, user_email: u.user_email,
            student_count: u.student_count, month_count: u.month_count, plan_name: u.plan_name,
            is_primary: u.is_primary,
          })));
        } else {
          setDealUsers([{
            user_name: initial?.Contact_Name, user_phone: initial?.Contact_Phone, user_email: initial?.Contact_Email,
            student_count: 40, month_count: initial?.License_Duration, plan_name: initial?.Quote_Plan || '학급별', is_primary: true,
          }]);
        }
        setDealUsersLoaded(true);
      }).catch(() => setDealUsersLoaded(true));
    } else {
      if (dealUsers.length === 0) {
        setDealUsers([{
          user_name: initial?.Contact_Name, user_phone: initial?.Contact_Phone, user_email: initial?.Contact_Email,
          student_count: 40, month_count: initial?.License_Duration, plan_name: initial?.Quote_Plan || '학급별', is_primary: true,
        }]);
      }
      setDealUsersLoaded(true);
    }
  }, [initial, dealUsersLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // 담당자 변경 시 primary 사용자 자동 업데이트
  useEffect(() => {
    if (dealUsers.length > 0 && dealUsers[0]?.is_primary) {
      setDealUsers(prev => {
        const first = prev[0];
        if (first.user_name === f.Contact_Name && first.user_phone === f.Contact_Phone && first.user_email === f.Contact_Email) return prev;
        return [{ ...first, user_name: f.Contact_Name, user_phone: f.Contact_Phone, user_email: f.Contact_Email }, ...prev.slice(1)];
      });
    }
  }, [f.Contact_Name, f.Contact_Phone, f.Contact_Email]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDealUser = (idx: number, field: keyof DealUserInput, value: unknown) => {
    setDealUsers(prev => prev.map((u, i) => i === idx ? { ...u, [field]: value } : u));
  };
  const addDealUser = () => {
    const base = dealUsers[0];
    const next = [...dealUsers, {
      user_name: '', user_phone: '', user_email: '',
      student_count: base?.student_count ?? 40,
      month_count: base?.month_count,
      plan_name: base?.plan_name ?? '학급별',
      is_primary: false,
    }];
    setDealUsers(next);
    up('License_Code_Count', next.length);
  };
  const removeDealUser = (idx: number) => {
    if (dealUsers.length <= 1) return;
    const next = dealUsers.filter((_, i) => i !== idx);
    setDealUsers(next);
    up('License_Code_Count', next.length);
  };
  // 전체 사용자에게 동일 값 일괄 적용
  const applyToAllUsers = (field: keyof DealUserInput, value: unknown) => {
    setDealUsers(prev => prev.map(u => ({ ...u, [field]: value })));
  };

  // ── Draft 자동저장 (의미있는 데이터가 있을 때만) ──
  useEffect(() => {
    if (!DRAFT_STORAGE_KEY) return;
    if (!hasMeaningfulData(f)) {
      // 빈 폼이면 기존 draft 삭제
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    const timer = setTimeout(() => {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ fields: f, tabs: localTabs, activeTabIdx }));
    }, 600);
    return () => clearTimeout(timer);
  }, [f, localTabs, activeTabIdx, DRAFT_STORAGE_KEY]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearDraft = () => {
    if (DRAFT_STORAGE_KEY) localStorage.removeItem(DRAFT_STORAGE_KEY);
  };

  // 파일+날짜 상태 기반 스테이지 자동 계산
  const autoStage = (pending: Record<string, File>, stored: Record<string, DealFileRecord>, pendingLic: File[], storedLic: DealFileRecord[], fields: Partial<DealFields>): string => {
    if (fields.Payment_Date) return '입금완료';
    if (pendingLic.length > 0 || storedLic.length > 0) return '이용권 발송완료';
    if (Object.keys(pending).some(k => k.startsWith('quote')) || Object.keys(stored).some(k => k.startsWith('quote'))) return '견적';
    return 'Lead';
  };

  // 기존 DB 파일 제거 (저장 시 실제 삭제)
  const removeStoredFile = (slotKey: string) => {
    const rec = storedFiles[slotKey];
    if (rec) setRemovedFileIds(prev => [...prev, rec.id]);
    setStoredFiles(prev => {
      const next = { ...prev };
      delete next[slotKey];
      up('Deal_Stage', autoStage(pendingFiles, next, pendingLicenseFiles, storedLicenseFiles, f));
      return next;
    });
  };

  const removeStoredReceipt = (id: string) => {
    setRemovedReceiptIds(prev => [...prev, id]);
    setStoredReceiptFiles(prev => prev.filter(r => r.id !== id));
  };

  const addReceiptFile = (file: File) => {
    setPendingReceiptFiles(prev => [...prev, file]);
  };

  const removeReceiptFile = (i: number) => {
    setPendingReceiptFiles(prev => prev.filter((_, idx) => idx !== i));
  };

  const removeStoredLicenseFile = (id: string) => {
    setRemovedLicenseIds(prev => [...prev, id]);
    setStoredLicenseFiles(prev => {
      const next = prev.filter(r => r.id !== id);
      up('Deal_Stage', autoStage(pendingFiles, storedFiles, pendingLicenseFiles, next, f));
      return next;
    });
  };

  const parseAllLicenseFiles = async (files: File[]) => {
    if (files.length === 0) {
      setLicenseContacts([]);
      up('License_Template', '');
      return;
    }
    setParsingTemplate(true);
    try {
      const allContacts: LicenseContact[] = [];
      for (const file of files) {
        const parsed = await parseLicenseTemplate(file);
        allContacts.push(...parsed);
      }
      // phone+code 기준 중복 제거
      const seen = new Set<string>();
      const unique = allContacts.filter(lc => {
        const key = `${lc.phone}|${lc.code}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setLicenseContacts(unique);
      up('License_Template', files.map(file => file.name).join(', '));
      if (unique.length > 0 && !num('License_Code_Count')) {
        up('License_Code_Count', unique.length);
      }
    } catch {
      toast.error('템플릿 파싱 실패. 형식을 확인해주세요.');
    } finally {
      setParsingTemplate(false);
    }
  };

  const addLicenseFile = async (file: File) => {
    const next = [...pendingLicenseFiles, file];
    setPendingLicenseFiles(next);
    up('Deal_Stage', autoStage(pendingFiles, storedFiles, next, storedLicenseFiles, f));
    await parseAllLicenseFiles(next);
  };

  const removePendingLicenseFile = async (i: number) => {
    const next = pendingLicenseFiles.filter((_, idx) => idx !== i);
    setPendingLicenseFiles(next);
    up('Deal_Stage', autoStage(pendingFiles, storedFiles, next, storedLicenseFiles, f));
    await parseAllLicenseFiles(next);
  };

  const up  = (k: keyof DealFields, v: unknown) => setF(prev => ({ ...prev, [k]: v }));
  const n   = (k: keyof DealFields) => (f[k] as string) ?? '';
  const num = (k: keyof DealFields) => (f[k] as number | undefined);
  const partnerNames = (partners ?? []).map(p => p.name);
  // 파트너 목록 로드 후 기존 Lead_Source가 목록에 없으면 직접입력 모드로 전환
  useEffect(() => {
    if (!partners || partners.length === 0) return;
    const src = n('Lead_Source');
    if (src && !partnerNames.includes(src)) setShowCustomSource(true);
  }, [partners]);

  const selectedPlans = (n('Quote_Plan') || '').split(',').map(s => s.trim()).filter(Boolean);
  const togglePlan = (p: string) => {
    const next = selectedPlans.includes(p)
      ? selectedPlans.filter(x => x !== p)
      : [...selectedPlans, p];
    up('Quote_Plan', next.join(', '));
  };

  // 파일 선택 처리
  const handleFileSelect = async (slotKey: string, file: File | null) => {
    setPendingFiles(prev => {
      const next = file ? { ...prev, [slotKey]: file } : { ...prev };
      if (!file) delete next[slotKey];
      up('Deal_Stage', autoStage(next, storedFiles, pendingLicenseFiles, storedLicenseFiles, f));
      return next;
    });
  };
  const fileRef = (key: string) => (el: HTMLInputElement | null) => { fileRefs.current[key] = el; };

  const getQuotePdfData = () => {
    const tab = localTabs[activeTabIdx];
    const items = tab?.items ?? [];
    const discount = tab?.discount_amount ?? 0;
    const totals = calcQuoteTotals(items, discount);
    const quoteNumber = n('Quote_Number');
    const paymentUrl = quoteNumber ? `${window.location.origin}/order/pay/${encodeURIComponent(quoteNumber)}` : undefined;
    return {
      quoteNumber,
      quoteDate: n('Quote_Date'),
      orgName: n('Org_Name'),
      contactName: n('Contact_Name'),
      items,
      discountAmount: discount,
      plan: items[0]?.plan || n('Quote_Plan') || '',
      duration: num('License_Duration') ?? items[0]?.duration ?? 0,
      unitPrice: items[0]?.unit_price ?? num('Unit_Price') ?? 0,
      licenseQty: tab?.license_qty ?? 0,
      finalValue: totals.finalValue || (num('Final_Contract_Value') ?? 0),
      supplyPrice: totals.supplyPrice || (num('Supply_Price') ?? 0),
      taxAmount: totals.taxAmount || (num('Tax_Amount') ?? 0),
      notes: tab?.notes,
      paymentUrl,
    };
  };

  const handleQuoteGenerateNumber = async () => {
    setQuoteNumGenerating(true);
    try {
      const dbNums = await fetchAllDealQuoteNumbers().catch(() => [] as string[]);
      const airtableNums = (allDeals ?? []).flatMap(d => d.fields.Quote_Number ? [d.fields.Quote_Number] : []);
      const localNums = localTabs
        .filter((_, i) => i !== activeTabIdx)
        .flatMap(t => t.quote_number ? [t.quote_number] : []);
      const newNum = generateQuoteNumber([...airtableNums, ...dbNums, ...localNums]);
      // 활성 탭 + form 동시 update (탭 간 데이터 격리)
      upTab('quote_number', newNum);
      up('Quote_Number', newNum);
    } finally { setQuoteNumGenerating(false); }
  };

  const handleQuoteGenerateAndAttach = async (qSlot: string) => {
    setPdfGenAttaching(true);
    try {
      const { blob, fileName } = await generateQuotePdfBlob(getQuotePdfData());
      const file = new File([blob], fileName, { type: 'application/pdf' });
      setPendingFiles(prev => ({ ...prev, [qSlot]: file }));
    } catch { toast.error('PDF 생성 실패'); }
    finally { setPdfGenAttaching(false); }
  };

  const handleQuoteOpenSendPreview = async (qSlot: string) => {
    const contactEmail = n('Contact_Email');
    if (!contactEmail) { toast.error('담당자 이메일이 없습니다'); return; }
    const pendingFile = pendingFiles[qSlot];
    const storedFile = storedFiles[qSlot];
    let blob: Blob;
    let fileName: string;
    if (pendingFile) {
      blob = pendingFile; fileName = pendingFile.name;
    } else if (storedFile) {
      const r = await fetch(storedFile.file_url).catch(() => null);
      if (!r?.ok) { toast.error('파일을 불러올 수 없습니다'); return; }
      blob = await r.blob(); fileName = storedFile.file_name;
    } else { toast.error('첨부된 파일이 없습니다'); return; }
    const blobUrl = URL.createObjectURL(blob);
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    setQuoteSendPreview({ blobUrl, base64, fileName });
  };

  // 결제 페이지 검증용 — deal_quotes에 quote_number / contact_email / contact_phone UPSERT
  // /order/pay/:quoteNumber에서 견적서 조회 + 이메일 매칭 시 사용됨
  const upsertActiveTabQuote = async () => {
    const quoteNumber = n('Quote_Number');
    if (!quoteNumber) return;
    const dealId = draftKey?.startsWith('edit_') ? draftKey.slice(5) : 'web';
    const tab = localTabs[activeTabIdx];
    const items = tab?.items ?? [];
    const fields = {
      deal_id: dealId,
      quote_number: quoteNumber,
      quote_date: n('Quote_Date') || undefined,
      contact_email: n('Contact_Email') || undefined,
      contact_phone: n('Contact_Phone') || undefined,
      org_name: n('Org_Name') || undefined,
      plan: items[0]?.plan || n('Quote_Plan') || undefined,
      duration: num('License_Duration') ?? items[0]?.duration,
      qty: items[0]?.qty,
      license_qty: tab?.license_qty,
      unit_price: items[0]?.unit_price ?? num('Unit_Price'),
      supply_price: num('Supply_Price'),
      tax_amount: num('Tax_Amount'),
      final_value: num('Final_Contract_Value'),
      items,
      discount_amount: tab?.discount_amount,
      notes: tab?.notes,
    };
    try {
      const found = await fetch(
        `${SUPABASE_URL}/rest/v1/deal_quotes?quote_number=eq.${encodeURIComponent(quoteNumber)}&select=id`,
        { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } },
      ).then((r) => (r.ok ? r.json() : []));
      if (Array.isArray(found) && found.length > 0) {
        await updateDealQuote(found[0].id, fields);
      } else {
        await saveDealQuote({ ...fields, is_selected: tab?.is_selected ?? false } as Omit<DealQuote, 'id' | 'created_at'>);
      }
    } catch (e) {
      console.warn('deal_quotes UPSERT 실패 (이메일 검증 영향)', e);
    }
  };

  const handleQuoteConfirmSend = async () => {
    if (!quoteSendPreview) return;
    setQuoteSending(true);
    try {
      const quoteNumber = n('Quote_Number');
      const contactEmail = n('Contact_Email');
      const paymentUrl = quoteNumber ? `${window.location.origin}/order/pay/${encodeURIComponent(quoteNumber)}` : undefined;

      // 결제 페이지 검증용 — deal_quotes에 contact_email/contact_phone UPSERT
      await upsertActiveTabQuote();

      await sendQuoteEmail({
        to: contactEmail,
        orgName: n('Org_Name'),
        contactName: n('Contact_Name'),
        quoteNumber,
        paymentUrl,
        attachmentBase64: quoteSendPreview.base64,
        attachmentFileName: quoteSendPreview.fileName,
      });
      toast.success(`${contactEmail}으로 견적서를 발송했습니다`);
      URL.revokeObjectURL(quoteSendPreview.blobUrl);
      setQuoteSendPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '발송 실패');
    } finally { setQuoteSending(false); }
  };

  // 견적서 일괄 발송 미리보기
  const handleQuoteBatchPreview = async () => {
    const contactEmail = n('Contact_Email');
    if (!contactEmail) { toast.error('담당자 이메일이 없습니다'); return; }
    const previews: Array<{ blobUrl: string; base64: string; fileName: string; tabLabel: string }> = [];
    for (let i = 0; i < localTabs.length; i++) {
      const tab = localTabs[i];
      const qSlot = tab.id ? `quote_file_${tab.id}` : `quote_tab_${i}`;
      const pendingFile = pendingFiles[qSlot];
      const storedFile = storedFiles[qSlot];
      let blob: Blob | null = null;
      let fileName = '';
      if (pendingFile) {
        blob = pendingFile; fileName = pendingFile.name;
      } else if (storedFile) {
        const r = await fetch(storedFile.file_url).catch(() => null);
        if (r?.ok) { blob = await r.blob(); fileName = storedFile.file_name; }
      }
      if (blob) {
        const blobUrl = URL.createObjectURL(blob);
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob!);
        });
        previews.push({ blobUrl, base64, fileName, tabLabel: getTabLabel(tab, i) });
      }
    }
    if (previews.length === 0) { toast.error('발송할 견적서 파일이 없습니다'); return; }
    setQuoteBatchPreview(previews);
    setQuoteBatchActiveIdx(0);
  };

  const handleQuoteBatchSend = async () => {
    if (!quoteBatchPreview) return;
    setQuoteBatchSending(true);
    try {
      const quoteNumber = n('Quote_Number');
      const contactEmail = n('Contact_Email');
      const paymentUrl = quoteNumber ? `${window.location.origin}/order/pay/${encodeURIComponent(quoteNumber)}` : undefined;

      // 결제 페이지 검증용 — deal_quotes에 contact_email/contact_phone UPSERT
      await upsertActiveTabQuote();

      await sendQuoteEmail({
        to: contactEmail,
        orgName: n('Org_Name'),
        contactName: n('Contact_Name'),
        quoteNumber,
        paymentUrl,
        attachments: quoteBatchPreview.map(p => ({ base64: p.base64, fileName: p.fileName })),
      });
      toast.success(`${quoteBatchPreview.length}건의 견적서를 ${contactEmail}으로 발송했습니다`);
      quoteBatchPreview.forEach(p => URL.revokeObjectURL(p.blobUrl));
      setQuoteBatchPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '일괄 발송 실패');
    } finally { setQuoteBatchSending(false); }
  };

  const cleanupBatchPreview = () => {
    quoteBatchPreview?.forEach(p => URL.revokeObjectURL(p.blobUrl));
    setQuoteBatchPreview(null);
  };

  // 전화번호 재구매/신규 감지
  useEffect(() => {
    const phone = f.Contact_Phone?.trim() ?? '';
    if (phone.replace(/\D/g, '').length < 9) { setPhoneStatus(null); return; }
    const timer = setTimeout(() => {
      const norm = normalizePhone(phone);
      const contactMatch = contacts?.find(c => {
        const cn = c.fields.phone_normalized || normalizePhone(c.fields.Phone ?? '');
        return cn === norm;
      });
      // 현재 편집 중인 딜 제외하고 기존 딜 수 계산
      const currentDealId = draftKey?.startsWith('edit_') ? draftKey.slice(5) : null;
      const otherDeals = allDeals?.filter(d =>
        normalizePhone(d.fields.Contact_Phone ?? '') === norm && d.id !== currentDealId
      ) ?? [];
      const dealCount = otherDeals.length;
      if (contactMatch || dealCount > 0) {
        setPhoneStatus({ type: dealCount > 0 ? 'existing' : 'contact_only', name: contactMatch?.fields.Name, email: contactMatch?.fields.Email, dealCount, contactRecord: contactMatch });
        if (!f.Contact_Name && contactMatch?.fields.Name) {
          setF(prev => ({
            ...prev,
            Contact_Name: contactMatch.fields.Name!,
            Contact_Email: contactMatch.fields.Email ?? prev.Contact_Email,
            Deal_Type: dealCount > 0 ? 'Renewal' : prev.Deal_Type,
          }));
        }
      } else {
        setPhoneStatus({ type: 'new', dealCount: 0 });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [f.Contact_Phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const fillFromContact = () => {
    if (!phoneStatus) return;
    if (phoneStatus.name) up('Contact_Name', phoneStatus.name);
    if (phoneStatus.email) up('Contact_Email', phoneStatus.email);
    if (phoneStatus.dealCount > 0) up('Deal_Type', 'Renewal');
  };

  const computedName = f.Deal_Name
    || (f.Contact_Name && f.Org_Name ? `${f.Contact_Name} (${f.Org_Name})` : f.Contact_Name || f.Org_Name || '');

  return (<>
    <div className="space-y-6">

      {/* Draft 복원 배너 */}
      {draftRestored && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <span className="flex-1">⚠️ 이전에 작성 중이던 내용이 복원됐습니다.</span>
          <button type="button" onClick={() => { clearDraft(); setF(initial ?? {}); setDraftRestored(false); }}
            className="underline hover:opacity-70 whitespace-nowrap">초기화</button>
          <button type="button" onClick={() => setDraftRestored(false)}
            className="text-amber-500 hover:opacity-70 ml-1">✕</button>
        </div>
      )}

      {/* 스테이지 + 유형 */}
      <div className="flex gap-2 flex-wrap">
        {ALL_DEAL_STAGES.map(s => (
          <button key={s} type="button" onClick={() => up('Deal_Stage', s)}
            className={`text-xs rounded-full px-3 py-1.5 border transition-colors
              ${f.Deal_Stage === s ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border hover:border-primary/50'}`}>
            {STAGE_META[s]?.label ?? s}
          </button>
        ))}
        <select value={f.Deal_Type ?? 'New'} onChange={e => up('Deal_Type', e.target.value)}
          className="text-xs rounded-full px-3 py-1.5 border border-border bg-background ml-auto">
          <option value="New">신규</option>
          <option value="Renewal">재구매</option>
        </select>
      </div>

      {/* 담당자 */}
      <Section icon={User} title="담당자">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="전화번호 *">
              <Input value={n('Contact_Phone')} onChange={e => up('Contact_Phone', formatPhone(e.target.value))}
                className="h-8 text-sm" placeholder="010-0000-0000" />
            </Field>
            <Field label="이름">
              <Input value={n('Contact_Name')} onChange={e => up('Contact_Name', e.target.value)}
                className="h-8 text-sm" placeholder="홍길동" />
            </Field>
          </div>
          {phoneStatus && (
            <div className={`rounded-lg border text-xs overflow-hidden
              ${phoneStatus.type === 'existing'
                ? 'bg-orange-50 border-orange-200 text-orange-700'
                : phoneStatus.type === 'contact_only'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              <div className="flex items-center gap-2 px-3 py-2">
                {phoneStatus.type === 'existing' ? (
                  <>
                    <UserCheck className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1">
                      <strong>재구매 고객</strong>
                      {phoneStatus.name && ` · ${phoneStatus.name}`}
                      {` · 기존 딜 ${phoneStatus.dealCount}건`}
                    </span>
                    {phoneStatus.contactRecord?.fields.Notes && (
                      <button type="button"
                        onClick={() => setShowContactNotes(v => !v)}
                        className="underline font-medium whitespace-nowrap hover:opacity-70 mr-2">
                        {showContactNotes ? '이력 닫기' : '이력 보기'}
                      </button>
                    )}
                    <button type="button" onClick={fillFromContact}
                      className="underline font-medium whitespace-nowrap hover:opacity-70">정보 불러오기</button>
                  </>
                ) : phoneStatus.type === 'contact_only' ? (
                  <>
                    <UserCheck className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1">
                      <strong>등록 고객</strong>
                      {phoneStatus.name && ` · ${phoneStatus.name}`}
                    </span>
                    <button type="button" onClick={fillFromContact}
                      className="underline font-medium whitespace-nowrap hover:opacity-70">정보 불러오기</button>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 flex-shrink-0" />
                    <span><strong>신규 고객</strong> · 등록된 연락처 없음</span>
                  </>
                )}
              </div>
              {/* 기존 고객 Notes 표시 */}
              {(phoneStatus.type === 'existing' || phoneStatus.type === 'contact_only') && showContactNotes && phoneStatus.contactRecord?.fields.Notes && (
                <div className="border-t border-orange-200 bg-orange-50/70 px-3 py-2 space-y-1 max-h-36 overflow-y-auto">
                  {phoneStatus.contactRecord.fields.Notes.split('\n').filter(Boolean).map((line, i) => {
                    const clean = line.replace(/\s*·rec\w+/, '');
                    const dateMatch = clean.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*/);
                    return (
                      <div key={i} className="flex gap-2">
                        {dateMatch ? (
                          <>
                            <span className="font-mono text-orange-500 flex-shrink-0">{dateMatch[1]}</span>
                            <span className="text-orange-700">{clean.replace(dateMatch[0], '')}</span>
                          </>
                        ) : (
                          <span className="text-orange-700">{clean}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <Field label="이메일">
            <Input value={n('Contact_Email')} onChange={e => up('Contact_Email', e.target.value)}
              type="email" className="h-8 text-sm" />
          </Field>
        </div>
      </Section>

      {/* 기관 */}
      <Section icon={Building2} title="기관">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="학교/기관명">
              <SchoolSearchInput
                value={n('Org_Name')}
                onChange={v => up('Org_Name', v)}
                onSelect={s => {
                  setF(prev => ({
                    ...prev,
                    Org_Name:           s.name,
                    Org_ZipCode:        s.zipCode.trim(),
                    Org_Address:        s.address,
                    Org_Address_Detail: s.addressDetail,
                    Org_Tel:            s.tel,
                    Org_Homepage:       s.homepage,
                    Education_Office:   s.eduOffice,
                  }));
                }}
              />
            </Field>
          </div>
          {/* 학교 정보 (검색 후 자동완성) */}
          {(n('Org_Address') || n('Education_Office')) && (
            <div className="col-span-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 space-y-1.5 text-xs">
              {n('Education_Office') && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">시도교육청</span>
                  <span className="font-medium">{n('Education_Office')}</span>
                </div>
              )}
              {n('Org_ZipCode') && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">우편번호</span>
                  <span>{n('Org_ZipCode')}</span>
                </div>
              )}
              {n('Org_Address') && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">주소</span>
                  <span>{n('Org_Address')} {n('Org_Address_Detail')}</span>
                </div>
              )}
              {n('Org_Tel') && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">학교 전화</span>
                  <span>{n('Org_Tel')}</span>
                </div>
              )}
              {n('Org_Homepage') && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 flex-shrink-0">홈페이지</span>
                  <a href={n('Org_Homepage')} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline truncate">{n('Org_Homepage')}</a>
                </div>
              )}
            </div>
          )}
          <Field label="행정담당자">
            <Input value={n('Admin_Name')} onChange={e => up('Admin_Name', e.target.value)}
              className="h-8 text-sm" />
          </Field>
          <Field label="행정 전화">
            <Input value={n('Admin_Phone')} onChange={e => up('Admin_Phone', e.target.value)}
              className="h-8 text-sm" />
          </Field>
          <div className="col-span-2">
            <Field label="행정 이메일">
              <Input value={n('Admin_Email')} onChange={e => up('Admin_Email', e.target.value)}
                type="email" className="h-8 text-sm" />
            </Field>
          </div>
          <div className="col-span-2">
            <FileAttachInput label="고유번호증"
              textValue={n('School_ID_Number')} onTextChange={v => up('School_ID_Number', v)}
              placeholder="파일명 or 고유번호" slotKey="school_id"
              file={pendingFiles['school_id']} onFileSelect={handleFileSelect}
              inputRef={fileRef('school_id')}
              storedFile={storedFiles['school_id']} onRemoveStored={removeStoredFile} />
          </div>
        </div>
      </Section>

      {/* 견적 */}
      <Section icon={FileText} title="견적">
        <div className="rounded-lg border border-border overflow-hidden">
          {/* 탭 바 */}
          <div className="flex items-end bg-muted/30 border-b border-border overflow-x-auto px-1.5 pt-1.5">
            {localTabs.map((tab, idx) => (
              <button key={idx} type="button" onClick={() => switchToTab(idx)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-t border-l border-r rounded-t-md mr-0.5 flex-shrink-0 transition-colors
                  ${idx === activeTabIdx
                    ? 'bg-background border-border text-foreground font-medium -mb-px z-10'
                    : 'bg-transparent border-border/40 text-muted-foreground hover:bg-background/60'}`}>
                {tab.is_selected && <span className="text-[9px] rounded-full px-1 py-0.5 bg-primary text-primary-foreground font-medium leading-none">확정</span>}
                <span>{getTabLabel(tab, idx)}</span>
                {localTabs.length > 1 && (
                  <span
                    onClick={e => { e.stopPropagation(); removeQuoteTab(idx); }}
                    className="ml-0.5 text-muted-foreground hover:text-destructive leading-none cursor-pointer">×</span>
                )}
              </button>
            ))}
            <button type="button" onClick={addQuoteTab}
              className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0 mb-0.5">
              +
            </button>
            <div className="ml-auto flex-shrink-0 mb-0.5 pr-1 flex items-center gap-1.5">
              {localTabs.length > 1 && !localTabs[activeTabIdx]?.is_selected && (
                <button type="button" onClick={() => {
                  setLocalTabs(prev => prev.map((t, i) => ({ ...t, is_selected: i === activeTabIdx })));
                  // 확정된 견적의 금액을 딜 필드에 반영
                  const tab = localTabs[activeTabIdx];
                  if (tab?.final_value != null) {
                    setF(prev => ({
                      ...prev,
                      Quote_Date: tab.quote_date, Quote_Plan: tab.plan,
                      Quote_Qty: tab.qty, License_Duration: tab.duration,
                      Unit_Price: tab.unit_price, Supply_Price: tab.supply_price,
                      Tax_Amount: tab.tax_amount, Final_Contract_Value: tab.final_value,
                      Quote_Number: tab.quote_number,
                    }));
                  }
                  toast.success('이 견적을 딜 확정으로 선택했습니다');
                }}
                  className="text-[11px] px-2.5 py-1 rounded border border-primary/50 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />딜 확정
                </button>
              )}
              <button type="button" onClick={handleQuoteBatchPreview}
                className="text-[11px] px-2.5 py-1 rounded border border-blue-400 text-blue-600 hover:bg-blue-50 transition-colors flex items-center gap-1">
                <Mail className="h-3 w-3" />모두 발송
              </button>
            </div>
          </div>

        <div className="p-3 space-y-3">
          {/* 견적서번호 | 견적일 — 활성 탭 직접 binding (탭 간 데이터 격리) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">견적서 번호</Label>
                <button type="button" onClick={handleQuoteGenerateNumber} disabled={quoteNumGenerating}
                  className="text-[11px] px-2 py-0.5 rounded border border-primary/50 text-primary hover:bg-primary/10 disabled:opacity-50 flex items-center gap-1">
                  {quoteNumGenerating && <Loader2 className="h-3 w-3 animate-spin" />}생성
                </button>
              </div>
              <Input
                value={localTabs[activeTabIdx]?.quote_number ?? ''}
                onChange={e => { upTab('quote_number', e.target.value); up('Quote_Number', e.target.value); }}
                className="h-8 text-sm" placeholder="견적서 번호" />
            </div>
            <Field label="견적일">
              <DateInput
                value={localTabs[activeTabIdx]?.quote_date ?? ''}
                onChange={v => { upTab('quote_date', v); up('Quote_Date', v); }}
                className="h-8 text-sm" />
            </Field>
          </div>
          {/* 총인원 | 이용권수량 | 이용기간 — 활성 탭 직접 binding */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="총인원 (명)">
              <NumericInput
                value={localTabs[activeTabIdx]?.qty ?? undefined}
                onChange={v => { upTab('qty', v); up('Quote_Qty', v); }}
                className="h-8 text-sm" />
            </Field>
            <Field label="이용권 수 (장)">
              <NumericInput value={localTabs[activeTabIdx]?.license_qty ?? undefined} onChange={v => upTab('license_qty', v)} className="h-8 text-sm" />
            </Field>
            <Field label="이용기간 (개월)">
              <NumericInput
                value={localTabs[activeTabIdx]?.duration ?? undefined}
                onChange={v => { upTab('duration', v); up('License_Duration', v); }}
                className="h-8 text-sm" />
            </Field>
          </div>
          {/* 상품 */}
          {(() => {
            const items: QuoteLineItem[] = localTabs[activeTabIdx]?.items ?? [];
            const discount = localTabs[activeTabIdx]?.discount_amount ?? 0;
            const totals = calcQuoteTotals(items, discount);

            const setItems = (next: QuoteLineItem[]) => {
              setLocalTabs(prev => {
                const tabs = [...prev];
                tabs[activeTabIdx] = { ...tabs[activeTabIdx], items: next };
                return tabs;
              });
              const t = calcQuoteTotals(next, discount);
              setF(prev => ({ ...prev, Final_Contract_Value: t.finalValue, Supply_Price: t.supplyPrice, Tax_Amount: t.taxAmount }));
            };
            const setDiscount = (d: number | undefined) => {
              const dv = d ?? 0;
              setLocalTabs(prev => {
                const tabs = [...prev];
                tabs[activeTabIdx] = { ...tabs[activeTabIdx], discount_amount: dv };
                return tabs;
              });
              const t = calcQuoteTotals(items, dv);
              setF(prev => ({ ...prev, Final_Contract_Value: t.finalValue, Supply_Price: t.supplyPrice, Tax_Amount: t.taxAmount }));
            };
            const updateItem = (idx: number, patch: Partial<QuoteLineItem>) => {
              const next = items.map((it, i) => {
                if (i !== idx) return it;
                const updated = { ...it, ...patch };
                if ('plan' in patch || 'duration' in patch) {
                  const newItem = makeItem(updated.plan, updated.duration, updated.qty);
                  updated.unit_price = newItem.unit_price;
                  updated.s2b_number = newItem.s2b_number;
                }
                updated.amount = updated.unit_price * updated.qty;
                return updated;
              });
              setItems(next);
            };
            const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
            const addItem = () => setItems([...items, makeItem('학급플랜', 6, 1)]);
            const aiRecommend = () => {
              const rec = recommendItems(num('Quote_Qty') ?? 0, localTabs[activeTabIdx]?.license_qty ?? 0, num('License_Duration') ?? 0);
              if (rec.length) { setItems(rec); toast.success('AI 추천 상품이 추가되었습니다'); }
              else toast.error('총인원 또는 이용기간을 입력해주세요');
            };

            return (<>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">상품</Label>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={aiRecommend}
                      className="text-[11px] px-2 py-0.5 rounded border border-violet-400 text-violet-600 hover:bg-violet-50 flex items-center gap-1">
                      ✦ AI추천
                    </button>
                    <button type="button" onClick={addItem}
                      className="text-[11px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted flex items-center gap-1">
                      <Plus className="h-3 w-3" />추가
                    </button>
                  </div>
                </div>
                {items.length === 0 ? (
                  <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-md">
                    상품을 추가하세요
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {items.map((it, idx) => (
                      <div key={idx} className="rounded-md border border-border p-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={PLAN_LIST.includes(it.plan) ? it.plan : (it.plan ? '__custom__' : PLAN_LIST[0])}
                            onChange={e => {
                              const nextPlan = e.target.value;
                              if (nextPlan === '__custom__') {
                                // 기타 — 기존 자유입력 값 유지
                                updateItem(idx, { plan: PLAN_LIST.includes(it.plan) ? '' : it.plan, unit_price: 0 });
                              } else if (nextPlan === '럭키세븐이벤트플랜') {
                                updateItem(idx, { plan: nextPlan, duration: 7, unit_price: 0 });
                              } else {
                                updateItem(idx, { plan: nextPlan, unit_price: 0 });
                              }
                            }}
                            className="h-7 text-xs border rounded px-1.5 flex-1 bg-background"
                          >
                            {PLAN_LIST.map(p => <option key={p} value={p}>{p}</option>)}
                            <option value="__custom__">기타(직접입력)</option>
                          </select>
                          {it.plan && !PLAN_LIST.includes(it.plan) && (
                            <input
                              type="text"
                              value={it.plan}
                              onChange={e => updateItem(idx, { plan: e.target.value })}
                              placeholder="플랜명"
                              className="h-7 text-xs border rounded px-1.5 w-32 bg-background"
                            />
                          )}
                          <select value={it.duration} onChange={e => updateItem(idx, { duration: Number(e.target.value), unit_price: 0 })}
                            className="h-7 text-xs border rounded px-1.5 w-20 bg-background"
                            disabled={it.plan === '럭키세븐이벤트플랜'}>
                            {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d}개월</option>)}
                          </select>
                          <span className="text-xs text-muted-foreground">×</span>
                          <input type="number" value={it.qty || ''} min={1}
                            onChange={e => updateItem(idx, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                            className="h-7 text-xs border rounded px-1.5 w-12 text-center bg-background" />
                          <button type="button" onClick={() => removeItem(idx)}
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex-shrink-0">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>단가 {it.unit_price > 0 ? it.unit_price.toLocaleString('ko-KR') : '-'} {it.s2b_number && `· S2B ${it.s2b_number}`}</span>
                          <span className="font-medium text-foreground tabular-nums">{it.amount > 0 ? `${it.amount.toLocaleString('ko-KR')}원` : '-'}</span>
                        </div>
                      </div>
                    ))}
                    <div className="text-right text-xs text-muted-foreground pt-1">
                      소계: <span className="font-medium text-foreground tabular-nums">{totals.subtotal.toLocaleString('ko-KR')}원</span>
                    </div>
                  </div>
                )}
              </div>
              {/* 할인금액 */}
              <Field label="할인금액 (원)">
                <NumericInput value={discount || undefined} onChange={v => setDiscount(v)} className="h-8 text-sm" placeholder="0" />
              </Field>
              {/* 실결제금액 | 공급가액 | 세액 (자동계산) */}
              <div className="grid grid-cols-3 gap-3">
                <Field label="실결제금액 (원)">
                  <div className="h-8 flex items-center text-sm font-medium tabular-nums px-3 border rounded-md bg-muted/30">
                    {totals.finalValue > 0 ? totals.finalValue.toLocaleString('ko-KR') : '-'}
                  </div>
                </Field>
                <Field label="공급가액 (원)">
                  <div className="h-8 flex items-center text-sm text-muted-foreground tabular-nums px-3 border rounded-md bg-muted/30">
                    {totals.supplyPrice > 0 ? totals.supplyPrice.toLocaleString('ko-KR') : '자동계산'}
                  </div>
                </Field>
                <Field label="세액 (원)">
                  <div className="h-8 flex items-center text-sm text-muted-foreground tabular-nums px-3 border rounded-md bg-muted/30">
                    {totals.taxAmount > 0 ? totals.taxAmount.toLocaleString('ko-KR') : '자동계산'}
                  </div>
                </Field>
              </div>
            </>);
          })()}
          {/* 견적서 파일 첨부 (탭별 슬롯) */}
          {(() => {
            const qSlot = localTabs[activeTabIdx]?.id
              ? `quote_file_${localTabs[activeTabIdx].id}`
              : `quote_tab_${activeTabIdx}`;
            const pendingFile = pendingFiles[qSlot];
            const storedFile = storedFiles[qSlot];
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">견적서 파일</Label>
                  <button type="button" onClick={() => handleQuoteGenerateAndAttach(qSlot)} disabled={pdfGenAttaching}
                    className="text-[11px] px-2 py-0.5 rounded border border-primary/50 text-primary hover:bg-primary/10 disabled:opacity-50 flex items-center gap-1">
                    {pdfGenAttaching && <Loader2 className="h-3 w-3 animate-spin" />}생성
                  </button>
                </div>
                <input ref={fileRef(qSlot)} type="file" className="hidden" accept=".pdf,.doc,.docx"
                  onChange={e => { handleFileSelect(qSlot, e.target.files?.[0] ?? null); e.target.value = ''; }} />
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const fl = e.dataTransfer.files[0]; if (fl) handleFileSelect(qSlot, fl); }}
                  onClick={() => { if (!pendingFile && !storedFile) fileRefs.current[qSlot]?.click(); }}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors border-dashed border-border hover:border-primary/50 ${!pendingFile && !storedFile ? 'cursor-pointer' : 'cursor-default'}`}>
                  {pendingFile ? (
                    <>
                      <Paperclip className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <span className="flex-1 truncate">{pendingFile.name}</span>
                      <button type="button" onClick={e => { e.stopPropagation(); handleFileSelect(qSlot, null); }}
                        className="p-0.5 rounded hover:bg-muted flex-shrink-0">
                        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                      <button type="button" onClick={e => { e.stopPropagation(); handleQuoteOpenSendPreview(qSlot); }}
                        className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded border border-blue-400 text-blue-600 hover:bg-blue-50">
                        발송
                      </button>
                    </>
                  ) : storedFile ? (
                    <>
                      <Paperclip className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                      <a href={storedFile.file_url} target="_blank" rel="noopener noreferrer"
                        className="flex-1 truncate text-green-700 hover:underline" onClick={e => e.stopPropagation()}>
                        {storedFile.file_name}
                      </a>
                      <button type="button" title="다시 업로드"
                        onClick={e => { e.stopPropagation(); fileRefs.current[qSlot]?.click(); }}
                        className="flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground">
                        재업로드
                      </button>
                      <button type="button" onClick={e => { e.stopPropagation(); removeStoredFile(qSlot); }}
                        className="p-0.5 rounded hover:bg-muted flex-shrink-0">
                        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                      <button type="button" onClick={e => { e.stopPropagation(); handleQuoteOpenSendPreview(qSlot); }}
                        className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded border border-blue-400 text-blue-600 hover:bg-blue-50">
                        발송
                      </button>
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-muted-foreground">클릭하거나 파일을 끌어다 놓기</span>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        </div>{/* end rounded border container */}
      </Section>

      {/* 사용자 (이용권 수신자) */}
      <Section icon={Users} title={`사용자 (${dealUsers.length}명) — 이용권 수량 ${dealUsers.length}장`}>
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">이용권을 받을 사용자입니다. 사용자 수 = 이용권 수량</p>
          {dealUsers.map((u, idx) => (
            <div key={idx} className="border border-border rounded-md p-2.5 bg-muted/20 relative">
              {idx > 0 && (
                <button type="button" onClick={() => removeDealUser(idx)}
                  className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              )}
              {idx === 0 && <span className="text-[10px] text-primary font-medium">대표 사용자 (담당자)</span>}
              <div className="grid grid-cols-3 gap-2 mt-1">
                <div>
                  <span className="text-[10px] text-muted-foreground">이름</span>
                  <Input value={u.user_name ?? ''} onChange={e => updateDealUser(idx, 'user_name', e.target.value)}
                    className="h-7 text-xs" placeholder="홍길동" disabled={idx === 0 && u.is_primary} />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">연락처</span>
                  <Input value={u.user_phone ?? ''} onChange={e => updateDealUser(idx, 'user_phone', formatPhone(e.target.value))}
                    className="h-7 text-xs" placeholder="010-0000-0000" disabled={idx === 0 && u.is_primary} />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">이메일</span>
                  <Input value={u.user_email ?? ''} onChange={e => updateDealUser(idx, 'user_email', e.target.value)}
                    className="h-7 text-xs" placeholder="email@example.com" disabled={idx === 0 && u.is_primary} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">학생 수</span>
                    {idx === 0 && dealUsers.length > 1 && (
                      <button type="button" onClick={() => applyToAllUsers('student_count', u.student_count)}
                        className="text-[9px] text-primary hover:underline">전체 적용</button>
                    )}
                  </div>
                  <Input type="number" value={u.student_count ?? ''} onChange={e => updateDealUser(idx, 'student_count', parseInt(e.target.value) || 0)}
                    className="h-7 text-xs" />
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">기간 (개월)</span>
                    {idx === 0 && dealUsers.length > 1 && (
                      <button type="button" onClick={() => applyToAllUsers('month_count', u.month_count)}
                        className="text-[9px] text-primary hover:underline">전체 적용</button>
                    )}
                  </div>
                  <Input type="number" value={u.month_count ?? ''} onChange={e => updateDealUser(idx, 'month_count', parseInt(e.target.value) || undefined)}
                    className="h-7 text-xs" placeholder="12" />
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">플랜</span>
                    {idx === 0 && dealUsers.length > 1 && (
                      <button type="button" onClick={() => applyToAllUsers('plan_name', u.plan_name)}
                        className="text-[9px] text-primary hover:underline">전체 적용</button>
                    )}
                  </div>
                  <Input value={u.plan_name ?? ''} onChange={e => updateDealUser(idx, 'plan_name', e.target.value)}
                    className="h-7 text-xs" />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addDealUser}
            className="w-full border border-dashed border-border rounded-md py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-1">
            <Plus className="h-3 w-3" />사용자 추가
          </button>
        </div>
      </Section>

      {/* 이용권 */}
      <Section icon={Package} title="이용권">
        <div className="grid grid-cols-2 gap-3">
          <Field label="코드 수량">
            <NumericInput value={num('License_Code_Count')} onChange={v => up('License_Code_Count', v)} className="h-8 text-sm" />
          </Field>
          <Field label="발송일">
            <DateInput value={n('License_Send_Date')} onChange={v => up('License_Send_Date', v)} className="h-8 text-sm" />
          </Field>
          <Field label="만료일">
            <DateInput value={n('Renewal_Date')} onChange={v => up('Renewal_Date', v)} className="h-8 text-sm" />
          </Field>
          <div className="col-span-2">
            <MultiFileAttachInput
              label="이용권발송 템플릿 (Excel/CSV, 여러 파일 가능)"
              pendingFiles={pendingLicenseFiles}
              onAdd={addLicenseFile}
              onRemoveNew={removePendingLicenseFile}
              storedFiles={storedLicenseFiles}
              onRemoveStored={removeStoredLicenseFile}
            />
          </div>

          {/* 기존 발급 이용권 */}
          {initialLicenses && initialLicenses.length > 0 && (
            <div className="col-span-2 rounded-lg border border-border overflow-hidden">
              <div className="bg-teal-50 px-3 py-2 flex items-center gap-2 border-b border-border">
                <Globe className="h-3.5 w-3.5 text-teal-600" />
                <span className="text-xs font-medium text-teal-700">발급된 이용권 ({initialLicenses.length}건)</span>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {['코드', '담당자', '학교/기관', '전화번호', '기간', '상태'].map(h => (
                        <th key={h} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {initialLicenses.map(lic => (
                      <tr key={lic.id} className="border-t border-border">
                        <td className="px-2.5 py-1.5 font-mono">{lic.coupon_code}</td>
                        <td className="px-2.5 py-1.5">{lic.contact_name || '-'}</td>
                        <td className="px-2.5 py-1.5">{lic.org_name || '-'}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{lic.contact_phone || '-'}</td>
                        <td className="px-2.5 py-1.5">{lic.duration}개월·{lic.user_count}명</td>
                        <td className="px-2.5 py-1.5">{lic.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 템플릿 파싱 결과 */}
          {parsingTemplate && (
            <div className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />템플릿 분석 중...
            </div>
          )}
          {licenseContacts.length > 0 && (() => {
            // 전화번호로 기존/신규 판별
            const checkExisting = (phone: string) =>
              contacts?.some(c =>
                (c.fields.phone_normalized || normalizePhone(c.fields.Phone ?? '')) === normalizePhone(phone)
              ) ?? false;
            const existCount = licenseContacts.filter(lc => lc.phone && checkExisting(lc.phone)).length;
            const newCount   = licenseContacts.length - existCount;
            return (
              <div className="col-span-2 rounded-lg border border-border overflow-hidden">
                <div className="bg-primary/5 px-3 py-2 flex items-center gap-2 border-b border-border">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-primary">
                    {licenseContacts.length}명 파싱됨
                  </span>
                  {newCount > 0 && (
                    <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700 font-medium">
                      신규 {newCount}명
                    </span>
                  )}
                  {existCount > 0 && (
                    <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-600 font-medium">
                      기존 {existCount}명 (노트만 업데이트)
                    </span>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        {['구분', '이름', '전화번호', '코드', '기간', '인원'].map(h => (
                          <th key={h} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {licenseContacts.map((lc, i) => {
                        const isExisting = lc.phone && checkExisting(lc.phone);
                        return (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2.5 py-1.5">
                              {isExisting
                                ? <span className="rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-medium">기존</span>
                                : <span className="rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-medium">신규</span>
                              }
                            </td>
                            <td className="px-2.5 py-1.5">{lc.name}</td>
                            <td className="px-2.5 py-1.5 tabular-nums">{lc.phone}</td>
                            <td className="px-2.5 py-1.5 font-mono">{lc.code}</td>
                            <td className="px-2.5 py-1.5">{lc.duration && `${lc.duration}개월`}</td>
                            <td className="px-2.5 py-1.5">{lc.userCount && `${lc.userCount}명`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      </Section>

      {/* 세무 */}
      <Section icon={Receipt} title="세무">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="구매처">
              {!showCustomSource ? (
                <Select
                  value={partnerNames.includes(n('Lead_Source')) ? n('Lead_Source') : ''}
                  onValueChange={v => {
                    if (v === '__custom__') { setShowCustomSource(true); up('Lead_Source', ''); }
                    else up('Lead_Source', v);
                  }}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="파트너사 선택..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(partners ?? []).map(p => (
                      <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">기타 (직접입력)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex gap-1.5">
                  <Input value={n('Lead_Source')} onChange={e => up('Lead_Source', e.target.value)}
                    className="h-8 text-sm flex-1" placeholder="구매처 직접 입력" autoFocus />
                  <button onClick={() => { setShowCustomSource(false); up('Lead_Source', ''); }}
                    className="text-xs text-muted-foreground hover:text-foreground px-2">목록</button>
                </div>
              )}
            </Field>
          </div>
          <Field label="계약일 (주문일)">
            <DateInput value={n('Contract_Date')} onChange={v => up('Contract_Date', v)} className="h-8 text-sm" />
          </Field>
          <Field label="입금일">
            <DateInput value={n('Payment_Date')} onChange={v => {
              const next = { ...f, Payment_Date: v || undefined };
              setF(next);
              if (!f.Deal_Stage || ['Lead', 'Proposal', 'Contract', 'Closed_Won', '체험권', '견적', '이용권 발송완료', '입금완료'].includes(f.Deal_Stage ?? '')) {
                const stage = autoStage(pendingFiles, storedFiles, pendingLicenseFiles, storedLicenseFiles, next);
                setF(p => ({ ...p, Deal_Stage: stage }));
              }
            }} className="h-8 text-sm" />
          </Field>
          <div className="col-span-2">
            <Field label="영수증발급일">
              <DateInput value={n('Receipt_Date')} onChange={v => up('Receipt_Date', v)} className="h-8 text-sm" />
            </Field>
          </div>
          <div className="col-span-2">
            <MultiFileAttachInput
              label="영수증 파일"
              pendingFiles={pendingReceiptFiles}
              onAdd={addReceiptFile}
              onRemoveNew={removeReceiptFile}
              storedFiles={storedReceiptFiles}
              onRemoveStored={removeStoredReceipt}
            />
          </div>
        </div>
      </Section>

      {/* 딜 이름 */}
      <Section icon={Pencil} title="딜 이름">
        <Field label="">
          <Input value={n('Deal_Name') || computedName}
            onChange={e => up('Deal_Name', e.target.value)}
            className="h-8 text-sm" placeholder="자동 생성 또는 직접 입력" />
        </Field>
      </Section>

      {/* 메모 */}
      <Section icon={FileText} title="메모">
        <Textarea value={n('Notes')} onChange={e => up('Notes', e.target.value)}
          className="text-sm min-h-[80px]" placeholder="특이사항, 이력 등..." />
      </Section>

      {/* 저장/취소 */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <Button variant="outline" onClick={onCancel} className="flex-1">취소</Button>
        <Button onClick={() => {
          const name = f.Deal_Name || computedName || '(이름없음)';
          const finalTabs = [...localTabs];
          finalTabs[activeTabIdx] = readCurrentTabData();
          clearDraft();
          onSave({ ...f, Deal_Name: name }, pendingFiles, pendingReceiptFiles, pendingLicenseFiles, licenseContacts, phoneStatus?.contactRecord ?? initialContact, removedFileIds, removedReceiptIds, removedLicenseIds, finalTabs, dealUsers);
        }} disabled={saving} className="flex-1">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />저장 중...</> : '저장'}
        </Button>
      </div>
    </div>

    {/* 견적서 발송 미리보기 + 확인 (단일) */}
    {quoteSendPreview && (
      <Dialog open={true} onOpenChange={() => { URL.revokeObjectURL(quoteSendPreview.blobUrl); setQuoteSendPreview(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>견적서 발송 확인</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1.5">
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">수신</span>
                <span className="font-medium text-foreground">{n('Contact_Email') || '(이메일 미입력)'}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">답장</span>
                <span>sales@tebahsoft.com</span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">파일</span>
                <span className="truncate">{quoteSendPreview.fileName}</span>
              </div>
            </div>
            <iframe src={quoteSendPreview.blobUrl} className="w-full h-[480px] rounded border border-border" title="견적서 미리보기" />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { URL.revokeObjectURL(quoteSendPreview.blobUrl); setQuoteSendPreview(null); }}>취소</Button>
              <Button onClick={handleQuoteConfirmSend} disabled={quoteSending || !n('Contact_Email')}>
                {quoteSending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />발송 중...</> : '이 주소로 발송'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}

    {/* 견적서 일괄 발송 미리보기 */}
    {quoteBatchPreview && (
      <Dialog open={true} onOpenChange={cleanupBatchPreview}>
        <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>견적서 일괄 발송 ({quoteBatchPreview.length}건)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1.5 flex-shrink-0">
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">수신</span>
                <span className="font-medium text-foreground">{n('Contact_Email') || '(이메일 미입력)'}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">건수</span>
                <span>{quoteBatchPreview.length}건의 견적서를 1개 이메일에 첨부하여 발송합니다</span>
              </div>
            </div>
            {/* 탭 바 */}
            <div className="flex border-b border-border overflow-x-auto flex-shrink-0">
              {quoteBatchPreview.map((p, idx) => (
                <button key={idx} type="button" onClick={() => setQuoteBatchActiveIdx(idx)}
                  className={`px-4 py-2 text-xs border-b-2 transition-colors flex-shrink-0
                    ${idx === quoteBatchActiveIdx
                      ? 'border-primary text-primary font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                  {p.tabLabel}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">({p.fileName})</span>
                </button>
              ))}
            </div>
            {/* 미리보기 */}
            <iframe
              src={quoteBatchPreview[quoteBatchActiveIdx]?.blobUrl}
              className="w-full flex-1 min-h-[400px] rounded border border-border"
              title={`견적서 미리보기 ${quoteBatchActiveIdx + 1}`}
            />
            <div className="flex gap-2 justify-end flex-shrink-0">
              <Button variant="outline" onClick={cleanupBatchPreview}>취소</Button>
              <Button onClick={handleQuoteBatchSend} disabled={quoteBatchSending || !n('Contact_Email')}>
                {quoteBatchSending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />발송 중...</>
                  : `${quoteBatchPreview.length}건 모두 발송`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}
  </>);
}

// ── 견적 추가/편집 다이얼로그 ──────────────────────
// 견적서 번호 자동 생성: YYYY-01-NNNN (01 = AI마음일기, 4자리 일련번호)
const QUOTE_NUMBER_RE = /^\d{4}-01-\d{4}$/;
function generateQuoteNumber(existingNumbers: string[]): string {
  const year = new Date().getFullYear();
  const prefix = `${year}-01-`;
  const max = existingNumbers
    .filter(n => n && QUOTE_NUMBER_RE.test(n) && n.startsWith(prefix))
    .map(n => parseInt(n.slice(prefix.length), 10))
    .filter(n => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function QuoteDialog({
  open, onClose, dealId, quote, onSaved, existingNumbers,
  orgName, contactName, contactEmail,
}: {
  open: boolean;
  onClose: () => void;
  dealId: string;
  quote?: DealQuote | null;
  onSaved: (q: DealQuote) => void;
  existingNumbers: string[];
  orgName: string;
  contactName: string;
  contactEmail: string;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<DealQuote>>(quote ?? {});
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [existingFileRec, setExistingFileRec] = useState<DealFileRecord | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [numGenerating, setNumGenerating] = useState(false);
  const [pdfGenAttaching, setPdfGenAttaching] = useState(false);
  const [sendPreview, setSendPreview] = useState<{
    blobUrl: string; base64: string; fileName: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (quote) {
      setForm(quote);
      getDealFiles(dealId).then(files => {
        const quoteFiles = files.filter(f => f.slot_key?.startsWith('quote_file_') || f.slot_key?.startsWith('quote_tab_'));
        // 정확히 quote_file_{id} 매칭 시도
        const exact = quoteFiles.find(f => f.slot_key === `quote_file_${quote.id}`);
        // 없으면 quote_tab_N 매칭 (DealForm에서 업로드된 파일)
        setExistingFileRec(exact ?? quoteFiles[0] ?? null);
      }).catch(() => {});
    } else {
      // 새 견적 — 번호 자동 생성
      setForm({ quote_number: generateQuoteNumber(existingNumbers) });
      setExistingFileRec(null);
    }
    setPendingFile(null);
    setRemoveFile(false);
  }, [quote, open]);

  const up = (k: keyof DealQuote, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  const n = (k: keyof DealQuote) => (form[k] as string) ?? '';
  const num = (k: keyof DealQuote) => form[k] as number | undefined;

  const effectiveStoredFile = removeFile ? undefined : existingFileRec;

  const getPdfData = () => {
    const quoteNumber = n('quote_number');
    const paymentUrl = quoteNumber ? `${window.location.origin}/order/pay/${encodeURIComponent(quoteNumber)}` : undefined;
    return {
      quoteNumber,
      quoteDate: n('quote_date'),
      orgName,
      contactName,
      plan: n('plan'),
      duration: num('duration') ?? 0,
      unitPrice: num('unit_price') ?? 0,
      licenseQty: num('license_qty') ?? 0,
      finalValue: num('final_value') ?? 0,
      supplyPrice: num('supply_price') ?? 0,
      taxAmount: num('tax_amount') ?? 0,
      notes: n('notes') || undefined,
      paymentUrl,
    };
  };

  const handleGenerateNumber = async () => {
    setNumGenerating(true);
    try {
      const dbNums = await fetchAllDealQuoteNumbers().catch(() => [] as string[]);
      up('quote_number', generateQuoteNumber([...existingNumbers, ...dbNums]));
    } finally { setNumGenerating(false); }
  };

  const handleGenerateAndAttach = async () => {
    setPdfGenAttaching(true);
    try {
      const { blob, fileName } = await generateQuotePdfBlob(getPdfData());
      setPendingFile(new File([blob], fileName, { type: 'application/pdf' }));
      setRemoveFile(false);
    } catch { toast.error('PDF 생성 실패'); }
    finally { setPdfGenAttaching(false); }
  };

  const handleOpenSendPreview = async () => {
    if (!contactEmail) { toast.error('담당자 이메일이 없습니다'); return; }
    let blob: Blob;
    let fileName: string;
    if (pendingFile) {
      blob = pendingFile; fileName = pendingFile.name;
    } else if (effectiveStoredFile) {
      const r = await fetch(effectiveStoredFile.file_url).catch(() => null);
      if (!r?.ok) { toast.error('파일을 불러올 수 없습니다'); return; }
      blob = await r.blob(); fileName = effectiveStoredFile.file_name;
    } else { toast.error('첨부된 파일이 없습니다'); return; }
    const blobUrl = URL.createObjectURL(blob);
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    setSendPreview({ blobUrl, base64, fileName });
  };

  const handleConfirmSend = async () => {
    if (!sendPreview) return;
    setSending(true);
    try {
      const quoteNumber = n('quote_number');
      const paymentUrl = quoteNumber ? `${window.location.origin}/order/pay/${encodeURIComponent(quoteNumber)}` : undefined;
      await sendQuoteEmail({
        to: contactEmail,
        orgName,
        contactName,
        quoteNumber,
        paymentUrl,
        attachmentBase64: sendPreview.base64,
        attachmentFileName: sendPreview.fileName,
      });
      toast.success(`${contactEmail}으로 견적서를 발송했습니다`);
      URL.revokeObjectURL(sendPreview.blobUrl);
      setSendPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '발송 실패');
    } finally { setSending(false); }
  };

  const quoteFields = {
    quote_date: form.quote_date, plan: form.plan, qty: form.qty,
    license_qty: form.license_qty, duration: form.duration, unit_price: form.unit_price,
    supply_price: form.supply_price, tax_amount: form.tax_amount,
    final_value: form.final_value, quote_number: form.quote_number, notes: form.notes,
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let savedId: string;
      if (quote) {
        await updateDealQuote(quote.id, quoteFields);
        onSaved({ ...quote, ...form });
        savedId = quote.id;
      } else {
        const saved = await saveDealQuote({ deal_id: dealId, ...quoteFields, is_selected: false });
        onSaved(saved);
        savedId = saved.id;
      }
      // 파일 처리
      if (removeFile && existingFileRec) {
        await deleteDealFileRecord(existingFileRec.id).catch(() => {});
      }
      if (pendingFile) {
        if (existingFileRec && !removeFile) await deleteDealFileRecord(existingFileRec.id).catch(() => {});
        const { name, url } = await uploadDealFile(dealId, pendingFile);
        await saveDealFileRecord({ deal_id: dealId, slot_key: `quote_file_${savedId}`, label: '견적서', file_name: name, file_url: url });
      }
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally { setSaving(false); }
  };

  return (<>
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{quote ? '견적 편집' : '견적 추가'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">견적일</Label>
              <Input type="date" value={n('quote_date')} onChange={e => up('quote_date', e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">견적서 번호</Label>
                <button type="button" onClick={handleGenerateNumber} disabled={numGenerating}
                  className="text-[11px] px-2 py-0.5 rounded border border-primary/50 text-primary hover:bg-primary/10 disabled:opacity-50 flex items-center gap-1">
                  {numGenerating && <Loader2 className="h-3 w-3 animate-spin" />}생성
                </button>
              </div>
              <Input value={n('quote_number')} onChange={e => up('quote_number', e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">플랜</Label>
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {['학급플랜', '학년플랜', '학교(소)', '학교(중)', '학교(대)'].map(p => (
                  <button key={p} type="button" onClick={() => up('plan', p)}
                    className={`text-xs rounded-md px-2.5 py-1 border transition-colors
                      ${n('plan') === p ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50 text-muted-foreground'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">총인원 (명)</Label>
              <NumericInput value={num('qty')} onChange={v => up('qty', v)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">이용권 수량 (장)</Label>
              <NumericInput value={num('license_qty')} onChange={v => up('license_qty', v)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">이용기간 (개월)</Label>
              <NumericInput value={num('duration')} onChange={v => up('duration', v)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">단가 (원)</Label>
              <NumericInput value={num('unit_price')} onChange={v => up('unit_price', v)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">실결제금액 (원)</Label>
              <NumericInput value={num('final_value')} onChange={v => {
                if (v != null && v > 0) {
                  const supply = Math.round(v / 1.1);
                  setForm(p => ({ ...p, final_value: v, supply_price: supply, tax_amount: v - supply }));
                } else { up('final_value', v); }
              }} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">공급가액</Label>
              <NumericInput value={num('supply_price')} onChange={v => up('supply_price', v)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">세액</Label>
              <NumericInput value={num('tax_amount')} onChange={v => up('tax_amount', v)} className="h-8 text-sm" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">메모</Label>
              <Input value={n('notes')} onChange={e => up('notes', e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="col-span-2 space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">견적서 파일</Label>
                <button type="button" onClick={handleGenerateAndAttach} disabled={pdfGenAttaching}
                  className="text-[11px] px-2 py-0.5 rounded border border-primary/50 text-primary hover:bg-primary/10 disabled:opacity-50 flex items-center gap-1">
                  {pdfGenAttaching && <Loader2 className="h-3 w-3 animate-spin" />}생성
                </button>
              </div>
              <input ref={el => { fileInputRef.current = el; }} type="file" className="hidden" accept=".pdf,.doc,.docx"
                onChange={e => { const f = e.target.files?.[0] ?? null; setPendingFile(f); if (f) setRemoveFile(false); e.target.value = ''; }} />
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setPendingFile(f); setRemoveFile(false); } }}
                onClick={() => { if (!pendingFile && !effectiveStoredFile) fileInputRef.current?.click(); }}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors border-dashed border-border hover:border-primary/50 ${!pendingFile && !effectiveStoredFile ? 'cursor-pointer' : 'cursor-default'}`}>
                {pendingFile ? (
                  <>
                    <Paperclip className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className="flex-1 truncate">{pendingFile.name}</span>
                    <button type="button" onClick={e => { e.stopPropagation(); setPendingFile(null); }}
                      className="p-0.5 rounded hover:bg-muted flex-shrink-0">
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                    <button type="button" onClick={e => { e.stopPropagation(); handleOpenSendPreview(); }}
                      className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded border border-blue-400 text-blue-600 hover:bg-blue-50">
                      발송
                    </button>
                  </>
                ) : effectiveStoredFile ? (
                  <>
                    <Paperclip className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                    <a href={effectiveStoredFile.file_url} target="_blank" rel="noopener noreferrer"
                      className="flex-1 truncate text-green-700 hover:underline" onClick={e => e.stopPropagation()}>
                      {effectiveStoredFile.file_name}
                    </a>
                    <button type="button" title="다시 업로드"
                      onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      className="flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground">
                      재업로드
                    </button>
                    <button type="button" onClick={e => { e.stopPropagation(); setRemoveFile(true); setPendingFile(null); }}
                      className="p-0.5 rounded hover:bg-muted flex-shrink-0">
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                    <button type="button" onClick={e => { e.stopPropagation(); handleOpenSendPreview(); }}
                      className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded border border-blue-400 text-blue-600 hover:bg-blue-50">
                      발송
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">클릭하거나 파일을 끌어다 놓기</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <Button className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />저장 중...</> : '저장'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {/* 견적서 발송 미리보기 + 확인 */}
    {sendPreview && (
      <Dialog open={true} onOpenChange={() => { URL.revokeObjectURL(sendPreview.blobUrl); setSendPreview(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>견적서 발송 확인</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1.5">
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">수신</span>
                <span className="font-medium text-foreground">{contactEmail || '(이메일 미입력)'}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">답장</span>
                <span>sales@tebahsoft.com</span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground w-12 flex-shrink-0">파일</span>
                <span className="truncate">{sendPreview.fileName}</span>
              </div>
            </div>
            <iframe src={sendPreview.blobUrl} className="w-full h-[480px] rounded border border-border" title="견적서 미리보기" />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { URL.revokeObjectURL(sendPreview.blobUrl); setSendPreview(null); }}>취소</Button>
              <Button onClick={handleConfirmSend} disabled={sending || !contactEmail}>
                {sending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />발송 중...</> : '이 주소로 발송'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}
  </>
  );
}

// ── 메인 페이지 ──────────────────────────────────
export default function Deals() {
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const { data: deals, isLoading } = useDeals();
  const { data: contacts } = useContacts();
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();

  const [searchParams, setSearchParams] = useSearchParams();
  const focusDealId = searchParams.get('focus');

  const [search, setSearch]             = useState('');
  const [stageFilter, setStageFilter]   = useState('all');
  const [typeFilter, setTypeFilter]     = useState('all');
  const [selected, setSelected]         = useState<AirtableRecord<DealFields> | null>(null);
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [editMode, setEditMode]         = useState<'add' | 'edit'>('add');
  const [sortField, setSortField]       = useState('Created');
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('desc');
  const [uploading, setUploading]       = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [dealFiles, setDealFiles]           = useState<DealFileRecord[]>([]);
  const [dealLicenses, setDealLicenses]     = useState<DealLicenseRecord[]>([]);
  const [attachCode, setAttachCode]         = useState('');
  const [attachLoading, setAttachLoading]   = useState(false);
  const [autoDealLinking, setAutoDealLinking] = useState(false);
  const [autoDealLinkProgress, setAutoDealLinkProgress] = useState('');
  const [autoDealLinkResult, setAutoDealLinkResult] = useState<{
    linked: number; skipped_multi: number; skipped_no_match: number;
  } | null>(null);
  const [checkedIds, setCheckedIds]         = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting]     = useState(false);
  const [stageSyncing, setStageSyncing] = useState(false);
  const [stageSyncResult, setStageSyncResult] = useState<{
    updated: number;
    names: string[];
    unmatched: string[];
  } | null>(null);
  const [dealQuotes, setDealQuotes]         = useState<DealQuote[]>([]);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [editingQuote, setEditingQuote]     = useState<DealQuote | null>(null);
  const [pdfGenerating, setPdfGenerating]   = useState<string | null>(null); // quote id
  const [periodFilter, setPeriodFilter]     = useState<PeriodValue>('this_month');
  const [periodCustomFrom, setPeriodCustomFrom] = useState('');
  const [periodCustomTo, setPeriodCustomTo]     = useState('');
  const { widths: colW, startResize } = useResizableColumns('deals_col_widths', {
    등록일: 90, 견적번호: 120, 담당자: 130, '학교/기관': 140, 유형: 72, 스테이지: 80, 실결제금액: 100, 계약일: 90, 입금일: 90, 구매처: 90, '📎': 36,
  });
  // 고정 열 sticky left 오프셋 (체크박스 32px + 각 열 너비 누적)
  const CHECKBOX_W = 32;
  const stickyLeft = {
    견적번호: canEdit ? CHECKBOX_W + (colW['등록일'] ?? 90) : (colW['등록일'] ?? 90),
    담당자:   canEdit ? CHECKBOX_W + (colW['등록일'] ?? 90) + (colW['견적번호'] ?? 120) : (colW['등록일'] ?? 90) + (colW['견적번호'] ?? 120),
    '학교/기관': canEdit ? CHECKBOX_W + (colW['등록일'] ?? 90) + (colW['견적번호'] ?? 120) + (colW['담당자'] ?? 130) : (colW['등록일'] ?? 90) + (colW['견적번호'] ?? 120) + (colW['담당자'] ?? 130),
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 딜 데이터 로드 후 편집 다이얼로그 오픈
  const openDealEdit = async (deal: AirtableRecord<DealFields>) => {
    setSelected(deal);
    setEditMode('edit');
    try {
      const [files, licenses, quotes] = await Promise.all([
        getDealFiles(deal.id).catch(() => [] as DealFileRecord[]),
        getDealLicenses(deal.id).catch(() => [] as DealLicenseRecord[]),
        getDealQuotes(deal.id).catch(() => [] as DealQuote[]),
      ]);
      setDealFiles(files);
      setDealLicenses(licenses);
      setDealQuotes(quotes);
    } catch {
      setDealFiles([]);
      setDealLicenses([]);
      setDealQuotes([]);
    }
    setDialogOpen(true);
  };

  // ?id= 쿼리 파라미터로 특정 딜 자동 오픈
  useEffect(() => {
    if (!deals || deals.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return;
    const deal = deals.find(d => d.id === id);
    if (deal) {
      openDealEdit(deal);
      // URL 정리 (히스토리 replace)
      window.history.replaceState(null, '', '/deals');
    }
  }, [deals]);

  // 고객 정보 업데이트 확인 다이얼로그
  interface ContactChange {
    key: string;
    label: string;
    from: string;
    to: string;
    type: 'replace' | 'append';
  }
  interface PendingContactUpdate {
    contact: AirtableRecord<ContactFields>;
    changes: ContactChange[];
    newNoteLine: string;
    dealId: string;
    selected: Set<string>;
  }
  const [pendingContactUpdate, setPendingContactUpdate] = useState<PendingContactUpdate | null>(null);

  const handleSort = (f: string) => {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(f); setSortDir('desc'); }
  };

  // ── 기간 필터 ── 공용 PeriodFilter 사용 (이번달/지난달/올해/작년/직접입력)
  // 딜의 기준 날짜: 존재하는 날짜 필드 중 가장 빠른 것
  const getDealDate = (d: AirtableRecord<DealFields>): string => {
    const dates = [
      d.fields.Quote_Date,
      d.fields.Contract_Date,
      d.fields.Order_Date,
      d.fields.License_Send_Date,
      d.fields.Created_Date,
    ].filter(Boolean) as string[];
    return dates.length > 0 ? dates.sort()[0] : '';
  };

  const matchesPeriodDeal = (d: AirtableRecord<DealFields>): boolean => {
    const dateStr = getDealDate(d);
    if (!dateStr) return true; // 날짜 없는 딜은 항상 포함
    return matchesPeriod(dateStr, periodFilter, periodCustomFrom, periodCustomTo);
  };

  const periodDeals = (deals ?? []).filter(matchesPeriodDeal);
  const { label: periodLabel } = getPeriodRange(periodFilter, periodCustomFrom, periodCustomTo);

  const pipeline = DEAL_STAGES.map(s => ({
    stage: s, ...STAGE_META[s],
    count: periodDeals.filter(d => d.fields.Deal_Stage === s).length,
    total: periodDeals.filter(d => d.fields.Deal_Stage === s)
      .reduce((sum, d) => sum + (d.fields.Final_Contract_Value ?? 0), 0),
  }));

  const filtered = periodDeals.filter(d => {
    const q = search.toLowerCase();
    const f = d.fields;
    const matchSearch = !q || [f.Contact_Name, f.Contact_Phone, f.Org_Name, f.Deal_Name, f.Lead_Source]
      .some(v => v?.toLowerCase().includes(q));
    return matchSearch
      && (stageFilter === 'all' || f.Deal_Stage === stageFilter)
      && (typeFilter  === 'all' || f.Deal_Type  === typeFilter);
  });

  const fieldKey: Record<string, (d: AirtableRecord<DealFields>) => string> = {
    Created:              d => d.createdTime ?? '',
    Contact_Name:         d => d.fields.Contact_Name ?? '',
    Org_Name:             d => d.fields.Org_Name ?? '',
    Final_Contract_Value: d => String(d.fields.Final_Contract_Value ?? 0).padStart(12, '0'),
    Quote_Date:           d => d.fields.Quote_Date ?? '',
    Contract_Date:        d => d.fields.Contract_Date ?? d.fields.Order_Date ?? '',
    Payment_Date:         d => d.fields.Payment_Date ?? '',
    Renewal_Date:         d => d.fields.Renewal_Date ?? '',
  };
  const sorted = [...filtered].sort((a, b) => {
    const fn = fieldKey[sortField];
    const primary = fn ? (sortDir === 'asc' ? fn(a).localeCompare(fn(b)) : fn(b).localeCompare(fn(a))) : 0;
    if (primary !== 0) return primary;
    // 2차 정렬: 견적번호 내림차순
    return (b.fields.Quote_Number ?? '').localeCompare(a.fields.Quote_Number ?? '');
  });

  const pipelineTotals = {
    deal:     periodDeals.length,
    contract: pipeline
      .filter(p => ['Contract', 'Active_User', 'Closed_Won'].includes(p.stage))
      .reduce((s, p) => s + p.total, 0),
    won: pipeline.find(p => p.stage === 'Closed_Won')?.total ?? 0,
  };

  // 파일 업로드 (상세보기)
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !selected) return;
    setUploading(true);
    try {
      const newRecords: DealFileRecord[] = [];
      for (const file of Array.from(files)) {
        const { name, url } = await uploadDealFile(selected.id, file);
        const rec = await saveDealFileRecord({
          deal_id: selected.id, slot_key: '', label: '', file_name: name, file_url: url,
        });
        newRecords.push(rec);
      }
      setDealFiles(prev => [...prev, ...newRecords]);
      toast.success(`${newRecords.length}개 파일 업로드 완료`);
    } catch (e: unknown) {
      toast.error(`업로드 실패: ${e instanceof Error ? e.message : '오류'}`);
    } finally { setUploading(false); }
  };

  const handleStageChange = async (stage: string) => {
    if (!selected) return;
    await updateDeal.mutateAsync({ id: selected.id, fields: { Deal_Stage: stage } });
    setSelected(prev => prev ? { ...prev, fields: { ...prev.fields, Deal_Stage: stage } } : null);
    toast.success('스테이지 변경됨');
  };

  // 딜 스테이지 기준 고객 Lead_Stage 일괄 동기화
  const DEAL_TO_CONTACT_STAGE: Record<string, string> = {
    '입금완료':        '구매',
    '이용권 발송완료': '구매',
    '계약체결/구매':   '구매',
    '결제예정':        '구매',
    '입금대기':        '구매',
    '견적':            '관심',
    '템플릿 회신대기': '관심',
    '체험권':          '체험',
  };
  // 스테이지 우선순위 (높을수록 우선)
  const STAGE_PRIORITY: Record<string, number> = {
    '구매': 3, '관심': 2, '체험': 1,
  };

  const handleStageSync = async () => {
    setStageSyncing(true);
    setStageSyncResult(null);
    try {
      // 1. 전체 딜 + 고객 로드
      const [allDeals, allContacts] = await Promise.all([
        airtable.fetchAll<DealFields>('03_Deals'),
        airtable.fetchAll<ContactFields>('01_Contacts'),
      ]);

      // 2. 고객 Map: "이름||전화번호" → {id, currentStage}
      const contactMap = new Map<string, { id: string; stage: string }>();
      for (const c of allContacts) {
        const name  = (c.fields.Name  ?? '').trim();
        const phone = (c.fields.Phone ?? '').replace(/\D/g, '');
        if (name) {
          contactMap.set(`${name}||${phone}`, { id: c.id, stage: c.fields.Lead_Stage ?? '' });
          if (!contactMap.has(`${name}||`)) {
            contactMap.set(`${name}||`, { id: c.id, stage: c.fields.Lead_Stage ?? '' });
          }
        }
      }

      // 3. 딜별로 고객에게 줄 최고 스테이지 계산
      const bestStage = new Map<string, string>(); // contactId → 최고 contactStage
      const unmatched: string[] = [];
      for (const d of allDeals) {
        const name  = (d.fields.Contact_Name  ?? '').trim();
        const phone = (d.fields.Contact_Phone ?? '').replace(/\D/g, '');
        if (!name) continue;
        const newStage = DEAL_TO_CONTACT_STAGE[d.fields.Deal_Stage ?? ''];
        if (!newStage) continue;
        const contact = contactMap.get(`${name}||${phone}`) ?? contactMap.get(`${name}||`);
        if (!contact) {
          if (!unmatched.includes(name)) unmatched.push(name);
          continue;
        }
        const current = bestStage.get(contact.id);
        if (!current || (STAGE_PRIORITY[newStage] ?? 0) > (STAGE_PRIORITY[current] ?? 0)) {
          bestStage.set(contact.id, newStage);
        }
      }

      // 4. 실제로 변경이 필요한 고객만 업데이트
      const toUpdate = allContacts.filter(c => {
        const target = bestStage.get(c.id);
        return target && target !== c.fields.Lead_Stage;
      });

      await Promise.all(
        toUpdate.map(c =>
          airtable.updateRecord<ContactFields>('01_Contacts', c.id, { Lead_Stage: bestStage.get(c.id)! })
        )
      );

      const names = toUpdate.map(c => c.fields.Name ?? '').filter(Boolean);
      setStageSyncResult({ updated: toUpdate.length, names, unmatched });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(`고객 스테이지 동기화 완료 — ${toUpdate.length}명 업데이트`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '동기화 실패');
    } finally {
      setStageSyncing(false);
    }
  };

  const handleAttachCoupon = async () => {
    if (!attachCode || !selected) return;
    setAttachLoading(true);
    try {
      const f = selected.fields;
      await attachCouponToDeal(attachCode, selected.id, {
        contact_name:  f.Contact_Name  ?? '',
        contact_phone: f.Contact_Phone ?? '',
        org_name:      f.Org_Name      ?? '',
      });
      const updated = await getDealLicenses(selected.id);
      setDealLicenses(updated);
      setAttachCode('');
      toast.success(`쿠폰 ${attachCode} 연결 완료`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '쿠폰 연결 실패');
    } finally {
      setAttachLoading(false);
    }
  };

  const handleAutoDealLink = async () => {
    setAutoDealLinking(true);
    setAutoDealLinkResult(null);
    const headers = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY };
    try {
      setAutoDealLinkProgress('딜 목록 불러오는 중...');
      const allDeals = await airtable.fetchAll<DealFields>('03_Deals');
      const normalize = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();
      const orgMap = new Map<string, string[]>();
      for (const d of allDeals) {
        const org = d.fields.Org_Name?.trim();
        if (!org) continue;
        const key = normalize(org);
        orgMap.set(key, [...(orgMap.get(key) ?? []), d.id]);
      }

      setAutoDealLinkProgress('미연결 이용권 불러오는 중...');
      const [cRes, dlRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons?group_name=not.is.null&select=id,coupon_code,group_name,extracted_name,is_used,duration,user_limit,service_expire_at&limit=5000`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/deal_licenses?select=coupon_code&limit=5000`, { headers }),
      ]);
      const rawCoupons: Array<{
        id: number; coupon_code: string; group_name: string; extracted_name: string | null;
        is_used: boolean; duration: number; user_limit: number; service_expire_at: string | null;
      }> = cRes.ok ? await cRes.json() : [];
      const existingCodes = new Set<string>(
        (dlRes.ok ? await dlRes.json() : []).map((r: { coupon_code: string }) => r.coupon_code)
      );
      const unlinked = rawCoupons.filter(c => !existingCodes.has(c.coupon_code));

      let linked = 0, skipped_multi = 0, skipped_no_match = 0;
      const BATCH = 10;
      for (let i = 0; i < unlinked.length; i += BATCH) {
        const batch = unlinked.slice(i, i + BATCH);
        setAutoDealLinkProgress(`처리 중... ${i + batch.length}/${unlinked.length}`);
        await Promise.all(batch.map(async (c) => {
          const matches = orgMap.get(normalize(c.group_name)) ?? [];
          if (matches.length === 1) {
            const deal = allDeals.find(d => d.id === matches[0])!;
            try {
              await saveDealLicenses([{
                deal_id: matches[0], coupon_code: c.coupon_code,
                contact_name: c.extracted_name ?? '', contact_phone: deal.fields.Contact_Phone ?? '',
                org_name: c.group_name, duration: String(c.duration), user_count: String(c.user_limit),
                status: c.is_used ? '사용중' : '대기', service_expire_at: c.service_expire_at ?? null,
              }]);
              linked++;
            } catch { /* 중복 무시 */ }
          } else if (matches.length > 1) { skipped_multi++; }
          else { skipped_no_match++; }
        }));
      }
      setAutoDealLinkResult({ linked, skipped_multi, skipped_no_match });
      qc.invalidateQueries({ queryKey: ['deals'] });
      toast.success(`자동 딜 연결 완료 — ${linked}건 연결됨`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '자동 딜 연결 실패');
    } finally {
      setAutoDealLinking(false);
      setAutoDealLinkProgress('');
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    await deleteDeal.mutateAsync(selected.id);
    setSheetOpen(false); setSelected(null); setConfirmDelete(false);
    toast.success('딜이 삭제되었습니다');
  };

  const handleBulkDelete = async () => {
    if (checkedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      await Promise.all([...checkedIds].map(id => deleteDeal.mutateAsync(id)));
      toast.success(`${checkedIds.size}개 딜 삭제 완료`);
      setCheckedIds(new Set());
      if (selected && checkedIds.has(selected.id)) {
        setSheetOpen(false); setSelected(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setBulkDeleting(false);
    }
  };

  // 딜 저장 + 파일 업로드 + 이용권 고객 등록
  const handleSave = async (
    fields: Partial<DealFields>,
    pendingFiles: Record<string, File>,
    pendingReceiptFiles: File[],
    pendingLicenseFiles: File[],
    licenseContacts: LicenseContact[],
    contactToUpdate?: AirtableRecord<ContactFields>,
    removedFileIds?: string[],
    removedReceiptIds?: string[],
    removedLicenseIds?: string[],
    quoteTabs?: QuoteTab[],
    dealUsersInput?: DealUserInput[],
  ) => {
    setUploading(true);
    try {
      let dealId: string;

      if (editMode === 'add') {
        const rec = await createDeal.mutateAsync(fields);
        dealId = rec.id;
      } else {
        dealId = selected!.id;
        await updateDeal.mutateAsync({ id: dealId, fields });
        setSelected(prev => prev ? { ...prev, fields: { ...prev.fields, ...fields } } : null);
      }

      // 삭제된 파일 DB에서 제거
      for (const id of [...(removedFileIds ?? []), ...(removedReceiptIds ?? []), ...(removedLicenseIds ?? [])]) {
        await deleteDealFileRecord(id).catch(() => {});
      }

      // ── 견적 탭 Supabase 저장 (파일 업로드보다 먼저 — 새 id 필요) ──
      const quoteTabIdMap = new Map<string, string>(); // quote_tab_N → quote_file_{newId}
      if (quoteTabs && quoteTabs.length > 0) {
        const existingQuotes = await getDealQuotes(dealId).catch(() => [] as DealQuote[]);
        const existingById = new Map(existingQuotes.map(q => [q.id, q]));
        for (let i = 0; i < quoteTabs.length; i++) {
          const tab = quoteTabs[i];
          const isSelected = i === 0 && quoteTabs.length === 1 ? true : (tab.is_selected ?? false);
          const quotePayload = {
            quote_number: tab.quote_number,
            quote_date: tab.quote_date,
            plan: tab.plan,
            qty: tab.qty,
            license_qty: tab.license_qty,
            duration: tab.duration,
            unit_price: tab.unit_price,
            final_value: tab.final_value,
            supply_price: tab.supply_price,
            tax_amount: tab.tax_amount,
            items: tab.items as unknown[],
            discount_amount: tab.discount_amount,
            notes: tab.notes,
            is_selected: isSelected,
          };
          if (tab.id && existingById.has(tab.id)) {
            await updateDealQuote(tab.id, quotePayload).catch(e => console.warn('견적 탭 업데이트 실패:', e));
          } else if (!tab.id) {
            try {
              const saved = await saveDealQuote({ deal_id: dealId, ...quotePayload });
              quoteTabIdMap.set(`quote_tab_${i}`, `quote_file_${saved.id}`);
            } catch (e) { console.warn('견적 탭 저장 실패:', e); }
          }
        }
      }

      // 새 파일 업로드 → DB에 메타데이터 저장
      for (const [slotKey, file] of Object.entries(pendingFiles)) {
        const resolvedSlot = quoteTabIdMap.get(slotKey) ?? slotKey;
        const { name, url } = await uploadDealFile(dealId, file);
        await saveDealFileRecord({
          deal_id:  dealId,
          slot_key: resolvedSlot,
          label:    SLOT_LABELS[slotKey] ?? (resolvedSlot.startsWith('quote_file_') ? '견적서' : slotKey),
          file_name: name,
          file_url:  url,
        });
      }
      // 영수증 파일 업로드 (다중)
      for (const file of pendingReceiptFiles) {
        const { name, url } = await uploadDealFile(dealId, file);
        await saveDealFileRecord({
          deal_id:  dealId,
          slot_key: 'receipt',
          label:    '영수증',
          file_name: name,
          file_url:  url,
        });
      }
      // 이용권 템플릿 파일 업로드 (다중)
      for (const file of pendingLicenseFiles) {
        const { name, url } = await uploadDealFile(dealId, file);
        await saveDealFileRecord({
          deal_id:  dealId,
          slot_key: 'license',
          label:    '이용권템플릿',
          file_name: name,
          file_url:  url,
        });
      }

      const today = new Date().toISOString().split('T')[0];
      // 최신 노트 추적 (step1에서 업데이트된 내용을 step2에서 참조)
      const updatedNotesMap = new Map<string, string>(); // phone_norm → 최신 Notes

      // 딜 스테이지로 구매 여부 판단: 계약/입금 단계만 '구매고객'
      const PURCHASE_STAGES = new Set(['계약체결/구매', '결제예정', '이용권 발송완료', '템플릿 회신대기', '입금대기', '입금완료', 'Contract', 'Closed_Won']);
      const isPurchase = PURCHASE_STAGES.has(fields.Deal_Stage ?? '');
      const actionLabel = isPurchase ? '구매' : '견적요청';
      const leadStage = isPurchase ? '구매' : '관심';

      // ── Step 1: 딜 담당자 → 01_Contacts upsert ─────────────
      // 딜 폼의 정확한 이름/이메일로 연락처를 먼저 생성/보완
      if (fields.Contact_Phone) {
        const norm = normalizePhone(fields.Contact_Phone);
        const existing = contacts?.find(c =>
          (c.fields.phone_normalized || normalizePhone(c.fields.Phone ?? '')) === norm
        );
        const planLabel = [
          fields.Quote_Plan ?? '',
          fields.Quote_Qty ? `(${fields.Quote_Qty}명)` : '',
          fields.License_Duration ? ` ${fields.License_Duration}개월` : '',
        ].filter(Boolean).join('').trim();
        const purchaseNote = `[${today}] ${planLabel ? planLabel + ' ' : ''}${actionLabel} ·${dealId}`.trim();

        if (!existing) {
          // 신규: 딜 폼의 정확한 정보로 생성
          await airtable.createRecord<ContactFields>('01_Contacts', {
            Name:             fields.Contact_Name,
            Phone:            fields.Contact_Phone,
            phone_normalized: norm,
            ...(fields.Contact_Email ? { Email: fields.Contact_Email } : {}),
            Org_Name:         fields.Org_Name,
            ...(isPurchase ? { Contact_Type: '구매고객' } : {}),
            Lead_Stage:       leadStage,
            Notes:            purchaseNote,
          });
          updatedNotesMap.set(norm, purchaseNote);
        } else {
          // 기존: 누락된 이메일만 보완, 구매고객은 다운그레이드 안 함
          const prevNotes = existing.fields.Notes ?? '';
          const alreadyNoted = prevNotes.includes(`·${dealId}`);
          const updates: Partial<ContactFields> = {};
          // 구매 단계: 무조건 업그레이드 / 견적 단계: 기존이 구매고객이면 유지
          if (isPurchase) {
            updates.Contact_Type = '구매고객';
          }
          if (!existing.fields.Email && fields.Contact_Email) updates.Email = fields.Contact_Email;
          // 신규 딜일 때만 활동 노트 추가 (contactToUpdate 다이얼로그가 없는 경우)
          if (!contactToUpdate && !alreadyNoted) {
            updates.Notes = [purchaseNote, prevNotes].filter(Boolean).join('\n');
            updatedNotesMap.set(norm, updates.Notes);
          } else {
            updatedNotesMap.set(norm, prevNotes);
          }
          if (Object.keys(updates).length > 0) {
            await airtable.updateRecord<ContactFields>('01_Contacts', existing.id, updates);
          }
        }
        qc.invalidateQueries({ queryKey: ['contacts'] });
      }

      // ── Step 2: 이용권 템플릿 → 이용권 노트 추가 + deal_licenses ─
      if (licenseContacts.length > 0) {
        const licenseRows: Parameters<typeof saveDealLicenses>[0] = [];

        for (const lc of licenseContacts) {
          if (!lc.phone && !lc.name) continue;
          const norm = normalizePhone(lc.phone);
          const orgName = lc.org || fields.Org_Name;
          const licenseNote = [
            `[${today}] 이용권 발송`,
            `코드: ${lc.code}${lc.duration ? ` | 기간: ${lc.duration}개월` : ''}${lc.userCount ? ` | 인원: ${lc.userCount}명` : ''}`,
            orgName ? `기관: ${orgName}` : '',
          ].filter(Boolean).join('\n');

          const existing = contacts?.find(c =>
            (c.fields.phone_normalized || normalizePhone(c.fields.Phone ?? '')) === norm
          );
          // step1에서 업데이트된 노트 기준으로 중복 체크
          const currentNotes = updatedNotesMap.get(norm) ?? existing?.fields.Notes ?? '';
          const alreadyNoted = lc.code && currentNotes.includes(`코드: ${lc.code}`);

          if (!alreadyNoted) {
            if (existing) {
              await airtable.updateRecord<ContactFields>('01_Contacts', existing.id, {
                Notes: [licenseNote, currentNotes].filter(Boolean).join('\n'),
              });
            } else if (norm !== normalizePhone(fields.Contact_Phone ?? '')) {
              // 딜 담당자와 다른 사람 (템플릿에 여러 담당자가 있는 경우)
              await airtable.createRecord<ContactFields>('01_Contacts', {
                Name:             lc.name,
                Phone:            lc.phone,
                phone_normalized: norm,
                Lead_Stage:       '구매',
                Contact_Type:     '구매고객',
                Org_Name:         orgName,
                Notes:            licenseNote,
              });
            }
            // 딜 담당자이면서 방금 생성된 경우 → step1에서 이미 처리됨
          }

          if (lc.code) {
            licenseRows.push({
              deal_id:       dealId,
              coupon_code:   lc.code,
              contact_name:  lc.name,
              contact_phone: lc.phone,
              org_name:      orgName ?? '',
              duration:      lc.duration,
              user_count:    lc.userCount,
              status:        '대기',
            });
          }
        }

        // deal_licenses 저장 — 쿠폰코드 중복 스킵
        if (licenseRows.length > 0) {
          const existingLics = await getDealLicenses(dealId).catch(() => [] as typeof licenseRows);
          const existingCodes = new Set(existingLics.map(r => r.coupon_code));
          const newRows = licenseRows.filter(r => !existingCodes.has(r.coupon_code));
          if (newRows.length > 0) {
            await saveDealLicenses(newRows).catch(e => console.warn('deal_licenses 저장 실패:', e));
            // 이용권 코드 발급 시 발급일 자동 설정 + 스테이지 변경
            const autoUpdates: Partial<DealFields> = {};
            if (!fields.License_Send_Date) autoUpdates.License_Send_Date = today;
            if (!fields.Deal_Stage || !['입금대기', '입금완료'].includes(fields.Deal_Stage)) {
              autoUpdates.Deal_Stage = '이용권 발송완료';
            }
            if (Object.keys(autoUpdates).length > 0) {
              await updateDeal.mutateAsync({ id: dealId, fields: autoUpdates }).catch(() => {});
              setSelected(prev => prev ? { ...prev, fields: { ...prev.fields, ...autoUpdates } } : null);
            }
          }
        }
      }

      // 고객 정보 업데이트 확인 다이얼로그 준비
      if (contactToUpdate) {
        const today = new Date().toISOString().split('T')[0];
        const planPart  = fields.Quote_Plan ?? '';
        const qtyPart   = fields.Quote_Qty ? `(${fields.Quote_Qty}명)` : '';
        const monthPart = fields.License_Duration ? ` ${fields.License_Duration}개월` : '';
        const newNoteLine = `[${today}] ${planPart}${qtyPart}${monthPart} 구매`.trim();

        const changes: { key: string; label: string; from: string; to: string; type: 'replace' | 'append' }[] = [];

        // 현재 딜 제외한 기존 딜 수로 재구매 판별
        const contactPhone = normalizePhone(fields.Contact_Phone ?? '');
        const otherDealCount = (deals ?? []).filter(d =>
          normalizePhone(d.fields.Contact_Phone ?? '') === contactPhone && d.id !== dealId
        ).length;
        if (otherDealCount > 0 && contactToUpdate.fields.Lead_Stage !== '재구매') {
          changes.push({ key: 'Lead_Stage', label: '스테이지',
            from: contactToUpdate.fields.Lead_Stage ?? '(없음)', to: '재구매', type: 'replace' });
        } else if (otherDealCount === 0 && contactToUpdate.fields.Lead_Stage !== '구매') {
          changes.push({ key: 'Lead_Stage', label: '스테이지',
            from: contactToUpdate.fields.Lead_Stage ?? '(없음)', to: '구매', type: 'replace' });
        }
        if (fields.Org_Name && fields.Org_Name !== contactToUpdate.fields.Org_Name) {
          changes.push({ key: 'Org_Name', label: '소속',
            from: contactToUpdate.fields.Org_Name ?? '(없음)', to: fields.Org_Name, type: 'replace' });
        }
        if (contactToUpdate.fields.data_source_date !== today) {
          changes.push({ key: 'data_source_date', label: '최근활동',
            from: contactToUpdate.fields.data_source_date ?? '(없음)', to: today, type: 'replace' });
        }
        // Notes는 항상 추가 (딜 라인)
        changes.push({ key: 'notes_append', label: '활동이력',
          from: '(기존 이력 유지)', to: newNoteLine, type: 'append' });

        if (changes.length > 0) {
          setPendingContactUpdate({
            contact: contactToUpdate, changes, newNoteLine, dealId,
            selected: new Set(changes.map(c => c.key)),
          });
        }
      }

      // (견적 탭은 파일 업로드 전에 이미 저장됨 — quoteTabIdMap 참조)

      // 사용자(이용권 수신자) 저장
      if (dealUsersInput && dealUsersInput.length > 0) {
        const validUsers = dealUsersInput.filter(u => u.user_name || u.user_phone);
        if (validUsers.length > 0) {
          await saveDealUsers(dealId, validUsers).catch(e => console.warn('사용자 저장 실패:', e));
        }
      }

      // 연결된 파트너 딜에 이용권발급일·입금일 동기화
      syncPartnerDealDates(dealId, {
        license_issue_date: fields.License_Send_Date as string | undefined,
        deposit_date: fields.Payment_Date as string | undefined,
      });

      // 저장 성공 시 draft 삭제
      const dk = editMode === 'edit' ? `edit_${selected?.id}` : 'new';
      localStorage.removeItem(`deal_draft_${dk}`);
      setDialogOpen(false);
      if (editMode === 'add') {
        notifyNewDeal(fields.Deal_Name as string, fields.Org_Name as string, fields.Contact_Name as string, fields.Final_Contract_Value as number);
      }
      toast.success(editMode === 'add' ? '딜이 추가되었습니다' : '저장되었습니다');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      toast.error(msg, { duration: 8000 });
    } finally { setUploading(false); }
  };

  // 닫기 전 임시저장 확인
  const handleCloseDialog = () => {
    const dk = editMode === 'edit' ? `edit_${selected?.id}` : 'new';
    const hasDraft = !!localStorage.getItem(`deal_draft_${dk}`);
    if (hasDraft) { setDiscardConfirmOpen(true); return; }
    setDialogOpen(false);
  };

  const confirmDiscardAndClose = () => {
    const dk = editMode === 'edit' ? `edit_${selected?.id}` : 'new';
    localStorage.removeItem(`deal_draft_${dk}`);
    setDiscardConfirmOpen(false);
    setDialogOpen(false);
  };

  if (isLoading) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">딜 관리</h1>
      <DataTableSkeleton columns={7} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">딜 관리</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {periodLabel} · {pipelineTotals.deal}건 · 계약합계 {fmt(pipelineTotals.contract)}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && <DealUploadDialog existingDeals={deals} onDone={() => qc.invalidateQueries({ queryKey: ['deals'] })} />}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={handleAutoDealLink} disabled={autoDealLinking || stageSyncing}
              title="mDiary 학교명 기준으로 이용권을 딜에 자동 연결">
              <CheckCircle2 className={`h-4 w-4 mr-1 ${autoDealLinking ? 'animate-pulse' : ''}`} />
              {autoDealLinking ? autoDealLinkProgress || '연결 중...' : '이용권 자동 연결'}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={handleStageSync} disabled={stageSyncing || autoDealLinking}
              title="딜 스테이지 기준으로 고객 Lead_Stage 일괄 업데이트">
              <Users className={`h-4 w-4 mr-1 ${stageSyncing ? 'animate-pulse' : ''}`} />
              {stageSyncing ? '동기화 중...' : '고객 스테이지 동기화'}
            </Button>
          )}
          {canEdit && checkedIds.size > 0 && (
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              선택 삭제 ({checkedIds.size}건)
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => { setSelected(null); setEditMode('add'); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />딜 추가
            </Button>
          )}
        </div>
      </div>
      {stageSyncResult && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm space-y-1.5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
            <span className="text-teal-800 font-medium">고객 스테이지 동기화 완료</span>
            <span className="text-teal-700"><b>{stageSyncResult.updated}</b>명 업데이트</span>
            {stageSyncResult.unmatched.length > 0 && (
              <span className="text-amber-700"><b>{stageSyncResult.unmatched.length}</b>건 고객 미매칭</span>
            )}
            <button onClick={() => setStageSyncResult(null)} className="ml-auto text-muted-foreground hover:text-foreground">✕</button>
          </div>
          {stageSyncResult.names.length > 0 && (
            <p className="text-xs text-teal-700 pl-7">
              업데이트: {stageSyncResult.names.join(', ')}
            </p>
          )}
          {stageSyncResult.unmatched.length > 0 && (
            <p className="text-xs text-amber-700 pl-7">
              미매칭 (고객 없음): {stageSyncResult.unmatched.join(', ')}
            </p>
          )}
        </div>
      )}
      {autoDealLinkResult && (
        <div className="flex items-center gap-4 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-2.5 text-sm">
          <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
          <span className="text-blue-800 font-medium">이용권 자동 연결 완료</span>
          <span className="text-blue-700">연결 <b>{autoDealLinkResult.linked}</b>건</span>
          {autoDealLinkResult.skipped_multi > 0 && (
            <span className="text-amber-700">동일 학교 딜 복수 <b>{autoDealLinkResult.skipped_multi}</b>건 (수동 필요)</span>
          )}
          {autoDealLinkResult.skipped_no_match > 0 && (
            <span className="text-muted-foreground">매칭 없음 <b>{autoDealLinkResult.skipped_no_match}</b>건</span>
          )}
          <button onClick={() => setAutoDealLinkResult(null)} className="ml-auto text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}

      {/* 파이프라인 */}
      <div className="surface-card ring-container p-4 space-y-3">
        {/* 기간 필터 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-muted-foreground font-medium">딜 파이프라인</p>
          <PeriodFilter
            value={periodFilter}
            onChange={setPeriodFilter}
            customFrom={periodCustomFrom}
            customTo={periodCustomTo}
            onCustomChange={(from, to) => { setPeriodCustomFrom(from); setPeriodCustomTo(to); }}
          />
        </div>

        {/* 스테이지 버튼 */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          <button onClick={() => setStageFilter('all')}
            className={`flex-shrink-0 flex flex-col items-center rounded-lg px-3 py-2 min-w-[64px] transition-colors
              ${stageFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}>
            <span className="text-lg font-bold">{pipelineTotals.deal}</span>
            <span className="text-[10px] mt-0.5">전체</span>
            {pipelineTotals.contract > 0 && (
              <span className={`text-[9px] mt-0.5 ${stageFilter === 'all' ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>
                {fmt(pipelineTotals.contract)}
              </span>
            )}
          </button>
          {pipeline.map((p, i) => (
            <div key={p.stage} className="flex items-center gap-1 flex-shrink-0">
              {i < pipeline.length - 2
                ? <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                : <span className="text-muted-foreground/30 text-xs mx-1">|</span>}
              <button onClick={() => setStageFilter(stageFilter === p.stage ? 'all' : p.stage)}
                className={`flex flex-col items-center rounded-lg px-3 py-2 min-w-[72px] transition-colors border
                  ${stageFilter === p.stage ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-transparent hover:border-border bg-muted/50'}`}>
                <span className={`text-lg font-bold tabular-nums ${p.count === 0 ? 'text-muted-foreground/40' : ''}`}>{p.count.toLocaleString()}</span>
                <span className={`text-[10px] mt-0.5 whitespace-nowrap ${stageFilter === p.stage ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {p.label}
                </span>
                {p.total > 0 && STAGES_WITH_AMOUNT.has(p.stage) && (
                  <span className={`text-[10px] font-medium mt-0.5 tabular-nums ${stageFilter === p.stage ? 'text-primary/80' : 'text-muted-foreground/70'}`}>
                    {p.total >= 100_000_000
                      ? `${(p.total / 100_000_000).toFixed(1)}억`
                      : `${Math.round(p.total / 10_000).toLocaleString()}만`}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="담당자, 학교, 전화번호 검색..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 w-64 text-sm" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 유형</SelectItem>
            <SelectItem value="New">신규</SelectItem>
            <SelectItem value="Renewal">재구매</SelectItem>
          </SelectContent>
        </Select>
        {stageFilter !== 'all' && (
          <button onClick={() => setStageFilter('all')}
            className="h-8 px-3 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20">
            {STAGE_META[stageFilter]?.label} ✕
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground self-center">{sorted.length}건</span>
      </div>

      {/* 테이블 */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
          <table className="w-full text-sm table-fixed min-w-[900px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted/60 backdrop-blur">
                {canEdit && (
                  <th className="px-3 py-3 w-8 bg-muted/60" style={{ position: 'sticky', left: 0, zIndex: 2 }}>
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={sorted.length > 0 && sorted.every(d => checkedIds.has(d.id))}
                      onChange={e => {
                        if (e.target.checked) setCheckedIds(new Set(sorted.map(d => d.id)));
                        else setCheckedIds(new Set());
                      }}
                    />
                  </th>
                )}
                {([
                  { label: '등록일',     field: 'Created'              },
                  { label: '견적번호',   field: 'Quote_Number'         },
                  { label: '담당자',     field: 'Contact_Name'         },
                  { label: '학교/기관',  field: 'Org_Name'             },
                  { label: '유형',       field: null                   },
                  { label: '스테이지',   field: null                   },
                  { label: '실결제금액', field: 'Final_Contract_Value' },
                  { label: '계약일',     field: 'Contract_Date'        },
                  { label: '입금일',     field: 'Payment_Date'         },
                  { label: '구매처',     field: null                   },
                  { label: '📎',         field: null                   },
                ] as { label: string; field: string | null }[]).map(({ label, field }) => {
                  const isSticky = label in stickyLeft;
                  return (
                  <th key={label} onClick={() => field && handleSort(field)}
                    style={{
                      width: colW[label],
                      ...(isSticky ? { position: 'sticky', left: stickyLeft[label as keyof typeof stickyLeft], zIndex: 2 } : {}),
                    }}
                    className={`relative px-4 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap select-none bg-muted/60
                      ${field ? 'cursor-pointer hover:text-foreground' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {field && (sortField === field
                        ? sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                        : <ChevronsUpDown className="h-3 w-3 opacity-30" />)}
                    </span>
                    <div onMouseDown={e => startResize(label, e)}
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 z-10" />
                  </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={canEdit ? 12 : 11} className="px-4 py-10 text-center text-muted-foreground">딜이 없습니다.</td></tr>
              ) : sorted.map(d => {
                const fileCount = d.fields.Notes ? parseFileLinks(d.fields.Notes).length : 0;
                const isChecked = checkedIds.has(d.id);
                return (
                  <tr key={d.id}
                    onClick={() => openDealEdit(d)}
                    className={`border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors ${isChecked ? 'bg-primary/5' : ''}`}>
                    {canEdit && (
                      <td className="px-3 py-2.5 bg-background" style={{ position: 'sticky', left: 0, zIndex: 1 }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={isChecked}
                          onChange={e => {
                            setCheckedIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(d.id);
                              else next.delete(d.id);
                              return next;
                            });
                          }}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                      {d.createdTime ? d.createdTime.slice(0, 10) : '-'}
                    </td>
                    <td className={`px-4 py-2.5 whitespace-nowrap ${isChecked ? 'bg-primary/5' : 'bg-background'}`}
                      style={{ position: 'sticky', left: stickyLeft['견적번호'], zIndex: 1 }}>
                      {d.fields.Quote_Number
                        ? <span className="inline-flex items-center bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5 font-mono font-semibold text-xs">{d.fields.Quote_Number}</span>
                        : <span className="text-muted-foreground text-xs">-</span>}
                    </td>
                    <td className={`px-4 py-2.5 overflow-hidden ${isChecked ? 'bg-primary/5' : 'bg-background'}`}
                      style={{ position: 'sticky', left: stickyLeft['담당자'], zIndex: 1 }}>
                      <p className="font-medium truncate">{d.fields.Contact_Name || '-'}</p>
                      {d.fields.Contact_Phone && (
                        <p className="text-xs text-muted-foreground tabular-nums truncate">{d.fields.Contact_Phone}</p>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 text-xs text-muted-foreground truncate overflow-hidden ${isChecked ? 'bg-primary/5' : 'bg-background'}`}
                      style={{ position: 'sticky', left: stickyLeft['학교/기관'], zIndex: 1 }}>
                      {d.fields.Org_Name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs rounded-full px-2 py-0.5 ${d.fields.Deal_Type === 'Renewal' ? 'bg-orange-100 text-orange-700' : 'bg-muted text-muted-foreground'}`}>
                        {d.fields.Deal_Type === 'Renewal' ? '재구매' : '신규'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5"><StageBadge stage={d.fields.Deal_Stage} /></td>
                    <td className="px-4 py-2.5 tabular-nums text-xs text-right">
                      {d.fields.Final_Contract_Value
                        ? new Intl.NumberFormat('ko-KR').format(d.fields.Final_Contract_Value)
                        : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{d.fields.Contract_Date || d.fields.Order_Date}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{d.fields.Payment_Date}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[100px] truncate">{d.fields.Lead_Source}</td>
                    <td className="px-4 py-2.5">
                      {fileCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-primary">
                          <Paperclip className="h-3 w-3" />{fileCount}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 추가/편집 팝업 ── */}
      <Dialog open={discardConfirmOpen} onOpenChange={open => { if (!open) setDiscardConfirmOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>임시저장 삭제</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">작성 중인 내용의 임시저장을 삭제하고 닫으시겠습니까?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDiscardConfirmOpen(false)}>취소 (계속 작성)</Button>
            <Button variant="destructive" onClick={confirmDiscardAndClose}>예, 삭제하고 닫기</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) handleCloseDialog(); }}>
        <DialogContent
          className="max-w-3xl p-0 gap-0 flex flex-col max-h-[92vh]"
          onInteractOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle>{editMode === 'add' ? '새 딜 추가' : '딜 편집'}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <DealForm
              key={editMode === 'edit' ? selected?.id : 'add'}
              initial={editMode === 'edit' ? selected?.fields : undefined}
              initialContact={editMode === 'edit' && selected?.fields.Contact_Phone
                ? contacts?.find(c => {
                    const norm = c.fields.phone_normalized || normalizePhone(c.fields.Phone ?? '');
                    return norm === normalizePhone(selected.fields.Contact_Phone ?? '');
                  })
                : undefined}
              existingFiles={editMode === 'edit' ? dealFiles : []}
              initialQuotes={editMode === 'edit' ? dealQuotes : []}
              initialLicenses={editMode === 'edit' ? dealLicenses : []}
              draftKey={editMode === 'edit' ? `edit_${selected?.id}` : 'new'}
              onSave={handleSave}
              onCancel={handleCloseDialog}
              saving={createDeal.isPending || updateDeal.isPending || uploading}
              contacts={contacts}
              allDeals={deals}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 상세보기 Sheet ── */}
      <Sheet open={sheetOpen} onOpenChange={open => { if (!open) { setSheetOpen(false); setConfirmDelete(false); } }}>
        <SheetContent className="flex flex-col w-[520px] sm:w-[600px] p-0">
          {selected && (() => {
            const f = selected.fields;
            const textNotes = (f.Notes ?? '').trim();
            return (
              <>
                <SheetHeader className="px-6 py-4 border-b border-border flex-shrink-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <SheetTitle className="text-base">{f.Contact_Name || f.Deal_Name}</SheetTitle>
                        {f.Org_Name && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3.5 w-3.5" />{f.Org_Name}
                          </p>
                        )}
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          <StageBadge stage={f.Deal_Stage} />
                          {f.Deal_Type === 'Renewal' && (
                            <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">재구매</span>
                          )}
                          {f.Quote_Plan && (
                            <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">{f.Quote_Plan}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {canEdit && selected && <Button size="sm" variant="outline" className="gap-1"
                        onClick={() => openDealEdit(selected)}>
                        <Pencil className="h-3.5 w-3.5" />편집
                      </Button>}
                      {canEdit && confirmDelete ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleteDeal.isPending}>
                            {deleteDeal.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '삭제 확인'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>취소</Button>
                        </div>
                      ) : canEdit ? (
                        <Button size="sm" variant="ghost"
                          className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setConfirmDelete(true)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                  {/* 스테이지 변경 */}
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_DEAL_STAGES.map(s => (
                      <button key={s} onClick={() => handleStageChange(s)}
                        className={`text-xs rounded-full px-3 py-1 border transition-colors
                          ${f.Deal_Stage === s ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border hover:border-primary/50'}`}>
                        {STAGE_META[s]?.label ?? s}
                      </button>
                    ))}
                  </div>

                  {/* 견적 목록 */}
                  <Section icon={FileText} title="견적 목록">
                    <div className="space-y-2">
                      {dealQuotes.length === 0 ? (
                        <p className="text-xs text-muted-foreground">등록된 견적이 없습니다.</p>
                      ) : dealQuotes.map(q => (
                        <div key={q.id} className={`rounded-lg border p-3 space-y-1.5 ${q.is_selected ? 'border-primary bg-primary/5' : 'border-border bg-muted/20'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {q.is_selected && (
                                <span className="flex-shrink-0 text-[10px] rounded-full px-1.5 py-0.5 bg-primary text-primary-foreground font-medium">딜 확정</span>
                              )}
                              {q.plan && <span className="text-xs font-medium truncate">{q.plan}</span>}
                              {q.final_value != null && q.final_value > 0 && (
                                <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                                  {new Intl.NumberFormat('ko-KR').format(q.final_value)}원
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                title="견적서 PDF 생성"
                                disabled={pdfGenerating === q.id}
                                onClick={async () => {
                                  setPdfGenerating(q.id);
                                  try {
                                    await generateQuotePdf({
                                      quoteNumber: q.quote_number ?? '',
                                      quoteDate: q.quote_date ?? '',
                                      orgName: selected!.fields.Org_Name ?? '',
                                      contactName: selected!.fields.Contact_Name ?? '',
                                      plan: q.plan ?? '',
                                      duration: q.duration ?? 0,
                                      unitPrice: q.unit_price ?? 0,
                                      licenseQty: q.license_qty ?? 0,
                                      finalValue: q.final_value ?? 0,
                                      supplyPrice: q.supply_price ?? 0,
                                      taxAmount: q.tax_amount ?? 0,
                                      items: (q.items as import('@/lib/pricing').QuoteLineItem[] | undefined) ?? [],
                                      discountAmount: q.discount_amount ?? 0,
                                      notes: q.notes,
                                    });
                                  } catch (e) {
                                    toast.error('PDF 생성 실패');
                                  } finally {
                                    setPdfGenerating(null);
                                  }
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-50">
                                {pdfGenerating === q.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <FileDown className="h-3.5 w-3.5" />}
                              </button>
                              {!q.is_selected && (
                                <button
                                  onClick={async () => {
                                    await selectDealQuote(selected!.id, q.id);
                                    // 딜의 Quote 필드도 업데이트
                                    await updateDeal.mutateAsync({ id: selected!.id, fields: {
                                      Quote_Date: q.quote_date,
                                      Quote_Plan: q.plan,
                                      Quote_Qty: q.qty,
                                      License_Duration: q.duration,
                                      Unit_Price: q.unit_price,
                                      Supply_Price: q.supply_price,
                                      Tax_Amount: q.tax_amount,
                                      Final_Contract_Value: q.final_value,
                                      Quote_Number: q.quote_number,
                                    }});
                                    setSelected(prev => prev ? { ...prev, fields: { ...prev.fields,
                                      Quote_Date: q.quote_date, Quote_Plan: q.plan, Quote_Qty: q.qty,
                                      License_Duration: q.duration, Unit_Price: q.unit_price,
                                      Supply_Price: q.supply_price, Tax_Amount: q.tax_amount,
                                      Final_Contract_Value: q.final_value, Quote_Number: q.quote_number,
                                    }} : null);
                                    setDealQuotes(prev => prev.map(dq => ({ ...dq, is_selected: dq.id === q.id })));
                                    toast.success('견적이 딜로 확정되었습니다');
                                  }}
                                  className="text-[11px] px-2 py-1 rounded border border-primary/50 text-primary hover:bg-primary/10 transition-colors">
                                  딜 확정
                                </button>
                              )}
                              <button
                                onClick={() => { setEditingQuote(q); setQuoteDialogOpen(true); }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={async () => {
                                  await deleteDealQuote(q.id);
                                  setDealQuotes(prev => prev.filter(dq => dq.id !== q.id));
                                }}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                            {q.quote_number && (
                              <span className="inline-flex items-center bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5 font-mono font-semibold text-[11px]">{q.quote_number}</span>
                            )}
                            {q.quote_date && <span>{q.quote_date}</span>}
                            {q.qty != null && <span>{q.qty.toLocaleString('ko-KR')}명</span>}
                            {q.duration != null && <span>{q.duration}개월</span>}
                            {q.notes && <span className="text-muted-foreground/70">{q.notes}</span>}
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => { setEditingQuote(null); setQuoteDialogOpen(true); }}
                        className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
                        <Plus className="h-3.5 w-3.5" />견적 추가
                      </button>
                    </div>
                  </Section>

                  {/* 담당자 */}
                  <Section icon={User} title="담당자">
                    <div className="space-y-2">
                      {(f.Contact_Phone || f.Contact_Email) && (
                        <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
                          {f.Contact_Phone && (
                            <a href={`tel:${f.Contact_Phone}`} className="flex items-center gap-2 text-sm hover:text-primary">
                              <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />{f.Contact_Phone}
                            </a>
                          )}
                          {f.Contact_Email && (
                            <a href={`mailto:${f.Contact_Email}`} className="flex items-center gap-2 text-sm hover:text-primary">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />{f.Contact_Email}
                            </a>
                          )}
                        </div>
                      )}
                      {/* 학교 정보 */}
                      {(f.Education_Office || f.Org_Address || f.Org_Tel || f.Org_Homepage) && (
                        <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 space-y-1.5 text-xs">
                          {f.Education_Office && (
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-20 flex-shrink-0">시도교육청</span>
                              <span className="font-medium">{f.Education_Office}</span>
                            </div>
                          )}
                          {(f.Org_ZipCode || f.Org_Address) && (
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-20 flex-shrink-0">주소</span>
                              <span>{f.Org_ZipCode && `[${f.Org_ZipCode.trim()}] `}{f.Org_Address} {f.Org_Address_Detail}</span>
                            </div>
                          )}
                          {f.Org_Tel && (
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-20 flex-shrink-0">학교 전화</span>
                              <a href={`tel:${f.Org_Tel}`} className="hover:text-primary">{f.Org_Tel}</a>
                            </div>
                          )}
                          {f.Org_Homepage && (
                            <div className="flex gap-2">
                              <span className="text-muted-foreground w-20 flex-shrink-0">홈페이지</span>
                              <a href={f.Org_Homepage} target="_blank" rel="noopener noreferrer"
                                className="text-blue-600 hover:underline truncate">{f.Org_Homepage}</a>
                            </div>
                          )}
                        </div>
                      )}
                      {(f.Admin_Name || f.Admin_Phone || f.Admin_Email || f.School_ID_Number) && (
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { l: '행정담당자', v: f.Admin_Name },
                            { l: '행정 전화',  v: f.Admin_Phone },
                            { l: '행정 이메일', v: f.Admin_Email },
                            { l: '고유번호증',  v: f.School_ID_Number },
                          ].filter(r => r.v).map(({ l, v }) => (
                            <div key={l} className="bg-muted/30 rounded-lg p-2.5">
                              <p className="text-[10px] text-muted-foreground">{l}</p>
                              <p className="text-sm mt-0.5 truncate">{v}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Section>

                  {/* 견적 */}
                  <Section icon={FileText} title="견적">
                    {f.Quote_Number && (
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">견적서 번호</span>
                        <span className="inline-flex items-center bg-teal-50 text-teal-700 border border-teal-200 rounded-md px-2.5 py-1 font-mono font-bold text-sm tracking-wide">{f.Quote_Number}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { l: '견적일',     v: f.Quote_Date },
                        { l: '플랜',       v: f.Quote_Plan },
                        { l: '수량',       v: f.Quote_Qty != null ? `${f.Quote_Qty.toLocaleString('ko-KR')}명` : undefined },
                        { l: '이용기간',   v: f.License_Duration ? `${f.License_Duration}개월` : undefined },
                        { l: '단가',       v: fmt(f.Unit_Price) },
                        { l: '실결제금액', v: fmt(f.Final_Contract_Value), bold: true },
                        { l: '공급가액',   v: fmt(f.Supply_Price) },
                        { l: '세액',       v: fmt(f.Tax_Amount) },
                      ].filter(r => r.v && r.v !== '-').map(({ l, v, bold }) => (
                        <div key={l} className="bg-muted/30 rounded-lg p-2.5">
                          <p className="text-[10px] text-muted-foreground">{l}</p>
                          <p className={`text-sm mt-0.5 ${bold ? 'font-semibold text-foreground' : ''}`}>{v}</p>
                        </div>
                      ))}
                    </div>
                  </Section>

                  {/* 이용권 */}
                  <Section icon={Package} title="이용권">
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { l: '코드 수량', v: f.License_Code_Count ? `${f.License_Code_Count.toLocaleString('ko-KR')}개` : undefined },
                          { l: '발송일',   v: f.License_Send_Date },
                          { l: '만료일',   v: f.Renewal_Date },
                          { l: '템플릿',   v: f.License_Template },
                        ].filter(r => r.v).map(({ l, v }) => (
                          <div key={l} className="bg-muted/30 rounded-lg p-2.5">
                            <p className="text-[10px] text-muted-foreground">{l}</p>
                            <p className="text-sm mt-0.5 truncate">{v}</p>
                          </div>
                        ))}
                      </div>
                      {dealLicenses.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-[11px] text-muted-foreground font-medium mb-1.5">
                            등록된 이용권 ({dealLicenses.length}건)
                          </p>
                          {dealLicenses.map(lic => (
                            <div key={lic.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                              <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium
                                ${lic.status === '사용중' ? 'bg-teal-100 text-teal-700'
                                  : lic.status === '만료' || lic.status === '이탈' ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-600'}`}>
                                {lic.status}
                              </span>
                              <span className="font-mono text-xs flex-shrink-0">{lic.coupon_code}</span>
                              <span className="text-muted-foreground flex-1 truncate">{lic.contact_name}</span>
                              {lic.duration && <span className="text-muted-foreground flex-shrink-0">{lic.duration}개월</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* 쿠폰 코드 연결 */}
                      <div className="mt-3 flex gap-2">
                        <Input
                          className="h-7 text-xs font-mono flex-1"
                          placeholder="쿠폰 코드 입력 후 연결"
                          value={attachCode}
                          onChange={e => setAttachCode(e.target.value.trim())}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && attachCode && selected) {
                              e.preventDefault();
                              handleAttachCoupon();
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2"
                          disabled={!attachCode || attachLoading}
                          onClick={handleAttachCoupon}
                        >
                          {attachLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '연결'}
                        </Button>
                      </div>
                  </Section>

                  {/* 세무 */}
                  {(f.Lead_Source || f.Order_Date || f.Contract_Date || f.Payment_Date || f.Receipt_Date) && (
                    <Section icon={Receipt} title="세무">
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { l: '구매처',      v: f.Lead_Source },
                          { l: '계약일(주문일)', v: f.Contract_Date || f.Order_Date },
                          { l: '입금일',      v: f.Payment_Date },
                          { l: '영수증발급일', v: f.Receipt_Date },
                        ].filter(r => r.v).map(({ l, v }) => (
                          <div key={l} className="bg-muted/30 rounded-lg p-2.5">
                            <p className="text-[10px] text-muted-foreground">{l}</p>
                            <p className="text-sm mt-0.5 truncate">{v}</p>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* 첨부 파일 */}
                  <Section icon={Paperclip} title="첨부 파일">
                    {dealFiles.length === 0 ? (
                      <p className="text-xs text-muted-foreground">첨부된 파일이 없습니다.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {dealFiles.map(file => (
                          <div key={file.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted/40 group">
                            <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-xs text-muted-foreground w-16 flex-shrink-0">{file.slot_key?.startsWith('quote_tab_') || file.slot_key?.startsWith('quote_file_') ? '견적서' : file.label}</span>
                            <a href={file.file_url} target="_blank" rel="noopener noreferrer"
                              className="text-sm flex-1 truncate hover:text-primary hover:underline underline-offset-2">
                              {file.file_name}
                            </a>
                            <button
                              onClick={async () => {
                                await deleteDealFileRecord(file.id);
                                setDealFiles(prev => prev.filter(f => f.id !== file.id));
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity">
                              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                            </button>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* 메모 */}
                  {textNotes && (
                    <Section icon={FileText} title="메모">
                      <div className="space-y-1.5 bg-muted/30 rounded-lg p-3">
                        {textNotes.split('\n').filter(Boolean).map((line, i) => {
                          const clean = line.replace(/\s*·rec\w+/, '');
                          const dm = clean.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*/);
                          return (
                            <div key={i} className="flex gap-2 text-sm">
                              {dm ? <>
                                <span className="text-xs font-mono text-primary flex-shrink-0 pt-0.5">{dm[1]}</span>
                                <span className="text-muted-foreground">{clean.replace(dm[0], '')}</span>
                              </> : <span className="text-muted-foreground">{clean}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </Section>
                  )}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ── 견적 추가/편집 다이얼로그 ── */}
      {selected && (
        <QuoteDialog
          open={quoteDialogOpen}
          onClose={() => { setQuoteDialogOpen(false); setEditingQuote(null); }}
          dealId={selected.id}
          quote={editingQuote}
          existingNumbers={(deals ?? []).flatMap(d => d.fields.Quote_Number ? [d.fields.Quote_Number] : [])}
          orgName={selected.fields.Org_Name ?? ''}
          contactName={selected.fields.Contact_Name ?? ''}
          contactEmail={selected.fields.Contact_Email ?? ''}
          onSaved={q => {
            setDealQuotes(prev => {
              const idx = prev.findIndex(dq => dq.id === q.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = q;
                return next;
              }
              return [...prev, q];
            });
            // 딜 확정 견적이면 Airtable 딜 필드도 동기화
            if (q.is_selected && selected) {
              const updates: Partial<DealFields> = {
                Quote_Date: q.quote_date, Quote_Plan: q.plan, Quote_Qty: q.qty,
                License_Duration: q.duration, Unit_Price: q.unit_price,
                Supply_Price: q.supply_price, Tax_Amount: q.tax_amount,
                Final_Contract_Value: q.final_value, Quote_Number: q.quote_number,
              };
              updateDeal.mutateAsync({ id: selected.id, fields: updates }).then(() => {
                setSelected(prev => prev ? { ...prev, fields: { ...prev.fields, ...updates } } : null);
              }).catch(() => {});
            }
          }}
        />
      )}

      {/* ── 고객 정보 업데이트 확인 다이얼로그 ── */}
      {pendingContactUpdate && (() => {
        const pcu = pendingContactUpdate;
        const toggleKey = (key: string) => {
          setPendingContactUpdate(prev => {
            if (!prev) return null;
            const next = new Set(prev.selected);
            next.has(key) ? next.delete(key) : next.add(key);
            return { ...prev, selected: next };
          });
        };
        const applyUpdate = async () => {
          const fieldsToUpdate: Partial<ContactFields> = {};
          for (const change of pcu.changes) {
            if (!pcu.selected.has(change.key)) continue;
            if (change.key === 'notes_append') {
              const prev = pcu.contact.fields.Notes ?? '';
              fieldsToUpdate.Notes = [pcu.newNoteLine, prev].filter(Boolean).join('\n');
            } else {
              (fieldsToUpdate as Record<string, string>)[change.key] = change.to;
            }
          }
          if (Object.keys(fieldsToUpdate).length > 0) {
            await airtable.updateRecord<ContactFields>('01_Contacts', pcu.contact.id, fieldsToUpdate);
            qc.invalidateQueries({ queryKey: ['contacts'] });
            toast.success('고객 정보가 업데이트되었습니다');
          }
          setPendingContactUpdate(null);
        };

        return (
          <Dialog open onOpenChange={() => setPendingContactUpdate(null)}>
            <DialogContent className="max-w-md" onInteractOutside={e => e.preventDefault()}>
              <DialogHeader>
                <DialogTitle>고객 정보 업데이트</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  <strong>{pcu.contact.fields.Name}</strong> 님의 정보를 딜 내용으로 업데이트합니다.
                </p>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>업데이트할 항목 선택</span>
                  <button
                    onClick={() => setPendingContactUpdate(prev => prev ? {
                      ...prev,
                      selected: prev.selected.size === prev.changes.length
                        ? new Set()
                        : new Set(prev.changes.map(c => c.key)),
                    } : null)}
                    className="underline hover:opacity-70"
                  >
                    {pcu.selected.size === pcu.changes.length ? '전체 해제' : '전체 선택'}
                  </button>
                </div>
                {pcu.changes.map(change => (
                  <label key={change.key}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors
                      ${pcu.selected.has(change.key) ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80'}`}>
                    <input
                      type="checkbox"
                      checked={pcu.selected.has(change.key)}
                      onChange={() => toggleKey(change.key)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{change.label}</p>
                      {change.type === 'replace' ? (
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          <span className="line-through opacity-60 truncate max-w-[120px]">{change.from}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-foreground font-medium">{change.to}</span>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-primary truncate">{change.to}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={applyUpdate} disabled={pcu.selected.size === 0} className="flex-1">
                  업데이트 ({pcu.selected.size}개)
                </Button>
                <Button variant="outline" onClick={() => setPendingContactUpdate(null)} className="flex-1">
                  건너뛰기
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
