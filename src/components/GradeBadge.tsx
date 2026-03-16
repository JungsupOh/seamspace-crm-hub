import { cn } from '@/lib/utils';
import { getMQLStyles, getHealthStyles, type MQLGrade, type HealthGrade } from '@/lib/grades';

interface GradeBadgeProps {
  grade: string;
  type: 'mql' | 'health';
  className?: string;
}

export function GradeBadge({ grade, type, className }: GradeBadgeProps) {
  const styles = type === 'mql'
    ? getMQLStyles(grade as MQLGrade)
    : getHealthStyles(grade as HealthGrade);

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-md text-meta font-medium tracking-wide uppercase',
      styles,
      className
    )}>
      {grade}
    </span>
  );
}
