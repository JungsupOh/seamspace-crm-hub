import { useState } from 'react';
import { useContacts, useCreateContact, useUpdateContact } from '@/hooks/use-airtable';
import { GradeBadge } from '@/components/GradeBadge';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Plus, Search } from 'lucide-react';
import { AirtableRecord } from '@/lib/airtable';
import { ContactFields } from '@/types/airtable';
import { getMQLGrade } from '@/lib/grades';
import { toast } from 'sonner';

export default function Contacts() {
  const { data: contacts, isLoading } = useContacts();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [selected, setSelected] = useState<AirtableRecord<ContactFields> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const filtered = contacts?.filter(c => {
    const f = c.fields;
    const q = search.toLowerCase();
    const matchSearch = !q || [f.Name, f.Email, typeof f.Organization === 'string' ? f.Organization : ''].some(v => v?.toLowerCase().includes(q));
    const matchType = typeFilter === 'all' || f.Contact_Type === typeFilter;
    const matchGrade = gradeFilter === 'all' || (f.MQL_Grade || getMQLGrade(f.MQL_Score ?? 0)) === gradeFilter;
    const matchCountry = countryFilter === 'all' || f.Country === countryFilter;
    return matchSearch && matchType && matchGrade && matchCountry;
  }) ?? [];

  const countries = [...new Set(contacts?.map(c => c.fields.Country).filter(Boolean))];
  const contactTypes = [...new Set(contacts?.map(c => c.fields.Contact_Type).filter(Boolean))];

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createContact.mutate({
      Name: fd.get('Name') as string,
      Email: fd.get('Email') as string,
      Phone: fd.get('Phone') as string,
      Organization: fd.get('Organization') as string,
      Country: fd.get('Country') as string,
      Role: fd.get('Role') as string,
      Lead_Source: fd.get('Lead_Source') as string,
    }, {
      onSuccess: () => { setAddOpen(false); toast.success('연락처가 추가되었습니다'); },
      onError: () => toast.error('오류가 발생했습니다'),
    });
  };

  const handleMQLUpdate = (id: string, score: number) => {
    updateContact.mutate({ id, fields: { MQL_Score: score, MQL_Grade: getMQLGrade(score) } }, {
      onSuccess: () => toast.success('MQL Score가 업데이트되었습니다'),
    });
  };

  if (isLoading) return <div className="space-y-4"><h1 className="text-section display-heading">연락처</h1><DataTableSkeleton columns={8} /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-section display-heading">연락처</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>새 연락처 추가</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="grid gap-3">
              {['Name', 'Email', 'Phone', 'Organization', 'Country', 'Role', 'Lead_Source'].map(field => (
                <div key={field}>
                  <Label className="text-meta">{field}</Label>
                  <Input name={field} required className="mt-1" />
                </div>
              ))}
              <Button type="submit" disabled={createContact.isPending} className="mt-2">
                {createContact.isPending ? '저장 중...' : '저장'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="이름, 이메일, 회사명 검색..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-64 text-data" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-data"><SelectValue placeholder="Contact Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Type</SelectItem>
            {contactTypes.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-32 h-8 text-data"><SelectValue placeholder="MQL Grade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Grade</SelectItem>
            {['Hot','Warm','Cold','Inactive'].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-32 h-8 text-data"><SelectValue placeholder="Country" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 국가</SelectItem>
            {countries.map(c => <SelectItem key={c} value={c!}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="surface-card ring-container overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-data">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Name','Email','Phone','Organization','Country','Type','MQL Grade','Score','Follow-up','담당자'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-meta font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No records found</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors" onClick={() => setSelected(c)}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{c.fields.Name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.fields.Email}</td>
                  <td className="px-4 py-3 tabular">{c.fields.Phone}</td>
                  <td className="px-4 py-3">{Array.isArray(c.fields.Organization) ? c.fields.Organization[0] : c.fields.Organization}</td>
                  <td className="px-4 py-3">{c.fields.Country}</td>
                  <td className="px-4 py-3">{c.fields.Contact_Type}</td>
                  <td className="px-4 py-3">{(c.fields.MQL_Grade || getMQLGrade(c.fields.MQL_Score ?? 0)) && <GradeBadge grade={c.fields.MQL_Grade || getMQLGrade(c.fields.MQL_Score ?? 0)} type="mql" />}</td>
                  <td className="px-4 py-3 tabular">{c.fields.Champion_Score}</td>
                  <td className="px-4 py-3 tabular">{c.fields.Next_Followup_Date}</td>
                  <td className="px-4 py-3">{c.fields.Assigned_To}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="overflow-y-auto">
          {selected && (
            <>
              <SheetHeader><SheetTitle>{selected.fields.Name}</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-3">
                {Object.entries(selected.fields).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-meta text-muted-foreground">{k}</p>
                    <p className="font-medium">{Array.isArray(v) ? v.join(', ') : String(v ?? '-')}</p>
                  </div>
                ))}
                <div className="pt-4 border-t border-border">
                  <Label className="text-meta">MQL Score 수동 입력</Label>
                  <div className="flex gap-2 mt-1">
                    <Input type="number" min={0} max={100} id="mql-input" className="w-24 h-8" defaultValue={selected.fields.MQL_Score ?? 0} />
                    <Button size="sm" onClick={() => {
                      const val = parseInt((document.getElementById('mql-input') as HTMLInputElement).value);
                      if (!isNaN(val)) handleMQLUpdate(selected.id, val);
                    }}>적용</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
