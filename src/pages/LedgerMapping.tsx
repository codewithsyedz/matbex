import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarIcon,
  ChevronDown,
  Check,
  Download,
  FileClock,
  Link2,
  Wallet,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useLedgerMapping, type LedgerMappingRow } from "@/hooks/useLedgerMapping";
import { ExpenseSettlementTimeline } from "@/components/expenses/ExpenseSettlementTimeline";

const routeTone: Record<LedgerMappingRow["route"], string> = {
  cash: "text-emerald-600",
  ap: "text-amber-600",
  ap_settled: "text-foreground",
  unposted: "text-destructive",
};

const routeBadge: Record<LedgerMappingRow["route"], string> = {
  cash: "Cash / Bank",
  ap: "Accounts Payable",
  ap_settled: "AP → settled",
  unposted: "Unposted",
};

export default function LedgerMapping() {
  const { tenant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const [searchParams, setSearchParams] = useSearchParams();

  const paramExpenseId = searchParams.get("expense");
  const paramFrom = searchParams.get("from");
  const paramTo = searchParams.get("to");
  const paramBranch = searchParams.get("branch");
  const paramRoute = searchParams.get("route");
  const paramQuery = searchParams.get("q");

  const [from, setFrom] = useState<Date>(
    paramFrom ? parseISO(paramFrom) : startOfMonth(new Date())
  );
  const [to, setTo] = useState<Date>(
    paramTo ? parseISO(paramTo) : endOfMonth(new Date())
  );
  const [branchId, setBranchId] = useState<string>(
    paramBranch ?? pinnedBranchId ?? activeBranchId ?? "all"
  );
  const [routeFilter, setRouteFilter] = useState<string>(paramRoute ?? "all");
  const [search, setSearch] = useState(paramQuery ?? "");
  const [timeline, setTimeline] = useState<{ id: string; description: string } | null>(null);
  const [openExpenseId, setOpenExpenseId] = useState<string | null>(paramExpenseId);
  const [copied, setCopied] = useState(false);

  // Sync local open state with the URL param so back/forward navigation works.
  useEffect(() => {
    setOpenExpenseId(paramExpenseId);
  }, [paramExpenseId]);

  // Keep the URL in sync with the current filters so the address bar is always shareable.
  useEffect(() => {
    const next = new URLSearchParams();
    next.set("from", format(from, "yyyy-MM-dd"));
    next.set("to", format(to, "yyyy-MM-dd"));
    if (branchId && branchId !== "all") next.set("branch", branchId);
    if (routeFilter !== "all") next.set("route", routeFilter);
    if (search.trim()) next.set("q", search.trim());
    if (openExpenseId) next.set("expense", openExpenseId);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branchId, routeFilter, search, openExpenseId]);

  const handleCopyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied", { description: `${branchScopeLabel} · ${format(from, "dd MMM")} – ${format(to, "dd MMM yyyy")}` });
    } catch {
      toast.error("Could not copy link", { description: url });
    }
  };

  const { rows, isLoading } = useLedgerMapping({ from, to, branchId });

  const filtered = useMemo(() => {
    if (openExpenseId) {
      return rows.filter((r) => r.expenseId === openExpenseId);
    }
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (routeFilter !== "all" && r.route !== routeFilter) return false;
      if (!term) return true;
      return [r.description, r.supplierName, r.categoryName, r.branchName, r.expenseId]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [rows, routeFilter, search, openExpenseId]);

  const totals = useMemo(
    () => ({
      count: filtered.length,
      cash: filtered.reduce((s, r) => s + r.cashPaid, 0),
      apOpen: filtered.reduce((s, r) => s + Math.max(r.apOpen, 0), 0),
      unposted: filtered.filter((r) => !r.posted).length,
      unbalanced: filtered.filter((r) => r.posted && !r.balanced).length,
    }),
    [filtered],
  );

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const lines: string[] = [];
    lines.push(`Expense → Ledger Mapping,${tenant?.name ?? ""}`);
    lines.push(`Period,${format(from, "yyyy-MM-dd")} to ${format(to, "yyyy-MM-dd")}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push("");
    lines.push(
      [
        "Expense Date",
        "Description",
        "Supplier",
        "Branch",
        "Status",
        "Route",
        "Triggering Event",
        "Reference",
        "Entry Date",
        "Account Code",
        "Account Name",
        "Leg Type",
        "Debit",
        "Credit",
        "Voided",
      ].join(","),
    );
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    for (const r of filtered) {
      if (r.events.length === 0) {
        lines.push(
          [
            r.expenseDate,
            esc(r.description),
            esc(r.supplierName),
            esc(r.branchName),
            r.status,
            routeBadge[r.route],
            "No ledger entry",
            "",
            "",
            "",
            "",
            "",
            "0.00",
            "0.00",
            "",
          ].join(","),
        );
      }
      for (const e of r.events) {
        for (const leg of e.legs) {
          lines.push(
            [
              r.expenseDate,
              esc(r.description),
              esc(r.supplierName),
              esc(r.branchName),
              r.status,
              routeBadge[r.route],
              e.triggerLabel,
              esc(e.reference),
              e.date,
              leg.accountCode,
              esc(leg.accountName),
              leg.role,
              leg.debit.toFixed(2),
              leg.credit.toFixed(2),
              leg.isVoided ? "yes" : "no",
            ].join(","),
          );
        }
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-mapping-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const DatePick = ({ value, onChange, label }: { value: Date; onChange: (d: Date) => void; label: string }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarIcon className="h-3.5 w-3.5" />
          {label}: {format(value, "dd MMM yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={(d) => d && onChange(d)} initialFocus />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Expense → Ledger mapping</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every expense line linked to the exact ledger entries it produced — cash vs Accounts Payable — and the
            event that triggered each posting.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link to="/reports/ap-audit-trail">
              <FileClock className="h-3.5 w-3.5" /> AP audit trail
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyLink} className="gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DatePick value={from} onChange={setFrom} label="From" />
        <DatePick value={to} onChange={setTo} label="To" />
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="h-9 w-[200px]">
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
        <Select value={routeFilter} onValueChange={setRouteFilter}>
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue placeholder="Posting route" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All routes</SelectItem>
            <SelectItem value="cash">Cash / Bank only</SelectItem>
            <SelectItem value="ap">Accounts Payable (open)</SelectItem>
            <SelectItem value="ap_settled">AP settled</SelectItem>
            <SelectItem value="unposted">Unposted</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description, supplier, category…"
          className="h-9 w-[260px]"
          disabled={!!openExpenseId}
        />
      </div>

      {openExpenseId && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Viewing one expense:</span>
          <span className="font-mono font-medium">{openExpenseId}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1"
            onClick={() => {
              setOpenExpenseId(null);
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("expense");
                next.delete("from");
                next.delete("to");
                return next;
              });
            }}
          >
            <X className="h-3.5 w-3.5" /> View all expenses
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Expense lines", value: String(totals.count), icon: ArrowRightLeft },
          { label: "Credited to Cash / Bank", value: fmt(totals.cash), icon: Wallet },
          { label: "Open Accounts Payable", value: fmt(totals.apOpen), icon: FileClock },
          {
            label: "Needs attention",
            value: `${totals.unposted} unposted · ${totals.unbalanced} unbalanced`,
            icon: AlertTriangle,
          },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-1.5 text-xs">
                <c.icon className="h-3.5 w-3.5" /> {c.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-medium">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Mapping detail</CardTitle>
          <CardDescription>
            Expand a row to see each journal batch, its triggering event, and the individual DR/CR legs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No expense lines match the selected filters.
            </p>
          ) : (
            filtered.map((r) => (
              <Collapsible
                key={r.expenseId}
                className="rounded-lg border"
                open={openExpenseId === r.expenseId}
                onOpenChange={(open) => setOpenExpenseId(open ? r.expenseId : null)}
              >
                <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40">
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  <div className="min-w-[240px] flex-1">
                    <p className="truncate text-sm font-medium">{r.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.expenseDate}
                      {r.supplierName ? ` · ${r.supplierName}` : ""}
                      {r.branchName ? ` · ${r.branchName}` : ""}
                      {r.paymentMethod ? ` · ${r.paymentMethod}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={routeTone[r.route]}>
                    {routeBadge[r.route]}
                  </Badge>
                  {r.posted && !r.balanced && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" /> Unbalanced
                    </Badge>
                  )}
                  <span className="font-mono text-sm">{fmt(r.amount)}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t bg-muted/20 px-3 py-3">
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{r.routeLabel}</span>
                    {r.apBilled > 0.005 && (
                      <span>
                        AP billed {fmt(r.apBilled)} · settled {fmt(r.apSettled)} · open{" "}
                        {fmt(Math.max(r.apOpen, 0))}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 gap-1.5"
                      onClick={() => setTimeline({ id: r.expenseId, description: r.description })}
                    >
                      <FileClock className="h-3.5 w-3.5" /> Timeline
                    </Button>
                  </div>

                  {r.events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No ledger entries yet — this expense has not been posted.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {r.events.map((e) => (
                        <div key={e.key} className="rounded-md border bg-background">
                          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
                            <Badge variant="secondary">{e.triggerLabel}</Badge>
                            <span className="text-muted-foreground">
                              {e.date}
                              {e.reference ? ` · ${e.reference}` : ""}
                            </span>
                            {e.allVoided && <Badge variant="outline">Voided</Badge>}
                            {!e.balanced && !e.allVoided && (
                              <Badge variant="destructive">Out of balance</Badge>
                            )}
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Account</TableHead>
                                <TableHead>Leg</TableHead>
                                <TableHead className="text-right">Debit</TableHead>
                                <TableHead className="text-right">Credit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {e.legs.map((leg) => (
                                <TableRow key={leg.id} className={leg.isVoided ? "opacity-50 line-through" : ""}>
                                  <TableCell className="text-sm">
                                    {leg.accountCode} {leg.accountName}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-xs capitalize">
                                      {leg.role === "ap" ? "Accounts payable" : leg.role}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {leg.debit ? fmt(leg.debit) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {leg.credit ? fmt(leg.credit) : "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))
          )}
        </CardContent>
      </Card>

      <ExpenseSettlementTimeline
        expenseId={timeline?.id ?? null}
        expenseDescription={timeline?.description}
        open={!!timeline}
        onOpenChange={(o) => !o && setTimeline(null)}
      />
    </div>
  );
}
