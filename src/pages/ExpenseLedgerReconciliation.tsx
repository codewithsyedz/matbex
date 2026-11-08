import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, ScrollText, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import {
  EXPENSE_LEDGER_ISSUE_LABELS,
  useExpenseLedgerReconciliation,
  type ExpenseLedgerIssue,
} from "@/hooks/useExpenseLedgerReconciliation";
import { useBulkPostExpenses, useAutoReconcileImbalanced } from "@/hooks/usePostingCenter";

type IssueFilter = "flagged" | "all" | ExpenseLedgerIssue;

const ISSUE_FILTERS: Array<{ value: IssueFilter; label: string }> = [
  { value: "flagged", label: "Flagged only" },
  { value: "all", label: "All entries" },
  { value: "not_posted", label: "Never posted" },
  { value: "posted_no_legs", label: "No ledger legs" },
  { value: "unbalanced", label: "Unbalanced" },
  { value: "amount_mismatch", label: "Amount mismatch" },
];

const issueBadge = (issue: ExpenseLedgerIssue) => {
  if (issue === "ok") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        Reconciled
      </Badge>
    );
  }
  const tone =
    issue === "not_posted" || issue === "posted_no_legs"
      ? "border-destructive/40 text-destructive"
      : "border-amber-500/40 text-amber-600";
  return (
    <Badge variant="outline" className={`gap-1 ${tone}`}>
      <AlertTriangle className="h-3 w-3" />
      {EXPENSE_LEDGER_ISSUE_LABELS[issue]}
    </Badge>
  );
};

export default function ExpenseLedgerReconciliation() {
  const { tenant, hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("flagged");

  const { rows, totals, isLoading, isFetching, refetch } = useExpenseLedgerReconciliation({
    branchId,
    from,
    to,
  });

  const bulkPost = useBulkPostExpenses();
  const autoReconcile = useAutoReconcileImbalanced();
  const scopedBranch = branchId && branchId !== "all" ? branchId : null;

  const branchScopeLabel = useMemo(
    () =>
      !scopedBranch ? "All branches" : branches.find((b) => b.id === scopedBranch)?.name ?? scopedBranch,
    [scopedBranch, branches],
  );

  const visibleRows = useMemo(() => {
    if (issueFilter === "all") return rows;
    if (issueFilter === "flagged") return rows.filter((r) => r.issue !== "ok");
    return rows.filter((r) => r.issue === issueFilter);
  }, [rows, issueFilter]);

  const handlePostMissing = async () => {
    const ids = rows.filter((r) => r.issue === "not_posted").map((r) => r.id);
    if (ids.length === 0) {
      toast.info("Nothing left to post");
      return;
    }
    await bulkPost.mutateAsync({ branchId: scopedBranch, expenseIds: ids });
    await refetch();
  };

  const handleAutoReconcile = async () => {
    await autoReconcile.mutateAsync(scopedBranch);
    await refetch();
  };

  const handleExportCsv = () => {
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(`Expense Ledger Reconciliation,${tenant?.name ?? ""}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push(`Period,${from || "start"} to ${to || "today"}`);
    lines.push(`Generated,${format(new Date(), "yyyy-MM-dd HH:mm")}`);
    lines.push("");
    lines.push(
      [
        "Date",
        "Description",
        "Supplier",
        "Branch",
        "Bill Total",
        "Ledger Debit",
        "Ledger Credit",
        "Difference",
        "Legs",
        "Posted Flag",
        "Issue",
      ].join(","),
    );
    for (const r of visibleRows) {
      lines.push(
        [
          r.expenseDate,
          esc(r.description ?? ""),
          esc(r.supplierName ?? "—"),
          esc(r.branchName ?? "—"),
          r.billed.toFixed(2),
          r.primaryDrTotal.toFixed(2),
          r.crTotal.toFixed(2),
          r.diff.toFixed(2),
          r.legCount,
          r.ledgerPosted ? "yes" : "no",
          esc(EXPENSE_LEDGER_ISSUE_LABELS[r.issue]),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expense-ledger-reconciliation-${format(new Date(), "yyyyMMdd")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Reconciliation exported");
  };

  if (!loading && !hasFeature("accounting")) {
    return (
      <LockedFeatureScreen
        featureName="Expense Ledger Reconciliation"
        description="Automatically flag expense entries that never reached the transactional ledger."
        featureKey="accounting"
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ScrollText className="h-7 w-7 text-primary" />
            Expense Ledger Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every expense checked against its journal legs — missing, empty or unbalanced postings are
            flagged automatically · {branchScopeLabel}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[170px]">
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

          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-[150px]"
            aria-label="From date"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-[150px]"
            aria-label="To date"
          />

          <Select value={issueFilter} onValueChange={(v) => setIssueFilter(v as IssueFilter)}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="Issue" />
            </SelectTrigger>
            <SelectContent>
              {ISSUE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExportCsv}
            disabled={isLoading || visibleRows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>

          {totals.notPosted > 0 && (
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={handlePostMissing}
              disabled={bulkPost.isPending}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Post {totals.notPosted} missing
            </Button>
          )}

          {totals.unbalanced > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="h-9 gap-1.5"
              onClick={handleAutoReconcile}
              disabled={autoReconcile.isPending}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Auto-fix unbalanced
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Entries scanned</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{totals.scanned}</p>
            <p className="mt-1 text-xs font-light text-muted-foreground">
              {totals.flagged} flagged
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Never posted</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-destructive">
              {totals.notPosted}
            </p>
            <p className="mt-1 text-xs font-light text-muted-foreground">
              {fmt(totals.notPostedAmount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Marked posted, no legs</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-destructive">
              {totals.postedNoLegs}
            </p>
            <p className="mt-1 text-xs font-light text-muted-foreground">
              {fmt(totals.postedNoLegsAmount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Unbalanced / mismatched</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-amber-600">
              {totals.unbalanced + totals.amountMismatch}
            </p>
            <p className="mt-1 text-xs font-light text-muted-foreground">
              {fmt(totals.unbalancedAmount + totals.amountMismatchAmount)} off
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Expense entries</CardTitle>
          <CardDescription className="font-light">
            Showing {visibleRows.length} of {rows.length} entries. Fixes post through the standard
            expense posting rules — see the{" "}
            <Link to="/accounting" className="underline underline-offset-2">
              Posting Center
            </Link>{" "}
            for per-entry diagnostics.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <p className="text-sm font-light text-muted-foreground">
                No expense entries match this filter — the sub-ledger agrees with the ledger.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Bill</TableHead>
                    <TableHead className="text-right">DR</TableHead>
                    <TableHead className="text-right">CR</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">{r.expenseDate}</TableCell>
                      <TableCell className="max-w-[260px] truncate">{r.description ?? "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{r.supplierName ?? "—"}</TableCell>
                      <TableCell className="max-w-[140px] truncate">{r.branchName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.billed)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.primaryDrTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.crTotal)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          Math.abs(r.diff) > 0.005 ? "text-amber-600" : "text-muted-foreground"
                        }`}
                      >
                        {fmt(r.diff)}
                      </TableCell>
                      <TableCell>{issueBadge(r.issue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}