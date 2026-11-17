// 아웃리치 큐 — `/outreach` (LEAD-S2)
//
// 상태별로 무엇이 밀려 있는지 한눈에 본다. **CRM 은 보내지 않는다** —
// 예약된 것을 James 계정으로 제시카가 보내고 돌아와 "발송 완료"를 누른다.
//
// 한 번에 여러 건 보내기·템플릿 일괄 생성은 이번에 만들지 않는다(다음 단위 후보).

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { ArrowLeft, Ban, ExternalLink } from 'lucide-react';

import { getAllDrafts, getLeads, type LeadRow, type OutreachDraft } from '@/lib/leadsApi';
import {
  DRAFT_STATUSES, DRAFT_STATUS_LABEL, MAIL_LANG_LABEL, checkSuppression, localTimeAt,
  offsetLabel, suppressionText, timezoneOffsetFor, type DraftStatus, type MailLang,
} from '@/lib/outreach';
import { countryShort } from '@/lib/countries';
import { kstDate } from '@/lib/leadFollowup';

export default function Outreach() {
  const { data: drafts, isLoading } = useQuery({
    queryKey: ['outreach_drafts_all'], queryFn: getAllDrafts, staleTime: 1000 * 60,
  });
  const { data: leads } = useQuery({ queryKey: ['leads_all'], queryFn: getLeads });

  const byId = useMemo(() => new Map((leads ?? []).map(l => [l.id, l])), [leads]);
  const [tab, setTab] = useState<DraftStatus>('draft');

  const grouped = useMemo(() => {
    const m = new Map<DraftStatus, OutreachDraft[]>();
    for (const s of DRAFT_STATUSES) m.set(s, []);
    for (const d of drafts ?? []) {
      const s = (DRAFT_STATUSES as readonly string[]).includes(d.status)
        ? (d.status as DraftStatus) : 'draft';
      m.get(s)!.push(d);
    }
    return m;
  }, [drafts]);

  if (isLoading) return <div className="p-6"><DataTableSkeleton /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link to="/leads" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" />리드 관리
        </Link>
        <h1 className="text-xl font-semibold mt-0.5">아웃리치 큐</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          CRM 은 메일을 <strong>보내지 않습니다</strong>. 예약된 초안을 James 계정으로 보낸 뒤
          리드 상세에서 "발송 완료로 표시"를 누르세요.
        </p>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as DraftStatus)}>
        <TabsList className="flex-wrap h-auto min-h-10 gap-1 justify-start">
          {DRAFT_STATUSES.map(s => (
            <TabsTrigger key={s} value={s}>
              {DRAFT_STATUS_LABEL[s]}
              {(grouped.get(s)?.length ?? 0) > 0 && (
                <Badge variant="secondary" className="ml-1.5">{grouped.get(s)!.length}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {DRAFT_STATUSES.map(s => (
          <TabsContent key={s} value={s} className="mt-3">
            {(grouped.get(s)?.length ?? 0) === 0
              ? (
                <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                  {DRAFT_STATUS_LABEL[s]} 상태인 초안이 없습니다.
                </div>
              )
              : <DraftTable rows={grouped.get(s)!} byId={byId} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function DraftTable({ rows, byId }: {
  rows: OutreachDraft[]; byId: Map<string, LeadRow>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">받는 사람</th>
            <th className="px-3 py-2 text-left font-medium">제목</th>
            <th className="px-3 py-2 text-left font-medium">언어</th>
            <th className="px-3 py-2 text-left font-medium">예약 (현지 시각)</th>
            <th className="px-3 py-2 text-left font-medium">상태 확인</th>
            <th className="px-3 py-2 text-right font-medium">수정</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(d => {
            const lead = byId.get(d.lead_id);
            const sup = lead ? checkSuppression(lead) : null;
            const tz = lead ? timezoneOffsetFor(lead.country) : null;
            return (
              <tr key={d.id} className={sup?.blocked ? 'bg-destructive/5' : ''}>
                <td className="px-3 py-2">
                  <div className="font-medium">{lead?.name ?? '(알 수 없음)'}</div>
                  <div className="text-xs text-muted-foreground">
                    {lead?.school_name ?? '—'}
                    {lead?.country && ` · ${countryShort(lead.country)}`}
                    {tz !== null && ` (${offsetLabel(tz)})`}
                  </div>
                </td>
                <td className="px-3 py-2 max-w-[260px] truncate" title={d.subject ?? ''}>
                  {d.subject ?? '(제목 없음)'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {MAIL_LANG_LABEL[d.language as MailLang] ?? d.language}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {d.scheduled_at
                    ? (localTimeAt(d.scheduled_at, lead?.country) ?? kstDate(d.scheduled_at))
                    : '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {sup?.blocked
                    ? (
                      <span className="text-destructive inline-flex items-center gap-1">
                        <Ban className="h-3 w-3" />{suppressionText(sup)}
                      </span>
                    )
                    : sup && sup.warnings.length > 0
                      ? <span className="text-amber-700">⚠️ 확인 필요</span>
                      : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                  {kstDate(d.updated_at)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                    <Link to={`/leads?lead=${encodeURIComponent(d.lead_id)}`}>
                      열기<ExternalLink className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
