import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Phone, Mail, Building2, Calendar, ExternalLink, Save, Loader2 } from 'lucide-react';
import { useUpdateDeal } from '@/hooks/use-airtable';
import { ALL_DEAL_STAGES, DEAL_STAGE_LABELS, STAGE_COLOR } from '@/lib/grades';
import type { AirtableRecord } from '@/lib/airtable';
import type { DealFields } from '@/types/airtable';

interface Props {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  deal:         AirtableRecord<DealFields> | null;
}

export function DealQuickView({ open, onOpenChange, deal }: Props) {
  const updateDeal = useUpdateDeal();
  const [stage, setStage] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (deal) {
      setStage(deal.fields.Deal_Stage ?? '');
      setNotes(deal.fields.Notes ?? '');
    }
  }, [deal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!deal) return null;
  const f = deal.fields;
  const stageLabel = DEAL_STAGE_LABELS[f.Deal_Stage ?? ''] ?? f.Deal_Stage ?? '-';
  const stageColor = STAGE_COLOR[f.Deal_Stage ?? ''] ?? 'bg-muted text-muted-foreground';

  const dirty = stage !== (f.Deal_Stage ?? '') || notes !== (f.Notes ?? '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Partial<DealFields> = {};
      if (stage !== (f.Deal_Stage ?? '')) updates.Deal_Stage = stage;
      if (notes !== (f.Notes ?? '')) updates.Notes = notes;
      await updateDeal.mutateAsync({ id: deal.id, fields: updates });
      toast.success('저장됨');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {f.Org_Name || f.Deal_Name || '딜 상세'}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${stageColor}`}>
              {stageLabel}
            </span>
          </DialogTitle>
          <DialogDescription>
            {f.Deal_Name && f.Deal_Name !== f.Org_Name && <span className="block">{f.Deal_Name}</span>}
            빠른 보기 · 편집 — 전체 편집은 우측 하단 "딜 관리 열기" 사용
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 담당자 정보 */}
          <Section title="담당자">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {f.Contact_Name && <Field label="이름" value={f.Contact_Name} />}
              {f.Contact_Phone && (
                <Field label="전화">
                  <a href={`tel:${f.Contact_Phone}`} className="text-primary hover:underline flex items-center gap-1">
                    <Phone className="h-3 w-3" />{f.Contact_Phone}
                  </a>
                </Field>
              )}
              {f.Contact_Email && (
                <Field label="이메일">
                  <a href={`mailto:${f.Contact_Email}`} className="text-primary hover:underline flex items-center gap-1 truncate">
                    <Mail className="h-3 w-3 shrink-0" />{f.Contact_Email}
                  </a>
                </Field>
              )}
            </div>
          </Section>

          {/* 견적 정보 */}
          {(f.Quote_Number || f.Final_Contract_Value || f.Quote_Date) && (
            <Section title="견적">
              <div className="grid grid-cols-3 gap-2 text-sm">
                {f.Quote_Number && <Field label="견적번호" value={f.Quote_Number} mono />}
                {f.Quote_Date && <Field label="견적일" value={f.Quote_Date} />}
                {f.Final_Contract_Value != null && f.Final_Contract_Value > 0 && (
                  <Field label="금액" value={`${f.Final_Contract_Value.toLocaleString()}원`} />
                )}
                {f.Quote_Qty && <Field label="총인원" value={`${f.Quote_Qty.toLocaleString()}명`} />}
                {f.License_Duration && <Field label="이용기간" value={`${f.License_Duration}개월`} />}
                {f.License_Code_Count && <Field label="이용권 수" value={`${f.License_Code_Count}장`} />}
              </div>
            </Section>
          )}

          {/* 일자 정보 */}
          {(f.Order_Date || f.Contract_Date || f.Charge_Date || f.Payment_Date) && (
            <Section title="진행 일자">
              <div className="grid grid-cols-3 gap-2 text-sm">
                {f.Order_Date && <Field label="주문일" value={f.Order_Date} />}
                {f.Contract_Date && <Field label="계약일" value={f.Contract_Date} />}
                {f.Charge_Date && <Field label="결제일" value={f.Charge_Date} />}
                {f.Payment_Date && <Field label="입금일" value={f.Payment_Date} />}
              </div>
            </Section>
          )}

          {/* 빠른 편집: 단계 + 메모 */}
          <Section title="빠른 편집">
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">단계</label>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_DEAL_STAGES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">메모</label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="담당자 메모"
                  rows={3}
                  className="text-sm"
                />
              </div>
            </div>
          </Section>
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
          <Link
            to={`/deals?id=${deal.id}`}
            onClick={() => onOpenChange(false)}
            className="text-xs text-primary hover:underline flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />딜 관리 열기 (전체 편집)
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>닫기</Button>
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              저장
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
        <Calendar className="h-3 w-3" />{title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, children, mono }: { label: string; value?: string; children?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {children ?? (
        <p className={`text-sm truncate ${mono ? 'font-mono' : ''}`}>{value ?? '-'}</p>
      )}
    </div>
  );
}
