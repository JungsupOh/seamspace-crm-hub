// 접근 전략 버전 — LEAD-S1
//
// 전략은 **덮어쓰지 않고 쌓는다.** 1판·2판·3판이 그대로 남아야
// "2판으로 3차 접촉했더니 이런 결과였다"를 읽을 수 있다.
//
// 현재 전략 = **가장 큰 version**. 새 버전은 현재 판을 미리 채워서 시작하되
// 근거(무엇을 왜 바꿨나)만 비운다.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Plus } from 'lucide-react';

import { addStrategy, getFacts, getStrategies, type Actor, type StrategyRow } from '@/lib/leadsApi';
import {
  FACT_STATUS_LABEL, PENDING_PLACEHOLDER, buildStrategy, currentStrategy, draftNextVersion,
  factIdsOf, isConfirmed, type OutreachFact, type StrategyDraft,
} from '@/lib/leadStrategy';
import { kstDate } from '@/lib/leadFollowup';
import { Emphasis } from './Emphasis';

export function StrategyPanel({ leadId, actor, reviseFrom, onRevised }: {
  leadId: string;
  actor: Actor;
  /** "결과가 기록됐습니다" 안내에서 넘어온 접촉 id — 새 판의 근거로 잇는다. */
  reviseFrom?: string | null;
  onRevised?: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<StrategyDraft | null>(null);

  const { data: list } = useQuery({
    queryKey: ['lead_strategies', leadId], queryFn: () => getStrategies(leadId),
  });
  const { data: facts } = useQuery({ queryKey: ['outreach_facts'], queryFn: getFacts });

  const cur = useMemo(() => currentStrategy((list ?? []) as StrategyRow[]), [list]);
  const older = useMemo(
    () => ((list ?? []) as StrategyRow[]).filter(s => s.id !== cur?.id), [list, cur]);

  const factById = useMemo(
    () => new Map((facts ?? []).map(f => [f.id, f as OutreachFact])), [facts]);
  const confirmedFacts = useMemo(
    () => (facts ?? []).filter(isConfirmed) as OutreachFact[], [facts]);
  const pendingFacts = useMemo(
    () => (facts ?? []).filter(f => f.status === 'pending') as OutreachFact[], [facts]);

  const startNew = () => setDraft(draftNextVersion((list ?? []) as StrategyRow[], reviseFrom ?? null));

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('작성 중인 전략이 없습니다.');
      const v = buildStrategy(leadId, draft, (facts ?? []) as OutreachFact[]);
      if (v.ok !== true) throw new Error('error' in v ? v.error : '저장할 수 없습니다.');
      return addStrategy(v.row, actor);
    },
    onSuccess: () => {
      toast.success(`전략 v${draft?.version} 을 저장했습니다`);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['lead_strategies', leadId] });
      qc.invalidateQueries({ queryKey: ['strategy_heads'] });
      onRevised?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setD = (k: keyof StrategyDraft, v: unknown) =>
    setDraft(p => (p ? { ...p, [k]: v } : p));

  const toggleFact = (id: string) => setDraft(p => {
    if (!p) return p;
    const has = p.factIds.includes(id);
    return { ...p, factIds: has ? p.factIds.filter(x => x !== id) : [...p.factIds, id] };
  });

  return (
    <div className="space-y-3">
      {/* 현재 전략 */}
      {cur
        ? (
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge className="h-5 px-1.5">현재 전략 v{cur.version}</Badge>
              <span className="text-xs text-muted-foreground">{kstDate(cur.created_at)}</span>
            </div>
            <Row label="목표">{cur.goal ?? '—'}</Row>
            {cur.angle && <Row label="접근 각도">{cur.angle}</Row>}
            {cur.key_points && (
              <Row label="핵심 포인트"><span className="whitespace-pre-wrap">{cur.key_points}</span></Row>
            )}
            {factIdsOf(cur.fact_ids).length > 0 && (
              <Row label="쓸 사실">
                <span className="flex flex-wrap gap-1">
                  {factIdsOf(cur.fact_ids).map(id => {
                    const f = factById.get(id);
                    return (
                      <FactChip key={id} fact={f} />
                    );
                  })}
                </span>
              </Row>
            )}
            {cur.avoid_text && (
              <Row label="하지 않을 말"><span className="text-destructive">{cur.avoid_text}</span></Row>
            )}
            {cur.next_contact_plan && <Row label="다음 접촉">{cur.next_contact_plan}</Row>}
            {cur.rationale && <Row label="근거">{cur.rationale}</Row>}
          </div>
        )
        : <p className="text-xs text-muted-foreground">아직 접근 전략이 없습니다.</p>}

      {!draft && (
        <Button size="sm" variant={cur ? 'outline' : 'default'} onClick={startNew}>
          <Plus className="h-4 w-4 mr-1.5" />
          {cur ? `새 버전 작성 (v${cur.version + 1})` : '전략 1판 작성'}
        </Button>
      )}

      {/* 새 판 작성 */}
      {draft && (
        <div className="rounded-lg border border-primary/40 px-3 py-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-5 px-1.5">작성 중 v{draft.version}</Badge>
            {draft.basedOnActivityId && (
              <span className="text-xs text-muted-foreground">직전 접촉 결과를 근거로</span>
            )}
          </div>

          <F label="이번 접촉의 목표 (필수)">
            <Input className="h-9" value={draft.goal} onChange={e => setD('goal', e.target.value)}
              placeholder="예: 데모 일정 잡기" />
          </F>
          <F label="접근 각도">
            <Input className="h-9" value={draft.angle} onChange={e => setD('angle', e.target.value)}
              placeholder="예: LMS 연동 관심에서 출발" />
          </F>
          <F label="핵심 포인트 (한 줄에 하나)">
            <Textarea rows={3} value={draft.keyPoints} onChange={e => setD('keyPoints', e.target.value)} />
          </F>

          <div>
            <Label className="text-xs">쓸 수 있는 사실 (확정만 고를 수 있습니다)</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {confirmedFacts.length === 0 && (
                <span className="text-xs text-muted-foreground">확정된 사실이 없습니다.</span>
              )}
              {confirmedFacts.map(f => {
                const on = draft.factIds.includes(f.id);
                return (
                  <TooltipProvider key={f.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={() => toggleFact(f.id)}
                          className={`rounded-full border px-2.5 py-1 text-xs transition ${
                            on ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'}`}>
                          {f.label_ko}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        {f.statement_en ?? f.statement_ko ?? f.label_ko}
                        {f.caveat && (
                          <div className="mt-1 text-amber-200">⚠️ <Emphasis text={f.caveat} /></div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
            {pendingFacts.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1.5">
                미정 {pendingFacts.length}건({pendingFacts.map(f => f.label_ko).join(', ')})은
                고를 수 없습니다 — 메일에서는 <strong>"{PENDING_PLACEHOLDER}"</strong>로만 답하세요.
              </p>
            )}
          </div>

          <F label="하지 않을 말">
            <Input className="h-9" value={draft.avoidText} onChange={e => setD('avoidText', e.target.value)}
              placeholder="예: 연동 가능 시점 약속, 가격 숫자" />
          </F>
          <F label="다음 접촉 계획 (채널·시기)">
            <Input className="h-9" value={draft.nextContactPlan}
              onChange={e => setD('nextContactPlan', e.target.value)}
              placeholder="예: 메일 · 3일 뒤" />
          </F>
          <F label={draft.version >= 2 ? '이전 판에서 무엇을 왜 바꿨나 (필수)' : '근거 (선택)'}>
            <Textarea rows={2} value={draft.rationale} onChange={e => setD('rationale', e.target.value)} />
          </F>

          {draft.version >= 2 && (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              저장하면 v{draft.version} 이 새로 쌓입니다. 이전 판은 지워지지 않습니다.
            </p>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>취소</Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? '저장 중…' : `v${draft.version} 저장`}
            </Button>
          </div>
        </div>
      )}

      {/* 이전 버전 */}
      {older.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            이전 버전 {older.length}개
          </summary>
          <ul className="mt-2 space-y-1">
            {older.map(s => (
              <li key={s.id} className="flex gap-2">
                <span className="w-10 shrink-0 text-muted-foreground">v{s.version}</span>
                <span className="w-[76px] shrink-0 text-muted-foreground tabular-nums">
                  {kstDate(s.created_at)}
                </span>
                <span className="flex-1 text-muted-foreground">
                  {s.rationale ?? s.goal ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FactChip({ fact }: { fact?: OutreachFact }) {
  if (!fact) return <Badge variant="outline" className="h-4 px-1 text-[10px]">(없는 사실)</Badge>;
  const ok = isConfirmed(fact);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={ok ? 'secondary' : 'outline'} className="h-4 px-1 text-[10px] cursor-help">
            {fact.label_ko}
            {!ok && ` (${FACT_STATUS_LABEL[fact.status as 'pending'] ?? fact.status})`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          {ok
            ? (fact.statement_en ?? fact.statement_ko ?? fact.label_ko)
            : `지금은 쓸 수 없습니다 — "${PENDING_PLACEHOLDER}"로만 답하세요.`}
          {fact.caveat && (
            <div className="mt-1 text-amber-200">⚠️ <Emphasis text={fact.caveat} /></div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-[70px] shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

function F({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}
