import { cn } from "@/lib/utils";

interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div className={cn("p-5 rounded-lg border bg-card", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          <div className="h-3 w-20 rounded skeleton-shimmer" />
          <div className="h-7 w-24 rounded skeleton-shimmer" />
          <div className="h-3 w-16 rounded skeleton-shimmer" />
        </div>
        <div className="h-8 w-8 rounded-md skeleton-shimmer" />
      </div>
    </div>
  );
}

export function SkeletonShiftCard({ className }: SkeletonCardProps) {
  return (
    <div className={cn("p-4 rounded-lg border bg-card min-w-[280px]", className)}>
      <div className="flex items-start justify-between mb-3">
        <div className="h-5 w-16 rounded skeleton-shimmer" />
        <div className="h-4 w-12 rounded skeleton-shimmer" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-24 rounded skeleton-shimmer" />
        <div className="h-4 w-32 rounded skeleton-shimmer" />
        <div className="h-4 w-28 rounded skeleton-shimmer" />
      </div>
    </div>
  );
}
