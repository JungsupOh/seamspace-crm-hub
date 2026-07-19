import { useState, useEffect, useRef, useCallback } from 'react';
import { formatPhone } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useDeals } from '@/hooks/use-airtable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Loader2, Search, X, Users, Package, Ticket, Copy, Send } from 'lucide-react';
import { getPartnerDeals, createPartnerDeal, updatePartnerDeal, deletePartnerDeal, calcCommission, createDealBuyers, getDealBuyers, deleteDealBuyers } from '@/lib/partner-deals';
import { notifyPartnerDeal } from '@/lib/telegram';
import type { PartnerDeal, PartnerDealBuyer } from '@/lib/partner-deals';
import { searchSchools, type SchoolInfo } from '@/lib/neis';
import { PARTNER_PLAN_LIST, DURATION_OPTIONS, getUnitPrice } from '@/lib/pricing';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AmountInput } from '@/components/AmountInput';
import { makeT, formatMoney, currencyUnit, formatIntlPhone } from '@/lib/partner-i18n';
import { issueLicense, getPartnerLicenses, resendLicenseEmail, type PartnerLicense } from '@/lib/partner-licenses';

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
}

const emptyBuyer = (): BuyerInput => ({
  buyer_name: '', buyer_phone: '', buyer_email: '',
  student_count: 40, month_count: '',
});

interface ItemInput {
  plan: string;
  duration: number;
  qty: number;
  unit_price: number;
  amount: number;
}

// ko: 기존 학급플랜/자동단가. intl: 자유입력 플랜 + 수동 단가.
const emptyItem = (intl = false): ItemInput => intl
  ? { plan: '', duration: 12, qty: 1, unit_price: 0, amount: 0 }
  : { plan: '학급플랜', duration: 4, qty: 1, unit_price: getUnitPrice('학급플랜', 4), amount: getUnitPrice('학급플랜', 4) };

interface IssueForm {
  partnerDealId: string;
  customerName: string;
  contactEmail: string;
  contactPhone: string;
  orgName: string;
  plan: string;
  duration: number;
  userCount: number;
  amount: number | '';
}
const emptyIssueForm = (): IssueForm => ({
  partnerDealId: '', customerName: '', contactEmail: '', contactPhone: '',
  orgName: '', plan: '', duration: 12, userCount: 40, amount: '',
});

