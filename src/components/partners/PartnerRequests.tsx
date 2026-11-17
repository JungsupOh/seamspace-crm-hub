// 관리자: 파트너가 보낸 요청 목록 (LEAD-S7-4)
//
// 추가 구매·사용 불가 처리 요청을 한 곳에서 본다. 할 수 있는 것은 **처리 표시뿐**이다 —
// 요청 내용(종류·대상·수량·사유)은 파트너가 보낸 사실이라 고치지 않는다.
//
// ⚠️ "처리함"은 **표시**다. 추가 구매는 계약·구매 원장에 직접 넣어야 하고,
//    사용 불가 처리는 쿠폰 차단 API 가 없어 원장 표시까지만이다(브리프 5항).

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Inbox } from 'lucide-react';

import {
  getPartnerRequests, markRequestHandled, type PartnerRequestRow,
} from '@/lib/partnerContractsApi';
import { seatMonthsLabel } from '@/lib/partnerContractForm';

export const REQUEST_KIND_LABEL: Record<PartnerRequestRow['kind'], string> = {
  purchase: '추가 구매 요청',
  revoke: '사용 불가 처리 요청',
};

export const HANDLED_HINT =
  '"처리함"은 표시일 뿐입니다. 추가 구매는 계약의 구매 원장에 직접 넣어야 하고, '
  + '사용 불가 처리는 쿠폰 차단 API 가 없어 원장 표시까지만입니다.';

interface Props {
  /** 지금 로그인한 관리자 — 누가 처리했는지 남긴다 */
  adminId: string;
  /** 이 파트너의 요청만 보여 준다(비우면 전체) */
  partnerId?: string;
  partnerNames?: Map<string, string>;
}

export default function PartnerRequests({ adminId, partnerId, partnerNames }: Props) {
  const qc = useQueryClient();
  const [showHandled, setShowHandled] = useState(false);

  const { data: all } = useQuery({
    queryKey: ['partner_requests', showHandled],
    queryFn: () => getPartnerRequests(!showHandled),
  });

  const rows = useMemo(
    () => (all ?? []).filter(r => !partnerId || r.partner_id === partnerId),
    [all, partnerId]);

  const open = rows.filter(r => r.status === 'open');

  if (rows.length === 0 && !showHandled) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          파트너 요청
        </h3>
        {open.length > 0 && (
          <Badge variant="destructive" className="h-5 px-1.5 text-[11px]">
            열린 요청 {open.length}
          </Badge>
        )}
        <Button size="sm" variant="ghost" className="h-6 text-[11px] ml-auto"
          onClick={() => setShowHandled(v => !v)}>
          {showHandled ? '열린 것만' : '처리한 것도'}
        </Button>
      </div>

      {rows.length === 0
        ? <p className="text-xs text-muted-foreground">요청이 없습니다.</p>
        : (
          <div className="space-y-1.5">
            {rows.map(r => (
              <RequestRow key={r.id} row={r} adminId={adminId}
                partnerName={partnerNames?.get(r.partner_id)}
                onDone={() => qc.invalidateQueries({ queryKey: ['partner_requests'] })} />
            ))}
          </div>
        )}

      <p className="text-[11px] text-muted-foreground">{HANDLED_HINT}</p>
    </section>
  );
}

function RequestRow({ row, adminId, partnerName, onDone }: {
  row: PartnerRequestRow; adminId: string; partnerName?: string; onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const mark = useMutation({
    mutationFn: (status: 'handled' | 'dismissed') =>
      markRequestHandled(row.id, adminId, status, note),
    onSuccess: () => { toast.success('요청을 처리로 표시했습니다'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const target = row.contract_id ?? row.license_id ?? '';
  const isOpen = row.status === 'open';

  return (
    <div className={`rounded border px-2.5 py-2 text-xs space-y-1 ${isOpen ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={row.kind === 'purchase' ? 'default' : 'secondary'}
          className="h-4 px-1 text-[10px]">
          {REQUEST_KIND_LABEL[row.kind]}
        </Badge>
        {partnerName && <span className="font-medium">{partnerName}</span>}
        <span className="text-muted-foreground">{row.requested_at.slice(0, 10)}</span>
        {row.seat_months !== null && <span>{seatMonthsLabel(row.seat_months)}</span>}
        <span className="text-muted-foreground">
          {row.kind === 'purchase' ? '계약' : '이용권'} {target.slice(0, 8)}
        </span>
        {!isOpen && (
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {row.status === 'handled' ? '처리함' : '보류'}
          </Badge>
        )}
      </div>

      {row.reason && <p className="text-muted-foreground">사유: {row.reason}</p>}
      {row.handled_note && <p className="text-muted-foreground">처리 메모: {row.handled_note}</p>}

      {isOpen && (
        <div className="flex items-center gap-1.5">
          <Input className="h-7 text-xs" placeholder="처리 메모 (선택)"
            value={note} onChange={e => setNote(e.target.value)} />
          <Button size="sm" className="h-7 text-[11px] shrink-0"
            disabled={mark.isPending} onClick={() => mark.mutate('handled')}>
            처리함
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] shrink-0"
            disabled={mark.isPending} onClick={() => mark.mutate('dismissed')}>
            보류
          </Button>
        </div>
      )}
    </div>
  );
}
