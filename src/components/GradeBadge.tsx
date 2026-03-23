import { cn } from '@/lib/utils';
import { STAGE_COLOR } from '@/lib/grades';

interface GradeBadgeProps {
  grade: string;
  className?: string;
}

export function GradeBadge({ grade, className }: GradeBadgeProps) {
  const styles = STAGE_COLOR[grade] ?? 'bg-muted text-muted-foreground';
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      styles,
      className
    )}>
      {grade}
    </span>
  );
}
