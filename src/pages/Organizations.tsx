import { useState } from 'react';
import { useOrganizations, useContacts, useDeals } from '@/hooks/use-airtable';
import { GradeBadge } from '@/components/GradeBadge';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AirtableRecord } from '@/lib/airtable';
import { OrganizationFields } from '@/types/airtable';

export default function Organizations() {
  const { data: orgs, isLoading } = useOrganizations();
  const { data: contacts } = useContacts();
  const { data: deals } = useDeals();
  const [selected, setSelected] = useState<AirtableRecord<OrganizationFields> | null>(null);

  const linkedContacts = contacts?.filter(c => {
    if (!selected) return false;
    const org = c.fields.Organization;
    return (Array.isArray(org) ? org.includes(selected.id) : org === selected.fields.Org_Name);
  }) ?? [];

  const linkedDeals = deals?.filter(d => {
    if (!selected) return false;
    const org = d.fields.Organization;
    return (Array.isArray(org) ? org.includes(selected.id) : org === selected.fields.Org_Name);
  }) ?? [];

  if (isLoading) return <div className="space-y-4"><h1 className="text-section display-heading">조직 관리</h1><DataTableSkeleton columns={8} /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-section display-heading">조직 관리</h1>
      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-data">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Org Name','Country','Type','Students','License','Health Score','Health Grade','Renewal Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-meta font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(!orgs || orgs.length === 0) ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No records found</td></tr>
              ) : orgs.map(o => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors" onClick={() => setSelected(o)}>
                  <td className="px-4 py-3 font-medium">{o.fields.Org_Name}</td>
                  <td className="px-4 py-3">{o.fields.Country}</td>
                  <td className="px-4 py-3">{o.fields.Type}</td>
                  <td className="px-4 py-3 tabular">{o.fields.Student_Count}</td>
                  <td className="px-4 py-3">{o.fields.Active_License}</td>
                  <td className="px-4 py-3 tabular">{o.fields.Health_Score}</td>
                  <td className="px-4 py-3">{o.fields.Health_Grade && <GradeBadge grade={o.fields.Health_Grade} type="health" />}</td>
                  <td className="px-4 py-3 tabular">{o.fields.Renewal_Date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="overflow-y-auto w-[480px] sm:w-[540px]">
          {selected && (
            <>
              <SheetHeader><SheetTitle>{selected.fields.Org_Name}</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-3">
                {Object.entries(selected.fields).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-meta text-muted-foreground">{k}</p>
                    <p className="font-medium">{Array.isArray(v) ? v.join(', ') : String(v ?? '-')}</p>
                  </div>
                ))}
              </div>
              {linkedContacts.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-data font-semibold mb-2">연결된 연락처 ({linkedContacts.length})</h3>
                  <div className="divide-y divide-border ring-container rounded-lg overflow-hidden">
                    {linkedContacts.map(c => (
                      <div key={c.id} className="px-3 py-2">
                        <p className="font-medium text-data">{c.fields.Name}</p>
                        <p className="text-meta text-muted-foreground">{c.fields.Email}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {linkedDeals.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-data font-semibold mb-2">연결된 Deal ({linkedDeals.length})</h3>
                  <div className="divide-y divide-border ring-container rounded-lg overflow-hidden">
                    {linkedDeals.map(d => (
                      <div key={d.id} className="px-3 py-2">
                        <p className="font-medium text-data">{d.fields.Deal_Name}</p>
                        <p className="text-meta text-muted-foreground">{d.fields.Deal_Stage?.replace(/_/g, ' ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
