// 아웃리치 — LEAD-S2
//
// **CRM 은 메일을 보내지 않는다**(제시카 추천, James 결정 전까지).
// 초안 작성 → 사실 점검 → 승인 → 예약 → "발송 완료 기록" 까지만 한다.
// 실제 발송은 James 계정으로 제시카가 하고, 돌아와서 "발송 완료로 표시"를 누른다.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Ban, Check, Clock, Copy, Plus, Send } from 'lucide-react';

import {
  addDraft, approveDraft, cancelDraft, getCcLinks, getDrafts, getFacts, getStrategies,
  markDraftSent, scheduleDraft, updateDraftBody, type Actor, type LeadRow, type OutreachDraft,
} from '@/lib/leadsApi';
import {
  DRAFT_STATUS_LABEL, MAIL_LANGS, MAIL_LANG_LABEL, buildCancel, buildDraft, canEditBody,
  appendUnsubscribeLine, checkApproval, checkSuppression, findRiskyPhrases, hasUnsubscribeLine,
  newDraftBody, replaceUnsubscribeLine,
  localTimeAt, offsetLabel, outgoingText, pendingFactPhrase, scheduleFromLocal,
  suggestStageAfterSend, suppressionText, timezoneOffsetFor, unsubscribeLine,
  type DraftStatus, type MailLang,
} from '@/lib/outreach';
import { currentStrategy, factIdsOf, isConfirmed, nextAttemptNo, PENDING_PLACEHOLDER,
  type OutreachFact } from '@/lib/leadStrategy';
import { kstDate } from '@/lib/leadFollowup';
import { stripEmphasis } from './Emphasis';
import { getActivities } from '@/lib/leadsApi';

export function OutreachPanel({ lead, actor, allLeads }: {
  lead: LeadRow; actor: Actor; allLeads: LeadRow[];
}) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['outreach_drafts', lead.id] });
    qc.invalidateQueries({ queryKey: ['outreach_drafts_all'] });
  };

  const { data: drafts } = useQuery({
    queryKey: ['outreach_drafts', lead.id], queryFn: () => getDrafts(lead.id),
  });
  const { data: facts } = useQuery({ queryKey: ['outreach_facts'], queryFn: getFacts });
  const { data: strategies } = useQuery({
    queryKey: ['lead_strategies', lead.id], queryFn: () => getStrategies(lead.id),
  });
  const { data: ccLinks } = useQuery({
    queryKey: ['cc_links', lead.id], queryFn: () => getCcLinks(lead.id),
  });
  const { data: acts } = useQuery({
    queryKey: ['lead_activities', lead.id], queryFn: () => getActivities(lead.id),
  });

  const cur = useMemo(() => currentStrategy(strategies ?? []), [strategies]);
  const sup = useMemo(() => checkSuppression(lead), [lead]);
  const tz = timezoneOffsetFor(lead.country);

  const ccPeople = useMemo(() => {
    const byId = new Map(allLeads.map(l => [l.id, l]));
    return (ccLinks ?? []).map(c => ({
      lead_id: c.cc_lead_id,
      name: byId.get(c.cc_lead_id)?.name ?? null,
      row: byId.get(c.cc_lead_id) ?? null,
    }));
  }, [ccLinks, allLeads]);

  const [writing, setWriting] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {/* CRM 은 보내지 않는다 — 늘 보이게 둔다 */}
      <p className="text-xs text-muted-foreground">
        CRM 은 메일을 <strong>보내지 않습니다</strong>. 초안·승인·예약까지 관리하고,
        발송은 James 계정으로 한 뒤 "발송 완료로 표시"를 누릅니다.
      </p>

      {/* 억제 규칙 */}
      {sup.blocked
        ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs
            text-destructive flex items-start gap-2">
            <Ban className="h-4 w-4 shrink-0 mt-px" />
            <span><strong>보낼 수 없는 대상입니다</strong> — {suppressionText(sup)}</span>
          </div>
        )
        : sup.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {sup.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
          </div>
        )}

      {/* 현재 전략 요약 */}
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
        {cur
          ? (
            <>
              <Badge className="h-4 px-1 text-[10px] mr-1.5">전략 v{cur.version}</Badge>
              {cur.goal ?? '—'}
              {cur.avoid_text && (
                <div className="mt-1 text-destructive">하지 않을 말: {cur.avoid_text}</div>
              )}
            </>
          )
          : <span className="text-muted-foreground">전략이 아직 없습니다. 먼저 접근 전략을 세우세요.</span>}
      </div>

      {!writing && !editId && (
        <Button size="sm" variant="outline" onClick={() => setWriting(true)}>
          <Plus className="h-4 w-4 mr-1.5" />새 초안 작성
        </Button>
      )}

      {(writing || editId) && (
        <DraftEditor
          lead={lead} actor={actor} facts={(facts ?? []) as OutreachFact[]}
          strategyId={cur?.id ?? null}
          existing={editId ? (drafts ?? []).find(d => d.id === editId) ?? null : null}
          onClose={() => { setWriting(false); setEditId(null); }}
          onSaved={() => { setWriting(false); setEditId(null); refresh(); }}
        />
      )}

      {(drafts ?? []).length === 0
        ? <p className="text-xs text-muted-foreground">아직 초안이 없습니다.</p>
        : (
          <ul className="space-y-2">
            {(drafts ?? []).map(d => (
              <DraftCard key={d.id} draft={d} lead={lead} actor={actor}
                ccPeople={ccPeople} tz={tz}
                attemptNo={nextAttemptNo(acts ?? [])}
                onEdit={() => setEditId(d.id)} onChanged={refresh} />
            ))}
          </ul>
        )}
    </div>
  );
}

