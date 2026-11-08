import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, Download, History, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";

import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useReversalAudit,
  REVERSAL_KIND_LABEL,
  type ReversalEventKind,
} from "@/hooks/useReversalAudit";

const kindTone: Record<ReversalEventKind, string> = {
  void: "bg-destructive/10 text-destructive border-destructive/30",
  reversal_batch: "bg-warning/10 text-warning border-warning/30",
  adjustment_reversed: "bg-primary/10 text-primary border-primary/30",
  overhead_reopened: "bg-accent text-accent-foreground border-primary/20",
  overhead_adjusted: "bg-muted text-muted-foreground border-border",
};

export default function ReversalAudit() {
  const { branches, activeBranchId, pinnedBranchId, canSwitchBranches } = useBranch();
  const { format: fmt } = useCurrency();

  const [searchParams] = useSearchParams();
  const initialDate = searchParams.get("date");
  const initialBranch = searchParams.get("branch");

  const [date, setDate] = useState<Date>(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      const [y, m, d] = initialDate.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  });
  const [branchId, setBranchId] = useState<string>(
    initialBranch ?? pinnedBranchId ?? activeBranchId ?? "all",
  );
  const [kind, setKind] = useState<string>("all");

  const { events, isLoading, refetch } = useReversalAudit({ branchId, date });

  const filtered = useMemo(
    () => (kind === "all" ? events : events.filter((e) => e.kind === kind)),
    [events, kind],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    events.forEach((e) => (c[e.kind] = (c[e.kind] ?? 0) + 1));
    return c;
  }, [events]);

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error("Nothing to export for this day");
      return;
    }
    const header = ["When", "Type", "Branch", "Title", "Detail", "Reason", "By", "Amount", "Reference"];
    const lines = filtered.map((e) =>
      [
        format(new Date(e.occurredAt), "yyyy-MM-dd HH:mm:ss"),
        REVERSAL_KIND_LABEL[e.kind],
        e.branchName ?? "—",
        e.title,
        e.detail ?? "",
        e.reason ?? "",
        e.actorName ?? "",
        e.amount != null ? e.amount.toFixed(2) : "",
        e.referenceNumber ?? e.batchId ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reversal-audit-${format(date, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <History className="h-7 w-7" />
            Reversal &amp; Reopening Audit
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every void, reversal entry, day-end reversal, and reopening for a branch on a given date.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Business date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[190px] justify-start">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {format(date, "PPP")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Select value={branchId} onValueChange={setBranchId} disabled={!canSwitchBranches}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {canSwitchBranches && <SelectItem value="all">All branches</SelectItem>}
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Event type</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events ({events.length})</SelectItem>
                {(Object.keys(REVERSAL_KIND_LABEL) as ReversalEventKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {REVERSAL_KIND_LABEL[k]} ({counts[k] ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            {filtered.length} event{filtered.length === 1 ? "" : "s"} on {format(date, "PPP")}
          </CardTitle>
          <CardDescription>
            Ledger legs are shown for voided and reversal batches so you can confirm the net impact.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : filtered.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              No reversals, voids, or reopenings recorded for this branch and date.
            </div>
          ) : (
            filtered.map((e) => (
              <div key={e.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={kindTone[e.kind]}>
                      {REVERSAL_KIND_LABEL[e.kind]}
                    </Badge>
                    <span className="font-medium">{e.title}</span>
                    {e.branchName && (
                      <span className="text-xs text-muted-foreground">· {e.branchName}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {format(new Date(e.occurredAt), "MMM d, HH:mm:ss")}
                    {e.actorName ? ` · ${e.actorName}` : ""}
                  </div>
                </div>

                {(e.detail || e.reason) && (
                  <div className="text-sm text-muted-foreground space-y-0.5">
                    {e.detail && <div>{e.detail}</div>}
                    {e.reason && <div className="italic">Reason: {e.reason}</div>}
                  </div>
                )}

                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {e.amount != null && (
                    <span>
                      Amount: <span className="font-medium text-foreground">{fmt(e.amount)}</span>
                    </span>
                  )}
                  {(e.referenceNumber || e.batchId) && (
                    <span className="font-mono">
                      Ref: {e.referenceNumber ?? `${e.batchId?.slice(0, 8)}…`}
                    </span>
                  )}
                </div>

                {e.legs.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Account</TableHead>
                        <TableHead className="text-xs text-right">Debit</TableHead>
                        <TableHead className="text-xs text-right">Credit</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {e.legs.map((l, i) => (
                        <TableRow key={i} className={l.isVoided ? "opacity-60" : ""}>
                          <TableCell className="text-xs">
                            <span className="font-mono">{l.accountCode ?? "—"}</span>{" "}
                            {l.accountName ?? ""}
                          </TableCell>
                          <TableCell className="text-xs text-right tabular-nums">
                            {l.debit ? fmt(l.debit) : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-right tabular-nums">
                            {l.credit ? fmt(l.credit) : "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {l.isVoided ? (
                              <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                                Voided
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">Active</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
