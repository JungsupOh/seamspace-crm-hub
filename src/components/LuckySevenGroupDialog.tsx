// 럭키세븐 그룹 관리 다이얼로그 — Campaigns.tsx 어드민에서 호출
// slug='lucky-seven' 캠페인의 그룹 리스트 + 상세 + 견적서 재발송 + 라이선스 일괄 발급
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, CheckCircle2, Clock, RefreshCw, Mail, Award, ChevronDown, ChevronRight, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import {
  refreshGroupStatus,
  issueLuckySevenLicenses,
  createDealFromLuckySevenGroup,
  findDealIdForGroupCode,
  type LSGroupRow,
  type LSPaymentGroupRow,
  type LSLeadRow,
} from '@/lib/luckySeven';
import { issueQuoteForPaymentGroup } from '@/lib/luckySevenEmail';
import { notifyLuckySevenPayment } from '@/lib/telegram';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

interface Props {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
}

interface GroupListItem extends LSGroupRow {
  leader_name?: string;
  leader_school?: string;
  paid_count?: number;
  total_count?: number;
}

// 그룹 status → 상태 카테고리 매핑 (필터 칩용)
type StatusFilter = 'all' | '결제대기' | '결제진행중' | '결제완료' | '라이선스대기' | '라이선스발급';

const matchFilter = (status: string, filter: StatusFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === '결제대기') return status === '신청' || status === '견적발송';
  if (filter === '결제진행중') return status === '일부결제';
  if (filter === '결제완료') return status === '결제완료' || status === '발급완료';
  if (filter === '라이선스대기') return status === '결제완료';
  if (filter === '라이선스발급') return status === '발급완료';
  return true;
};

