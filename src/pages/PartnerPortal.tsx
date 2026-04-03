import { useState, useEffect, useRef, useCallback } from 'react';
import { formatPhone } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useDeals } from '@/hooks/use-airtable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Loader2, Search, X, Users } from 'lucide-react';
import { getPartnerDeals, createPartnerDeal, updatePartnerDeal, deletePartnerDeal, calcCommission, createDealBuyers, getDealBuyers } from '@/lib/partner-deals';
import type { PartnerDeal, PartnerDealBuyer } from '@/lib/partner-deals';
import { searchSchools, type SchoolInfo } from '@/lib/neis';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface PartnerInfo {
  id: string;
  name: string;
  commission_rate: number;
  contact_name: string | null;
  contact_email: string | null;
}

interface BuyerInput {
  buyer_name: string;
  buyer_phone: string;
  buyer_email: string;
  student_count: number;
  month_count: number | '';
  plan_name: string;
}

const emptyBuyer = (): BuyerInput => ({
  buyer_name: '', buyer_phone: '', buyer_email: '',
  student_count: 40, month_count: '', plan_name: '학급별',
});

export default function PartnerPortal() {
  const { userProfile } = useAuth();
  const { data: allDeals } = useDeals();
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [deals, setDeals] = useState<PartnerDeal[]>([]);
  const [dealBuyersMap, setDealBuyersMap] = useState<Record<string, PartnerDealBuyer[]>>({});
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PartnerDeal>>({});
  const [adding, setAdding] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState<Partial<PartnerDeal>>({});
  const [buyers, setBuyers] = useState<BuyerInput[]>([emptyBuyer()]);
  const [periodFilter, setPeriodFilter] = useState('this_month');

  // 학교 검색
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolResults, setSchoolResults] = useState<SchoolInfo[]>([]);
  const [schoolSearching, setSchoolSearching] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const schoolRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // 파트너 정보 로드
  useEffect(() => {
    if (!userProfile?.partner_id) return;
    fetch(`${SUPABASE_URL}/rest/v1/partners?id=eq.${userProfile.partner_id}&select=id,name,commission_rate,contact_name,contact_email`, {
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    })
      .then(r => r.json())
      .then(rows => { if (rows[0]) setPartner(rows[0]); })
      .catch(() => {});
  }, [userProfile?.partner_id]);

  // 파트너 딜 로드
  useEffect(() => {
    if (!partner?.id) return;
    setLoading(true);
    getPartnerDeals(partner.id)
      .then(async (dealList) => {
        setDeals(dealList);
        // 각 딜의 구매자 로드
        const buyersMap: Record<string, PartnerDealBuyer[]> = {};
        await Promise.all(dealList.map(async d => {
          const b = await getDealBuyers(d.id);
          if (b.length > 0) buyersMap[d.id] = b;
        }));
        setDealBuyersMap(buyersMap);
      })
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [partner?.id]);

  // 학교 검색 (디바운스)
  const handleSchoolSearch = useCallback((query: string) => {
    setSchoolQuery(query);
    setAddForm(p => ({ ...p, school_name: query }));
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) {
      setSchoolResults([]);
      setShowSchoolDropdown(false);
      return;
    }
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

  const selectSchool = (school: SchoolInfo) => {
    setSchoolQuery(school.name);
    setAddForm(p => ({ ...p, school_name: school.name }));
    setShowSchoolDropdown(false);
  };

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (schoolRef.current && !schoolRef.current.contains(e.target as Node)) {
        setShowSchoolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 기간 필터
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');

  const getRange = (): { from: string; to: string; label: string } => {
    switch (periodFilter) {
      case 'this_month': { const ym = `${yyyy}-${pad(mm + 1)}`; return { from: `${ym}-01`, to: `${ym}-31`, label: `${ym} 실적` }; }
      case 'last_month': { const d = new Date(yyyy, mm - 1, 1); const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; return { from: `${ym}-01`, to: `${ym}-31`, label: `${ym} 실적` }; }
      case 'this_year': return { from: `${yyyy}-01-01`, to: `${yyyy}-12-31`, label: `${yyyy}년 실적` };
      default: return { from: '2000-01-01', to: '2099-12-31', label: '전체 실적' };
    }
  };
  const { from: pFrom, to: pTo, label: pLabel } = getRange();
  const filteredDeals = deals.filter(d => {
    if (periodFilter === 'all') return true;
    const date = d.contract_date ?? '';
    return date >= pFrom && date <= pTo;
  });

  const totalPayment = filteredDeals.reduce((s, d) => s + (d.payment_amount ?? 0), 0);
  const totalCommission = filteredDeals.reduce((s, d) => s + (d.commission_amount ?? 0), 0);
  const totalSettlement = filteredDeals.reduce((s, d) => s + (d.settlement_amount ?? 0), 0);

  const commissionRate = partner?.commission_rate ?? 15;

  const handleOpenAddDialog = () => {
    setAddForm({ quantity: 1 });
    setBuyers([emptyBuyer()]);
    setSchoolQuery('');
    setSchoolResults([]);
    setShowSchoolDropdown(false);
    setAddDialogOpen(true);
  };

  const handleAddSubmit = async () => {
    if (!partner) return;
    // 구매자 최소 1명 이름 필수
    const validBuyers = buyers.filter(b => b.buyer_name.trim());
    if (validBuyers.length === 0) {
      toast.error('구매자를 최소 1명 입력해주세요');
      return;
    }
    setAdding(true);
    try {
      const seq = deals.length + 1;
      const { commission, settlement } = calcCommission(addForm.payment_amount ?? 0, commissionRate);
      // 첫 번째 구매자를 딜의 대표 구매자로 저장 (하위 호환)
      const firstBuyer = validBuyers[0];
      const created = await createPartnerDeal({
        partner_id: partner.id,
        seq_number: seq,
        contract_date: addForm.contract_date || null,
        school_name: addForm.school_name || null,
        buyer_name: firstBuyer.buyer_name || null,
        buyer_phone: firstBuyer.buyer_phone || null,
        buyer_email: firstBuyer.buyer_email || null,
        plan_name: addForm.plan_name || null,
        quantity: validBuyers.length,
        payment_amount: addForm.payment_amount ?? 0,
        commission_amount: commission,
        settlement_amount: settlement,
        remarks: addForm.remarks || null,
      });
      // 구매자 레코드 생성
      const createdBuyers = await createDealBuyers(created.id, validBuyers.map(b => ({
        buyer_name: b.buyer_name || undefined,
        buyer_phone: b.buyer_phone || undefined,
        buyer_email: b.buyer_email || undefined,
        student_count: b.student_count,
        month_count: b.month_count === '' ? undefined : b.month_count,
        plan_name: b.plan_name || undefined,
        quantity: 1,
      })));
      setDeals(prev => [...prev, created]);
      setDealBuyersMap(prev => ({ ...prev, [created.id]: createdBuyers }));
      setAddDialogOpen(false);
      toast.success('딜이 추가되었습니다');
    } catch { toast.error('추가 실패'); }
    finally { setAdding(false); }
  };

  const handleSave = async (id: string) => {
    try {
      const { commission, settlement } = calcCommission(editForm.payment_amount ?? 0, commissionRate);
      const updates = { ...editForm, commission_amount: commission, settlement_amount: settlement };
      await updatePartnerDeal(id, updates);
      setDeals(prev => prev.map(d => d.id === id ? { ...d, ...updates } as PartnerDeal : d));
      setEditingId(null);
      toast.success('저장됨');
    } catch { toast.error('저장 실패'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePartnerDeal(id);
      setDeals(prev => prev.filter(d => d.id !== id));
      setDealBuyersMap(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch { toast.error('삭제 실패'); }
  };

  const ef = (k: keyof PartnerDeal) => (editForm[k] as string) ?? '';
  const efn = (k: keyof PartnerDeal) => editForm[k] as number | undefined;
  const eset = (k: keyof PartnerDeal, v: unknown) => setEditForm(prev => ({ ...prev, [k]: v }));

  // 구매자 입력 핸들러
  const updateBuyer = (idx: number, field: keyof BuyerInput, value: string | number) => {
    setBuyers(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  };
  const addBuyer = () => setBuyers(prev => [...prev, emptyBuyer()]);
  const removeBuyer = (idx: number) => {
    if (buyers.length <= 1) return;
    setBuyers(prev => prev.filter((_, i) => i !== idx));
  };

  if (!userProfile?.partner_id) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">파트너 계정이 연결되어 있지 않습니다. 관리자에게 문의하세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-semibold">{partner?.name ?? '파트너'} 포털</h1>
        <p className="text-sm text-muted-foreground mt-0.5">수수료율 {commissionRate}% · 전체 {deals.length}건</p>
      </div>

      {/* 기간 필터 */}
      <div className="flex items-center gap-1.5">
        {([
          { id: 'this_month', label: '이번달' },
          { id: 'last_month', label: '지난달' },
          { id: 'this_year', label: '올해' },
          { id: 'all', label: '전체' },
        ] as const).map(({ id, label }) => (
          <button key={id} onClick={() => setPeriodFilter(id)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors
              ${periodFilter === id ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 실적 요약 */}
      <div className="surface-card ring-container p-4">
        <p className="text-xs text-muted-foreground font-medium mb-3">{pLabel}</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-2xl font-bold tabular-nums">{totalPayment.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">매출 (결제금액)</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-amber-600">{totalCommission.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">수수료</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-teal-700">{totalSettlement.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">원</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">정산금액</p>
          </div>
        </div>
      </div>

      {/* 딜 추가 버튼 */}
      <div className="flex justify-end">
        <Button size="sm" onClick={handleOpenAddDialog} disabled={adding}>
          <Plus className="h-4 w-4 mr-1.5" />딜 추가
        </Button>
      </div>

      {/* 딜 테이블 */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground w-8">#</th>
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
              {loading ? (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">로딩 중...</td></tr>
              ) : filteredDeals.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">등록된 딜이 없습니다.</td></tr>
              ) : filteredDeals.map((d, idx) => {
                const isEditing = editingId === d.id;
                const dbBuyers = dealBuyersMap[d.id] ?? [];
                const buyerCount = dbBuyers.length || 1;
                const buyerDisplay = dbBuyers.length > 1
                  ? `${d.buyer_name} 외 ${dbBuyers.length - 1}명`
                  : d.buyer_name || '-';
                const phoneDisplay = dbBuyers.length > 1
                  ? `${d.buyer_phone ?? ''} ...`
                  : d.buyer_phone || '-';

                if (isEditing) {
                  return (
                    <tr key={d.id} className="bg-primary/5">
                      <td className="px-3 py-2 text-muted-foreground text-xs">{idx + 1}</td>
                      <td className="px-3 py-2"><input type="date" value={ef('contract_date')} onChange={e => eset('contract_date', e.target.value)} className="h-7 text-xs border rounded px-1.5 w-32" /></td>
                      <td className="px-3 py-2"><input value={ef('school_name')} onChange={e => eset('school_name', e.target.value)} className="h-7 text-xs border rounded px-1.5 w-full" placeholder="학교명" /></td>
                      <td className="px-3 py-2"><input value={ef('buyer_name')} onChange={e => eset('buyer_name', e.target.value)} className="h-7 text-xs border rounded px-1.5 w-full" placeholder="구매자" /></td>
                      <td className="px-3 py-2"><input value={ef('buyer_phone')} onChange={e => eset('buyer_phone', e.target.value)} className="h-7 text-xs border rounded px-1.5 w-28" placeholder="연락처" /></td>
                      <td className="px-3 py-2"><input value={ef('plan_name')} onChange={e => eset('plan_name', e.target.value)} className="h-7 text-xs border rounded px-1.5 w-16" /></td>
                      <td className="px-3 py-2"><input type="number" value={efn('quantity') ?? ''} onChange={e => eset('quantity', parseInt(e.target.value) || 1)} className="h-7 text-xs border rounded px-1.5 w-12 text-center" /></td>
                      <td className="px-3 py-2"><input type="number" value={efn('payment_amount') ?? ''} onChange={e => eset('payment_amount', parseInt(e.target.value) || 0)} className="h-7 text-xs border rounded px-1.5 w-24 text-right" /></td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">{calcCommission(efn('payment_amount') ?? 0, commissionRate).commission.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">{calcCommission(efn('payment_amount') ?? 0, commissionRate).settlement.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.license_issue_date || '-'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.deposit_date || '-'}</td>
                      <td className="px-3 py-2"><input value={ef('remarks')} onChange={e => eset('remarks', e.target.value)} className="h-7 text-xs border rounded px-1.5 w-full" /></td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button onClick={() => handleSave(d.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground">저장</button>
                          <button onClick={() => setEditingId(null)} className="text-[10px] px-1 py-0.5 rounded border border-border">취소</button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={d.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{d.contract_date || '-'}</td>
                    <td className="px-3 py-2.5 text-xs font-medium">{d.school_name || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        {buyerDisplay}
                        {dbBuyers.length > 1 && <Users className="h-3 w-3 text-primary/60" />}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{phoneDisplay}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.plan_name || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-center">{buyerCount}</td>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums font-medium">{(d.payment_amount ?? 0) > 0 ? d.payment_amount!.toLocaleString() : '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums text-amber-600">{(d.commission_amount ?? 0) > 0 ? d.commission_amount!.toLocaleString() : '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-right tabular-nums text-teal-700">{(d.settlement_amount ?? 0) > 0 ? d.settlement_amount!.toLocaleString() : '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.license_issue_date || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.deposit_date || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground truncate max-w-[100px]">{d.remarks || '-'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingId(d.id); setEditForm(d); }}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(d.id)}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 딜 추가 모달 */}
      <Dialog open={addDialogOpen} onOpenChange={open => { if (!open) setAddDialogOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>새 딜 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2 overflow-y-auto flex-1">
            {/* 계약일 */}
            <div>
              <Label className="text-xs">계약일</Label>
              <Input type="date" value={(addForm.contract_date as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, contract_date: e.target.value }))} className="h-8 text-sm" />
            </div>

            {/* 학교 검색 */}
            <div ref={schoolRef} className="relative">
              <Label className="text-xs">학교명</Label>
              <div className="relative">
                <Input
                  value={schoolQuery}
                  onChange={e => handleSchoolSearch(e.target.value)}
                  onFocus={() => { if (schoolResults.length > 0) setShowSchoolDropdown(true); }}
                  placeholder="학교명을 입력하세요"
                  className="h-8 text-sm pr-8"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  {schoolSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Search className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </div>
              {showSchoolDropdown && schoolResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {schoolResults.map((s, i) => (
                    <button key={i} onClick={() => selectSchool(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{s.kind} · {s.eduOffice}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 구매자 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  구매자 ({buyers.length}명)
                </Label>
                <button onClick={addBuyer} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" />추가
                </button>
              </div>
              <div className="space-y-2">
                {buyers.map((b, idx) => (
                  <div key={idx} className="border border-border rounded-md p-2.5 bg-muted/30 relative">
                    {buyers.length > 1 && (
                      <button onClick={() => removeBuyer(idx)}
                        className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 mb-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground">이름 *</span>
                        <Input value={b.buyer_name} onChange={e => updateBuyer(idx, 'buyer_name', e.target.value)} placeholder="홍길동" className="h-7 text-xs" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">연락처</span>
                        <Input value={b.buyer_phone} onChange={e => updateBuyer(idx, 'buyer_phone', formatPhone(e.target.value))} placeholder="010-0000-0000" className="h-7 text-xs" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">이메일</span>
                        <Input value={b.buyer_email} onChange={e => updateBuyer(idx, 'buyer_email', e.target.value)} placeholder="email@example.com" className="h-7 text-xs" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground">학생 수</span>
                        <Input type="number" value={b.student_count} onChange={e => updateBuyer(idx, 'student_count', parseInt(e.target.value) || 0)} className="h-7 text-xs" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">개월 수</span>
                        <Input type="number" value={b.month_count} onChange={e => updateBuyer(idx, 'month_count', parseInt(e.target.value) || '')} placeholder="12" className="h-7 text-xs" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">플랜</span>
                        <Input value={b.plan_name} onChange={e => updateBuyer(idx, 'plan_name', e.target.value)} className="h-7 text-xs" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 결제 정보 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">플랜</Label>
                <Input value={(addForm.plan_name as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, plan_name: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">결제금액</Label>
                <Input type="number" value={addForm.payment_amount ?? ''} onChange={e => setAddForm(p => ({ ...p, payment_amount: parseInt(e.target.value) || 0 }))} className="h-8 text-sm" />
              </div>
            </div>
            {(addForm.payment_amount ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
                수수료 {calcCommission(addForm.payment_amount ?? 0, commissionRate).commission.toLocaleString()}원 / 정산 {calcCommission(addForm.payment_amount ?? 0, commissionRate).settlement.toLocaleString()}원
              </div>
            )}
            <div>
              <Label className="text-xs">비고</Label>
              <Input value={(addForm.remarks as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, remarks: e.target.value }))} className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>취소</Button>
            <Button size="sm" onClick={handleAddSubmit} disabled={adding}>
              {adding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              추가
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
