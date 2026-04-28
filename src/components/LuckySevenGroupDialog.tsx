// 럭키세븐 그룹 관리 다이얼로그 — Campaigns.tsx 어드민에서 호출
// slug='lucky-seven' 캠페인의 그룹 리스트 + 상세 + 견적서 재발송 + 라이선스 일괄 발급
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, CheckCircle2, Clock, RefreshCw, Mail, Award, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  refreshGroupStatus,
  issueLuckySevenLicenses,
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

export function LuckySevenGroupDialog({ open, onClose, campaignId, campaignName }: Props) {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const groupsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/lucky_seven_groups?campaign_id=eq.${campaignId}&order=created_at.desc&select=*`,
        { headers: HEADERS },
      );
      const rawGroups: LSGroupRow[] = groupsRes.ok ? await groupsRes.json() : [];

      // 각 그룹별 대표자 정보 + 결제 진행률 동시 조회
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaignId]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>럭키세븐 그룹 관리</span>
            <Button size="sm" variant="outline" onClick={reload} disabled={loading} className="h-7">
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> 새로고침
            </Button>
          </DialogTitle>
        </DialogHeader>

        {loading && groups.length === 0 ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">아직 신청된 그룹이 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                campaignName={campaignName}
                expanded={expanded === g.id}
                onToggle={() => setExpanded(expanded === g.id ? null : g.id)}
                onChange={reload}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GroupCard({ group, campaignName, expanded, onToggle, onChange }: {
  group: GroupListItem;
  campaignName: string;
  expanded: boolean;
  onToggle: () => void;
  onChange: () => void;
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

      {expanded && <GroupDetail group={group} campaignName={campaignName} onChange={onChange} />}
    </div>
  );
}

function GroupDetail({ group, campaignName, onChange }: { group: GroupListItem; campaignName: string; onChange: () => void }) {
  const [detail, setDetail] = useState<{ paymentGroups: LSPaymentGroupRow[]; leads: LSLeadRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => { reloadDetail(); }, [group.id]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleIssueLicenses = async () => {
    if (!confirm(`멤버 ${leads.length}명에게 학급플랜 7개월권을 일괄 발급할까요?\n쿠폰 알림톡이 각 멤버 휴대폰으로 발송됩니다.`)) return;
    setBusy(true);
    try {
      await issueLuckySevenLicenses(group, leads);
      toast.success(`라이선스 ${leads.length}건 발급 + 알림톡 발송 완료`);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '라이선스 발급 실패');
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
        <Button size="sm" disabled={busy || !allPaid || isIssued} onClick={handleIssueLicenses}>
          <Award className="h-4 w-4 mr-1" /> {isIssued ? '발급 완료' : '발급'}
        </Button>
      </div>
    </div>
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
