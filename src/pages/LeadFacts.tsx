// 쓸 수 있는 사실 보드 — LEAD-S1 (`/leads/facts`)
//
// 회사가 메일에서 말할 수 있는 사실을 **확정/미정/중단**으로 관리한다.
// 코드에 상수로 박지 않는 이유: 확정과 미정이 섞여 있고(보드게임은 가격은 확정이지만
// 재고·배송은 미정), 바뀌었을 때 **이미 나간 메일을 되돌릴 수 없다**.
//
// ⚠️ `caveat`(주의) 가 이 화면의 핵심이다. 확정 사실에도 **넘지 말아야 할 선**이 있다.
//    상태만 보고 문장을 쓰면 그 선을 넘는다.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { AlertTriangle, ArrowLeft, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

import {
  addFact, getFactLog, getFacts, updateFact, type OutreachFactRow,
} from '@/lib/leadsApi';
import {
  FACT_STATUSES, FACT_STATUS_LABEL, factStatusLogLine, type FactStatus,
} from '@/lib/leadStrategy';
import { kstDate } from '@/lib/leadFollowup';

export default function LeadFacts() {
  const qc = useQueryClient();
  const { userProfile, currentUser } = useAuth();
  const actor = useMemo(
    () => ({ name: userProfile?.name ?? userProfile?.email ?? null, userId: currentUser?.id ?? null }),
    [userProfile, currentUser]);

  const { data: facts, isLoading } = useQuery({ queryKey: ['outreach_facts'], queryFn: getFacts });
  const refresh = () => qc.invalidateQueries({ queryKey: ['outreach_facts'] });

  const [newOpen, setNewOpen] = useState(false);

  if (isLoading) return <div className="p-6"><DataTableSkeleton /></div>;

  const byStatus = (s: FactStatus) => (facts ?? []).filter(f => f.status === s);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/leads" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />리드 관리
          </Link>
          <h1 className="text-xl font-semibold mt-0.5">쓸 수 있는 사실</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            메일에 쓸 수 있는 문장과 <strong>넘지 말아야 할 선</strong>을 관리합니다.
            전략에서는 <strong>확정</strong>만 고를 수 있습니다.
          </p>
        </div>
        <Button size="sm" onClick={() => setNewOpen(v => !v)}>
          <Plus className="h-4 w-4 mr-1.5" />사실 추가
        </Button>
      </div>

      {newOpen && <NewFactForm actor={actor} onSaved={() => { setNewOpen(false); refresh(); }} />}

      {FACT_STATUSES.map(s => {
        const rows = byStatus(s);
        if (rows.length === 0) return null;
        return (
          <section key={s} className="space-y-2">
            <h2 className="text-sm font-medium flex items-center gap-2">
              {FACT_STATUS_LABEL[s]}
              <Badge variant="secondary" className="h-5">{rows.length}</Badge>
            </h2>
            <div className="space-y-2">
              {rows.map(f => <FactCard key={f.id} fact={f} actor={actor} onSaved={refresh} />)}
            </div>
          </section>
        );
      })}

      {(facts ?? []).length === 0 && (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          아직 등록된 사실이 없습니다. 시드(audit/seed_outreach_facts.sql)를 적용하거나 직접 추가하세요.
        </div>
      )}
    </div>
  );
}

