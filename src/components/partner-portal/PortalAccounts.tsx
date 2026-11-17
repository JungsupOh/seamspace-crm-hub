// 포털의 "계정" 구역 — **파트너 관리자에게만** 보인다 (LEAD-S7-5)
//
// 쓰기는 전부 엣지 함수 `partner-accounts` 로 간다. 화면이 막는 것(자기 자신·마지막
// 관리자)은 **편의일 뿐**이고 서버가 다시 판단한다.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users } from 'lucide-react';

import { makeT, type Msg, type PartnerLocale } from '@/lib/partner-i18n';
import { ACCOUNT_MSG, AUDIT_ACTION_MSG, ROLE_MSG, STATUS_MSG } from '@/lib/partnerPortalMsg';
import {
  ROLE_OPTIONS, callPartnerAccounts, cannotDeactivate, getPartnerAccounts,
  getPartnerAuditLog, type PartnerAccount, type PartnerRole,
} from '@/lib/partnerAccounts';

interface Props {
  partnerId: string;
  locale: PartnerLocale;
  myId: string;
  /** `partner_admin` 일 때만 이 구역을 그린다 */
  isPartnerAdmin: boolean;
}

export default function PortalAccounts({ partnerId, locale, myId, isPartnerAdmin }: Props) {
  const t = makeT(locale);
  const qc = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ['portal_accounts', partnerId],
    queryFn: () => getPartnerAccounts(partnerId),
    enabled: isPartnerAdmin,
  });
  const { data: audit } = useQuery({
    queryKey: ['portal_audit', partnerId],
    queryFn: () => getPartnerAuditLog(partnerId, 20),
    enabled: isPartnerAdmin,
  });

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<PartnerRole>('partner_member');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['portal_accounts', partnerId] });
    qc.invalidateQueries({ queryKey: ['portal_audit', partnerId] });
  };

  const run = useMutation({
    mutationFn: (input: Parameters<typeof callPartnerAccounts>[0]) => callPartnerAccounts(input),
    onSuccess: r => {
      if (r.ok) { toast.success(t(ACCOUNT_MSG.sectionTitle)); refresh(); setEmail(''); setName(''); }
      else toast.error(r.message ?? '');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = useMemo(() => accounts ?? [], [accounts]);

  // 관리자가 아니면 **아무것도 보여 주지 않는다**
  if (!isPartnerAdmin) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-1.5">
        <Users className="h-4 w-4" />{t(ACCOUNT_MSG.sectionTitle)}
      </h2>

      {/* 계정 목록 */}
      <div className="space-y-1.5">
        {list.map(a => (
          <AccountRow key={a.id} acc={a} myId={myId} all={list} t={t}
            busy={run.isPending} onRun={i => run.mutate(i)} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t(ACCOUNT_MSG.keepsHistory)}</p>

      {/* 초대 */}
      <div className="rounded border p-3 space-y-2">
        <h3 className="text-xs font-semibold">{t(ACCOUNT_MSG.invite)}</h3>
        <p className="text-[11px] text-muted-foreground">{t(ACCOUNT_MSG.inviteHint)}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">{t(ACCOUNT_MSG.email)}</Label>
            <Input className="h-8 text-sm" type="email" value={email}
              onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{t(ACCOUNT_MSG.name)}</Label>
            <Input className="h-8 text-sm" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{t(ACCOUNT_MSG.role)}</Label>
            <select className="w-full h-8 text-sm rounded-md border bg-background px-2"
              value={role} onChange={e => setRole(e.target.value as PartnerRole)}>
              {ROLE_OPTIONS.map(r => (
                <option key={r} value={r}>{t(ROLE_MSG[r])}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{t(ACCOUNT_MSG.roleHint)}</p>
        <Button size="sm" className="h-8 text-xs" disabled={run.isPending || !email.trim()}
          onClick={() => run.mutate({ action: 'invite', email: email.trim(), name, role })}>
          {t(ACCOUNT_MSG.send)}
        </Button>
      </div>

      {/* 감사 기록 */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          {t(ACCOUNT_MSG.auditTitle)} ({audit?.length ?? 0})
        </summary>
        <div className="mt-2 space-y-1">
          {(audit ?? []).length === 0
            ? <p className="text-muted-foreground">{t(ACCOUNT_MSG.auditEmpty)}</p>
            : (audit ?? []).map(r => (
              <div key={r.id} className="flex flex-wrap gap-x-2 rounded border px-2 py-1">
                <span>{r.created_at.slice(0, 16).replace('T', ' ')}</span>
                <span className="font-medium">
                  {t(AUDIT_ACTION_MSG[r.action as keyof typeof AUDIT_ACTION_MSG]
                     ?? ACCOUNT_MSG.auditTitle)}
                </span>
                {typeof r.meta?.email === 'string' && (
                  <span className="text-muted-foreground">{r.meta.email}</span>
                )}
                {typeof r.meta?.role === 'string' && (
                  <span className="text-muted-foreground">{String(r.meta.role)}</span>
                )}
              </div>
            ))}
        </div>
      </details>
    </section>
  );
}

function AccountRow({ acc, myId, all, t, busy, onRun }: {
  acc: PartnerAccount; myId: string; all: readonly PartnerAccount[];
  t: (m: Msg) => string; busy: boolean;
  onRun: (i: Parameters<typeof callPartnerAccounts>[0]) => void;
}) {
  const blocked = cannotDeactivate(acc, myId, all);
  const inactive = acc.status === 'inactive';

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
      inactive ? 'opacity-60' : ''}`}>
      <span className="font-medium">{acc.name || '—'}</span>
      <Badge variant="outline" className="h-4 px-1 text-[10px]">
        {t(ROLE_MSG[acc.role] ?? ACCOUNT_MSG.roleMember)}
      </Badge>
      <Badge variant={inactive ? 'secondary' : 'default'} className="h-4 px-1 text-[10px]">
        {t(STATUS_MSG[(acc.status ?? 'active') as keyof typeof STATUS_MSG] ?? ACCOUNT_MSG.statusActive)}
      </Badge>
      {acc.id === myId && <span className="text-muted-foreground">({t(ACCOUNT_MSG.roleAdmin)})</span>}

      <div className="ml-auto flex items-center gap-1">
        {/* 역할 변경 — 관리자는 바꾸지 않는다(우리만) */}
        {acc.role !== 'partner_admin' && !inactive && (
          <select className="h-7 text-[11px] rounded border bg-background px-1"
            value={acc.role} disabled={busy}
            onChange={e => onRun({ action: 'changeRole', userId: acc.id,
              role: e.target.value as PartnerRole })}>
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{t(ROLE_MSG[r])}</option>)}
          </select>
        )}
        {inactive
          ? (
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy}
              onClick={() => onRun({ action: 'reactivate', userId: acc.id })}>
              {t(ACCOUNT_MSG.reactivate)}
            </Button>
          )
          : (
            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-destructive"
              disabled={busy || blocked !== null}
              title={blocked === 'self' ? t(ACCOUNT_MSG.cannotSelf)
                : blocked === 'last_admin' ? t(ACCOUNT_MSG.cannotLastAdmin) : undefined}
              onClick={() => onRun({ action: 'deactivate', userId: acc.id })}>
              {t(ACCOUNT_MSG.deactivate)}
            </Button>
          )}
      </div>
    </div>
  );
}
