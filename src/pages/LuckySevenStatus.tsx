// 럭키세븐 결제 진행 상황 조회 — /event/lucky-seven/status
// 그룹 코드 + 대표자 휴대폰으로 본인확인 후 그룹 진행 상태 표시
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertTriangle, CheckCircle2, Clock, ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhone } from '@/lib/utils';
import { fetchGroupByLeaderAuth, type LSGroupRow, type LSPaymentGroupRow, type LSLeadRow, LS_UNIT_PRICE } from '@/lib/luckySeven';

export default function LuckySevenStatus() {
  const [groupCode, setGroupCode] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ group: LSGroupRow; paymentGroups: LSPaymentGroupRow[]; leads: LSLeadRow[] } | null>(null);

  const handleSearch = async () => {
    if (!groupCode.trim() || !phone.trim()) {
      setError('그룹 코드와 대표자 휴대폰을 모두 입력해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGroupByLeaderAuth(groupCode.trim().toUpperCase(), phone);
      if (!res) setError('일치하는 그룹을 찾을 수 없습니다. 그룹 코드와 대표자 휴대폰을 확인해주세요.');
      else setData(res);
    } catch {
      setError('조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 조회 결과 화면
  if (data) {
    const { group, paymentGroups, leads } = data;
    const paid = paymentGroups.filter((p) => p.status === '결제완료').length;
    const total = paymentGroups.length;

    return (
      <div className="min-h-screen bg-muted/20 py-6 px-4">
        <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
          <div className="px-6 pt-5 pb-3 border-b border-border">
            <h1 className="text-base font-semibold">결제 진행 상황</h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{group.group_code}</p>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* 그룹 요약 */}
            <div className="bg-muted/30 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">멤버 수</span><span>{group.member_count}명</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">총 금액</span><span className="font-bold">{group.total_amount.toLocaleString()}원</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">상태</span><span className={statusColor(group.status)}>{group.status}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">결제 진행</span><span>{paid} / {total} 묶음</span></div>
            </div>

            {group.status === '발급완료' && (
              <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 rounded-lg p-3 text-sm">
                <CheckCircle2 className="h-5 w-5 text-teal-600 inline mr-2" />
                이용권이 멤버 휴대폰으로 발송되었습니다.
              </div>
            )}

            {/* 결제 묶음 리스트 */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">결제 묶음</h3>
              {paymentGroups.map((pg) => {
                const memberCount = leads.filter((l) => l.ls_payment_group_id === pg.id).length;
                const isPaid = pg.status === '결제완료';
                return (
                  <div key={pg.id} className={`rounded-lg border p-3 ${isPaid ? 'bg-teal-50/50 dark:bg-teal-950/20 border-teal-200' : 'border-border'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono text-muted-foreground">{pg.quote_number}</span>
                      <span className={`text-xs font-semibold ${isPaid ? 'text-teal-600' : 'text-amber-600'}`}>
                        {isPaid ? <><CheckCircle2 className="h-3 w-3 inline mr-1" />결제 완료</> : <><Clock className="h-3 w-3 inline mr-1" />{pg.status}</>}
                      </span>
                    </div>
                    <div className="text-sm">
                      <div>{pg.payer_name} · {memberCount}명 · <strong>{pg.amount.toLocaleString()}원</strong></div>
                      {pg.paid_at && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          결제일시: {new Date(pg.paid_at).toLocaleString('ko-KR')}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-2">
                      {pg.quote_pdf_url && (
                        <a href={pg.quote_pdf_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                          <Button variant="outline" size="sm" className="w-full text-xs">
                            <FileText className="h-3.5 w-3.5 mr-1" /> 견적서
                          </Button>
                        </a>
                      )}
                      {!isPaid && (
                        <Link to={`/event/lucky-seven/pay/${pg.quote_number}`} className="flex-1">
                          <Button size="sm" className="w-full text-xs">
                            결제하기 <ArrowRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 멤버 명단 */}
            <details className="border border-border rounded-lg p-3">
              <summary className="text-sm font-semibold cursor-pointer">멤버 명단 ({leads.length}명)</summary>
              <ul className="mt-2 text-xs space-y-1">
                {leads.map((m) => (
                  <li key={m.id} className="flex justify-between">
                    <span>{m.ls_member_index}. {m.name} {m.ls_role === 'leader' && <span className="text-primary">·대표</span>}</span>
                    <span className="text-muted-foreground">{m.school_name} · {LS_UNIT_PRICE.toLocaleString()}원</span>
                  </li>
                ))}
              </ul>
            </details>

            <Button variant="outline" className="w-full" onClick={() => setData(null)}>다른 그룹 조회</Button>
          </div>
        </div>
      </div>
    );
  }

  // 본인확인 입력 화면
  return (
    <div className="min-h-screen bg-muted/20 py-6 px-4">
      <div className="max-w-md mx-auto bg-card rounded-xl shadow-lg ring-1 ring-border overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <h1 className="text-base font-semibold">럭키세븐 결제 진행 상황 조회</h1>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            신청 시 발급받은 그룹 코드와 대표자 휴대폰으로 진행 상황을 확인할 수 있습니다.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs">그룹 코드 <span className="text-destructive">*</span></Label>
            <Input value={groupCode} onChange={(e) => setGroupCode(e.target.value.toUpperCase())} placeholder="예: LS26-0001" className="h-10 text-sm font-mono" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">대표자 휴대폰 <span className="text-destructive">*</span></Label>
            <Input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="010-0000-0000" type="tel" className="h-10 text-sm" />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-destructive/10 text-destructive text-xs rounded p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
              {error}
            </div>
          )}

          <Button onClick={handleSearch} disabled={loading} className="w-full h-11">
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />조회 중...</> : '조회하기'}
          </Button>

          <p className="text-[10px] text-muted-foreground text-center">문의: sales@tebahsoft.com</p>
        </div>
      </div>
    </div>
  );
}

function statusColor(s: string): string {
  if (s === '결제완료' || s === '발급완료') return 'text-teal-600 font-semibold';
  if (s === '일부결제') return 'text-amber-600 font-semibold';
  if (s === '이탈') return 'text-destructive';
  return 'text-foreground';
}
