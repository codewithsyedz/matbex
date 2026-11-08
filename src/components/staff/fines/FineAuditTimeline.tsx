import { format } from "date-fns";
import {
  ArrowRight,
  Ban,
  Check,
  CircleDot,
  FilePlus2,
  Send,
  Wallet,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/hooks/useCurrency";
import { useFineAuditTimeline, type FineTimelineEvent } from "@/hooks/useFineAuditTimeline";

function iconFor(e: FineTimelineEvent) {
  const s = (e.newStatus ?? "").toLowerCase();
  if (e.kind === "payroll") return Wallet;
  if (e.action.toLowerCase().includes("created")) return FilePlus2;
  if (s === "submitted") return Send;
  if (s === "approved" || s === "applied") return Check;
  if (s === "rejected") return X;
  if (s === "cancelled") return Ban;
  return CircleDot;
}

export function FineAuditTimeline({ fineId }: { fineId?: string }) {
  const { format: fmt } = useCurrency();
  const { data, isLoading } = useFineAuditTimeline(fineId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const events = data?.events ?? [];
  const amountChanged =
    data?.originalAmount != null &&
    data?.currentAmount != null &&
    data.originalAmount !== data.currentAmount;

  return (
    <div className="space-y-4">
      {/* Amount provenance */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 p-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Original amount</p>
          <p className="font-medium">{fmt(Number(data?.originalAmount ?? 0))}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Current amount</p>
          <p className={`font-medium ${amountChanged ? "text-amber-600 dark:text-amber-400" : ""}`}>
            {fmt(Number(data?.currentAmount ?? 0))}
          </p>
        </div>
      </div>

      {/* Payroll application */}
      {data?.payroll && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Wallet className="h-4 w-4 text-primary" /> Applied to payroll
          </div>
          <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
            <span>
              Period {data.payroll.period_start ?? "—"} → {data.payroll.period_end ?? "—"}
            </span>
            {data.payroll.payment_date && <span>Paid on {data.payroll.payment_date}</span>}
            <span>
              Gross {fmt(Number(data.payroll.gross_wage ?? 0))} · Fines deducted{" "}
              {fmt(Number(data.payroll.fines_deducted ?? 0))}
            </span>
            {data.fine?.applied_at && (
              <span>
                Recorded {format(new Date(data.fine.applied_at), "dd MMM yyyy HH:mm")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history recorded for this fine yet.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border/60 pl-5">
          {events.map((e) => {
            const Icon = iconFor(e);
            const changedAmount =
              e.oldAmount != null && e.newAmount != null && e.oldAmount !== e.newAmount;
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background">
                  <Icon className="h-3 w-3 text-muted-foreground" />
                </span>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{e.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(e.at), "dd MMM yyyy HH:mm")}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  by {e.actorName ?? "System"}
                </p>
                {(e.oldStatus || e.newStatus) && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs">
                    {e.oldStatus && (
                      <Badge variant="outline" className="capitalize">
                        {e.oldStatus.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {e.oldStatus && e.newStatus && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    )}
                    {e.newStatus && (
                      <Badge variant="outline" className="capitalize">
                        {e.newStatus.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                )}
                {changedAmount && (
                  <p className="mt-1 text-xs">
                    Amount {fmt(Number(e.oldAmount))} → <span className="font-medium">{fmt(Number(e.newAmount))}</span>
                  </p>
                )}
                {e.detail && <p className="mt-1 text-xs text-muted-foreground">{e.detail}</p>}
                {e.reason && (
                  <p className="mt-1 rounded-md bg-muted/50 p-2 text-xs italic">“{e.reason}”</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}