function FactCard({ fact, actor, onSaved }: {
  fact: OutreachFactRow;
  actor: { name: string | null; userId: string | null };
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    label_ko: fact.label_ko,
    statement_en: fact.statement_en ?? '',
    statement_ko: fact.statement_ko ?? '',
    caveat: fact.caveat ?? '',
    status: fact.status as FactStatus,
    note: '',
  });
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const { data: log } = useQuery({
    queryKey: ['fact_log', fact.id], queryFn: () => getFactLog(fact.id), enabled: open,
  });

  const statusChanged = f.status !== fact.status;

  const save = useMutation({
    mutationFn: () => updateFact(
      fact.id,
      {
        label_ko: f.label_ko.trim(),
        statement_en: f.statement_en.trim() || null,
        statement_ko: f.statement_ko.trim() || null,
        caveat: f.caveat.trim() || null,
        status: f.status,
      },
      statusChanged ? { from: fact.status, to: f.status, note: f.note } : null,
      actor,
    ),
    onSuccess: () => {
      toast.success(statusChanged
        ? `상태를 바꿨습니다 — ${factStatusLogLine(fact.status, f.status)}`
        : '저장했습니다');
      setF(p => ({ ...p, note: '' }));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmed = fact.status === 'confirmed';

  return (
    <div className="rounded-lg border px-3 py-2.5">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-sm">{fact.label_ko}</span>
              <Badge variant={confirmed ? 'secondary' : 'outline'} className="h-4 px-1 text-[10px]">
                {FACT_STATUS_LABEL[fact.status as FactStatus] ?? fact.status}
              </Badge>
              <code className="text-[10px] text-muted-foreground">{fact.fact_key}</code>
            </div>
            {fact.statement_en && (
              <p className="text-xs text-muted-foreground mt-1">{fact.statement_en}</p>
            )}
            {fact.caveat && (
              <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{fact.caveat}
              </p>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{open ? '접기' : '고치기'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t space-y-2.5">
          <div>
            <Label className="text-xs">이름</Label>
            <Input className="h-9" value={f.label_ko} onChange={e => set('label_ko', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">영어 문장 (메일에 그대로 쓸 수 있게)</Label>
            <Textarea rows={2} value={f.statement_en} onChange={e => set('statement_en', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">한국어 문장</Label>
            <Textarea rows={2} value={f.statement_ko} onChange={e => set('statement_ko', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">주의 — 말하면 안 되는 범위</Label>
            <Textarea rows={2} value={f.caveat} onChange={e => set('caveat', e.target.value)}
              placeholder="예: 재고·배송은 미정이므로 납기를 약속하지 말 것" />
          </div>
          <div className="flex gap-2 items-end">
            <div className="w-[130px]">
              <Label className="text-xs">상태</Label>
              <Select value={f.status} onValueChange={v => set('status', v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FACT_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{FACT_STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {statusChanged && (
              <div className="flex-1">
                <Label className="text-xs">바꾸는 이유 (로그에 남습니다)</Label>
                <Input className="h-9" value={f.note} onChange={e => set('note', e.target.value)} />
              </div>
            )}
          </div>
          {statusChanged && (
            <p className="text-xs text-muted-foreground">
              변경 로그: {factStatusLogLine(fact.status, f.status, f.note)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={save.isPending || !f.label_ko.trim()} onClick={() => save.mutate()}>
              {save.isPending ? '저장 중…' : '저장'}
            </Button>
            {fact.source && <span className="text-xs text-muted-foreground">출처 {fact.source}</span>}
            <span className="text-xs text-muted-foreground">고친 날 {kstDate(fact.updated_at)}</span>
          </div>

          <div className="pt-2 border-t">
            <div className="text-xs font-medium mb-1.5">
              변경 로그 {log ? `(${log.length})` : ''}
              <span className="ml-1.5 font-normal text-muted-foreground">지워지지 않습니다</span>
            </div>
            {!log || log.length === 0
              ? <p className="text-xs text-muted-foreground">아직 변경 기록이 없습니다.</p>
              : (
                <ul className="space-y-0.5">
                  {log.map(l => (
                    <li key={l.id} className="text-xs flex gap-2">
                      <span className="w-[76px] shrink-0 text-muted-foreground tabular-nums">
                        {kstDate(l.changed_at)}
                      </span>
                      <span className="flex-1">{factStatusLogLine(l.old_status, l.new_status, l.note)}</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewFactForm({ actor, onSaved }: {
  actor: { name: string | null; userId: string | null };
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    fact_key: '', label_ko: '', statement_en: '', statement_ko: '',
    caveat: '', status: 'pending' as FactStatus, source: '',
  });
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => addFact({
      fact_key: f.fact_key.trim(),
      label_ko: f.label_ko.trim(),
      statement_en: f.statement_en.trim() || null,
      statement_ko: f.statement_ko.trim() || null,
      caveat: f.caveat.trim() || null,
      status: f.status,
      source: f.source.trim() || null,
    }, actor),
    onSuccess: () => { toast.success('사실을 추가했습니다'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // 코드 이름은 영문 소문자·숫자·밑줄만 — 전략의 fact_ids 가 가리키는 열쇠다
  const keyOk = /^[a-z0-9_]{3,40}$/.test(f.fact_key.trim());

  return (
    <div className="rounded-lg border border-primary/40 px-3 py-3 space-y-2.5">
      <div className="flex gap-2">
        <div className="w-[200px]">
          <Label className="text-xs">코드 이름 (영문·숫자·밑줄)</Label>
          <Input className="h-9" value={f.fact_key} onChange={e => set('fact_key', e.target.value)}
            placeholder="pricing_subscription" />
        </div>
        <div className="flex-1">
          <Label className="text-xs">이름</Label>
          <Input className="h-9" value={f.label_ko} onChange={e => set('label_ko', e.target.value)} />
        </div>
        <div className="w-[120px]">
          <Label className="text-xs">상태</Label>
          <Select value={f.status} onValueChange={v => set('status', v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FACT_STATUSES.map(s => <SelectItem key={s} value={s}>{FACT_STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs">영어 문장</Label>
        <Textarea rows={2} value={f.statement_en} onChange={e => set('statement_en', e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">주의 — 말하면 안 되는 범위</Label>
        <Textarea rows={2} value={f.caveat} onChange={e => set('caveat', e.target.value)} />
      </div>
      <div className="flex gap-2 items-end">
        <div className="w-[200px]">
          <Label className="text-xs">출처</Label>
          <Input className="h-9" value={f.source} onChange={e => set('source', e.target.value)}
            placeholder="James 2026-11-17" />
        </div>
        <Button size="sm" disabled={!keyOk || !f.label_ko.trim() || save.isPending}
          onClick={() => save.mutate()}>
          추가
        </Button>
      </div>
      {!keyOk && f.fact_key.trim() && (
        <p className="text-xs text-muted-foreground">
          코드 이름은 영문 소문자·숫자·밑줄 3~40자입니다(전략이 이 값으로 사실을 가리킵니다).
        </p>
      )}
    </div>
  );
}
