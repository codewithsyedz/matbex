import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Layout-matched skeletons for the Staff & Payroll screens.
 * Dimensions mirror the real markup so nothing shifts when data lands
 * (important on slow mobile networks).
 */

function Bar({ className }: { className?: string }) {
  return <div className={`rounded skeleton-shimmer ${className ?? ""}`} />;
}

/** Mirrors StaffSummaryCards grid: 2 cols mobile / 4 cols desktop. */
export function StaffSummaryCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 md:gap-3 lg:gap-4">
              <Bar className="h-8 w-8 md:h-11 md:w-11 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Bar className="h-3 w-16 md:w-20" />
                <Bar className="h-5 md:h-6 lg:h-8 w-20 md:w-24" />
                <Bar className="h-2.5 w-12 md:w-16" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Generic list/table card skeleton used by staff, payroll, advances tabs. */
export function StaffTableCardSkeleton({
  rows = 6,
  toolbar = true,
}: {
  rows?: number;
  toolbar?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <Bar className="h-5 w-40" />
        <Bar className="h-3.5 w-56 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-4">
        {toolbar && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Bar className="h-10 w-full sm:flex-1" />
            <Bar className="h-10 w-full sm:w-40" />
          </div>
        )}
        <div className="space-y-2">
          {[...Array(rows)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border p-3"
              style={{ opacity: 1 - i * 0.08 }}
            >
              <Bar className="h-9 w-9 shrink-0 rounded-full" />
              <div className="flex-1 min-w-0 space-y-2">
                <Bar className="h-3.5 w-1/2" />
                <Bar className="h-3 w-1/3" />
              </div>
              <Bar className="h-6 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Payroll tab: two KPI cards above the records table. */
export function PayrollManagerSkeleton() {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Bar className="h-11 w-11 shrink-0 rounded-lg" />
                <div className="space-y-2">
                  <Bar className="h-3.5 w-28" />
                  <Bar className="h-7 w-32" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <StaffTableCardSkeleton rows={5} />
    </div>
  );
}

/** Fiscal month payable breakdown: header badges + totals + rows. */
export function PayableBreakdownSkeleton() {
  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="space-y-2">
            <Bar className="h-5 w-52 max-w-full" />
            <Bar className="h-3.5 w-64 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Bar className="h-6 w-24" />
            <Bar className="h-6 w-20" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <Bar className="h-3 w-16" />
              <Bar className="h-6 w-20" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2" style={{ opacity: 1 - i * 0.1 }}>
              <div className="flex items-center justify-between gap-3">
                <Bar className="h-3.5 w-1/3" />
                <Bar className="h-3.5 w-16 shrink-0" />
              </div>
              <Bar className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
