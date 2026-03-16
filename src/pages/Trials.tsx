import { useTrials } from '@/hooks/use-airtable';
import { GradeBadge } from '@/components/GradeBadge';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { daysUntilExpiry } from '@/lib/grades';
import { cn } from '@/lib/utils';

export default function Trials() {
  const { data: trials, isLoading } = useTrials();

  if (isLoading) return <div className="space-y-4"><h1 className="text-section display-heading">Trial PQL</h1><DataTableSkeleton columns={8} /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-section display-heading">Trial PQL</h1>
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-data">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Coupon Code','Contact','PQL Score','PQL Grade','Lessons Created','Students Invited','Trial Result','Days Until Expiry'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-meta font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(!trials || trials.length === 0) ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No records found</td></tr>
              ) : trials.map(t => {
                const days = t.fields.Days_Until_Expiry ?? daysUntilExpiry(t.fields.Expiration_Date);
                const urgent = days !== null && days <= 7;
                return (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{t.fields.Coupon_Code}</td>
                    <td className="px-4 py-3">{Array.isArray(t.fields.Contact) ? t.fields.Contact[0] : t.fields.Contact}</td>
                    <td className="px-4 py-3 tabular">{t.fields.PQL_Score}</td>
                    <td className="px-4 py-3">{t.fields.PQL_Grade && <GradeBadge grade={t.fields.PQL_Grade} type="mql" />}</td>
                    <td className="px-4 py-3 tabular">{t.fields.Lessons_Created}</td>
                    <td className="px-4 py-3 tabular">{t.fields.Students_Invited}</td>
                    <td className="px-4 py-3">{t.fields.Trial_Result}</td>
                    <td className={cn('px-4 py-3 tabular font-medium', urgent && 'text-pql-hot')}>
                      {days !== null ? `${days}일` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