// 그룹 리스트 + 상세 뷰 (Dialog 또는 인라인 탭에서 재사용)
export function LuckySevenGroupsView({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const reload = async () => {
    setLoading(true);
    try {
      const groupsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/lucky_seven_groups?campaign_id=eq.${campaignId}&order=created_at.desc&select=*`,
        { headers: HEADERS },
      );
      const rawGroups: LSGroupRow[] = groupsRes.ok ? await groupsRes.json() : [];

      const enriched = await Promise.all(rawGroups.map(async (g) => {
        const [leaderRes, pgRes] = await Promise.all([
          g.leader_lead_id
            ? fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?id=eq.${g.leader_lead_id}&select=name,school_name`, { headers: HEADERS })
            : Promise.resolve(null),
          fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?group_id=eq.${g.id}&select=status`, { headers: HEADERS }),
        ]);
        const leader = leaderRes && leaderRes.ok ? (await leaderRes.json())[0] : null;
        const pgs: { status: string }[] = pgRes.ok ? await pgRes.json() : [];
        return {
          ...g,
          leader_name: leader?.name,
          leader_school: leader?.school_name,
          paid_count: pgs.filter((p) => p.status === '결제완료').length,
          total_count: pgs.length,
        };
      }));
      setGroups(enriched);
      setRefreshKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // 합계 통계
  const totalApplications = groups.reduce((s, g) => s + g.member_count, 0);
  const totalPaymentGroups = groups.reduce((s, g) => s + (g.total_count ?? 0), 0);
  const totalPaid = groups.reduce((s, g) => s + (g.paid_count ?? 0), 0);

  // 필터별 카운트
  const counts: Record<StatusFilter, number> = {
    all: groups.length,
    결제대기: groups.filter((g) => matchFilter(g.status, '결제대기')).length,
    결제진행중: groups.filter((g) => matchFilter(g.status, '결제진행중')).length,
    결제완료: groups.filter((g) => matchFilter(g.status, '결제완료')).length,
    라이선스대기: groups.filter((g) => matchFilter(g.status, '라이선스대기')).length,
    라이선스발급: groups.filter((g) => matchFilter(g.status, '라이선스발급')).length,
  };

  const filteredGroups = groups.filter((g) => matchFilter(g.status, filter));

  const Chip = ({ id, label, color }: { id: StatusFilter; label: string; color: string }) => (
    <button
      type="button"
      onClick={() => setFilter(id)}
      className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
        filter === id
          ? 'bg-foreground text-background border-foreground'
          : `${color} hover:opacity-80`
      }`}
    >
      {label} <span className="font-bold ml-0.5">{counts[id]}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      {/* 합계 라인 */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          <span><strong className="text-foreground">{groups.length}</strong> 그룹</span>
          <span>· <strong className="text-foreground">{totalApplications}</strong>명 신청</span>
          <span>· 결제 <strong className="text-foreground">{totalPaid}/{totalPaymentGroups}</strong> 묶음</span>
        </div>
        <Button size="sm" variant="outline" onClick={reload} disabled={loading} className="h-7">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </Button>
      </div>

      {/* 상태별 필터 칩 */}
      <div className="flex items-center gap-1.5 flex-wrap px-1">
        <Chip id="all" label="전체" color="bg-muted text-muted-foreground border-border" />
        <span className="text-[10px] text-muted-foreground/60 ml-1">결제</span>
        <Chip id="결제대기" label="대기" color="bg-amber-50 text-amber-700 border-amber-200" />
        <Chip id="결제진행중" label="진행중" color="bg-blue-50 text-blue-700 border-blue-200" />
        <Chip id="결제완료" label="완료" color="bg-teal-50 text-teal-700 border-teal-200" />
        <span className="text-[10px] text-muted-foreground/60 ml-1">라이선스</span>
        <Chip id="라이선스대기" label="대기" color="bg-orange-50 text-orange-700 border-orange-200" />
        <Chip id="라이선스발급" label="발급" color="bg-emerald-50 text-emerald-700 border-emerald-200" />
      </div>

      {loading && groups.length === 0 ? (
        <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filteredGroups.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {groups.length === 0 ? '아직 신청된 그룹이 없습니다.' : `${filter} 상태의 그룹이 없습니다.`}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredGroups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              campaignName={campaignName}
              expanded={expanded === g.id}
              onToggle={() => setExpanded(expanded === g.id ? null : g.id)}
              onChange={reload}
              refreshKey={refreshKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LuckySevenGroupDialog({ open, onClose, campaignId, campaignName }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>럭키세븐 그룹 관리</DialogTitle>
        </DialogHeader>
        {open && <LuckySevenGroupsView campaignId={campaignId} campaignName={campaignName} />}
      </DialogContent>
    </Dialog>
  );
}

function GroupCard({ group, campaignName, expanded, onToggle, onChange, refreshKey }: {
  group: GroupListItem;
  campaignName: string;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => void;
  refreshKey: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{group.group_code}</span>
              <span className="text-xs text-muted-foreground truncate">{group.leader_name} ({group.leader_school})</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              멤버 {group.member_count}명 · {group.total_amount.toLocaleString()}원 · 결제 {group.paid_count}/{group.total_count}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${statusBadge(group.status)}`}>{group.status}</span>
        </div>
      </button>

      {expanded && <GroupDetail group={group} campaignName={campaignName} onChange={onChange} refreshKey={refreshKey} />}
    </div>
  );
}

function GroupDetail({ group, campaignName, onChange, refreshKey }: { group: GroupListItem; campaignName: string; onChange: () => void; refreshKey: number }) {
  const [detail, setDetail] = useState<{ paymentGroups: LSPaymentGroupRow[]; leads: LSLeadRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [existingDealId, setExistingDealId] = useState<string | null>(null);

  const reloadDetail = async () => {
    setLoading(true);
    try {
      const [pgRes, leadsRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?group_id=eq.${group.id}&order=quote_number.asc&select=*`, { headers: HEADERS }),
        fetch(`${SUPABASE_URL}/rest/v1/campaign_leads?ls_group_id=eq.${group.id}&order=ls_member_index.asc&select=*`, { headers: HEADERS }),
      ]);
      setDetail({
        paymentGroups: pgRes.ok ? await pgRes.json() : [],
        leads: leadsRes.ok ? await leadsRes.json() : [],
      });
    } finally {
      setLoading(false);
    }
  };

  // group.id 진입 시 + 부모 새로고침(refreshKey 변경) 시 재조회
  useEffect(() => { reloadDetail(); }, [group.id, refreshKey]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 딜 등록 여부 조회
  useEffect(() => {
    findDealIdForGroupCode(group.group_code).then(setExistingDealId).catch(() => setExistingDealId(null));
  }, [group.group_code, refreshKey]);

  if (loading || !detail) {
    return <div className="border-t border-border p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const { paymentGroups, leads } = detail;

  const handleResendQuote = async (pg: LSPaymentGroupRow) => {
    setBusy(true);
    try {
      const pgMembers = leads.filter((l) => l.ls_payment_group_id === pg.id);
      await issueQuoteForPaymentGroup({
        group,
        paymentGroup: pg,
        members: pgMembers,
        leaderName: group.leader_name ?? '(대표자)',
        leaderSchoolName: group.leader_school ?? '',
      });
      toast.success(`견적서 재발송 완료: ${pg.payer_email}`);
      await reloadDetail();
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '견적서 발송 실패');
    } finally {
      setBusy(false);
    }
  };

  const handleManualPaid = async (pg: LSPaymentGroupRow) => {
    if (!confirm(`${pg.payer_name}님의 ${pg.amount.toLocaleString()}원 결제를 완료 처리할까요?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?id=eq.${pg.id}`, {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: '결제완료', paid_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error('업데이트 실패');
      const newStatus = await refreshGroupStatus(group.id);

      // 텔레그램 알림 (수동 확인 표시)
      const updatedPgRes = await fetch(`${SUPABASE_URL}/rest/v1/lucky_seven_payment_groups?group_id=eq.${group.id}&select=status`, { headers: HEADERS });
      const allPgs: { status: string }[] = updatedPgRes.ok ? await updatedPgRes.json() : [];
      const paidCount = allPgs.filter((p) => p.status === '결제완료').length;

      notifyLuckySevenPayment({
        groupCode: group.group_code,
        campaignName,
        leaderName: group.leader_name ?? '(대표자)',
        leaderSchoolName: group.leader_school ?? '',
        payerName: pg.payer_name,
        payerOrgName: pg.buyer_org_name,
        amount: pg.amount,
        paidCount,
        totalCount: allPgs.length,
        manual: true,
      });

      toast.success(`결제 완료 처리됨${newStatus === '결제완료' ? ' (그룹 전체 완료)' : ''}`);
      await reloadDetail();
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmIssue = async () => {
    setBusy(true);
    try {
      await issueLuckySevenLicenses(group, leads);
      toast.success(`라이선스 ${leads.length}건 발급 + 알림톡 발송 완료`);
      setIssueDialogOpen(false);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '라이선스 발급 실패');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterDeal = async () => {
    const leader = leads.find((l) => l.ls_role === 'leader') ?? leads[0];
    if (!leader) { toast.error('대표자 정보를 찾을 수 없습니다.'); return; }
    if (!confirm(`그룹 ${group.group_code}을 딜로 등록할까요?\n· 딜 1건 + 결제묶음 ${paymentGroups.length}건의 견적 + 멤버 ${leads.length}명의 사용자 등록`)) return;
    setBusy(true);
    try {
      const result = await createDealFromLuckySevenGroup({
        group,
        leader: {
          schoolName: leader.school_name ?? '',
          schoolCode: null,
          schoolKind: null,
          position: leader.position ?? '',
          name: leader.name,
          phone: leader.phone,
          email: leader.email ?? '',
          source: '럭키세븐 5월',
          sourceEtc: null,
          marketingConsent: false,
        },
        members: leads,
        paymentGroups,
      });
      if (result.created) {
        toast.success(`딜 등록 완료 (견적 ${paymentGroups.length}건 / 사용자 ${leads.length}명)`);
      } else {
        toast.info('이미 등록된 딜이 있습니다.');
      }
      setExistingDealId(result.dealId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '딜 등록 실패');
    } finally {
      setBusy(false);
    }
  };

  const allPaid = paymentGroups.length > 0 && paymentGroups.every((p) => p.status === '결제완료');
  const isIssued = group.status === '발급완료';

  return (
    <div className="border-t border-border p-4 space-y-3 bg-muted/10">
      {/* 멤버 명단 */}
      <div className="rounded-lg bg-card border border-border p-3">
        <h4 className="text-xs font-semibold mb-2">멤버 ({leads.length}명)</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs">
          {leads.map((m) => {
            const pg = paymentGroups.find((p) => p.id === m.ls_payment_group_id);
            return (
              <div key={m.id} className="flex justify-between border-b border-border/50 py-1 last:border-0">
                <span>
                  {m.ls_member_index}. {m.name} {m.ls_role === 'leader' && <span className="text-primary text-[10px]">·대표</span>}
                </span>
                <span className="text-muted-foreground truncate ml-2">
                  {m.school_name} {pg && <span className="font-mono text-[10px]">· {pg.quote_number}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 결제 묶음 */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">결제 묶음 ({paymentGroups.length}건)</h4>
        {paymentGroups.map((pg) => {
          const memberCount = leads.filter((l) => l.ls_payment_group_id === pg.id).length;
          const isPaid = pg.status === '결제완료';
          return (
            <div key={pg.id} className={`rounded-lg border p-3 text-sm ${isPaid ? 'bg-teal-50/50 dark:bg-teal-950/20 border-teal-200' : 'bg-card border-border'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs text-muted-foreground">{pg.quote_number}</span>
                <span className={`text-xs font-semibold ${isPaid ? 'text-teal-600' : 'text-amber-600'}`}>
                  {isPaid ? <><CheckCircle2 className="h-3 w-3 inline mr-1" />결제완료</> : <><Clock className="h-3 w-3 inline mr-1" />{pg.status}</>}
                </span>
              </div>

              <div className="text-xs space-y-0.5">
                <div><strong>{pg.payer_name}</strong> · {pg.payer_phone} · {pg.payer_email}</div>
                <div className="text-muted-foreground">멤버 {memberCount}명 × 100,000원 = <strong className="text-foreground">{pg.amount.toLocaleString()}원</strong></div>
                {pg.tax_invoice_required && (
                  <div className="text-muted-foreground">
                    세금계산서: {pg.buyer_org_name} ({pg.buyer_business_no})
                  </div>
                )}
                {pg.paid_at && (
                  <div className="text-muted-foreground">결제일시: {new Date(pg.paid_at).toLocaleString('ko-KR')}{pg.toss_payment_key && <span className="ml-2 font-mono text-[10px]">key: ...{pg.toss_payment_key.slice(-8)}</span>}</div>
                )}
                {pg.email_sent_at && (
                  <div className="text-muted-foreground text-[10px]">견적서 발송일시: {new Date(pg.email_sent_at).toLocaleString('ko-KR')}</div>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border/50">
                {pg.quote_pdf_url && (
                  <a href={pg.quote_pdf_url} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="h-7 text-xs">
                      <FileText className="h-3 w-3 mr-1" /> PDF
                    </Button>
                  </a>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => handleResendQuote(pg)}>
                  <Mail className="h-3 w-3 mr-1" /> 견적서 재발송
                </Button>
                {!isPaid && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => handleManualPaid(pg)}>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> 결제완료 수동 표시
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 딜 관리 등록 */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5" /> 딜 관리 등록
          </div>
          <div className="text-xs text-muted-foreground">
            {existingDealId
              ? '✅ 이미 딜로 등록되었습니다 (영업이 /deals에서 후속 관리).'
              : `딜 1건 + 결제묶음 ${paymentGroups.length}건 견적 + 멤버 ${leads.length}명 사용자 등록`}
          </div>
        </div>
        <Button size="sm" variant={existingDealId ? 'outline' : 'default'} disabled={busy || !!existingDealId} onClick={handleRegisterDeal}>
          <Briefcase className="h-4 w-4 mr-1" /> {existingDealId ? '등록됨' : '딜로 등록'}
        </Button>
      </div>

      {/* 라이선스 일괄 발급 */}
      <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">라이선스 일괄 발급</div>
          <div className="text-xs text-muted-foreground">
            {isIssued
              ? '✅ 이미 발급되었습니다.'
              : allPaid
              ? `${leads.length}명에게 학급플랜 7개월권 + 알림톡 발송`
              : '결제가 모두 완료되어야 발급 가능합니다.'}
          </div>
        </div>
        <Button size="sm" disabled={busy || !allPaid || isIssued} onClick={() => setIssueDialogOpen(true)}>
          <Award className="h-4 w-4 mr-1" /> {isIssued ? '발급 완료' : '발급'}
        </Button>
      </div>

      <IssueLicensesConfirmDialog
        open={issueDialogOpen}
        onOpenChange={setIssueDialogOpen}
        group={group}
        members={leads}
        sending={busy}
        onConfirm={handleConfirmIssue}
      />
    </div>
  );
}

// 라이선스 일괄 발급 — 발송 문구 + 대상자 미리보기 (대시보드 미등록 알림 패턴)
function IssueLicensesConfirmDialog({ open, onOpenChange, group, members, sending, onConfirm }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: LSGroupRow;
  members: LSLeadRow[];
  sending: boolean;
  onConfirm: () => void;
}) {
  const [previewIdx, setPreviewIdx] = useState(0);
  const total = members.length;
  const previewTarget = members[Math.min(previewIdx, Math.max(total - 1, 0))];

  const previewMessage = (m: LSLeadRow): string => {
    return `안녕하세요, ${m.name} 선생님!  ❤️❤️\n` +
      `심스페이스 학급플랜 7개월권을 발급해 드립니다.\n` +
      `아래 코드로 등록하시고 학생들과 함께 이용해 보세요.\n\n` +
      `⭐이용권 정보⭐\n` +
      `코드: (발급 시 자동 생성)\n` +
      `기간: 7 개월\n` +
      `인원: 40 명\n\n` +
      `이용 중 문의사항은 카카오채널의 상담을 이용해 주시길 부탁드립니다. 💬\n\n감사합니다.`;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-4 w-4" />
            럭키세븐 라이선스 일괄 발급 — {group.group_code}
          </DialogTitle>
          <DialogDescription>
            총 <strong>{total}명</strong>에게 학급플랜 7개월권 발급 + 알림톡 발송. 발급 후 취소 불가.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-hidden flex-1">
          {/* 대상자 리스트 */}
          <div className="overflow-y-auto border border-border rounded-lg">
            <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground bg-muted/30 sticky top-0">
              발송 대상 {total}명
            </div>
            {members.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setPreviewIdx(i)}
                className={`w-full text-left px-3 py-2 border-b border-border text-xs hover:bg-muted/30 ${
                  i === previewIdx ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                }`}
              >
                <div className="font-medium">
                  {m.name} 선생님 {m.ls_role === 'leader' && <span className="text-primary text-[10px]">·대표</span>}
                  <span className="text-muted-foreground ml-1">· {m.phone}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {m.school_name ?? '-'} · 학급플랜 7개월권 / 40명
                </div>
              </button>
            ))}
            {total === 0 && (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">대상자 없음</div>
            )}
          </div>

          {/* 미리보기 */}
          <div className="overflow-y-auto border border-border rounded-lg bg-yellow-50/40">
            <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground bg-yellow-50 sticky top-0 border-b border-yellow-200">
              알림톡 미리보기 — TS_6206 · {previewTarget?.name ?? '-'}
            </div>
            {previewTarget ? (
              <pre className="px-3 py-3 text-[11px] whitespace-pre-wrap font-sans leading-relaxed">
                {previewMessage(previewTarget)}
              </pre>
            ) : (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">대상자 선택</div>
            )}
            <div className="px-3 py-2 text-[10px] text-muted-foreground border-t border-yellow-200 italic">
              * 실제 발송 메시지는 Aligo 등록 템플릿(TS_6206) 기준. 쿠폰 코드는 발급 시 자동 생성됩니다.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>취소</Button>
          <Button onClick={onConfirm} disabled={sending || total === 0}>
            {sending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />발급 중...</>
                     : <><Award className="h-4 w-4 mr-1" />{total}명에게 발급</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function statusBadge(s: string): string {
  if (s === '결제완료') return 'bg-teal-100 text-teal-700';
  if (s === '발급완료') return 'bg-emerald-100 text-emerald-700';
  if (s === '일부결제') return 'bg-amber-100 text-amber-700';
  if (s === '견적발송') return 'bg-blue-100 text-blue-700';
  if (s === '이탈') return 'bg-red-100 text-red-700';
  return 'bg-muted text-muted-foreground';
}
