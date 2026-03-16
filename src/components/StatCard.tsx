import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  subtitle?: string;
  className?: string;
}

export function StatCard({ title, value, icon, subtitle, className }: StatCardProps) {
  return (
    <div className={cn('surface-card ring-container p-5', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-meta text-muted-foreground font-medium">{title}</p>
          <p className="text-2xl display-heading tabular mt-1">{value}</p>
          {subtitle && <p className="text-meta text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
    </div>
  );
}
