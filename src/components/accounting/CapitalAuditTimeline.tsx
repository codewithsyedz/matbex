import { format } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, RotateCcw, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCapitalAuditTimeline } from "@/hooks/useCapitalAuditTimeline";
import { useCurrency } from "@/hooks/useCurrency";
import { exportToCSV } from "@/lib/exportUtils";
import { Download } from "lucide-react";

interface Props {
  capitalAccountId?: string | null;
  accountLabel?: string;
  branchName?: (id: string | null | undefined) => string;
}

const stamp = (iso?: string) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : format(d, "dd MMM yyyy · HH:mm");
};

export function CapitalAuditTimeline({ capitalAccountId, accountLabel, branchName }: Props) {
  const { format: money } = useCurrency();
  const { data: events = [], isLoading } = useCapitalAuditTimeline(capitalAccountId);

  const exportTimeline = () => {
    if (!events.length) return;
    exportToCSV({
      filename: `capital-audit-timeline-${capitalAccountId}`,
      headers: [
        "Timestamp",
        "Event",
        "Value date",
        "Amount",
        "Branch",
        "Reference",
        "Reason",
        "Notes",
        "User",
        "Journal batch",
      ],
      rows: events.map((e) => [
        stamp(e.at),
        e.kind === "account_opened"
          ? "Account opened"
          : e.kind === "reversal"
            ? "Reversal"
            : e.movementType === "injection"
              ? "Injection"
              : "Withdrawal",
        e.movementDate ?? "",
        e.amount ?? 0,
        branchName ? branchName(e.branchId) : (e.branchId ?? ""),
        e.reference ?? "",
        e.reason ?? "",
        e.description ?? "",
        e.actorName ?? "",
        e.batchId ?? "",
      ]),
    });
  };

  if (!capitalAccountId) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          Select a capital account to view its audit timeline.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base font-medium">Audit timeline</CardTitle>
          <CardDescription>
            {accountLabel ? `${accountLabel} — ` : ""}every movement and reversal with reason, user and
            timestamp.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={exportTimeline} disabled={!events.length}>
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground py-6">Loading timeline…</p>}
        {!isLoading && events.length === 0 && (
          <p className="text-sm text-muted-foreground py-6">No activity recorded for this account yet.</p>
        )}
        {!isLoading && events.length > 0 && (
          <ScrollArea className="max-h-[520px] pr-4">
            <ol className="relative border-l border-border pl-6 space-y-6">
              {events.map((e) => {
                const isReversal = e.kind === "reversal";
                const isOpen = e.kind === "account_opened";
                const injection = e.movementType === "injection";
                const Icon = isOpen ? Wallet : isReversal ? RotateCcw : injection ? ArrowUpRight : ArrowDownLeft;
                const tone = isReversal
                  ? "text-amber-600"
                  : isOpen
                    ? "text-muted-foreground"
                    : injection
                      ? "text-emerald-600"
                      : "text-destructive";
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                      <Icon className={`h-3.5 w-3.5 ${tone}`} />
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {isOpen
                          ? "Capital account opened"
                          : isReversal
                            ? "Movement reversed"
                            : injection
                              ? "Capital injection"
                              : "Capital withdrawal"}
                      </span>
                      {typeof e.amount === "number" && (
                        <span className={`text-sm font-medium ${tone}`}>{money(e.amount)}</span>
                      )}
                      {branchName && (
                        <Badge variant="outline" className="text-xs">
                          {branchName(e.branchId)}
                        </Badge>
                      )}
                      {isReversal && <Badge variant="secondary" className="text-xs">Reversal</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {stamp(e.at)}
                      {e.actorName ? ` · ${e.actorName}` : ""}
                      {e.movementDate ? ` · value date ${e.movementDate}` : ""}
                      {e.reference ? ` · ref ${e.reference}` : ""}
                    </p>
                    {isReversal && (
                      <p className="text-sm mt-1">
                        <span className="text-muted-foreground">Reason: </span>
                        {e.reason?.trim() ? e.reason : "No reason recorded"}
                      </p>
                    )}
                    {!isReversal && e.description && (
                      <p className="text-sm mt-1 text-muted-foreground">{e.description}</p>
                    )}
                    {e.batchId && (
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                        Journal batch {e.batchId.slice(0, 8)}…
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default CapitalAuditTimeline;
