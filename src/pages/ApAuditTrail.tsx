import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, subDays } from "date-fns";
import { CalendarIcon, Download, FileClock, Ban, Wallet, Undo2, Receipt } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useApAuditTrail, AP_EVENT_LABEL, type ApAuditEvent } from "@/hooks/useApAuditTrail";
import { FailedApSettlementsCard } from "@/components/accounting/FailedApSettlementsCard";
import { BillPostingReconciliationWidget } from "@/components/accounting/BillPostingReconciliationWidget";

const kindIcon = {
  posting: Receipt,
  settlement: Wallet,
  reversal: Undo2,
} as const;

const kindTone: Record<ApAuditEvent["kind"], string> = {
  posting: "text-muted-foreground",
  settlement: "text-emerald-600",
  reversal: "text-amber-600",
};

export default function ApAuditTrail() {
  const [params, setParams] = useSearchParams();
  const { tenant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();

  const expenseId = params.get("expenseId");
  const [from, setFrom] = useState<Date>(subDays(new Date(), 90));
  const [to, setTo] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [kind, setKind] = useState<string>("settlements");
  const [search, setSearch] = useState("");
  const [showVoided, setShowVoided] = useState(true);

  const { events, isLoading } = useApAuditTrail({
    expenseId,
    branchId,
    from,
    to,
    includePostings: kind !== "settlements",
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (!showVoided && e.isVoided) return false;
      if (kind === "settlement" && e.kind !== "settlement") return false;
      if (kind === "reversal" && e.kind !== "reversal") return false;
      if (kind === "settlements" && e.kind === "posting") return false;
      if (!q) return true;
      return [e.referenceNumber, e.expenseDescription, e.supplierName, e.createdByName, e.branchName, e.description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [events, search, kind, showVoided]);

  const totals = useMemo(() => {
    const settled = filtered.filter((e) => e.kind === "settlement" && !e.isVoided).reduce((s, e) => s + e.amount, 0);
    const reversed = filtered.filter((e) => e.kind === "reversal" && !e.isVoided).reduce((s, e) => s + e.amount, 0);
    return { settled, reversed, count: filtered.length };
  }, [filtered]);

  const branchScopeLabel = useMemo(
    () => (!branchId || branchId === "all" ? "All branches" : branches.find((b) => b.id === branchId)?.name ?? branchId),
    [branchId, branches],
  );

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Nothing to export for the current filters.");
      return;
    }
    const lines: string[] = [];
    lines.push(`AP Settlement Audit Trail,${tenant?.name ?? ""}`);
    lines.push(`Period,${format(from, "yyyy-MM-dd")} to ${format(to, "yyyy-MM-dd")}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push("");
    lines.push(
      ["Date", "Reference", "Event", "Expense / Payable", "Supplier", "Branch", "Amount", "Recorded by", "Recorded at", "Posted by", "Posted at", "Status", "Lines"].join(","),
    );
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    for (const e of filtered) {
      const legs = e.legs
        .map((l) => `${l.accountCode ?? ""} ${l.accountName ?? ""} ${l.debit > 0 ? `DR ${l.debit.toFixed(2)}` : `CR ${l.credit.toFixed(2)}`}`)
        .join(" | ");
      lines.push(
        [
          e.transactionDate,
          esc(e.referenceNumber),
          esc(AP_EVENT_LABEL[e.kind]),
          esc(e.expenseDescription),
          esc(e.supplierName),
          esc(e.branchName),
          e.amount.toFixed(2),
          esc(e.createdByName),
          esc(e.createdAt ? format(new Date(e.createdAt), "yyyy-MM-dd HH:mm") : ""),
          esc(e.postedByName),
          esc(e.postedAt ? format(new Date(e.postedAt), "yyyy-MM-dd HH:mm") : ""),
          e.isVoided ? "Voided" : "Posted",
          esc(legs),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ap-audit-trail-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Audit trail exported");
  };

  const DatePick = ({ value, onChange, label }: { value: Date; onChange: (d: Date) => void; label: string }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start gap-2 font-normal">
          <CalendarIcon className="h-4 w-4" />
          {label}: {format(value, "dd MMM yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={(d) => d && onChange(d)} className="pointer-events-auto" />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <FileClock className="h-6 w-6 text-primary" /> AP Audit Trail
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every posted settlement and reversal against expenses and payables, with the user who recorded it and when.
          </p>
        </div>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {expenseId && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <Badge variant="secondary">Filtered to a single expense</Badge>
          <span className="truncate text-muted-foreground">
            {filtered[0]?.expenseDescription ?? expenseId}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              params.delete("expenseId");
              setParams(params, { replace: true });
            }}
          >
            Show all
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Events</CardDescription>
            <CardTitle className="text-base font-medium">{totals.count}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Settled in period</CardDescription>
            <CardTitle className="text-base font-medium text-emerald-600">{fmt(totals.settled)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Reversed in period</CardDescription>
            <CardTitle className="text-base font-medium text-amber-600">{fmt(totals.reversed)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <BillPostingReconciliationWidget from={from} to={to} branchId={branchId} />

      <FailedApSettlementsCard branchId={branchId} />

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <DatePick value={from} onChange={setFrom} label="From" />
            <DatePick value={to} onChange={setTo} label="To" />
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-[210px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="settlements">Settlements & reversals</SelectItem>
                <SelectItem value="settlement">Settlements only</SelectItem>
                <SelectItem value="reversal">Reversals only</SelectItem>
                <SelectItem value="all">All ledger events</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Search reference, supplier, user…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[240px]"
            />
            <div className="flex items-center gap-2">
              <Switch id="show-voided" checked={showVoided} onCheckedChange={setShowVoided} />
              <Label htmlFor="show-voided" className="text-sm text-muted-foreground">
                Include voided
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No settlement or reversal events recorded for these filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Expense / Payable</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Recorded by</TableHead>
                    <TableHead>Posted by</TableHead>
                    <TableHead>Ledger lines</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => {
                    const Icon = kindIcon[e.kind];
                    return (
                      <TableRow key={e.batchId} className={e.isVoided ? "opacity-60" : undefined}>
                        <TableCell className="whitespace-nowrap align-top text-sm">
                          {e.transactionDate}
                          <div className="text-xs text-muted-foreground">
                            {e.createdAt ? format(new Date(e.createdAt), "dd MMM HH:mm") : "—"}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <span className={`flex items-center gap-1.5 text-sm font-medium ${kindTone[e.kind]}`}>
                            <Icon className="h-3.5 w-3.5" /> {AP_EVENT_LABEL[e.kind]}
                          </span>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            {e.referenceNumber ?? "—"}
                            {e.isVoided && (
                              <Badge variant="outline" className="ml-1 gap-1">
                                <Ban className="h-3 w-3" /> Voided
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[240px] align-top text-sm">
                          <div className="truncate">{e.expenseDescription ?? "—"}</div>
                          {e.supplierName && (
                            <div className="truncate text-xs text-muted-foreground">{e.supplierName}</div>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm">{e.branchName ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right align-top font-mono text-sm">
                          {fmt(e.amount)}
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          {e.createdByName ?? "—"}
                          <div className="text-xs text-muted-foreground">
                            {e.createdAt ? format(new Date(e.createdAt), "dd MMM yyyy HH:mm") : ""}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          {e.postedByName ?? "—"}
                          <div className="text-xs text-muted-foreground">
                            {e.postedAt ? format(new Date(e.postedAt), "dd MMM yyyy HH:mm") : ""}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-0.5">
                            {e.legs.map((l) => (
                              <div
                                key={l.id}
                                className={`flex items-center gap-2 text-xs ${l.isVoided ? "line-through text-muted-foreground" : ""}`}
                              >
                                <span className="font-mono text-muted-foreground">{l.accountCode ?? "—"}</span>
                                <span className="max-w-[140px] truncate">{l.accountName ?? ""}</span>
                                <span className="font-mono">
                                  {l.debit > 0 ? `DR ${l.debit.toFixed(2)}` : `CR ${l.credit.toFixed(2)}`}
                                </span>
                                {l.isVoided && l.voidedByName && (
                                  <span className="text-muted-foreground">· voided by {l.voidedByName}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
