// 같은 기관 사람들 + CC 결정 — LEAD-UI2 R6 · R7
//
// 왜 보여 주나
//   한 학교에서 두세 명을 만났는데 서로 모른 채 각각 메일을 보내면 **중복 연락**이 된다.
//   운영 데이터에 그런 묶음이 실제로 있다(소속이 겹치는 기관 22곳).
//
// CC 는 **기본이 없음**이다. 자동으로 넣지 않는다 —
// CC 에 넣으면 받는 사람끼리 서로의 이메일이 보인다.

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Users } from 'lucide-react';
import { MATCH_LABEL, type OrgMate } from '@/lib/leadOrg';
import { countryShort } from '@/lib/countries';
import { emailStatusLabel, isMailable, qualityLabel } from '@/lib/leadEdit';
import { kstDate } from '@/lib/leadFollowup';
import type { LeadRow } from '@/lib/leadsApi';

export const CC_WARNING =
  'CC 에 넣으면 받는 사람에게 서로의 이메일이 보입니다. ' +
  '같은 기관이어도 담당·관심이 다를 수 있으니 필요할 때만 선택하세요.';

export function OrgMatesPanel({
  mates, ccIds, onToggleCc, onOpenLead, recentWarning,
}: {
  mates: OrgMate<LeadRow>[];
  ccIds: Set<string>;
  onToggleCc: (mate: LeadRow, on: boolean) => void;
  onOpenLead: (id: string) => void;
  recentWarning: { name: string; daysAgo: number } | null;
}) {
  if (mates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        같은 기관으로 보이는 다른 리드가 없습니다.
      </p>
    );
  }

  const ccNames = mates.filter(m => ccIds.has(m.lead.id)).map(m => m.lead.name);

  return (
    <div className="space-y-2.5">
      {recentWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
          <span>
            이 기관에는 <strong>{recentWarning.daysAgo}일 전 {recentWarning.name}님</strong>에게
            연락했습니다. 중복으로 보내지 않도록 확인하세요.
          </span>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">이 리드에게 보낼 때 CC:</span>
        <span className="font-medium">
          {ccNames.length > 0 ? `${ccNames.join(', ')} (${ccNames.length}명)` : '없음'}
        </span>
      </div>

      <div className="rounded-lg border divide-y">
        {mates.map(({ lead, kinds, confidence }) => {
          const checked = ccIds.has(lead.id);
          const risky = !isMailable(lead);
          return (
            <div key={lead.id} className="flex items-start gap-2 px-3 py-2">
              <Checkbox
                className="mt-1"
                checked={checked}
                onCheckedChange={v => onToggleCc(lead, v === true)}
                aria-label={`${lead.name} CC 포함`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => onOpenLead(lead.id)}
                    className="font-medium text-sm hover:underline">
                    {lead.name}
                  </button>
                  {lead.position && <span className="text-xs text-muted-foreground">{lead.position}</span>}
                  {confidence === 'maybe' && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">추정</Badge>
                  )}
                  {kinds.map(k => (
                    <Badge key={k} variant="secondary" className="h-4 px-1 text-[10px]">
                      {MATCH_LABEL[k]}
                    </Badge>
                  ))}
                  {lead.email_status === 'hold' && (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">발송 보류</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2.5">
                  <span>{lead.followup_stage || '신규'}</span>
                  <span>가능성 {lead.probability ?? '—'}</span>
                  <span>마지막 접촉 {kstDate(lead.last_contact_at) ?? '없음'}</span>
                  {lead.owner && <span>담당 {lead.owner}</span>}
                  {lead.country && <span>{countryShort(lead.country)}</span>}
                </div>
                {checked && risky && (
                  <p className="text-xs text-destructive mt-1">
                    ⚠️ {emailStatusLabel(lead.email_status)} · 신뢰도 {qualityLabel(lead.email_quality)} —
                    CC 로 보내도 닿지 않을 수 있습니다.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">{CC_WARNING}</p>
    </div>
  );
}
