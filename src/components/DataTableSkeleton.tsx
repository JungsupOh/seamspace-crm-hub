import { Skeleton } from '@/components/ui/skeleton';

export function DataTableSkeleton({ columns = 6, rows = 8 }: { columns?: number; rows?: number }) {
  return (
    <div className="surface-card ring-container overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-data">
          <thead>
            <tr className="border-b border-border">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-3 text-left">
                  <Skeleton className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="border-b border-border last:border-0">
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c} className="px-4 py-3">
                    <Skeleton className="h-3 w-full max-w-[120px]" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
