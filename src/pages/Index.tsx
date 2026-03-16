import { useContacts, useDeals, useTrials } from '@/hooks/use-airtable';
import { StatCard } from '@/components/StatCard';
import { GradeBadge } from '@/components/GradeBadge';
import { DataTableSkeleton } from '@/components/DataTableSkeleton';
import { Users, Flame, FlaskConical, Briefcase } from 'lucide-react';
import { getMQLGrade } from '@/lib/grades';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { DEAL_STAGES } from '@/lib/grades';

const MQL_COLORS: Record<string, string> = {
  Hot: 'hsl(0 84% 60%)', Warm: 'hsl(35 92% 50%)', Cold: 'hsl(217 91% 60%)', Inactive: 'hsl(215 16% 47%)'
};

export default function Dashboard() {
  const { data: contacts, isLoading: cl } = useContacts();
  const { data: deals, isLoading: dl } = useDeals();
  const { data: trials, isLoading: tl } = useTrials();

  const today = new Date().toISOString().split('T')[0];

  const hotMQLCount = contacts?.filter(c => {
    const score = c.fields.MQL_Score ?? 0;
    return getMQLGrade(score) === 'Hot' || c.fields.MQL_Grade === 'Hot';
  }).length ?? 0;

  const activeTrials = trials?.filter(t => t.fields.Trial_Result === 'Active' || !t.fields.Trial_Result).length ?? 0;

  const closingDeals = deals?.filter(d => {
    const closeDate = d.fields.Expected_Close_Date;
    if (!closeDate) return false;
    const m = new Date(closeDate).getMonth();
    const y = new Date(closeDate).getFullYear();
    return m === new Date().getMonth() && y === new Date().getFullYear();
  }).length ?? 0;

  const todayFollowups = contacts?.filter(c => c.fields.Next_Followup_Date === today) ?? [];
  const recentDeals = [...(deals ?? [])].sort((a, b) =>
    (b.createdTime || '').localeCompare(a.createdTime || '')
  ).slice(0, 5);

  // MQL distribution
  const mqlDist = { Hot: 0, Warm: 0, Cold: 0, Inactive: 0 };
  contacts?.forEach(c => {
    const grade = c.fields.MQL_Grade || getMQLGrade(c.fields.MQL_Score ?? 0);
    if (grade in mqlDist) mqlDist[grade as keyof typeof mqlDist]++;
  });
  const mqlData = Object.entries(mqlDist).map(([name, value]) => ({ name, value }));

  // Deal stage distribution
  const stageDist: Record<string, number> = {};
  DEAL_STAGES.forEach(s => stageDist[s] = 0);
  deals?.forEach(d => {
    const stage = d.fields.Deal_Stage || '';
    if (stage in stageDist) stageDist[stage]++;
  });
  const stageData = Object.entries(stageDist).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));

  if (cl || dl || tl) {
    return (
      <div className="space-y-6">
        <h1 className="text-section display-heading">대시보드</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="surface-card ring-container p-5 h-24 animate-pulse" />)}
        </div>
        <DataTableSkeleton columns={4} rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-section display-heading">대시보드</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="전체 리드 수" value={contacts?.length ?? 0} icon={<Users className="h-5 w-5" />} />
        <StatCard title="Hot MQL" value={hotMQLCount} icon={<Flame className="h-5 w-5" />} />
        <StatCard title="Trial 활성" value={activeTrials} icon={<FlaskConical className="h-5 w-5" />} />
        <StatCard title="이번 달 클로징" value={closingDeals} icon={<Briefcase className="h-5 w-5" />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* MQL Donut */}
        <div className="surface-card ring-container p-5">
          <h2 className="text-data font-semibold mb-4">MQL Grade 분포</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={mqlData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                  {mqlData.map(entry => (
                    <Cell key={entry.name} fill={MQL_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2">
            {mqlData.map(d => (
              <div key={d.name} className="flex items-center gap-1.5 text-meta">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: MQL_COLORS[d.name] }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </div>

        {/* Deal Stage Bar */}
        <div className="surface-card ring-container p-5">
          <h2 className="text-data font-semibold mb-4">파이프라인 현황</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(222.2 47.4% 11.2%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Today's follow-ups */}
        <div className="surface-card ring-container overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-data font-semibold">오늘의 후속 조치 ({todayFollowups.length})</h2>
          </div>
          {todayFollowups.length === 0 ? (
            <div className="px-5 py-8 text-center text-muted-foreground text-meta">오늘 예정된 팔로업이 없습니다</div>
          ) : (
            <div className="divide-y divide-border">
              {todayFollowups.slice(0, 8).map(c => (
                <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div>
                    <p className="font-medium">{c.fields.Name}</p>
                    <p className="text-meta text-muted-foreground">{c.fields.Email}</p>
                  </div>
                  {c.fields.MQL_Grade && <GradeBadge grade={c.fields.MQL_Grade} type="mql" />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent deals */}
        <div className="surface-card ring-container overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-data font-semibold">최근 추가된 Deal</h2>
          </div>
          {recentDeals.length === 0 ? (
            <div className="px-5 py-8 text-center text-muted-foreground text-meta">등록된 Deal이 없습니다</div>
          ) : (
            <div className="divide-y divide-border">
              {recentDeals.map(d => (
                <div key={d.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div>
                    <p className="font-medium">{d.fields.Deal_Name}</p>
                    <p className="text-meta text-muted-foreground">{d.fields.Deal_Stage?.replace(/_/g, ' ')}</p>
                  </div>
                  {d.fields.MQL_Grade && <GradeBadge grade={d.fields.MQL_Grade} type="mql" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
