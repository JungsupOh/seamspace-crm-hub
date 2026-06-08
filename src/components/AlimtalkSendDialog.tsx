import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Send, AlertCircle, CheckCircle2, Loader2, MessageSquare } from 'lucide-react';
import {
  apiSendAlimtalk,
  type AlimtalkRecipient,
  type AlimtalkTpl,
  type SendResult,
} from '@/lib/alimtalk';

interface Props {
  open:            boolean;
  onOpenChange:    (v: boolean) => void;
  title:           string;
  recipients:      AlimtalkRecipient[];        // 발송 대상자 (이미 발송된 사람은 미리 제외)
  alreadySentCount?: number;                   // 비활성/스킵 표시용
  tpl_code:        AlimtalkTpl;
  stage:           string;
  sent_by?:        string;
  onSent?:         (r: SendResult) => void;    // 발송 완료 콜백 (invalidate 등)
}

const previewMessage = (tpl: AlimtalkTpl, r: AlimtalkRecipient): string => {
  if (tpl === 'UD_5369') {
    return `안녕하세요, ${r.name} 선생님!  ❤️❤️\n` +
      `선생님의 심스페이스 이용권의 사용기간이 곧 만료됩니다.\n` +
      `이용권 연장을 원하시면 이 채팅방에 메시지를 남겨 주세요.\n\n` +
      `⭐현재 이용권 정보⭐\n` +
      `그룹이름: ${r.group_name ?? '-'}\n` +
      `인원: ${r.user_limit} 명\n` +
      `기간: ${r.duration} 개월\n` +
      `만료일: ${r.expiry_date ?? '-'}\n\n` +
      `이용 중 문의사항은 카카오채널의 상담을 이용해 주시길 부탁드립니다. 💬\n\n감사합니다.`;
  }
  // UH_2821
  return `안녕하세요, ${r.name} 선생님!  ❤️❤️\n` +
    `발급해 드린 심스페이스 체험권이 아직 등록되지 않았습니다.\n` +
    `아래 코드로 등록하시고 학생들과 함께 이용해 보세요.\n\n` +
    `⭐체험권 정보⭐\n` +
    `코드: ${r.coupon_code ?? '-'}\n` +
    `기간: ${r.duration} 개월\n` +
    `인원: ${r.user_limit} 명\n\n` +
    `이용 중 문의사항은 카카오채널의 상담을 이용해 주시길 부탁드립니다. 💬\n\n감사합니다.`;
};