export default function PartnerPortal() {
  const { userProfile, partnerLocale, partnerCurrency, partnerCountry, canIssueLicenses } = useAuth();
  const isIntl = partnerLocale !== 'ko';
  const t = makeT(partnerLocale);
  const curUnit = currencyUnit(partnerCurrency);
  const phoneFmt = isIntl ? formatIntlPhone : formatPhone;
  const phonePlaceholder = isIntl ? '+90 5xx xxx xx xx' : '010-0000-0000';

  const { data: allDeals } = useDeals();
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [deals, setDeals] = useState<PartnerDeal[]>([]);
  const [dealBuyersMap, setDealBuyersMap] = useState<Record<string, PartnerDealBuyer[]>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingDealId, setEditingDealId] = useState<string | null>(null);  // null = 추가 모드, 값 있으면 해당 딜 수정 모드
  const [deleteDealConfirmOpen, setDeleteDealConfirmOpen] = useState(false);
  const [deleteDealTargetId, setDeleteDealTargetId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<Partial<PartnerDeal>>({});
  const [buyers, setBuyers] = useState<BuyerInput[]>([emptyBuyer()]);
  const [items, setItems] = useState<ItemInput[]>([emptyItem()]);
  const [periodFilter, setPeriodFilter] = useState('this_month');

  // 이용권 발급 (canIssueLicenses 파트너 전용)
  const [licenses, setLicenses] = useState<PartnerLicense[]>([]);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueForm, setIssueForm] = useState<IssueForm>(emptyIssueForm());
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

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

  // 발급된 이용권 로드 (발급 권한 파트너만)
  useEffect(() => {
    if (!partner?.id || !canIssueLicenses) return;
    getPartnerLicenses(partner.id).then(setLicenses).catch(() => setLicenses([]));
  }, [partner?.id, canIssueLicenses]);

  // 학교 검색 (디바운스) — 국내(ko)에서만 사용
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
      case 'this_month': { const ym = `${yyyy}-${pad(mm + 1)}`; return { from: `${ym}-01`, to: `${ym}-31`, label: t({ ko: `${ym} 실적`, ja: `${ym} 実績`, en: `${ym} Results` }) }; }
      case 'last_month': { const d = new Date(yyyy, mm - 1, 1); const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; return { from: `${ym}-01`, to: `${ym}-31`, label: t({ ko: `${ym} 실적`, ja: `${ym} 実績`, en: `${ym} Results` }) }; }
      case 'this_year': return { from: `${yyyy}-01-01`, to: `${yyyy}-12-31`, label: t({ ko: `${yyyy}년 실적`, ja: `${yyyy}年 実績`, en: `${yyyy} Results` }) };
      default: return { from: '2000-01-01', to: '2099-12-31', label: t({ ko: '전체 실적', ja: '全体実績', en: 'All Results' }) };
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
    setEditingDealId(null);
    setAddForm({ quantity: 1 });
    setBuyers([emptyBuyer()]);
    setItems([emptyItem(isIntl)]);
    setSchoolQuery('');
    setSchoolResults([]);
    setShowSchoolDropdown(false);
    setAddDialogOpen(true);
  };

  // 기존 딜 상세보기·수정 — 생성 다이얼로그를 재사용해 품명·구매자까지 프리필
  const handleOpenEditDialog = (deal: PartnerDeal) => {
    setEditingDealId(deal.id);
    setAddForm({
      contract_date: deal.contract_date,
      school_name: deal.school_name,
      remarks: deal.remarks,
    });
    // 품명 프리필 — items가 없으면(legacy) 요약 필드로 단일 항목 폴백
    const fallbackPlan = isIntl ? '' : '학급플랜';
    const dealItems = deal.items && deal.items.length > 0
      ? deal.items.map(it => ({
          plan: it.plan ?? fallbackPlan,
          duration: it.duration ?? (isIntl ? 12 : 4),
          qty: it.qty ?? 1,
          unit_price: it.unit_price ?? 0,
          amount: it.amount ?? 0,
        }))
      : [{
          plan: deal.plan_name || fallbackPlan,
          duration: deal.month_count || (isIntl ? 12 : 4),
          qty: deal.quantity || 1,
          unit_price: (deal.quantity && deal.quantity > 0) ? Math.round((deal.payment_amount ?? 0) / deal.quantity) : (deal.payment_amount ?? 0),
          amount: deal.payment_amount ?? 0,
        }];
    setItems(dealItems);
    // 구매자 프리필 — buyers 레코드가 없으면(legacy) 딜 요약 필드로 단일 구매자 폴백
    const dbBuyers = dealBuyersMap[deal.id] ?? [];
    const formBuyers: BuyerInput[] = dbBuyers.length > 0
      ? dbBuyers.map(b => ({
          buyer_name: b.buyer_name ?? '',
          buyer_phone: b.buyer_phone ?? '',
          buyer_email: b.buyer_email ?? '',
          student_count: b.student_count ?? 40,
          month_count: b.month_count ?? '',
        }))
      : [{
          buyer_name: deal.buyer_name ?? '',
          buyer_phone: deal.buyer_phone ?? '',
          buyer_email: deal.buyer_email ?? '',
          student_count: deal.student_count ?? 40,
          month_count: deal.month_count ?? '',
        }];
    setBuyers(formBuyers.length > 0 ? formBuyers : [emptyBuyer()]);
    setSchoolQuery(deal.school_name ?? '');
    setSchoolResults([]);
    setShowSchoolDropdown(false);
    setAddDialogOpen(true);
  };

  // 품목 입력 핸들러
  const itemsTotal = items.reduce((s, it) => s + it.amount, 0);
  const updateItem = (idx: number, field: keyof ItemInput, value: string | number) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, [field]: value };
      if (isIntl) {
        // 해외: 자유입력 단가. plan/duration은 가격 자동계산 없음.
        if (field === 'unit_price' || field === 'qty') {
          const up = field === 'unit_price' ? Number(value) || 0 : next.unit_price;
          const q = field === 'qty' ? Number(value) || 0 : next.qty;
          next.amount = up * q;
        }
        return next;
      }
      // 국내: 플랜/개월 → 자동단가
      if (field === 'plan' || field === 'duration') {
        next.unit_price = getUnitPrice(
          field === 'plan' ? (value as string) : it.plan,
          field === 'duration' ? (value as number) : it.duration,
        );
        next.amount = next.unit_price * next.qty;
      }
      if (field === 'qty') {
        next.amount = next.unit_price * (value as number);
      }
      return next;
    }));
  };
  const addItem = () => setItems(prev => [...prev, emptyItem(isIntl)]);
  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  // 추가/수정 공용 제출 — editingDealId 유무로 분기
  const handleDialogSubmit = async () => {
    if (!partner) return;
    // 구매자 최소 1명 이름 필수
    const validBuyers = buyers.filter(b => b.buyer_name.trim());
    if (validBuyers.length === 0) {
      toast.error(t({ ko: '구매자를 최소 1명 입력해주세요', ja: '購入者を最低1名入力してください', en: 'Please enter at least one buyer' }));
      return;
    }
    setAdding(true);
    try {
      const totalAmount = itemsTotal;
      const { commission, settlement } = calcCommission(totalAmount, commissionRate);
      const firstBuyer = validBuyers[0];
      const planSummary = items.map(it => it.plan).filter(Boolean).join(', ');
      const dealFields = {
        contract_date: addForm.contract_date || null,
        school_name: addForm.school_name || null,
        buyer_name: firstBuyer.buyer_name || null,
        buyer_phone: firstBuyer.buyer_phone || null,
        buyer_email: firstBuyer.buyer_email || null,
        plan_name: planSummary || null,
        quantity: items.reduce((s, it) => s + it.qty, 0),
        payment_amount: totalAmount,
        commission_amount: commission,
        settlement_amount: settlement,
        items: items.map(it => ({ plan: it.plan, duration: it.duration, qty: it.qty, unit_price: it.unit_price, amount: it.amount })),
        remarks: addForm.remarks || null,
        // 해외 파트너 딜 표시(통화/국가). 국내는 기본값(KRW/KR).
        ...(isIntl ? { currency: partnerCurrency, country: partnerCountry } : {}),
      };
      const buyerRows = validBuyers.map(b => ({
        buyer_name: b.buyer_name || undefined,
        buyer_phone: b.buyer_phone || undefined,
        buyer_email: b.buyer_email || undefined,
        student_count: b.student_count,
        month_count: b.month_count === '' ? undefined : b.month_count,
        quantity: 1,
      }));

      if (editingDealId) {
        // ── 수정 ──
        await updatePartnerDeal(editingDealId, dealFields);
        // 구매자는 전량 교체 (삭제 후 재생성)
        await deleteDealBuyers(editingDealId);
        const newBuyers = await createDealBuyers(editingDealId, buyerRows);
        setDeals(prev => prev.map(d => d.id === editingDealId ? { ...d, ...dealFields } as PartnerDeal : d));
        setDealBuyersMap(prev => ({ ...prev, [editingDealId]: newBuyers }));
        setAddDialogOpen(false);
        toast.success(t({ ko: '수정되었습니다', ja: '修正されました', en: 'Updated' }));
        notifyPartnerDeal(partner.name, addForm.school_name ?? '', firstBuyer.buyer_name ?? '', totalAmount,
          { currency: partnerCurrency, country: partnerCountry, edited: true });
      } else {
        // ── 추가 ──
        const created = await createPartnerDeal({
          partner_id: partner.id,
          seq_number: deals.length + 1,
          ...dealFields,
        });
        const createdBuyers = await createDealBuyers(created.id, buyerRows);
        setDeals(prev => [...prev, created]);
        setDealBuyersMap(prev => ({ ...prev, [created.id]: createdBuyers }));
        setAddDialogOpen(false);
        toast.success(t({ ko: '딜이 추가되었습니다', ja: '案件が追加されました', en: 'Deal added' }));
        notifyPartnerDeal(partner.name, addForm.school_name ?? '', firstBuyer.buyer_name ?? '', totalAmount,
          { currency: partnerCurrency, country: partnerCountry });
      }
    } catch { toast.error(editingDealId ? t({ ko: '수정 실패', ja: '修正に失敗しました', en: 'Update failed' }) : t({ ko: '추가 실패', ja: '追加に失敗しました', en: 'Add failed' })); }
    finally { setAdding(false); }
  };

  const handleDelete = (id: string) => {
    setDeleteDealTargetId(id);
    setDeleteDealConfirmOpen(true);
  };

  const confirmDeleteDeal = async () => {
    if (!deleteDealTargetId) return;
    try {
      await deletePartnerDeal(deleteDealTargetId);
      setDeals(prev => prev.filter(d => d.id !== deleteDealTargetId));
      setDealBuyersMap(prev => { const n = { ...prev }; delete n[deleteDealTargetId]; return n; });
      toast.success(t({ ko: '삭제되었습니다', ja: '削除されました', en: 'Deleted' }));
    } catch { toast.error(t({ ko: '삭제 실패', ja: '削除に失敗しました', en: 'Delete failed' })); }
    setDeleteDealConfirmOpen(false);
    setDeleteDealTargetId(null);
  };

  // 구매자 입력 핸들러
  const updateBuyer = (idx: number, field: keyof BuyerInput, value: string | number) => {
    setBuyers(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  };
  const addBuyer = () => setBuyers(prev => [...prev, emptyBuyer()]);
  const removeBuyer = (idx: number) => {
    if (buyers.length <= 1) return;
    setBuyers(prev => prev.filter((_, i) => i !== idx));
  };

  // ── 이용권 발급 ──
  const openIssueDialog = (deal?: PartnerDeal) => {
    const f = emptyIssueForm();
    if (deal) {
      f.partnerDealId = deal.id;
      f.customerName = deal.buyer_name ?? '';
      f.contactEmail = deal.buyer_email ?? '';
      f.contactPhone = deal.buyer_phone ?? '';
      f.orgName = deal.school_name ?? '';
    }
    setIssueForm(f);
    setIssuedCode(null);
    setIssueDialogOpen(true);
  };

  const handleIssue = async () => {
    if (!partner) return;
    if (!issueForm.contactEmail.trim()) {
      toast.error(t({ ko: '이메일을 입력하세요', ja: 'メールアドレスを入力してください', en: 'Please enter an email' }));
      return;
    }
    setIssuing(true);
    try {
      const res = await issueLicense({
        partnerDealId: issueForm.partnerDealId || null,
        customerName: issueForm.customerName,
        contactEmail: issueForm.contactEmail,
        contactPhone: issueForm.contactPhone,
        orgName: issueForm.orgName,
        plan: issueForm.plan,
        duration: String(issueForm.duration),
        userCount: String(issueForm.userCount),
        amount: issueForm.amount === '' ? null : Number(issueForm.amount),
        partnerName: partner.name,
        locale: partnerLocale,
      });
      setIssuedCode(res.coupon_code);
      toast.success(
        res.email_sent
          ? t({ ko: `이용권 발급 완료 · 이메일 발송됨 (${res.coupon_code})`, ja: `ライセンス発行完了・メール送信済み (${res.coupon_code})`, en: `License issued & emailed (${res.coupon_code})` })
          : t({ ko: `이용권 발급됨 · 이메일 발송 실패 (${res.coupon_code})`, ja: `ライセンス発行済み・メール送信失敗 (${res.coupon_code})`, en: `License issued, email failed (${res.coupon_code})` }),
      );
      getPartnerLicenses(partner.id).then(setLicenses).catch(() => {});
    } catch (e) {
      toast.error(`${t({ ko: '발급 실패', ja: '発行に失敗しました', en: 'Issue failed' })}: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setIssuing(false); }
  };

  const handleResend = async (lic: PartnerLicense) => {
    try {
      await resendLicenseEmail(lic, partner?.name, partnerLocale);
      toast.success(t({ ko: '재발송 완료', ja: '再送信完了', en: 'Resent' }));
      if (partner?.id) getPartnerLicenses(partner.id).then(setLicenses).catch(() => {});
    } catch (e) {
      toast.error(`${t({ ko: '재발송 실패', ja: '再送信に失敗しました', en: 'Resend failed' })}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(
      () => toast.success(t({ ko: '복사됨', ja: 'コピーしました', en: 'Copied' })),
      () => {},
    );
  };

  if (!userProfile?.partner_id) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-muted-foreground">{t({ ko: '파트너 계정이 연결되어 있지 않습니다. 관리자에게 문의하세요.', ja: 'パートナーアカウントが連携されていません。管理者にお問い合わせください。', en: 'No partner account linked. Please contact the administrator.' })}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-semibold">{partner?.name ?? t({ ko: '파트너', ja: 'パートナー', en: 'Partner' })} {t({ ko: '포털', ja: 'ポータル', en: 'Portal' })}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t({ ko: '수수료율', ja: '手数料率', en: 'Commission' })} {commissionRate}% · {t({ ko: '전체', ja: '合計', en: 'Total' })} {deals.length}{t({ ko: '건', ja: '件', en: '' })}</p>
      </div>

      {/* 기간 필터 */}
      <div className="flex items-center gap-1.5">
        {([
          { id: 'this_month', label: t({ ko: '이번달', ja: '今月', en: 'This month' }) },
          { id: 'last_month', label: t({ ko: '지난달', ja: '先月', en: 'Last month' }) },
          { id: 'this_year', label: t({ ko: '올해', ja: '今年', en: 'This year' }) },
          { id: 'all', label: t({ ko: '전체', ja: '全体', en: 'All' }) },
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
            <p className="text-2xl font-bold tabular-nums">{totalPayment.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">{curUnit}</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">{t({ ko: '매출 (결제금액)', ja: '売上（決済金額）', en: 'Revenue (paid)' })}</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-amber-600">{totalCommission.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">{curUnit}</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">{t({ ko: '수수료', ja: '手数料', en: 'Commission' })}</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-teal-700">{totalSettlement.toLocaleString()}<span className="text-sm font-normal text-muted-foreground ml-1">{curUnit}</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">{t({ ko: '정산금액', ja: '精算金額', en: 'Settlement' })}</p>
          </div>
        </div>
      </div>

      {/* 딜 추가 버튼 */}
      <div className="flex justify-end gap-2">
        {canIssueLicenses && (
          <Button size="sm" variant="outline" onClick={() => openIssueDialog()}>
            <Ticket className="h-4 w-4 mr-1.5" />{t({ ko: '이용권 발급', ja: 'ライセンス発行', en: 'Issue License' })}
          </Button>
        )}
        <Button size="sm" onClick={handleOpenAddDialog} disabled={adding}>
          <Plus className="h-4 w-4 mr-1.5" />{t({ ko: '딜 추가', ja: '案件追加', en: 'Add Deal' })}
        </Button>
      </div>

      {/* 딜 테이블 */}
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground w-8">#</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{t({ ko: '계약일', ja: '契約日', en: 'Date' })}</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">{t({ ko: '학교명', ja: '学校名', en: 'School / Org' })}</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">{t({ ko: '구매자', ja: '購入者', en: 'Buyer' })}</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">{t({ ko: '연락처', ja: '連絡先', en: 'Contact' })}</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">{t({ ko: '플랜', ja: 'プラン', en: 'Plan' })}</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-muted-foreground">{t({ ko: '수량', ja: '数量', en: 'Qty' })}</th>
                <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">{t({ ko: '결제금액', ja: '決済金額', en: 'Amount' })}</th>
                <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">{t({ ko: '수수료', ja: '手数料', en: 'Commission' })}</th>
                <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">{t({ ko: '정산금액', ja: '精算金額', en: 'Settlement' })}</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{t({ ko: '이용권발급', ja: 'ライセンス発行', en: 'License' })}</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{t({ ko: '입금일', ja: '入金日', en: 'Deposit' })}</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">{t({ ko: '비고', ja: '備考', en: 'Notes' })}</th>
                <th className="px-3 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">{t({ ko: '로딩 중...', ja: '読み込み中...', en: 'Loading...' })}</td></tr>
              ) : filteredDeals.length === 0 ? (
                <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground">{t({ ko: '등록된 딜이 없습니다.', ja: '登録された案件がありません。', en: 'No deals yet.' })}</td></tr>
              ) : filteredDeals.map((d, idx) => {
                const dbBuyers = dealBuyersMap[d.id] ?? [];
                const buyerCount = dbBuyers.length || 1;
                const buyerDisplay = dbBuyers.length > 1
                  ? t({ ko: `${d.buyer_name} 외 ${dbBuyers.length - 1}명`, ja: `${d.buyer_name} 他${dbBuyers.length - 1}名`, en: `${d.buyer_name} +${dbBuyers.length - 1}` })
                  : d.buyer_name || '-';
                const phoneDisplay = dbBuyers.length > 1
                  ? `${d.buyer_phone ?? ''} ...`
                  : d.buyer_phone || '-';

                return (
                  <tr key={d.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => handleOpenEditDialog(d)}>
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
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {canIssueLicenses && (
                          <button onClick={() => openIssueDialog(d)} title={t({ ko: '이용권 발급', ja: 'ライセンス発行', en: 'Issue License' })}
                            className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"><Ticket className="h-3.5 w-3.5" /></button>
                        )}
                        <button onClick={() => handleOpenEditDialog(d)} title={t({ ko: '상세보기 / 수정', ja: '詳細 / 修正', en: 'View / Edit' })}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleDelete(d.id)} title={t({ ko: '삭제', ja: '削除', en: 'Delete' })}
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

      {/* 발급된 이용권 목록 (발급 권한 파트너만) */}
      {canIssueLicenses && (
        <div className="surface-card ring-container overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/40">
            <Ticket className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{t({ ko: '발급된 이용권', ja: '発行済みライセンス', en: 'Issued Licenses' })} ({licenses.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{t({ ko: '발급일', ja: '発行日', en: 'Date' })}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{t({ ko: '고객', ja: '顧客', en: 'Customer' })}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{t({ ko: '학교/기관', ja: '学校・機関', en: 'School / Org' })}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{t({ ko: '플랜', ja: 'プラン', en: 'Plan' })}</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground">{t({ ko: '기간·인원', ja: '期間・人数', en: 'Term · Users' })}</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{t({ ko: '이용권코드', ja: 'ライセンスコード', en: 'Code' })}</th>
                  <th className="px-3 py-2.5 text-center text-xs font-medium text-muted-foreground">{t({ ko: '이메일', ja: 'メール', en: 'Email' })}</th>
                  <th className="px-3 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {licenses.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-xs">{t({ ko: '발급된 이용권이 없습니다.', ja: '発行されたライセンスがありません。', en: 'No licenses issued yet.' })}</td></tr>
                ) : licenses.map(lic => (
                  <tr key={lic.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{lic.created_at?.slice(0, 10)}</td>
                    <td className="px-3 py-2.5 text-xs font-medium">{lic.contact_name || '-'}<div className="text-[10px] text-muted-foreground">{lic.contact_email}</div></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{lic.org_name || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{lic.plan || '-'}</td>
                    <td className="px-3 py-2.5 text-xs text-center text-muted-foreground whitespace-nowrap">{lic.duration}{t({ ko: '개월', ja: 'か月', en: 'mo' })} · {lic.user_count}</td>
                    <td className="px-3 py-2.5 text-xs font-mono">{lic.coupon_code}</td>
                    <td className="px-3 py-2.5 text-center">
                      {lic.email_sent
                        ? <span className="text-[10px] text-teal-700 bg-teal-50 rounded px-1.5 py-0.5">{t({ ko: '발송됨', ja: '送信済み', en: 'Sent' })}</span>
                        : <span className="text-[10px] text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">{t({ ko: '미발송', ja: '未送信', en: 'Not sent' })}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => copyCode(lic.coupon_code)} title={t({ ko: '코드 복사', ja: 'コードをコピー', en: 'Copy code' })}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"><Copy className="h-3.5 w-3.5" /></button>
                        <button onClick={() => handleResend(lic)} title={t({ ko: '이메일 재발송', ja: 'メール再送信', en: 'Resend email' })}
                          className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"><Send className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 딜 추가 모달 */}
      <Dialog open={addDialogOpen} onOpenChange={open => { if (!open) { setAddDialogOpen(false); setEditingDealId(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingDealId ? t({ ko: '딜 상세 / 수정', ja: '案件詳細 / 修正', en: 'Deal Details / Edit' }) : t({ ko: '새 딜 추가', ja: '新規案件', en: 'New Deal' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2 overflow-y-auto flex-1">
            {/* 계약일 */}
            <div>
              <Label className="text-xs">{t({ ko: '계약일', ja: '契約日', en: 'Contract date' })}</Label>
              <Input type="date" value={(addForm.contract_date as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, contract_date: e.target.value }))} className="h-8 text-sm" />
            </div>

            {/* 학교명 — 국내는 NEIS 검색, 해외는 자유입력 */}
            {isIntl ? (
              <div>
                <Label className="text-xs">{t({ ko: '학교명', ja: '学校・機関名', en: 'School / Organization' })}</Label>
                <Input
                  value={(addForm.school_name as string) ?? ''}
                  onChange={e => setAddForm(p => ({ ...p, school_name: e.target.value }))}
                  placeholder={t({ ko: '학교/기관명', ja: '学校・機関名', en: 'School or organization name' })}
                  className="h-8 text-sm"
                />
              </div>
            ) : (
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
            )}

            {/* 품명 (상품 목록) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" />
                  {t({ ko: '품명', ja: '品名', en: 'Items' })} ({items.length})
                </Label>
                <button onClick={addItem} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" />{t({ ko: '추가', ja: '追加', en: 'Add' })}
                </button>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="border border-border rounded-md p-2.5 bg-muted/30 relative">
                    {items.length > 1 && (
                      <button onClick={() => removeItem(idx)}
                        className="absolute top-1.5 right-1.5 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    {isIntl ? (
                      /* 해외: 자유입력 플랜 + 수동 단가 */
                      <div className="grid grid-cols-[1.2fr_0.7fr_0.5fr_1fr] gap-2">
                        <div>
                          <span className="text-[10px] text-muted-foreground">{t({ ko: '플랜', ja: 'プラン', en: 'Plan' })}</span>
                          <Input value={it.plan} onChange={e => updateItem(idx, 'plan', e.target.value)} placeholder={t({ ko: '플랜명', ja: 'プラン名', en: 'Plan name' })} className="h-7 text-xs" />
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">{t({ ko: '이용개월', ja: '利用月数', en: 'Months' })}</span>
                          <Input type="number" min={1} value={it.duration} onChange={e => updateItem(idx, 'duration', parseInt(e.target.value) || 1)} className="h-7 text-xs text-center" />
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">{t({ ko: '수량', ja: '数量', en: 'Qty' })}</span>
                          <Input type="number" min={1} value={it.qty} onChange={e => updateItem(idx, 'qty', parseInt(e.target.value) || 1)} className="h-7 text-xs text-center" />
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">{t({ ko: '단가', ja: '単価', en: 'Unit price' })} ({curUnit})</span>
                          <Input type="number" min={0} value={it.unit_price} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} className="h-7 text-xs text-right" />
                        </div>
                      </div>
                    ) : (
                      /* 국내: 플랜 선택 + 자동단가 */
                      <div className="grid grid-cols-[1fr_0.7fr_0.5fr_1fr] gap-2">
                        <div>
                          <span className="text-[10px] text-muted-foreground">구매플랜</span>
                          <Select
                            value={PARTNER_PLAN_LIST.includes(it.plan) ? it.plan : (it.plan ? '__custom__' : '')}
                            onValueChange={v => {
                              if (v === '__custom__') {
                                updateItem(idx, 'plan', PARTNER_PLAN_LIST.includes(it.plan) ? '' : it.plan);
                              } else {
                                updateItem(idx, 'plan', v);
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="플랜 선택" /></SelectTrigger>
                            <SelectContent>
                              {PARTNER_PLAN_LIST.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                              <SelectItem value="__custom__" className="text-xs">기타(직접입력)</SelectItem>
                            </SelectContent>
                          </Select>
                          {it.plan && !PARTNER_PLAN_LIST.includes(it.plan) && (
                            <Input
                              value={it.plan}
                              onChange={e => updateItem(idx, 'plan', e.target.value)}
                              placeholder="플랜명 직접입력"
                              className="h-6 text-xs mt-1"
                            />
                          )}
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">이용개월</span>
                          <Select value={String(it.duration)} onValueChange={v => updateItem(idx, 'duration', Number(v))}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DURATION_OPTIONS.map(d => <SelectItem key={d} value={String(d)} className="text-xs">{d}개월</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">수량</span>
                          <Input type="number" min={1} value={it.qty} onChange={e => updateItem(idx, 'qty', parseInt(e.target.value) || 1)} className="h-7 text-xs text-center" />
                        </div>
                        <div>
                          <span className="text-[10px] text-muted-foreground">금액</span>
                          <div className="h-7 flex items-center text-xs font-medium tabular-nums text-right px-2 bg-muted rounded border border-border">
                            {it.amount.toLocaleString()}원
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* 합계 */}
              <div className="mt-2 flex items-center justify-between px-3 py-2 bg-primary/5 rounded-md border border-primary/20">
                <span className="text-xs font-medium">{t({ ko: '결제금액 합계', ja: '決済金額合計', en: 'Total amount' })}</span>
                <span className="text-sm font-bold tabular-nums">{formatMoney(itemsTotal, partnerCurrency)}</span>
              </div>
              {itemsTotal > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-1.5 mt-1">
                  {t({ ko: '수수료', ja: '手数料', en: 'Commission' })} {formatMoney(calcCommission(itemsTotal, commissionRate).commission, partnerCurrency)} / {t({ ko: '정산', ja: '精算', en: 'Settlement' })} {formatMoney(calcCommission(itemsTotal, commissionRate).settlement, partnerCurrency)}
                </div>
              )}
            </div>

            {/* 구매자 목록 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {t({ ko: '구매자', ja: '購入者', en: 'Buyers' })} ({buyers.length})
                </Label>
                <button onClick={addBuyer} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" />{t({ ko: '추가', ja: '追加', en: 'Add' })}
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
                        <span className="text-[10px] text-muted-foreground">{t({ ko: '이름', ja: '氏名', en: 'Name' })} *</span>
                        <Input value={b.buyer_name} onChange={e => updateBuyer(idx, 'buyer_name', e.target.value)} placeholder={t({ ko: '홍길동', ja: '山田太郎', en: 'Full name' })} className="h-7 text-xs" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">{t({ ko: '연락처', ja: '連絡先', en: 'Phone' })}</span>
                        <Input value={b.buyer_phone} onChange={e => updateBuyer(idx, 'buyer_phone', phoneFmt(e.target.value))} placeholder={phonePlaceholder} className="h-7 text-xs" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">{t({ ko: '이메일', ja: 'メール', en: 'Email' })}</span>
                        <Input value={b.buyer_email} onChange={e => updateBuyer(idx, 'buyer_email', e.target.value)} placeholder="email@example.com" className="h-7 text-xs" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-muted-foreground">{t({ ko: '학생 수', ja: '生徒数', en: 'Students' })}</span>
                        <AmountInput value={b.student_count} onValueChange={(n) => updateBuyer(idx, 'student_count', n)} className="h-7 text-xs" />
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground">{t({ ko: '이용개월', ja: '利用月数', en: 'Months' })}</span>
                        <Input type="number" value={b.month_count} onChange={e => updateBuyer(idx, 'month_count', parseInt(e.target.value) || '')} placeholder="12" className="h-7 text-xs" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 비고 */}
            <div>
              <Label className="text-xs">{t({ ko: '비고', ja: '備考', en: 'Notes' })}</Label>
              <Input value={(addForm.remarks as string) ?? ''} onChange={e => setAddForm(p => ({ ...p, remarks: e.target.value }))} className="h-8 text-sm" placeholder={t({ ko: '특이사항 입력', ja: '特記事項を入力', en: 'Notes' })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" size="sm" onClick={() => { setAddDialogOpen(false); setEditingDealId(null); }}>{t({ ko: '취소', ja: 'キャンセル', en: 'Cancel' })}</Button>
            <Button size="sm" onClick={handleDialogSubmit} disabled={adding}>
              {adding && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {editingDealId ? t({ ko: '저장', ja: '保存', en: 'Save' }) : t({ ko: '추가', ja: '追加', en: 'Add' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 이용권 발급 모달 */}
      <Dialog open={issueDialogOpen} onOpenChange={o => { if (!o) setIssueDialogOpen(false); }}>
        <DialogContent className="max-w-md" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t({ ko: '이용권 발급', ja: 'ライセンス発行', en: 'Issue License' })}</DialogTitle>
          </DialogHeader>
          {issuedCode ? (
            <div className="py-4 text-center space-y-3">
              <p className="text-sm text-muted-foreground">{t({ ko: '이용권이 발급되어 이메일로 전송되었습니다.', ja: 'ライセンスが発行され、メールで送信されました。', en: 'License issued and sent by email.' })}</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg font-mono font-bold tracking-wide bg-muted px-3 py-1.5 rounded">{issuedCode}</span>
                <button onClick={() => copyCode(issuedCode)} className="p-1.5 rounded hover:bg-muted text-muted-foreground"><Copy className="h-4 w-4" /></button>
              </div>
              <div className="flex justify-center gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setIssuedCode(null)}>{t({ ko: '추가 발급', ja: '追加発行', en: 'Issue another' })}</Button>
                <Button size="sm" onClick={() => setIssueDialogOpen(false)}>{t({ ko: '닫기', ja: '閉じる', en: 'Close' })}</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t({ ko: '고객명', ja: '顧客名', en: 'Customer name' })}</Label>
                  <Input value={issueForm.customerName} onChange={e => setIssueForm(f => ({ ...f, customerName: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">{t({ ko: '학교/기관', ja: '学校・機関', en: 'School / Org' })}</Label>
                  <Input value={issueForm.orgName} onChange={e => setIssueForm(f => ({ ...f, orgName: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t({ ko: '이메일 *', ja: 'メール *', en: 'Email *' })}</Label>
                  <Input type="email" value={issueForm.contactEmail} onChange={e => setIssueForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="email@example.com" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">{t({ ko: '연락처', ja: '連絡先', en: 'Phone' })}</Label>
                  <Input value={issueForm.contactPhone} onChange={e => setIssueForm(f => ({ ...f, contactPhone: phoneFmt(e.target.value) }))} placeholder={phonePlaceholder} className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs">{t({ ko: '플랜', ja: 'プラン', en: 'Plan' })}</Label>
                  <Input value={issueForm.plan} onChange={e => setIssueForm(f => ({ ...f, plan: e.target.value }))} placeholder={t({ ko: '플랜명', ja: 'プラン名', en: 'Plan name' })} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">{t({ ko: '개월', ja: 'か月', en: 'Months' })}</Label>
                  <Input type="number" min={1} value={issueForm.duration} onChange={e => setIssueForm(f => ({ ...f, duration: parseInt(e.target.value) || 1 }))} className="h-8 text-sm text-center" />
                </div>
                <div>
                  <Label className="text-xs">{t({ ko: '인원', ja: '人数', en: 'Users' })}</Label>
                  <Input type="number" min={1} value={issueForm.userCount} onChange={e => setIssueForm(f => ({ ...f, userCount: parseInt(e.target.value) || 1 }))} className="h-8 text-sm text-center" />
                </div>
              </div>
              <div>
                <Label className="text-xs">{t({ ko: '판매금액', ja: '販売金額', en: 'Amount' })} ({curUnit}) <span className="text-muted-foreground">— {t({ ko: '선택', ja: '任意', en: 'optional' })}</span></Label>
                <Input type="number" min={0} value={issueForm.amount} onChange={e => setIssueForm(f => ({ ...f, amount: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) }))} className="h-8 text-sm text-right" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => setIssueDialogOpen(false)}>{t({ ko: '취소', ja: 'キャンセル', en: 'Cancel' })}</Button>
                <Button size="sm" onClick={handleIssue} disabled={issuing}>
                  {issuing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  <Ticket className="h-3.5 w-3.5 mr-1" />{t({ ko: '발급 · 이메일 발송', ja: '発行・メール送信', en: 'Issue & Email' })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 딜 삭제 확인 */}
      <AlertDialog open={deleteDealConfirmOpen} onOpenChange={setDeleteDealConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ ko: '딜 삭제', ja: '案件削除', en: 'Delete Deal' })}</AlertDialogTitle>
            <AlertDialogDescription>{t({ ko: '이 딜을 삭제하시겠습니까?', ja: 'この案件を削除しますか？', en: 'Delete this deal?' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ ko: '취소', ja: 'キャンセル', en: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteDeal} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t({ ko: '삭제', ja: '削除', en: 'Delete' })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
