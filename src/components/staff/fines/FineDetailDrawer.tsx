import { format as formatDate } from "date-fns";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, Gavel, Paperclip, History } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { FineAuditTimeline } from "@/components/staff/fines/FineAuditTimeline";
import { FineEvidenceManager } from "@/components/staff/fines/FineEvidenceManager";
import type { FineHistoryRow } from "@/hooks/useFinesHistory";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  submitted: "secondary",
  under_review: "secondary",
  approved: "default",
  applied: "default",
  rejected: "destructive",
  cancelled: "destructive",
};

const ts = (v?: string | null) => (v ? formatDate(new Date(v), "dd MMM yyyy HH:mm") : "—");

interface Props {
  fine: FineHistoryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchName: (id: string | null) => string;
  requiresEvidence?: boolean;
}

export function FineDetailDrawer({ fine, open, onOpenChange, branchName, requiresEvidence }: Props) {
  const { format: money } = useCurrency();
  if (!fine) return null;

  const original = fine.original_amount != null ? Number(fine.original_amount) : null;
  const current = Number(fine.amount || 0);
  const changed = original != null && original !== current;
  const delta = changed ? current - (original as number) : 0;

  const actors = [
    { label: "Created", name: fine.createdByName, at: fine.created_at },
    { label: "Submitted", name: undefined, at: fine.submitted_at },
    { label: "Reviewed", name: fine.reviewedByName, at: fine.reviewed_at },
    { label: "Approved", name: fine.approvedByName, at: fine.approved_at },
    { label: "Applied to payroll", name: undefined, at: fine.applied_at },
  ];

  const note = fine.rejection_reason || fine.cancellation_reason || fine.description;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0">
        <ScrollArea className="h-full">
          <div className="p-6 pb-24 space-y-6">
            <SheetHeader className="space-y-2 text-left">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Gavel className="h-4 w-4 text-primary" />
                Fine {fine.fine_number ?? "—"}
                <Badge variant={STATUS_VARIANT[fine.status] ?? "outline"} className="capitalize">
                  {fine.status.replace(/_/g, " ")}
                </Badge>
              </SheetTitle>
              <SheetDescription>
                {fine.staff?.name ?? "—"} · {branchName(fine.branch_id)} ·{" "}
                {fine.violation_type?.name_en ?? "Violation"}
              </SheetDescription>
            </SheetHeader>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Violation date" value={formatDate(new Date(fine.violation_date), "dd MMM yyyy")} />
              <Field label="Payroll month" value={formatDate(new Date(fine.payroll_month), "MMM yyyy")} />
              <Field label="Department / role" value={fine.staff?.role ?? "—"} className="capitalize" />
              <Field label="Attendance ref" value={fine.attendance_reference ?? "—"} />
            </div>

            {/* Before / after amount */}
            <section className="rounded-lg border border-border/60 p-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Amount breakdown</p>
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Original</p>
                  <p className={`font-medium ${changed ? "line-through text-muted-foreground" : ""}`}>
                    {money(original ?? current)}
                  </p>
                </div>
                {changed && (
                  <>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-[11px] text-muted-foreground">Current</p>
                      <p className="font-semibold text-amber-600 dark:text-amber-400">{money(current)}</p>
                    </div>
                    <Badge variant="outline" className="ml-auto">
                      {delta > 0 ? "+" : ""}
                      {money(delta)}
                    </Badge>
                  </>
                )}
                {!changed && (
                  <Badge variant="outline" className="ml-auto">Unchanged</Badge>
                )}
              </div>
              {note && (
                <p className="mt-3 rounded-md bg-muted/50 p-2 text-xs italic">“{note}”</p>
              )}
            </section>

            {/* Actors */}
            <section>
              <p className="text-xs font-medium text-muted-foreground mb-2">Approval actors</p>
              <div className="rounded-lg border border-border/60 divide-y divide-border/50">
                {actors.map((a) => (
                  <div key={a.label} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                    <span className="text-muted-foreground text-xs">{a.label}</span>
                    <span className="text-right">
                      <span className="block">{a.name ?? (a.at ? "—" : "Pending")}</span>
                      <span className="block text-[11px] text-muted-foreground">{ts(a.at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            {/* Timeline */}
            <section>
              <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" /> Approval timeline
              </p>
              <FineAuditTimeline fineId={fine.id} />
            </section>

            <Separator />

            {/* Evidence */}
            <section>
              <p className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" /> Evidence attachments
              </p>
              <FineEvidenceManager
                fineId={fine.id}
                requiresEvidence={requiresEvidence}
                canManage={false}
              />
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`font-medium ${className ?? ""}`}>{value}</p>
    </div>
  );
}
