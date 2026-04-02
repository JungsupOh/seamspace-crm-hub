import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDeals } from '@/hooks/use-airtable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, TrendingUp, Pencil, Trash2, Link2, Loader2 } from 'lucide-react';
import { getPartnerDeals, createPartnerDeal, updatePartnerDeal, deletePartnerDeal, calcCommission } from '@/lib/partner-deals';
import type { PartnerDeal } from '@/lib/partner-deals';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface PartnerInfo {
  id: string;
  name: string;
  commission_rate: number;
  contact_name: string | null;
  contact_email: string | null;
}

export default function PartnerPortal() {
  const { userProfile } = useAuth();
  const { data: allDeals } = useDeals();
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [deals, setDeals] = useState<PartnerDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PartnerDeal>>({});
  const [adding, setAdding] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState<Partial<PartnerDeal>>({});
  const [periodFilter, setPeriodFilter] = useState('this_month');

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
    getPartnerDeals(partner.id).then(setDeals).catch(() => setDeals([])).finally(() => setLoading(false));
  }, [partner?.id]);

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
    setAddDialogOpen(true);
  };

  const handleAddSubmit = async () => {
    if (!partner) return;
    setAdding(true);
    try {
      const seq = deals.length + 1;
      const { commission, settlement } = calcCommission(addForm.payment_amount ?? 0, commissionRate);
      const created = await createPartnerDeal({
        partner_id: partner.id,
        seq_number: seq,
        contract_date: addForm.contract_date || null,
        school_name: addForm.school_name || null,
        buyer_name: addForm.buyer_name || null,
        buyer_phone: addForm.buyer_phone || null,
        plan_name: addForm.plan_name || null,
        quantity: addForm.quantity ?? 1,
        payment_amount: addForm.payment_amount ?? 0,
        commission_amount: commission,
        settlement_amount: settlement,
        remarks: addForm.remarks || null,
      });
      setDeals(prev => [...prev, created]);
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
    } catch { toast.error('삭제 실패'); }
  };

  const ef = (k: keyof PartnerDeal) => (editForm[k] as string) ?? '';
  const efn = (k: keyof PartnerDeal) => editForm[k] as number | undefined;
  const eset = (k: keyof PartnerDeal, v: unknown) => setEditForm(prev => ({ ...prev, [k]: v }));

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
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.buyer_name || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.buyer_phone || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.plan_name || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-center">{d.quantity || '-'}</td>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>새 딜 추가</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label className="text-xs">계약일</Label>
              <Input type="date" value={(addForm.contract_date as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, contract_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">학교명</Label>
              <Input value={(addForm.school_name as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, school_name: e.target.value }))} placeholder="학교명" className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">구매자</Label>
                <Input value={(addForm.buyer_name as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, buyer_name: e.target.value }))} placeholder="구매자" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">연락처</Label>
                <Input value={(addForm.buyer_phone as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, buyer_phone: e.target.value }))} placeholder="010-0000-0000" className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">플랜</Label>
                <Input value={(addForm.plan_name as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, plan_name: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">수량</Label>
                <Input type="number" value={addForm.quantity ?? ''} onChange={e => setAddForm(p => ({ ...p, quantity: parseInt(e.target.value) || 1 }))} className="h-8 text-sm" />
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
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>취소</Button>
              <Button size="sm" onClick={handleAddSubmit} disabled={adding}>
                {adding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                추가
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
