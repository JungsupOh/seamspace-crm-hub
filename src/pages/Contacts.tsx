import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useContacts, useCreateContact, useUpdateContact, useDeleteContact } from '@/hooks/use-airtable';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, Pencil, Trash2, X, Check, Key, Plus, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { AirtableRecord } from '@/lib/airtable';
import { ContactFields } from '@/types/airtable';
import { FUNNEL_STAGES, ALL_STAGES, STAGE_COLOR, CONTACT_TYPES, CONTACT_TYPE_COLOR, normalizeStage, normalizeContactType, resolveContactTypeKey } from '@/lib/grades';
import { useResizableColumns } from '@/hooks/useResizableColumns';
import { airtable } from '@/lib/airtable';
import { searchSchools, SchoolInfo } from '@/lib/neis';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface LicenseRecord {
  id: string;
  coupon_code: string;
  org_name: string;
  status: string;
  duration: string;
  user_count: string;
  service_expire_at: string | null;
  deal_id: string;
  created_at: string;
}

interface MDiaryCoupon {
  id: number;
  mdiary_id: number;
  coupon_code: string;
  created_at: string;
  duration: number;
  user_limit: number;
  is_used: boolean;
  descript: string;
  extracted_name: string | null;
  linked_contact_id: string | null;
  link_confirmed: boolean | null;  // null=미확인, true=확인, false=다른 분
}

async function getMDiaryCouponsByName(name: string): Promise<MDiaryCoupon[]> {
  if (!name || name.length < 2) return [];
  // 거부된 것(false)은 제외, 미확인(null)과 확인됨(true)만 표시
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mdiary_coupons?extracted_name=eq.${encodeURIComponent(name)}&order=created_at.desc`,
    { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
  );
  if (!res.ok) return [];
  const data: MDiaryCoupon[] = await res.json();
  return data.filter(c => c.link_confirmed !== false);
}

async function confirmCouponLink(id: number, contactId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ linked_contact_id: contactId, link_confirmed: true }),
  });
}

async function rejectCouponLink(id: number): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/mdiary_coupons?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ link_confirmed: false }),
  });
}

async function getLicensesByPhone(phone: string): Promise<LicenseRecord[]> {
  const normalized = phone.replace(/\D/g, '');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/deal_licenses?contact_phone=eq.${encodeURIComponent(phone)}&order=created_at.desc`,
    { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
  );
  if (!res.ok) return [];
  const data: LicenseRecord[] = await res.json();
  if (data.length > 0) return data;
  // 전화번호 포맷이 다를 수 있으므로 숫자만으로 재조회
  const res2 = await fetch(
    `${SUPABASE_URL}/rest/v1/deal_licenses?select=*&order=created_at.desc`,
    { headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY } }
  );
  if (!res2.ok) return [];
  const all: LicenseRecord[] = await res2.json();
  return all.filter(l => l.contact_phone?.replace(/\D/g, '') === normalized);
}

const STATUS_COLOR: Record<string, string> = {
  '대기':   'bg-slate-100 text-slate-600',
  '사용중': 'bg-teal-100 text-teal-700',
  '만료':   'bg-orange-100 text-orange-700',
  '이탈':   'bg-red-100 text-red-700',
};

function StageBadge({ stage }: { stage?: string }) {
  if (!stage) return <span className="text-muted-foreground text-xs">-</span>;
  const normalized = normalizeStage(stage);
  const cls = STAGE_COLOR[normalized] ?? 'bg-muted text-muted-foreground';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{normalized}</span>;
}

function TypeBadge({ type }: { type?: string }) {
  if (!type) return null;
  const normalized = normalizeContactType(type);
  const cls = CONTACT_TYPE_COLOR[normalized] ?? 'bg-muted text-muted-foreground';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{normalized}</span>;
}

