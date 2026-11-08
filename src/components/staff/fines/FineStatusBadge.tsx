import { Badge } from "@/components/ui/badge";
import type { FineStatus } from "@/hooks/useEmployeeFines";

const MAP: Record<FineStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  submitted: { label: "Submitted", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  under_review: { label: "Under Review", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  approved: { label: "Approved", className: "bg-primary/10 text-primary" },
  rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive" },
  applied: { label: "Applied to Payroll", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground line-through" },
};

export function FineStatusBadge({ status }: { status: FineStatus }) {
  const cfg = MAP[status] ?? MAP.draft;
  return (
    <Badge variant="outline" className={`border-transparent font-medium ${cfg.className}`}>
      {cfg.label}
    </Badge>
  );
}