// 현장 기록 · 관심 신호 — LEAD-S1
//
// 부스에서는 한 손으로 적는다. 그래서 **유형 칩 하나만 눌러도 저장된다**(메모는 선택).
// 신호는 규칙이 아니라 **기록**이다 — 전략을 세울 때 읽는 근거다.
// 저장 뒤 수정 UI 는 없다. 정정은 새 줄 + 이전 줄 취소 표시(원장 원칙).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addSignal, getSignals, voidSignal, type Actor } from '@/lib/leadsApi';
import {
  SIGNAL_LABEL, SIGNAL_SOURCES, SIGNAL_SOURCE_LABEL, SIGNAL_TYPES, buildSignal, buildVoid,
  type SignalSource, type SignalType,
} from '@/lib/leadStrategy';
import { kstDate } from '@/lib/leadFollowup';

export function SignalsPanel({ leadId, actor }: { leadId: string; actor: Actor }) {
  const qc = useQueryClient();
  const [type, setType] = useState<SignalType>('pricing');
  const [note, setNote] = useState('');
  const [source, setSource] = useState<SignalSource>('field');

  const { data: rows } = useQuery({ queryKey: ['lead_signals', leadId], queryFn: () => getSignals(leadId) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead_signals', leadId] });

  const add = useMutation({
    mutationFn: () => {
      const v = buildSignal({ leadId, signalType: type, note, source });
      if (v.ok !== true) throw new Error('error' in v ? v.error : '저장할 수 없습니다.');
      return addSignal(v.row, actor);
    },
    onSuccess: () => { toast.success('기록했습니다'); setNote(''); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      const v = buildVoid(reason);
      if (v.ok !== true) throw new Error('error' in v ? v.error : '취소할 수 없습니다.');
      return voidSignal(id, v.patch);
    },
    onSuccess: () => { toast.success('취소 표시했습니다'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const askCancel = (id: string) => {
    const reason = window.prompt('취소 사유를 적어 주세요 (기록은 지워지지 않고 취소로 표시됩니다)');
    if (reason === null) return;
    cancel.mutate({ id, reason });
  };

  const live = (rows ?? []).filter(r => !r.voided_at);

  return (
    <div className="space-y-2.5">
      {/* 유형 칩 — LEAD-S4(c): 고른 것이 **눌렀다**는 뜻이지 저장됐다는 뜻은 아니다.
          저장은 아래 버튼을 눌러야 한다. 체크 표시와 안내 문구로 그 차이를 분명히 한다.
          (칩을 누를 때 바로 저장하는 안을 쓰지 않은 이유는 결과 문서 §S4-4 에 적었다.) */}
      <div className="flex flex-wrap gap-1">
        {SIGNAL_TYPES.map(t => (
          <button key={t} type="button" onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
              type === t
                ? 'border-primary bg-primary text-primary-foreground font-medium'
                : 'hover:bg-muted'}`}>
            {type === t && <Check className="h-3 w-3" />}
            {SIGNAL_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>{SIGNAL_LABEL[type]}</strong> 을 골랐습니다. 아직 저장되지 않았습니다 —
        아래 <strong>"{SIGNAL_LABEL[type]} 추가"</strong> 를 눌러야 기록됩니다.
      </p>

      <div className="flex gap-2">
        <Input className="h-9 flex-1" value={note} onChange={e => setNote(e.target.value)}
          placeholder={type === 'other' ? '무엇인지 한 줄 (필수)' : '한 줄 메모 (선택)'} />
        <Select value={source} onValueChange={v => setSource(v as SignalSource)}>
          <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIGNAL_SOURCES.map(s => <SelectItem key={s} value={s}>{SIGNAL_SOURCE_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-9 whitespace-nowrap" disabled={add.isPending}
          onClick={() => add.mutate()}>
          {add.isPending ? '저장 중…' : `${SIGNAL_LABEL[type]} 추가`}
        </Button>
      </div>

      {(rows ?? []).length === 0
        ? <p className="text-xs text-muted-foreground">아직 기록이 없습니다.</p>
        : (
          <ul className="space-y-1">
            {(rows ?? []).map(r => (
              <li key={r.id}
                className={`text-xs flex items-start gap-2 ${r.voided_at ? 'opacity-50' : ''}`}>
                <span className="text-muted-foreground w-[76px] shrink-0 tabular-nums">
                  {r.observed_at}
                </span>
                <Badge variant="secondary" className="h-4 px-1 text-[10px] shrink-0">
                  {SIGNAL_LABEL[r.signal_type as SignalType] ?? r.signal_type}
                </Badge>
                <span className={`flex-1 ${r.voided_at ? 'line-through' : ''}`}>
                  {r.note ?? '—'}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {SIGNAL_SOURCE_LABEL[r.source as SignalSource] ?? r.source}
                </span>
                {r.voided_at
                  ? <span className="text-muted-foreground shrink-0" title={r.void_reason ?? ''}>취소됨</span>
                  : (
                    <button type="button" onClick={() => askCancel(r.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0">
                      취소
                    </button>
                  )}
              </li>
            ))}
          </ul>
        )}
      <p className="text-xs text-muted-foreground">
        기록은 지워지지 않습니다. 잘못 적었으면 취소로 표시하고 새로 적으세요.
        {live.length !== (rows ?? []).length && ` (취소 ${(rows ?? []).length - live.length}건)`}
      </p>
    </div>
  );
}