export function AlimtalkSendDialog({
  open, onOpenChange, title, recipients,
  alreadySentCount = 0, tpl_code, stage, sent_by, onSent,
}: Props) {
  const [sending, setSending] = useState(false);
  const [result,  setResult]  = useState<SendResult | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const keyOf = (r: AlimtalkRecipient) => `${r.license_source}:${r.license_id}`;
  const total = recipients.length;
  const previewTarget = recipients[Math.min(previewIdx, Math.max(total - 1, 0))];

  // 다이얼로그 오픈 또는 대상 구성이 실제로 바뀔 때만 기본 전원 선택으로 초기화.
  // recipients 배열은 매 렌더 새 참조라, 안정적인 키 문자열로 의존 (열린 채 리렌더돼도 선택 보존)
  const recipientsKey = recipients.map(keyOf).join('|');
  useEffect(() => {
    if (open) setSelected(new Set(recipientsKey ? recipientsKey.split('|') : []));
  }, [open, recipientsKey]);

  // 같은 전화번호가 2건 이상이면 '중복' 표시 (중복 발송 식별용)
  const phoneCounts = new Map<string, number>();
  recipients.forEach(r => {
    const p = (r.phone ?? '').replace(/\D/g, '');
    if (p) phoneCounts.set(p, (phoneCounts.get(p) ?? 0) + 1);
  });

  const selectedRecipients = recipients.filter(r => selected.has(keyOf(r)));
  const selectedCount = selectedRecipients.length;
  const allSelected = total > 0 && selectedCount === total;

  const toggleOne = (r: AlimtalkRecipient) => {
    const k = keyOf(r);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(recipients.map(keyOf)));
  };

  const reset = () => { setSending(false); setResult(null); setPreviewIdx(0); setSelected(new Set()); };
  const close = (v: boolean) => { if (!sending) { onOpenChange(v); if (!v) reset(); } };

  const handleSend = async () => {
    if (selectedCount === 0) { toast.error('선택된 발송 대상이 없습니다'); return; }
    setSending(true);
    try {
      const r = await apiSendAlimtalk({ recipients: selectedRecipients, tpl_code, stage, sent_by });
      setResult(r);
      if (r.failed === 0 && r.sent > 0) {
        toast.success(`${r.sent}명 발송 완료${r.skipped > 0 ? ` (중복 ${r.skipped}건 제외)` : ''}`);
      } else if (r.sent > 0) {
        toast.warning(`${r.sent}명 발송, ${r.failed}건 실패`);
      } else if (r.skipped === selectedCount) {
        toast.info(`전원 이미 발송됨 (${r.skipped}건 스킵)`);
      } else {
        toast.error(`발송 실패: ${r.failed}건`);
      }
      onSent?.(r);
    } catch (e) {
      toast.error(`발송 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            {title}
          </DialogTitle>
          <DialogDescription>
            총 {total}명 중 <strong>{selectedCount}명</strong> 발송 예정
            {alreadySentCount > 0 && (
              <span className="ml-2 text-muted-foreground">
                · 이미 발송된 {alreadySentCount}명은 자동 제외됨
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <ResultPanel result={result} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-hidden flex-1">
            {/* 대상자 리스트 */}
            <div className="overflow-y-auto border border-border rounded-lg">
              <div className="px-3 py-2 flex items-center justify-between bg-muted/30 sticky top-0 z-10">
                <span className="text-[11px] font-medium text-muted-foreground">발송 대상 {selectedCount}/{total}명</span>
                {total > 0 && (
                  <button onClick={toggleAll} className="text-[11px] text-primary hover:underline">
                    {allSelected ? '전체 해제' : '전체 선택'}
                  </button>
                )}
              </div>
              {recipients.map((r, i) => {
                const isSel = selected.has(keyOf(r));
                const dup = (phoneCounts.get((r.phone ?? '').replace(/\D/g, '')) ?? 0) > 1;
                return (
                  <div
                    key={`${r.license_source}:${r.license_id}`}
                    onClick={() => setPreviewIdx(i)}
                    className={`w-full flex items-start gap-2 px-3 py-2 border-b border-border text-xs cursor-pointer hover:bg-muted/30 ${
                      i === previewIdx ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                    } ${isSel ? '' : 'opacity-50'}`}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onClick={e => e.stopPropagation()}
                      onChange={() => toggleOne(r)}
                      className="mt-0.5 accent-primary shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium flex items-center gap-1.5">
                        <span className="truncate">{r.name} 선생님 <span className="text-muted-foreground">· {r.phone}</span></span>
                        {dup && <span className="shrink-0 text-[9px] font-semibold text-amber-700 bg-amber-100 rounded px-1 py-0.5">중복</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {r.group_name ?? '-'} · {r.user_limit}명 / {r.duration}개월
                        {r.expiry_date && ` · 만료 ${r.expiry_date}`}
                      </div>
                    </div>
                  </div>
                );
              })}
              {total === 0 && (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">발송 대상 없음</div>
              )}
            </div>

            {/* 미리보기 */}
            <div className="overflow-y-auto border border-border rounded-lg bg-yellow-50/40">
              <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground bg-yellow-50 sticky top-0 border-b border-yellow-200">
                미리보기 — {tpl_code} · {previewTarget?.name ?? '-'}
              </div>
              {previewTarget ? (
                <pre className="px-3 py-3 text-[11px] whitespace-pre-wrap font-sans leading-relaxed">
                  {previewMessage(tpl_code, previewTarget)}
                </pre>
              ) : (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">대상자 선택</div>
              )}
              <div className="px-3 py-2 text-[10px] text-muted-foreground border-t border-yellow-200 italic">
                * 실제 발송 메시지는 Aligo 등록 템플릿 기준
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <Button variant="outline" onClick={() => close(false)} disabled={sending}>
            {result ? '닫기' : '취소'}
          </Button>
          {!result && (
            <Button onClick={handleSend} disabled={sending || selectedCount === 0}>
              {sending ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" />발송 중...</>)
                       : (<><Send className="h-4 w-4 mr-1" />{selectedCount}명에게 발송</>)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResultPanel({ result }: { result: SendResult }) {
  return (
    <div className="space-y-3 overflow-y-auto flex-1 py-2">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="발송 성공" value={result.sent}    color="text-teal-600"   icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="중복 스킵" value={result.skipped} color="text-slate-500"  icon={<AlertCircle className="h-4 w-4" />} />
        <Stat label="실패"     value={result.failed}  color="text-red-500"    icon={<AlertCircle className="h-4 w-4" />} />
      </div>
      {result.failed > 0 && (
        <div className="border border-red-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 text-xs font-medium bg-red-50 text-red-700">실패 항목</div>
          {result.details.filter(d => d.status === 'failed').map((d, i) => (
            <div key={i} className="px-3 py-2 text-[11px] border-t border-red-100">
              <div className="font-mono text-muted-foreground">{d.license_id}</div>
              {d.error && <div className="text-red-600 mt-0.5">{d.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="surface-card ring-container p-3">
      <div className={`flex items-center gap-1.5 text-xs ${color}`}>{icon}{label}</div>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}
