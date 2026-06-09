import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Handshake, ChevronDown, ChevronRight, Mail, FileText } from 'lucide-react';
import { getPartnerExpiryEmails, type PartnerExpiryEmail } from '@/lib/partner-expiry';

const statusBadge = (s: string) => {
  if (s === 'sent')   return { label: '발송', cls: 'text-teal-700 bg-teal-50' };
  if (s === 'failed') return { label: '실패', cls: 'text-red-700 bg-red-50' };
  return { label: '스킵', cls: 'text-slate-600 bg-slate-100' };
};

const fmtDate = (s: string) => {
  try { return new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};

// 파트너 만기 안내 메일 발송 내역 + 원문 보기 (만기 알림 섹션 하단)
export function PartnerExpiryHistory() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PartnerExpiryEmail | null>(null);
  const { data: rows } = useQuery({
    queryKey: ['partner_expiry_emails'],
    queryFn: () => getPartnerExpiryEmails(50),
    staleTime: 60 * 1000,
  });
  const list = rows ?? [];

  return (
    <div className="border-t border-border">
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Handshake className="h-4 w-4 text-violet-600" />
          파트너 만기 안내 메일 발송 내역
          {list.length > 0 && (
            <span className="rounded-full bg-violet-100 text-violet-700 text-[11px] font-semibold px-2 py-0.5">{list.length}</span>
          )}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-2 pb-3">
          {list.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">발송 내역이 없습니다.</p>
          ) : (
            <div className="divide-y divide-border">
              {list.map(r => {
                const b = statusBadge(r.status);
                return (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted/20">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        🤝 {r.partner_name ?? '파트너'} · {r.org_name}
                        <span className="text-muted-foreground font-normal"> · {r.license_count}건</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.partner_email ?? '메일 없음'} · 최소만기 {r.soonest_expire_at}
                        {typeof r.soonest_dday === 'number' && ` (D-${r.soonest_dday})`} · {fmtDate(r.sent_at)}
                        {r.triggered_by && r.triggered_by !== 'cron' && ` · ${r.triggered_by}`}
                        {r.error && <span className="text-red-600"> · {r.error}</span>}
                      </div>
                    </div>
                    {r.html && (
                      <button onClick={() => setPreview(r)}
                        className="shrink-0 flex items-center gap-1 text-violet-700 hover:underline">
                        <FileText className="h-3.5 w-3.5" />원문
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={v => { if (!v) setPreview(null); }}>
        <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4" />
              {preview?.subject ?? '메일 원문'}
            </DialogTitle>
          </DialogHeader>
          <div className="text-[11px] text-muted-foreground -mt-1 mb-1">
            받는사람: {preview?.partner_email ?? '-'} · {preview && fmtDate(preview.sent_at)}
          </div>
          {preview?.html && (
            <iframe
              title="메일 원문"
              srcDoc={preview.html}
              className="w-full flex-1 min-h-[60vh] rounded border border-border bg-white"
              sandbox=""
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