// ─────────────────────── 초안 작성·수정 ───────────────────────

function DraftEditor({ lead, actor, facts, strategyId, existing, onClose, onSaved }: {
  lead: LeadRow; actor: Actor; facts: OutreachFact[]; strategyId: string | null;
  existing: OutreachDraft | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [lang, setLang] = useState<MailLang>((existing?.language as MailLang) ?? 'en');
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [factIds, setFactIds] = useState<string[]>(factIdsOf(existing?.fact_ids));
  const bodyRef = useState<HTMLTextAreaElement | null>(null);
  const [ta, setTa] = bodyRef;

  const unsubLine = useMemo(
    () => unsubscribeLine(lead.unsubscribe_token, lang), [lead.unsubscribe_token, lang]);

  // 새 초안이면 거부 문구를 **본문 끝에** 미리 넣어 둔다(요구 S2-2 · S4 d).
  // 자리를 결정하는 규칙은 appendUnsubscribeLine 한 곳에 있다 — 그래야 "다시 넣기" 와
  // 기본 본문이 같은 자리에 넣는다.
  useEffect(() => {
    setBody(b => {
      // 새 초안이면 **쓸 자리를 먼저** 비워 둔다(S4 후속).
      if (!b.trim() && !existing) return newDraftBody(lead.unsubscribe_token, lang);
      // 언어를 바꾸면 **그 줄만 갈아 끼운다**. 전에는 한국어로 쓰다 영어로 바꾸면
      // 한글 문구가 그대로 남았다 — `append` 가 **링크로만** 있는지 보는데
      // 링크는 두 언어가 같아서 "이미 있다"로 넘어갔다.
      return replaceUnsubscribeLine(b, lead.unsubscribe_token, lang);
    });
  }, [lang, lead.unsubscribe_token, existing]);

  const hasUnsub = hasUnsubscribeLine(body, lead.unsubscribe_token);
  // LEAD-S4 (f): 점검 대상은 **수신자에게 나갈 글만**(제목+본문).
  const risky = useMemo(() => findRiskyPhrases(outgoingText(subject, body)), [subject, body]);
  const confirmed = facts.filter(isConfirmed);
  const pending = facts.filter(f => f.status === 'pending');

  /** 커서 위치에 문장을 넣는다. 커서를 모르면 끝에 붙인다. */
  const insertAtCursor = (text: string) => {
    const el = ta;
    if (!el) { setBody(b => (b ? `${b}\n${text}` : text)); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    setBody(b => `${b.slice(0, start)}${text}${b.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const insertFact = (f: OutreachFact) => {
    const s = lang === 'ko' ? f.statement_ko : f.statement_en;
    if (!s) { toast.error(`${f.label_ko} — ${lang === 'ko' ? '한국어' : '영어'} 문장이 없습니다`); return; }
    insertAtCursor(s);
    setFactIds(p => (p.includes(f.id) ? p : [...p, f.id]));
  };

  // LEAD-S4 (e): **언어에 맞는 문장만** 넣는다. 전에는 한글 라벨을 괄호로 함께 넣어
  // 영어 메일에 한글이 섞였다(`(구독 가격 (해외): we will confirm…)`).
  const insertPending = (f: OutreachFact) => {
    insertAtCursor(pendingFactPhrase(lang));
    toast.info(`"${f.label_ko}" 는 미정이라 "${PENDING_PLACEHOLDER}" 문구만 넣었습니다`);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (existing) {
        if (!canEditBody(existing.status)) {
          throw new Error('승인된 초안은 고칠 수 없습니다. 새 초안으로 복제하세요.');
        }
        await updateDraftBody(existing.id, { subject, body, language: lang, fact_ids: factIds });
        return;
      }
      const v = buildDraft({ leadId: lead.id, strategyId, language: lang, subject, body, factIds });
      if (v.ok !== true) throw new Error('error' in v ? v.error : '저장할 수 없습니다.');
      await addDraft(v.row, actor);
    },
    onSuccess: () => { toast.success(existing ? '초안을 고쳤습니다' : '초안을 만들었습니다'); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-primary/40 px-3 py-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="h-5 px-1.5">
          {existing ? '초안 고치기' : '새 초안'}
        </Badge>
        <Select value={lang} onValueChange={v => setLang(v as MailLang)}>
          <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MAIL_LANGS.map(l => <SelectItem key={l} value={l}>{MAIL_LANG_LABEL[l]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">제목</Label>
        <Input className="h-9" value={subject} onChange={e => setSubject(e.target.value)} />
      </div>

      <div>
        <Label className="text-xs">본문</Label>
        <Textarea ref={setTa} rows={10} value={body} onChange={e => setBody(e.target.value)}
          className="font-mono text-xs" />
      </div>

      {/* 쓸 수 있는 사실 넣기 */}
      <div>
        <Label className="text-xs">쓸 수 있는 사실 넣기 (커서 위치에 들어갑니다)</Label>
        <div className="flex flex-wrap gap-1 mt-1">
          {confirmed.length === 0 && (
            <span className="text-xs text-muted-foreground">확정된 사실이 없습니다.</span>
          )}
          {confirmed.map(f => (
            <button key={f.id} type="button" onClick={() => insertFact(f)}
              title={f.caveat ? `⚠️ ${stripEmphasis(f.caveat)}` : undefined}
              className={`rounded-full border px-2.5 py-1 text-xs hover:bg-muted ${
                factIds.includes(f.id) ? 'border-primary bg-primary/10' : ''}`}>
              {f.label_ko}
            </button>
          ))}
        </div>
        {pending.length > 0 && (
          <div className="mt-1.5">
            <p className="text-xs text-muted-foreground">
              미정 {pending.length}건은 <strong>"{PENDING_PLACEHOLDER}"</strong> 문구만 넣을 수 있습니다:
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              {pending.map(f => (
                <button key={f.id} type="button" onClick={() => insertPending(f)}
                  className="rounded-full border border-dashed px-2.5 py-1 text-xs hover:bg-muted
                    text-muted-foreground">
                  {f.label_ko}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!hasUnsub && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs
          text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
          <span>
            <strong>수신 거부 문구가 없습니다.</strong> 이 상태로는 승인할 수 없습니다.
            {unsubLine && (
              <button type="button"
                onClick={() => setBody(b => appendUnsubscribeLine(b, lead.unsubscribe_token, lang))}
                className="ml-1.5 underline">다시 넣기</button>
            )}
          </span>
        </div>
      )}

      {risky.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
          <div className="font-medium">문구 점검 (막지는 않습니다)</div>
          {risky.map((h, i) => (
            <div key={i}>
              <strong>{h.label}</strong> — {h.why}
              <div className="opacity-70">…{h.excerpt}…</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>취소</Button>
        <Button size="sm" disabled={save.isPending || !subject.trim() || !body.trim()}
          onClick={() => save.mutate()}>
          {save.isPending ? '저장 중…' : '초안 저장'}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────── 초안 카드 ───────────────────────

function DraftCard({ draft, lead, actor, ccPeople, tz, attemptNo, onEdit, onChanged }: {
  draft: OutreachDraft; lead: LeadRow; actor: Actor;
  ccPeople: Array<{ lead_id: string; name: string | null; row: LeadRow | null }>;
  tz: number | null; attemptNo: number;
  onEdit: () => void; onChanged: () => void;
}) {
  const [open, setOpen] = useState(draft.status === 'draft');
  const [localTime, setLocalTime] = useState('');

  const approval = useMemo(
    () => checkApproval({ lead, subject: draft.subject, body: draft.body }), [lead, draft]);

  const act = (fn: () => Promise<void>, msg: string) => ({
    mutationFn: fn,
    onSuccess: () => { toast.success(msg); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation(act(
    () => approveDraft(draft.id, ccPeople.map(c => ({ lead_id: c.lead_id, name: c.name })), actor),
    '승인했습니다'));

  const schedule = useMutation(act(async () => {
    const iso = scheduleFromLocal(localTime, lead.country);
    if (!iso) throw new Error('예약 시각을 골라 주세요.');
    await scheduleDraft(draft.id, iso);
  }, '예약했습니다'));

  const markSent = useMutation(act(async () => {
    const suggest = suggestStageAfterSend(lead.followup_stage);
    let stage: string | null = null;
    if (suggest) {
      // 자동으로 바꾸지 않는다 — 사람에게 묻는다(요구 S2-2).
      stage = window.confirm(`단계를 "${suggest}" 로 바꿀까요? (취소하면 단계는 그대로입니다)`)
        ? suggest : null;
    }
    await markDraftSent({
      draftId: draft.id, leadId: lead.id, subject: draft.subject ?? '',
      attemptNo, strategyId: draft.strategy_id ?? null, stageAfter: stage, actor,
    });
  }, '발송 완료로 기록했습니다'));

  const cancel = useMutation(act(async () => {
    const reason = window.prompt('취소 사유를 적어 주세요 (초안은 지워지지 않습니다)');
    if (reason === null) throw new Error('취소하지 않았습니다.');
    const v = buildCancel(reason);
    if (v.ok !== true) throw new Error('error' in v ? v.error : '취소할 수 없습니다.');
    await cancelDraft(draft.id, v.patch);
  }, '취소했습니다'));

  const copy = async () => {
    const text = `${draft.subject ?? ''}\n\n${draft.body ?? ''}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('제목과 본문을 복사했습니다 (수신 거부 문구 포함)');
    } catch {
      toast.error('복사에 실패했습니다');
    }
  };

  const status = draft.status as DraftStatus;
  const editable = canEditBody(status);

  return (
    <li className="rounded-lg border px-3 py-2.5">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={status === 'sent' ? 'secondary' : 'outline'}
                className="h-4 px-1 text-[10px]">
                {DRAFT_STATUS_LABEL[status] ?? status}
              </Badge>
              <span className="text-xs">{MAIL_LANG_LABEL[draft.language as MailLang] ?? draft.language}</span>
              <span className="text-sm font-medium truncate">{draft.subject ?? '(제목 없음)'}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
              <span>{kstDate(draft.created_at)}</span>
              {draft.scheduled_at && (
                <span>
                  예약 {localTimeAt(draft.scheduled_at, lead.country) ?? kstDate(draft.scheduled_at)}
                </span>
              )}
              {draft.sent_at && <span>발송 {kstDate(draft.sent_at)}</span>}
              {draft.cancelled_reason && <span>사유 {draft.cancelled_reason}</span>}
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{open ? '접기' : '펼치기'}</span>
        </div>
      </button>

      {open && (
        <div className="mt-2.5 pt-2.5 border-t space-y-2.5">
          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/40 rounded p-2 max-h-64
            overflow-y-auto">{draft.body ?? ''}</pre>

          {ccPeople.length > 0 && (
            <p className="text-xs">
              <span className="text-muted-foreground">CC: </span>
              {ccPeople.map(c => c.name ?? '(이름 없음)').join(', ')} ({ccPeople.length}명)
              {status !== 'draft' && Array.isArray(draft.cc_snapshot) && (
                <span className="text-muted-foreground"> · 승인 시점 {(draft.cc_snapshot as unknown[]).length}명</span>
              )}
            </p>
          )}

          {approval.blockers.length > 0 && status === 'draft' && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2
              text-xs text-destructive space-y-0.5">
              {approval.blockers.map((b, i) => <div key={i}>• {b}</div>)}
            </div>
          )}
          {approval.warnings.length > 0 && status === 'draft' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs
              text-amber-900 space-y-0.5">
              {approval.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy className="h-4 w-4 mr-1.5" />복사
            </Button>

            {editable && (
              <Button size="sm" variant="outline" onClick={onEdit}>고치기</Button>
            )}

            {status === 'draft' && (
              <Button size="sm" disabled={!approval.canApprove || approve.isPending}
                onClick={() => approve.mutate()}>
                <Check className="h-4 w-4 mr-1.5" />승인
              </Button>
            )}

            {(status === 'approved' || status === 'scheduled') && (
              <>
                <Input type="datetime-local" className="h-8 w-[200px]" value={localTime}
                  onChange={e => setLocalTime(e.target.value)} />
                <Button size="sm" variant="outline" disabled={schedule.isPending || !localTime}
                  onClick={() => schedule.mutate()}>
                  <Clock className="h-4 w-4 mr-1.5" />
                  예약{tz !== null ? ` (현지 ${offsetLabel(tz)})` : ''}
                </Button>
              </>
            )}

            {(status === 'approved' || status === 'scheduled') && (
              <Button size="sm" disabled={markSent.isPending} onClick={() => markSent.mutate()}>
                <Send className="h-4 w-4 mr-1.5" />발송 완료로 표시 ({attemptNo}차)
              </Button>
            )}

            {status !== 'sent' && status !== 'cancelled' && (
              <Button size="sm" variant="ghost" disabled={cancel.isPending}
                onClick={() => cancel.mutate()}>
                취소
              </Button>
            )}
          </div>

          {!editable && status !== 'sent' && status !== 'cancelled' && (
            <p className="text-xs text-muted-foreground">
              승인된 초안은 본문을 고칠 수 없습니다. 고쳐야 하면 새 초안을 만드세요.
            </p>
          )}
          {tz === null && (status === 'approved' || status === 'scheduled') && (
            <p className="text-xs text-muted-foreground">
              국가를 모르면 예약 시각을 한국 시각으로 봅니다. 국가를 채우면 현지 시각으로 바뀝니다.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
