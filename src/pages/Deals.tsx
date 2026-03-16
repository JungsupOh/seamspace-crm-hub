import { useState } from 'react';
import { useDeals, useCreateDeal, useUpdateDeal } from '@/hooks/use-airtable';
import { GradeBadge } from '@/components/GradeBadge';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, LayoutGrid, List } from 'lucide-react';
import { DEAL_STAGES, DealStage } from '@/lib/grades';
import { DealFields } from '@/types/airtable';
import { AirtableRecord } from '@/lib/airtable';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

export default function Deals() {
  const { data: deals, isLoading } = useDeals();
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<AirtableRecord<DealFields> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createDeal.mutate({
      Deal_Name: fd.get('Deal_Name') as string,
      Deal_Stage: fd.get('Deal_Stage') as string,
      Deal_Type: fd.get('Deal_Type') as string,
      Organization: fd.get('Organization') as string,
      Keyman_Contact: fd.get('Keyman_Contact') as string,
    }, {
      onSuccess: () => { setAddOpen(false); toast.success('Deal이 추가되었습니다'); },
      onError: () => toast.error('오류가 발생했습니다'),
    });
  };

  const handleDrop = (dealId: string, newStage: DealStage) => {
    updateDeal.mutate({ id: dealId, fields: { Deal_Stage: newStage } }, {
      onSuccess: () => toast.success('스테이지가 변경되었습니다'),
    });
    setDragging(null);
  };

  if (isLoading) return <div className="space-y-4"><h1 className="text-section display-heading">딜 관리</h1><DataTableSkeleton /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-section display-heading">딜 관리</h1>
        <div className="flex gap-2">
          <div className="flex ring-container rounded-lg overflow-hidden">
            <Button variant={view === 'kanban' ? 'default' : 'ghost'} size="sm" onClick={() => setView('kanban')}><LayoutGrid className="h-4 w-4" /></Button>
            <Button variant={view === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => setView('list')}><List className="h-4 w-4" /></Button>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />추가</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>새 Deal 추가</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="grid gap-3">
                <div><Label className="text-meta">Deal Name</Label><Input name="Deal_Name" required className="mt-1" /></div>
                <div>
                  <Label className="text-meta">Deal Stage</Label>
                  <Select name="Deal_Stage" defaultValue="Lead">
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-meta">Deal Type</Label><Input name="Deal_Type" required className="mt-1" /></div>
                <div><Label className="text-meta">Organization</Label><Input name="Organization" required className="mt-1" /></div>
                <div><Label className="text-meta">Keyman Contact</Label><Input name="Keyman_Contact" required className="mt-1" /></div>
                <Button type="submit" disabled={createDeal.isPending} className="mt-2">{createDeal.isPending ? '저장 중...' : '저장'}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {DEAL_STAGES.map(stage => {
            const stageDeals = deals?.filter(d => d.fields.Deal_Stage === stage) ?? [];
            return (
              <div
                key={stage}
                className="flex-shrink-0 w-64 bg-muted/30 rounded-xl p-3 min-h-[400px]"
                onDragOver={e => e.preventDefault()}
                onDrop={() => dragging && handleDrop(dragging, stage)}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-meta font-semibold">{stage.replace(/_/g, ' ')}</h3>
                  <span className="text-meta text-muted-foreground tabular">{stageDeals.length}</span>
                </div>
                <div className="space-y-2">
                  {stageDeals.map(deal => (
                    <motion.div
                      key={deal.id}
                      layout
                      transition={{ type: 'tween', ease: [0.25, 0.1, 0.25, 1], duration: 0.2 }}
                      draggable
                      onDragStart={() => setDragging(deal.id)}
                      whileDrag={{ scale: 1.02, rotate: 1 }}
                      onClick={() => setSelected(deal)}
                      className="surface-card ring-container p-4 rounded-xl cursor-grab active:cursor-grabbing hover:ring-primary/30 transition-all"
                    >
                      <p className="font-medium text-data">{deal.fields.Deal_Name}</p>
                      <p className="text-meta text-muted-foreground mt-1">
                        {Array.isArray(deal.fields.Organization) ? deal.fields.Organization[0] : deal.fields.Organization}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        {deal.fields.MQL_Grade && <GradeBadge grade={deal.fields.MQL_Grade} type="mql" />}
                        {deal.fields.Expected_Close_Date && (
                          <span className="text-meta text-muted-foreground tabular">{deal.fields.Expected_Close_Date}</span>
                        )}
                      </div>
                      {deal.fields.Assigned_To && <p className="text-meta text-muted-foreground mt-1">{deal.fields.Assigned_To}</p>}
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="surface-card ring-container overflow-hidden">
          <table className="w-full text-data">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Deal Name','Stage','Organization','MQL Grade','Close Date','담당자'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-meta font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(!deals || deals.length === 0) ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No records found</td></tr>
              ) : deals.map(d => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors" onClick={() => setSelected(d)}>
                  <td className="px-4 py-3 font-medium">{d.fields.Deal_Name}</td>
                  <td className="px-4 py-3">{d.fields.Deal_Stage?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">{Array.isArray(d.fields.Organization) ? d.fields.Organization[0] : d.fields.Organization}</td>
                  <td className="px-4 py-3">{d.fields.MQL_Grade && <GradeBadge grade={d.fields.MQL_Grade} type="mql" />}</td>
                  <td className="px-4 py-3 tabular">{d.fields.Expected_Close_Date}</td>
                  <td className="px-4 py-3">{d.fields.Assigned_To}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="overflow-y-auto">
          {selected && (
            <>
              <SheetHeader><SheetTitle>{selected.fields.Deal_Name}</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-3">
                {Object.entries(selected.fields).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-meta text-muted-foreground">{k}</p>
                    <p className="font-medium">{Array.isArray(v) ? v.join(', ') : String(v ?? '-')}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
