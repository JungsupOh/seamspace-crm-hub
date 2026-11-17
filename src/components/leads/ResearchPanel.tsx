// 조사 메모 — LEAD-S1
//
// 제시카가 찾은 기관 정보와 **근거 링크**를 남긴다. 전략의 근거라서 지우지 않는다.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ExternalLink } from 'lucide-react';
import { addResearchNote, getResearchNotes, voidResearchNote, type Actor } from '@/lib/leadsApi';
import { buildResearch, buildVoid } from '@/lib/leadStrategy';
import { kstDate } from '@/lib/leadFollowup';

export function ResearchPanel({ leadId, actor }: { leadId: string; actor: Actor }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', body: '', sourceLabel: '', sourceUrl: '' });
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const { data: rows } = useQuery({
    queryKey: ['lead_research', leadId], queryFn: () => getResearchNotes(leadId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead_research', leadId] });

  const add = useMutation({
    mutationFn: () => {
      const v = buildResearch({
        leadId, title: f.title, body: f.body,
        sourceLabel: f.sourceLabel, sourceUrl: f.sourceUrl,
        collectedBy: actor.name ?? undefined,
      });
      if (v.ok !== true) throw new Error('error' in v ? v.error : '저장할 수 없습니다.');
      return addResearchNote(v.row, actor);
    },
    onSuccess: () => {
      toast.success('조사 메모를 남겼습니다');
      setF({ title: '', body: '', sourceLabel: '', sourceUrl: '' });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      const v = buildVoid(reason);
      if (v.ok !== true) throw new Error('error' in v ? v.error : '취소할 수 없습니다.');
      return voidResearchNote(id, v.patch);
    },
    onSuccess: () => { toast.success('취소 표시했습니다'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const askCancel = (id: string) => {
    const reason = window.prompt('취소 사유를 적어 주세요 (메모는 지워지지 않고 취소로 표시됩니다)');
    if (reason === null) return;
    cancel.mutate({ id, reason });
  };

  return (
    <div className="space-y-2.5">
      <div className="space-y-2">
        <div>
          <Label className="text-xs">제목</Label>
          <Input className="h-9" value={f.title} onChange={e => set('title', e.target.value)}
            placeholder="예: 기관 규모·담당 조직 확인" />
        </div>
        <div>
          <Label className="text-xs">내용</Label>
          <Textarea rows={3} value={f.body} onChange={e => set('body', e.target.value)} />
        </div>
        <div className="flex gap-2">
          <div className="w-[150px]">
            <Label className="text-xs">출처 이름</Label>
            <Input className="h-9" value={f.sourceLabel} onChange={e => set('sourceLabel', e.target.value)}
              placeholder="기관 홈페이지" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">근거 링크</Label>
            <Input className="h-9" value={f.sourceUrl} onChange={e => set('sourceUrl', e.target.value)}
              placeholder="https://…" />
          </div>
        </div>
        <Button size="sm" disabled={!f.title.trim() || add.isPending} onClick={() => add.mutate()}>
          메모 추가
        </Button>
      </div>

      {(rows ?? []).length === 0
        ? <p className="text-xs text-muted-foreground">아직 조사 메모가 없습니다.</p>
        : (
          <ul className="space-y-2">
            {(rows ?? []).map(r => (
              <li key={r.id} className={`rounded-lg border px-3 py-2 ${r.voided_at ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={`text-sm font-medium ${r.voided_at ? 'line-through' : ''}`}>
                      {r.title}
                    </div>
                    {r.body && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{r.body}</p>}
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2">
                      <span>{kstDate(r.created_at)}</span>
                      {r.collected_by && <span>{r.collected_by}</span>}
                      {r.source_label && <span>{r.source_label}</span>}
                      {r.source_url && (
                        <a href={r.source_url} target="_blank" rel="noreferrer noopener"
                          className="inline-flex items-center gap-0.5 hover:underline">
                          링크<ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {r.voided_at && (
                      <p className="text-xs text-muted-foreground mt-1">취소됨 — {r.void_reason}</p>
                    )}
                  </div>
                  {!r.voided_at && (
                    <button type="button" onClick={() => askCancel(r.id)}
                      className="text-xs text-muted-foreground hover:text-destructive shrink-0">
                      취소
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      <p className="text-xs text-muted-foreground">메모는 지워지지 않습니다 (전략의 근거).</p>
    </div>
  );
}
