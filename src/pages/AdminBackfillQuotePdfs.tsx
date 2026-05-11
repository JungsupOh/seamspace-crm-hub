// 어드민 일회성 도구: /order로 생성된 deal_quotes 중 PDF 첨부 누락 건을 일괄 재생성+첨부
// 이메일 발송은 하지 않음 (시스템 내부 정리 목적)

import { useEffect, useState } from 'react';
import { Loader2, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const HEADERS = { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

interface OrphanQuote {
  deal_id: string;
  quote_number: string;
  plan: string;
  qty: number;
  duration: number;
  unit_price: number;
  supply_price: number;
  tax_amount: number;
  final_value: number;
  buyer_name: string;
  buyer_email?: string | null;
  org_name: string;
  quote_date: string;
}

// 플랜명 → s2b용 정규화 (소수학급 플랜 → 소수학급플랜)
function normalizePlanForS2B(plan: string): string {
  const p = plan.trim();
  if (p.includes('소수학급')) return '소수학급플랜';
  if (p.includes('학년'))     return '학년플랜';
  if (p.includes('학교(소)')) return '학교(소)';
  if (p.includes('학교(중)')) return '학교(중)';
  if (p.includes('학교(대)')) return '학교(대)';
  return '학급플랜';
}

export default function AdminBackfillQuotePdfs() {
  const [orphans, setOrphans] = useState<OrphanQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());

  // 누락 견적 로드
  useEffect(() => {
    (async () => {
      try {
        // Web 출처 deal_quotes 중 같은 deal_id + quote_number 키로 deal_files가 없는 행
        // PostgREST에서는 not exists 직접 어려우니 두 단계 조회.
        const dqRes = await fetch(
          `${SUPABASE_URL}/rest/v1/deal_quotes?source=eq.web&select=deal_id,quote_number,plan,qty,duration,unit_price,supply_price,tax_amount,final_value,buyer_name,buyer_email,org_name,quote_date&order=quote_number.desc&limit=200`,
          { headers: HEADERS },
        );
        const all = dqRes.ok ? await dqRes.json() as OrphanQuote[] : [];

        const dfRes = await fetch(
          `${SUPABASE_URL}/rest/v1/deal_files?select=deal_id,slot_key&slot_key=like.quote_%25`,
          { headers: HEADERS },
        );
        const files = dfRes.ok ? await dfRes.json() as { deal_id: string; slot_key: string }[] : [];
        const fileSet = new Set(files.map(f => `${f.deal_id}::${f.slot_key.replace(/^quote_/, '')}`));

        const orphan = all.filter(q => q.deal_id && !fileSet.has(`${q.deal_id}::${q.quote_number}`));
        setOrphans(orphan);
      } catch (e) {
        toast.error(`조회 실패: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const processOne = async (q: OrphanQuote): Promise<void> => {
    const { generateQuotePdfBlob } = await import('@/lib/generateQuotePdf');
    const { uploadDealFile, saveDealFileRecord } = await import('@/lib/storage');
    const planNameForS2b = normalizePlanForS2B(q.plan);
    const { blob, fileName } = await generateQuotePdfBlob({
      quoteNumber: q.quote_number,
      quoteDate:   q.quote_date || new Date().toISOString().slice(0, 10),
      orgName:     q.org_name,
      contactName: q.buyer_name,
      plan:        planNameForS2b,
      duration:    q.duration,
      unitPrice:   q.unit_price,
      licenseQty:  q.qty,
      finalValue:  q.final_value,
      supplyPrice: q.supply_price,
      taxAmount:   q.tax_amount,
      paymentUrl:  `${window.location.origin}/order/pay/${encodeURIComponent(q.quote_number)}`,
    });
    if (!blob) throw new Error('PDF 생성 실패');
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const uploaded = await uploadDealFile(q.deal_id, file);
    await saveDealFileRecord({
      deal_id:   q.deal_id,
      slot_key:  `quote_${q.quote_number}`,
      label:     `견적서 ${q.quote_number} (백필)`,
      file_name: uploaded.name,
      file_url:  uploaded.url,
    });
  };

  const runAll = async () => {
    if (running || orphans.length === 0) return;
    setRunning(true);
    setDone(new Set());
    setFailed(new Map());
    for (const q of orphans) {
      try {
        await processOne(q);
        setDone(prev => new Set(prev).add(q.quote_number));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setFailed(prev => new Map(prev).set(q.quote_number, msg));
        console.error(`[backfill] ${q.quote_number} 실패`, e);
      }
    }
    setRunning(false);
    toast.success(`백필 완료: 성공 ${done.size}건 / 실패 ${failed.size}건`);
  };

  return (
    <div className="container mx-auto p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1">견적서 PDF 백필 도구</h1>
        <p className="text-sm text-muted-foreground">
          /order에서 생성된 deal_quotes 중 PDF 첨부 누락분을 일괄 재생성+첨부합니다.
          이메일은 발송하지 않습니다.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 누락 견적 조회 중...
        </div>
      ) : orphans.length === 0 ? (
        <div className="rounded-md border border-teal-200 bg-teal-50 p-4 text-sm text-teal-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> 누락된 견적이 없습니다.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-md border p-3 bg-muted/20">
            <div className="text-sm">
              누락 견적 <b>{orphans.length}</b>건 발견
              {done.size > 0 && <span className="ml-2 text-teal-700">완료 {done.size}</span>}
              {failed.size > 0 && <span className="ml-2 text-rose-700">실패 {failed.size}</span>}
            </div>
            <Button onClick={runAll} disabled={running}>
              {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> 처리 중...</> : <><FileText className="h-4 w-4 mr-2" /> 전체 백필 시작</>}
            </Button>
          </div>

          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2 text-left">견적번호</th>
                  <th className="px-3 py-2 text-left">학교/구매자</th>
                  <th className="px-3 py-2 text-left">플랜</th>
                  <th className="px-3 py-2 text-right">금액</th>
                  <th className="px-3 py-2 text-left">생성일</th>
                </tr>
              </thead>
              <tbody>
                {orphans.map(q => {
                  const isDone   = done.has(q.quote_number);
                  const errMsg   = failed.get(q.quote_number);
                  const status   = isDone ? 'done' : errMsg ? 'failed' : 'pending';
                  return (
                    <tr key={q.quote_number} className="border-t border-border">
                      <td className="px-3 py-2">
                        {status === 'done'   && <CheckCircle2 className="h-4 w-4 text-teal-600" />}
                        {status === 'failed' && <AlertCircle className="h-4 w-4 text-rose-600" titleAccess={errMsg} />}
                        {status === 'pending' && <span className="text-muted-foreground/50">·</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{q.quote_number}</td>
                      <td className="px-3 py-2">{q.org_name} / {q.buyer_name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{q.plan} × {q.qty} / {q.duration}개월</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(q.final_value ?? 0).toLocaleString('ko-KR')}원</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{q.quote_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