// ── 학교 검색 (NEIS API) — 연락처 전용 ──────────
function ContactSchoolSearchInput({
  value, onChange, onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (school: SchoolInfo) => void;
}) {
  const [results, setResults]   = useState<SchoolInfo[]>([]);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (!q.trim()) return;
    setLoading(true);
    try {
      const data = await searchSchools(q);
      setResults(data);
      setOpen(true);
    } catch {
      toast.error('학교 검색 실패');
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
          placeholder="OO초등학교"
        />
        <button type="button"
          onClick={() => doSearch(value)}
          disabled={loading}
          className="h-8 px-2.5 text-xs rounded-md border border-border hover:bg-muted disabled:opacity-50 flex-shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </button>
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

// ── 고객 추가 다이얼로그 ──────────────────────────
function AddContactDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createContact = useCreateContact();
  const [f, setF] = useState<Partial<ContactFields>>({
    Name: '', Phone: '', Email: '', Org_Name: '',
    Role: '', Lead_Source: '', Contact_Type: '', Lead_Stage: '신규', Notes: '',
  });
  const set = (k: keyof ContactFields, v: string) => setF(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!f.Name?.trim()) { toast.error('이름을 입력하세요'); return; }
    await createContact.mutateAsync(f);
    // mDiary 쿠폰 이력 자동 매칭 확인
    const coupons = await getMDiaryCouponsByName(f.Name.trim()).catch(() => []);
    if (coupons.length > 0) {
      toast.success(`고객 추가 완료 — mDiary 체험 이력 ${coupons.length}건 연결됨`);
    } else {
      toast.success('고객이 추가되었습니다');
    }
    setF({ Name: '', Phone: '', Email: '', Org_Name: '', Role: '', Lead_Source: '', Contact_Type: '', Lead_Stage: '신규', Notes: '' });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>고객 추가</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">이름 *</Label>
              <Input value={f.Name ?? ''} onChange={e => set('Name', e.target.value)} className="h-8 text-sm" placeholder="홍길동" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">전화</Label>
              <Input value={f.Phone ?? ''} onChange={e => set('Phone', e.target.value)} className="h-8 text-sm" placeholder="010-0000-0000" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">이메일</Label>
              <Input value={f.Email ?? ''} onChange={e => set('Email', e.target.value)} className="h-8 text-sm" placeholder="example@school.kr" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">소속</Label>
              <Input value={f.Org_Name ?? ''} onChange={e => set('Org_Name', e.target.value)} className="h-8 text-sm" placeholder="OO초등학교" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">유형</Label>
              <Select value={f.Contact_Type ?? ''} onValueChange={v => set('Contact_Type', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">유입경로</Label>
              <Input value={f.Lead_Source ?? ''} onChange={e => set('Lead_Source', e.target.value)} className="h-8 text-sm" placeholder="SNS, 지인소개 등" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">여정 단계</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STAGES.map(s => (
                <button key={s} onClick={() => set('Lead_Stage', s)}
                  className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                    f.Lead_Stage === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/60'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">메모</Label>
            <textarea value={f.Notes ?? ''} onChange={e => set('Notes', e.target.value)}
              rows={3} placeholder="첫 접촉 경위, 특이사항 등"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>

          <Button className="w-full" onClick={handleSave} disabled={createContact.isPending}>
            {createContact.isPending ? '추가 중...' : '고객 추가'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 연락처 편집 폼 ─────────────────────────────────
interface ContactEditFormProps {
  contact: AirtableRecord<ContactFields>;
  onCancel: () => void;
  onSaved: (updated: AirtableRecord<ContactFields>) => void;
}

function ContactEditForm({ contact, onCancel, onSaved }: ContactEditFormProps) {
  const updateContact = useUpdateContact();
  const [f, setF] = useState<Partial<ContactFields>>({
    Name:         contact.fields.Name ?? '',
    Phone:        contact.fields.phone_normalized ?? contact.fields.Phone ?? '',
    Email:        contact.fields.Email ?? '',
    Org_Name:     contact.fields.Org_Name ?? '',
    Role:         contact.fields.Role ?? '',
    Lead_Source:  contact.fields.Lead_Source ?? '',
    Contact_Type: resolveContactTypeKey(contact.fields.Contact_Type),
    Lead_Stage:   contact.fields.Lead_Stage ?? '',
    Notes:        contact.fields.Notes ?? '',
    Education_Office:   contact.fields.Education_Office ?? '',
    Org_ZipCode:        contact.fields.Org_ZipCode ?? '',
    Org_Address:        contact.fields.Org_Address ?? '',
    Org_Address_Detail: contact.fields.Org_Address_Detail ?? '',
    Org_Tel:            contact.fields.Org_Tel ?? '',
    Org_Homepage:       contact.fields.Org_Homepage ?? '',
    School_ID_Number:   contact.fields.School_ID_Number ?? '',
  });

  const set = (key: keyof ContactFields, val: string) =>
    setF(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    const fields = { ...f };
    if (fields.Phone) fields.phone_normalized = fields.Phone;
    await updateContact.mutateAsync({ id: contact.id, fields });
    onSaved({ ...contact, fields: { ...contact.fields, ...fields } });
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">이름</label>
          <Input value={f.Name ?? ''} onChange={e => set('Name', e.target.value)} className="mt-1 h-8 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">전화</label>
          <Input value={f.Phone ?? ''} onChange={e => set('Phone', e.target.value)} className="mt-1 h-8 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">유형</label>
          <Select value={f.Contact_Type ?? ''} onValueChange={v => set('Contact_Type', v)}>
            <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
            <SelectContent>
              {CONTACT_TYPES.map(t => (
                <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">이메일</label>
          <Input value={f.Email ?? ''} onChange={e => set('Email', e.target.value)} className="mt-1 h-8 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">유입경로</label>
          <Input value={f.Lead_Source ?? ''} onChange={e => set('Lead_Source', e.target.value)} className="mt-1 h-8 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">소속 학교 검색</label>
          <div className="mt-1">
            <ContactSchoolSearchInput
              value={f.Org_Name ?? ''}
              onChange={v => set('Org_Name', v)}
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
          </div>
          {(f.Org_Address || f.Education_Office) && (
            <div className="mt-1.5 rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 space-y-1 text-xs">
              {f.Education_Office && <div className="flex gap-2"><span className="text-muted-foreground w-16 flex-shrink-0">교육청</span><span>{f.Education_Office}</span></div>}
              {f.Org_Address && <div className="flex gap-2"><span className="text-muted-foreground w-16 flex-shrink-0">주소</span><span>{f.Org_Address}</span></div>}
              {f.Org_Tel && <div className="flex gap-2"><span className="text-muted-foreground w-16 flex-shrink-0">학교 전화</span><span>{f.Org_Tel}</span></div>}
            </div>
          )}
        </div>
      </div>

      {/* 스테이지 선택 */}
      <div>
        <label className="text-xs text-muted-foreground">스테이지</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ALL_STAGES.map(s => (
            <button
              key={s}
              onClick={() => set('Lead_Stage', s)}
              className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                f.Lead_Stage === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:border-primary/60'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 메모 */}
      <div>
        <label className="text-xs text-muted-foreground">메모 / 활동이력</label>
        <textarea
          value={f.Notes ?? ''}
          onChange={e => set('Notes', e.target.value)}
          rows={5}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={updateContact.isPending}
          className="flex-1 h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {updateContact.isPending ? '저장 중...' : '저장'}
        </button>
        <button
          onClick={onCancel}
          className="h-8 px-4 rounded-md border border-border text-sm hover:bg-muted"
        >
          취소
        </button>
      </div>
      {updateContact.isError && (
        <p className="text-xs text-destructive">{(updateContact.error as Error)?.message}</p>
      )}
    </div>
  );
}

export default function Contacts() {
  const { canEdit } = useAuth();
  const { data: contacts, isLoading } = useContacts();
  const updateContact  = useUpdateContact();
  const deleteContact  = useDeleteContact();
  const [addOpen, setAddOpen]         = useState(false);
  const [search, setSearch]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [selected, setSelected]       = useState<AirtableRecord<ContactFields> | null>(null);
  const [editMode, setEditMode]       = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [checkedIds, setCheckedIds]   = useState<Set<string>>(new Set());
  const [bulkType, setBulkType]       = useState('');
  const [bulkStage, setBulkStage]     = useState('');
  const { widths: colW, startResize } = useResizableColumns('contacts_col_widths', {
    이름: 110, 교육청: 130, 소속: 120, 전화: 110, 이메일: 160, 유형: 80, 스테이지: 72, 최근활동: 88,
  });
  const [sortField, setSortField]     = useState('Name');
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('asc');
  const [licenses, setLicenses]             = useState<LicenseRecord[]>([]);
  const [mDiaryCoupons, setMDiaryCoupons]   = useState<MDiaryCoupon[]>([]);

  useEffect(() => {
    if (!selected?.fields.Phone) { setLicenses([]); return; }
    getLicensesByPhone(selected.fields.Phone).then(setLicenses).catch(() => setLicenses([]));
  }, [selected?.id]);

  useEffect(() => {
    const name = selected?.fields.Name;
    if (!name) { setMDiaryCoupons([]); return; }
    getMDiaryCouponsByName(name).then(async (data) => {
      if (data.length === 0) { setMDiaryCoupons([]); return; }

      // 동명이인 여부 확인
      const sameNameCount = contacts?.filter(c => c.fields.Name === name).length ?? 0;
      const isUniqueName = sameNameCount <= 1;

      // 활동이력에서 날짜 추출
      const activityDates: string[] = [];
      (selected.fields.Notes ?? '').split('\n').forEach(line => {
        const m = line.match(/\[(\d{4}-\d{2}-\d{2})\]/);
        if (m) activityDates.push(m[1]);
      });

      // 자동확인 조건: 미확인 + 이름 유일 + 활동이력 날짜와 7일 이내
      const toAutoConfirm = data.filter(c => {
        if (c.link_confirmed !== null) return false;
        if (!isUniqueName) return false;
        return activityDates.some(actDate => {
          const diff = Math.abs(new Date(c.created_at).getTime() - new Date(actDate).getTime());
          return diff <= 7 * 86400000;
        });
      });

      if (toAutoConfirm.length > 0) {
        await Promise.all(toAutoConfirm.map(c => confirmCouponLink(c.id, selected.id)));
        setMDiaryCoupons(data.map(c =>
          toAutoConfirm.find(ac => ac.id === c.id)
            ? { ...c, link_confirmed: true, linked_contact_id: selected.id }
            : c
        ));
        toast.success(`체험권 ${toAutoConfirm.length}건 자동 확인됨`);
      } else {
        setMDiaryCoupons(data);
      }
    }).catch(() => setMDiaryCoupons([]));
  }, [selected?.id, contacts]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const openContact = (c: AirtableRecord<ContactFields>) => {
    setSelected(c);
    setEditMode(false);
    setDeleteConfirm(false);
  };

  const closeSheet = () => {
    setSelected(null);
    setEditMode(false);
    setDeleteConfirm(false);
  };

  // 스테이지 빠른 변경 (view 모드)
  const handleStageChange = async (stage: string) => {
    if (!selected) return;
    await updateContact.mutateAsync({ id: selected.id, fields: { Lead_Stage: stage } });
    setSelected(prev => prev ? { ...prev, fields: { ...prev.fields, Lead_Stage: stage } } : null);
  };

  const handleDelete = async () => {
    if (!selected) return;
    await deleteContact.mutateAsync(selected.id);
    closeSheet();
  };

  const handleBulkUpdate = async () => {
    if (!checkedIds.size) return;
    const fields: Partial<ContactFields> = {};
    if (bulkType)  fields.Contact_Type = bulkType;
    if (bulkStage) fields.Lead_Stage   = bulkStage;
    if (!Object.keys(fields).length) return;
    await Promise.all([...checkedIds].map(id => updateContact.mutateAsync({ id, fields })));
    setCheckedIds(new Set());
    setBulkType('');
    setBulkStage('');
  };

  const toggleCheck = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedIds.size === sorted.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(sorted.map(c => c.id)));
  };

  // 퍼널 스테이지별 카운트 (레거시 값도 정규화해서 집계)
  const stageCounts = FUNNEL_STAGES.map(s => ({
    ...s,
    count: contacts?.filter(c => normalizeStage(c.fields.Lead_Stage) === s.key).length ?? 0,
  }));

  const filtered = (contacts ?? []).filter(c => {
    const f = c.fields;
    const q = search.toLowerCase();
    const matchSearch = !q || [f.Name, f.Email, f.Org_Name, f.phone_normalized]
      .some(v => v?.toLowerCase().includes(q));
    const matchType  = typeFilter  === 'all' || resolveContactTypeKey(f.Contact_Type) === typeFilter;
    const matchStage = stageFilter === 'all' || normalizeStage(f.Lead_Stage) === stageFilter;
    return matchSearch && matchType && matchStage;
  });

  // data_source_date 없으면 Notes에서 가장 최근 날짜 추출
  const latestActivity = (fields: ContactFields): string => {
    if (fields.data_source_date) return fields.data_source_date;
    if (!fields.Notes) return '';
    const dates = [...fields.Notes.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);
    return dates.length ? dates.sort().at(-1)! : '';
  };

  const fieldKey: Record<string, (c: AirtableRecord<ContactFields>) => string> = {
    Name:    c => c.fields.Name    ?? '',
    Org:     c => c.fields.Org_Name ?? '',
    Phone:   c => c.fields.phone_normalized ?? '',
    Stage:   c => normalizeStage(c.fields.Lead_Stage),
    Date:    c => latestActivity(c.fields),
  };
  const sorted = [...filtered].sort((a, b) => {
    const fn = fieldKey[sortField];
    if (!fn) return 0;
    const va = fn(a).trim();
    const vb = fn(b).trim();
    if (!va && !vb) return 0;
    if (!va) return 1;   // 빈 값은 항상 맨 아래
    if (!vb) return -1;
    const cmp = va.localeCompare(vb, 'ko');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (isLoading) return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">고객</h1>
      <DataTableSkeleton columns={6} />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">고객</h1>
          <p className="text-sm text-muted-foreground mt-0.5">총 {contacts?.length ?? 0}명</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />고객 추가
          </Button>
        )}
      </div>
      <AddContactDialog open={addOpen} onClose={() => setAddOpen(false)} />

      {/* ── 가로 퍼널 ── */}
      <div className="surface-card ring-container p-4">
        <p className="text-xs text-muted-foreground mb-3 font-medium">리드 퍼널</p>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setStageFilter('all')}
            className={`flex-shrink-0 flex flex-col items-center rounded-lg px-3 py-2 min-w-[64px] transition-colors
              ${stageFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
          >
            <span className="text-lg font-bold">{contacts?.length ?? 0}</span>
            <span className="text-[10px] mt-0.5">전체</span>
          </button>

          {stageCounts.map((s) => (
            <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
              <button
                onClick={() => setStageFilter(stageFilter === s.key ? 'all' : s.key)}
                className={`flex flex-col items-center rounded-lg px-3 py-2 min-w-[72px] transition-colors border
                  ${stageFilter === s.key
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : 'border-transparent hover:border-border bg-muted/50'}`}
              >
                <span className={`text-lg font-bold ${s.count === 0 ? 'text-muted-foreground/40' : ''}`}>
                  {s.count}
                </span>
                <span className={`text-[10px] mt-0.5 text-center leading-tight whitespace-nowrap
                  ${stageFilter === s.key ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {s.key}
                </span>
              </button>
            </div>
          ))}

          <div className="flex items-center gap-1 flex-shrink-0 ml-2 pl-2 border-l border-border">
            {['미활성', '이탈'].map(stage => {
              const cnt = (contacts ?? []).filter(c => normalizeStage(c.fields.Lead_Stage) === stage).length;
              return (
                <button
                  key={stage}
                  onClick={() => setStageFilter(stageFilter === stage ? 'all' : stage)}
                  className={`flex flex-col items-center rounded-lg px-3 py-2 min-w-[56px] transition-colors border
                    ${stageFilter === stage
                      ? 'border-primary ring-1 ring-primary bg-primary/5'
                      : 'border-transparent hover:border-border bg-muted/30'}`}
                >
                  <span className="text-lg font-bold text-muted-foreground">{cnt}</span>
                  <span className="text-[10px] mt-0.5 text-muted-foreground">{stage}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 필터 바 ── */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="이름, 소속, 전화번호 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 w-64 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-32 h-8 text-sm"><SelectValue placeholder="전체 유형" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 유형</SelectItem>
            {CONTACT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {stageFilter !== 'all' && (
          <button
            onClick={() => setStageFilter('all')}
            className="h-8 px-3 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20"
          >
            스테이지: {stageFilter} ✕
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground self-center">
          {sorted.length}명 표시
        </span>
      </div>

      {/* ── 일괄 변경 바 ── */}
      {canEdit && checkedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm">
          <span className="text-xs font-medium text-primary">{checkedIds.size}명 선택됨</span>
          <Select value={bulkType} onValueChange={setBulkType}>
            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="유형 변경" /></SelectTrigger>
            <SelectContent>
              {CONTACT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bulkStage} onValueChange={setBulkStage}>
            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue placeholder="스테이지 변경" /></SelectTrigger>
            <SelectContent>
              {ALL_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={handleBulkUpdate}
            disabled={updateContact.isPending || (!bulkType && !bulkStage)}
            className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-40 hover:bg-primary/90"
          >
            적용
          </button>
          <button onClick={() => setCheckedIds(new Set())} className="h-7 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted">
            취소
          </button>
        </div>
      )}

      {/* ── 테이블 ── */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted/60 backdrop-blur">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" className="rounded"
                    checked={sorted.length > 0 && checkedIds.size === sorted.length}
                    onChange={toggleAll}
                    onClick={e => e.stopPropagation()}
                  />
                </th>
                {([
                  { label: '이름',     field: 'Name'  },
                  { label: '교육청',   field: null    },
                  { label: '소속',     field: 'Org'   },
                  { label: '전화',     field: 'Phone' },
                  { label: '이메일',   field: null    },
                  { label: '유형',     field: null    },
                  { label: '스테이지', field: 'Stage' },
                  { label: '최근활동', field: 'Date'  },
                ] as { label: string; field: string | null }[]).map(({ label, field }) => (
                  <th
                    key={label}
                    onClick={() => field && handleSort(field)}
                    style={{ width: colW[label] }}
                    className={`relative px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap select-none
                      ${field ? 'cursor-pointer hover:text-foreground' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {field && (
                        sortField === field
                          ? sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          : <ChevronsUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </span>
                    <div
                      onMouseDown={e => startResize(label, e)}
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 z-10"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : sorted.map(c => (
                <tr
                  key={c.id}
                  onClick={() => openContact(c)}
                  className={`border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors ${checkedIds.has(c.id) ? 'bg-primary/5' : ''}`}
                >
                  <td className="px-3 py-1.5 w-8" onClick={e => toggleCheck(c.id, e)}>
                    <input type="checkbox" className="rounded pointer-events-none"
                      checked={checkedIds.has(c.id)} readOnly />
                  </td>
                  <td className="px-3 py-1.5 font-medium text-xs truncate overflow-hidden">{c.fields.Name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs truncate overflow-hidden">{c.fields.Education_Office}</td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs truncate overflow-hidden">{c.fields.Org_Name}</td>
                  <td className="px-3 py-1.5 tabular-nums text-xs truncate overflow-hidden">{c.fields.phone_normalized || c.fields.Phone}</td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs truncate overflow-hidden">{c.fields.Email}</td>
                  <td className="px-3 py-1.5"><TypeBadge type={c.fields.Contact_Type} /></td>
                  <td className="px-3 py-1.5"><StageBadge stage={c.fields.Lead_Stage} /></td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{latestActivity(c.fields)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 상세 Sheet ── */}
      <Sheet open={!!selected} onOpenChange={closeSheet}>
        <SheetContent className="overflow-y-auto w-[440px] sm:w-[500px]">
          {selected && (
            <>
              <SheetHeader className="pb-3 border-b border-border">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <SheetTitle className="text-lg">{selected.fields.Name}</SheetTitle>
                    <div className="flex gap-2 mt-1.5">
                      <TypeBadge type={selected.fields.Contact_Type} />
                      <StageBadge stage={selected.fields.Lead_Stage} />
                    </div>
                  </div>
                  {/* 편집/삭제 버튼 */}
                  {canEdit && !editMode && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setEditMode(true); setDeleteConfirm(false); }}
                        className="p-1.5 rounded-md hover:bg-muted transition-colors"
                        title="편집"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </button>
                      {!deleteConfirm ? (
                        <button
                          onClick={() => setDeleteConfirm(true)}
                          className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-destructive">삭제?</span>
                          <button
                            onClick={handleDelete}
                            disabled={deleteContact.isPending}
                            className="p-1.5 rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(false)}
                            className="p-1.5 rounded-md hover:bg-muted"
                          >
                            <X className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </SheetHeader>

              {editMode ? (
                <ContactEditForm
                  contact={selected}
                  onCancel={() => setEditMode(false)}
                  onSaved={(updated) => {
                    setSelected(updated);
                    setEditMode(false);
                  }}
                />
              ) : (
                <div className="mt-4 space-y-5">

                  {/* 연락처 */}
                  {(selected.fields.phone_normalized || selected.fields.Phone || selected.fields.Email) && (
                    <section className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">연락처</p>
                      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
                        {(selected.fields.phone_normalized || selected.fields.Phone) && (
                          <a href={`tel:${selected.fields.phone_normalized || selected.fields.Phone}`}
                            className="flex items-center gap-2 text-sm hover:text-primary">
                            <span className="text-xs text-muted-foreground w-14 flex-shrink-0">전화</span>
                            {selected.fields.phone_normalized || selected.fields.Phone}
                          </a>
                        )}
                        {selected.fields.Email && (
                          <a href={`mailto:${selected.fields.Email}`}
                            className="flex items-center gap-2 text-sm hover:text-primary">
                            <span className="text-xs text-muted-foreground w-14 flex-shrink-0">이메일</span>
                            {selected.fields.Email}
                          </a>
                        )}
                      </div>
                    </section>
                  )}

                  {/* 소속 학교 */}
                  {selected.fields.Org_Name && (
                    <section className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">소속 학교</p>
                      <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 space-y-1.5 text-sm">
                        <p className="font-medium">{selected.fields.Org_Name}</p>
                        {(selected.fields.Education_Office || selected.fields.Org_Address || selected.fields.Org_Tel || selected.fields.Org_Homepage) ? (
                          <div className="space-y-1 text-xs text-muted-foreground mt-1">
                            {selected.fields.Education_Office && (
                              <div className="flex gap-2"><span className="w-14 flex-shrink-0">교육청</span><span className="text-foreground">{selected.fields.Education_Office}</span></div>
                            )}
                            {selected.fields.Org_Address && (
                              <div className="flex gap-2"><span className="w-14 flex-shrink-0">주소</span><span>{selected.fields.Org_ZipCode && `[${selected.fields.Org_ZipCode.trim()}] `}{selected.fields.Org_Address}</span></div>
                            )}
                            {selected.fields.Org_Tel && (
                              <div className="flex gap-2"><span className="w-14 flex-shrink-0">학교 전화</span><a href={`tel:${selected.fields.Org_Tel}`} className="hover:text-primary">{selected.fields.Org_Tel}</a></div>
                            )}
                            {selected.fields.Org_Homepage && (
                              <div className="flex gap-2"><span className="w-14 flex-shrink-0">홈페이지</span><a href={selected.fields.Org_Homepage} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{selected.fields.Org_Homepage}</a></div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-0.5">학교 검색으로 상세 정보를 추가하세요</p>
                        )}
                      </div>
                    </section>
                  )}

                  {/* 기타 정보 */}
                  {(selected.fields.Lead_Source || selected.fields.data_source_date) && (
                    <section className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">기타</p>
                      <div className="space-y-1">
                        {[
                          { label: '유입경로', value: selected.fields.Lead_Source },
                          { label: '최근활동', value: selected.fields.data_source_date },
                        ].filter(r => r.value).map(({ label, value }) => (
                          <div key={label} className="flex gap-3">
                            <span className="text-xs text-muted-foreground w-16 flex-shrink-0 pt-0.5">{label}</span>
                            <span className="text-sm">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}


                  {/* 스테이지 빠른 변경 */}
                  <section>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">스테이지 변경</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_STAGES.map(s => (
                        <button
                          key={s}
                          onClick={() => handleStageChange(s)}
                          disabled={updateContact.isPending}
                          className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                            selected.fields.Lead_Stage === s
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border hover:border-primary/60 disabled:opacity-50'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* 이용권 현황 */}
                  {licenses.length > 0 && (
                    <section>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Key className="h-3 w-3" />이용권 현황
                      </p>
                      <div className="space-y-2">
                        {licenses.map(lic => {
                          const today = new Date().toISOString().split('T')[0];
                          const status = lic.status === '이탈' ? '이탈'
                            : lic.status === '대기' ? '대기'
                            : lic.service_expire_at && lic.service_expire_at < today ? '만료'
                            : lic.status;
                          return (
                            <div key={lic.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 bg-teal-100 text-teal-700">구매</span>
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${STATUS_COLOR[status] ?? 'bg-slate-100 text-slate-600'}`}>
                                    {status}
                                  </span>
                                  <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">{lic.coupon_code || '-'}</span>
                                  <span className="text-sm font-medium truncate">{lic.org_name || '-'}</span>
                                </div>
                                <a href={`/deals?id=${lic.deal_id}`}
                                  className="text-xs text-primary hover:underline shrink-0">딜 보기</a>
                              </div>
                              <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                                {lic.duration && <span>{lic.duration}개월</span>}
                                {lic.user_count && <span>{lic.user_count}명</span>}
                                {lic.service_expire_at
                                  ? <span className={lic.service_expire_at < today ? 'text-orange-500 font-medium' : ''}>
                                      만료일 {lic.service_expire_at}{lic.service_expire_at < today ? ' (만료)' : ''}
                                    </span>
                                  : <span>만료일 미등록</span>}
                                <span className="text-muted-foreground/50">{lic.created_at.slice(0, 10)} 발급</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* 활동 이력 (Notes + mDiary 인라인) */}
                  {(selected.fields.Notes || mDiaryCoupons.length > 0) && (() => {
                    // 활동이력 날짜별로 mDiary 쿠폰 매칭 (±14일)
                    const matchedIds = new Set<number>();
                    const getCouponsNear = (actDate: string) => mDiaryCoupons.filter(c => {
                      const diff = Math.abs(new Date(c.created_at).getTime() - new Date(actDate).getTime());
                      if (diff <= 14 * 86400000) { matchedIds.add(c.id); return true; }
                      return false;
                    });
                    const renderCouponBadge = (c: MDiaryCoupon) => (
                      <div key={c.id} className={`ml-5 mt-1 rounded-lg border px-2.5 py-2 text-xs ${c.link_confirmed === true ? 'border-teal-200 bg-teal-50/40' : 'border-amber-200 bg-amber-50/30'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                            <span className="text-muted-foreground/50 text-[10px]">└ 체험권</span>
                            {c.link_confirmed === true
                              ? <span className="text-teal-600 font-medium flex items-center gap-0.5"><Check className="h-3 w-3" />확인됨</span>
                              : <span className="text-amber-600 font-medium">동명이인 확인 필요</span>}
                            <span className={`rounded-full px-1.5 py-0.5 font-medium ${c.is_used ? 'bg-teal-100 text-teal-700' : 'bg-orange-100 text-orange-700'}`}>
                              {c.is_used ? '사용함' : '미사용'}
                            </span>
                            <span className="font-mono bg-muted px-1 py-0.5 rounded">{c.coupon_code}</span>
                            <span className="text-muted-foreground/70">{c.created_at.slice(0, 10)} 발급 · {c.duration}개월 · {c.user_limit}명</span>
                          </div>
                          {c.link_confirmed === null && (
                            <div className="flex gap-1 shrink-0">
                              <button onClick={async () => {
                                await confirmCouponLink(c.id, selected.id);
                                setMDiaryCoupons(prev => prev.map(x => x.id === c.id ? { ...x, link_confirmed: true, linked_contact_id: selected.id } : x));
                                toast.success('이력 확인됨');
                              }} className="rounded px-1.5 py-0.5 bg-teal-100 text-teal-700 hover:bg-teal-200 font-medium">맞음</button>
                              <button onClick={async () => {
                                await rejectCouponLink(c.id);
                                setMDiaryCoupons(prev => prev.filter(x => x.id !== c.id));
                                toast.success('다른 분으로 처리됨');
                              }} className="rounded px-1.5 py-0.5 bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-600 font-medium">아님</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );

                    const noteLines = (selected.fields.Notes ?? '').split('\n').filter(Boolean);
                    return (
                      <section>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">활동 이력</p>
                        <div className="space-y-1 bg-muted/30 rounded-lg p-3">
                          {noteLines.map((line, i) => {
                            const clean = line.replace(/\s*·rec\w+/, '');
                            const dateMatch = clean.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*/);
                            const actDate = dateMatch?.[1];
                            const near = actDate ? getCouponsNear(actDate) : [];
                            return (
                              <div key={i} className="space-y-1">
                                <div className="flex gap-2 text-sm">
                                  {dateMatch
                                    ? <><span className="text-xs font-mono text-primary flex-shrink-0 pt-0.5">{actDate}</span>
                                        <span className="text-muted-foreground">{clean.replace(dateMatch[0], '')}</span></>
                                    : <span className="text-muted-foreground">{clean}</span>}
                                </div>
                                {near.map(renderCouponBadge)}
                              </div>
                            );
                          })}
                          {/* 활동이력과 매칭 안 된 mDiary 쿠폰 (날짜 미기재 or 14일 초과) */}
                          {mDiaryCoupons.filter(c => !matchedIds.has(c.id)).length > 0 && (
                            <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                              <p className="text-[10px] text-muted-foreground/60">활동이력 미매칭 체험권</p>
                              {mDiaryCoupons.filter(c => !matchedIds.has(c.id)).map(renderCouponBadge)}
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
