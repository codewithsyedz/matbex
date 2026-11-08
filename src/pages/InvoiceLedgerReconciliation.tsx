import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Copy, Download, RefreshCw, Search } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { InvoiceDivergenceCheckCard } from "@/components/accounting/InvoiceDivergenceCheckCard";
import { InvoiceRepairAuditPanel } from "@/components/accounting/InvoiceRepairAuditPanel";
import {
  INVOICE_RECON_ISSUE_LABELS,
  useInvoiceLedgerReconciliation,
  type InvoiceReconIssue,
  type InvoiceReconRow,
} from "@/hooks/useInvoiceLedgerReconciliation";

type IssueFilter = "flagged" | "all" | InvoiceReconIssue;

const ISSUE_FILTERS: Array<{ value: IssueFilter; label: string }> = [
  { value: "flagged", label: "Flagged only" },
  { value: "all", label: "All invoices" },
  { value: "duplicate_lines", label: "Duplicated lines" },
  { value: "total_mismatch", label: "Total ≠ lines" },
  { value: "expense_mismatch", label: "Expense ≠ bill" },
  { value: "ledger_mismatch", label: "Ledger ≠ bill" },
  { value: "not_posted", label: "Not posted" },
];

const issueBadge = (issue: InvoiceReconIssue) => {
  if (issue === "ok") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        Reconciled
      </Badge>
    );
  }
  const tone =
    issue === "duplicate_lines" || issue === "ledger_mismatch" || issue === "not_posted"
      ? "border-destructive/40 text-destructive"
      : "border-amber-500/40 text-amber-600";
  return (
    <Badge variant="outline" className={`gap-1 ${tone}`}>
      <AlertTriangle className="h-3 w-3" />
      {INVOICE_RECON_ISSUE_LABELS[issue]}
    </Badge>
  );
};

export default function InvoiceLedgerReconciliation() {
  const { tenant, hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const [searchParams] = useSearchParams();
  // Deep-link support for the nightly mismatch email (?invoice=&branch=&from=&to=&filter=)
  const linkInvoice = searchParams.get("invoice") ?? "";
  const linkBranch = searchParams.get("branch");
  const linkFrom = searchParams.get("from") ?? "";
  const linkTo = searchParams.get("to") ?? "";
  const linkFilter = searchParams.get("filter") as IssueFilter | null;

  const [branchId, setBranchId] = useState<string>(
    linkBranch ?? pinnedBranchId ?? activeBranchId ?? "all",
  );
  const [from, setFrom] = useState<string>(linkFrom);
  const [to, setTo] = useState<string>(linkTo);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>(
    linkFilter && ISSUE_FILTERS.some((f) => f.value === linkFilter) ? linkFilter : "flagged",
  );
  const [search, setSearch] = useState(linkInvoice);
  const [drilldown, setDrilldown] = useState<InvoiceReconRow | null>(null);

  const { rows, totals, isLoading, isFetching, refetch } = useInvoiceLedgerReconciliation({
    branchId,
    from,
    to,
  });

  const scopedBranch = branchId && branchId !== "all" ? branchId : null;
  const branchScopeLabel = useMemo(
    () =>
      !scopedBranch
        ? "All branches"
        : branches.find((b) => b.id === scopedBranch)?.name ?? scopedBranch,
    [scopedBranch, branches],
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = rows;
    if (issueFilter === "flagged") list = list.filter((r) => r.issues.length > 0);
    else if (issueFilter !== "all") list = list.filter((r) => r.issues.includes(issueFilter));
    if (term) {
      list = list.filter(
        (r) =>
          (r.invoiceNumber ?? "").toLowerCase().includes(term) ||
          (r.supplierName ?? "").toLowerCase().includes(term),
      );
    }
    return list;
  }, [rows, issueFilter, search]);

  const handleExportCsv = () => {
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(`Invoice Ledger Reconciliation,${tenant?.name ?? ""}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push(`Period,${from || "start"} to ${to || "today"}`);
    lines.push(`Generated,${format(new Date(), "yyyy-MM-dd HH:mm")}`);
    lines.push("");
    lines.push(
      [
        "Date",
        "Invoice",
        "Supplier",
        "Branch",
        "Invoice total",
        "Lines sum",
        "Unique lines sum",
        "Duplicate amount",
        "Expense amount",
        "Ledger debit",
        "Issues",
      ].join(","),
    );
    for (const r of visibleRows) {
      lines.push(
        [
          r.invoiceDate,
          esc(r.invoiceNumber ?? ""),
          esc(r.supplierName ?? ""),
          esc(r.branchName ?? ""),
          r.invoiceTotal.toFixed(2),
          r.itemsSum.toFixed(2),
          r.dedupSum.toFixed(2),
          r.duplicateAmount.toFixed(2),
          r.expenseAmount != null ? r.expenseAmount.toFixed(2) : "",
          r.ledgerAmount != null ? r.ledgerAmount.toFixed(2) : "",
          esc(r.issues.map((i) => INVOICE_RECON_ISSUE_LABELS[i]).join(" | ")),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoice-ledger-reconciliation-${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!hasFeature?.("accounting")) {
    return (
      <LockedFeatureScreen
        featureKey="accounting"
        featureName="Invoice Ledger Reconciliation"
        description="Upgrade to reconcile supplier invoices against the general ledger."
      />
    );
  }

  const summaryCards = [
    { label: "Invoices scanned", value: String(totals.scanned) },
    { label: "Flagged", value: String(totals.flagged) },
    { label: "Bills with duplicate lines", value: String(totals.duplicateLines) },
    { label: "Duplicate line value", value: fmt(totals.duplicateAmount) },
    { label: "Ledger mismatches", value: String(totals.ledgerMismatch + totals.notPosted) },
  ];

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Invoice Ledger Reconciliation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Flags invoices whose total disagrees with their line items, linked expense, or ledger
            postings — drill down to the exact duplicated lines.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={visibleRows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {summaryCards.map((c) => (
          <Card key={c.label} className="min-w-0">
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-xl font-light">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <InvoiceDivergenceCheckCard
        branchId={branchId}
        from={from}
        to={to}
        onInspectInvoice={(id) => {
          const row = rows.find((r) => r.invoiceId === id);
          if (row) setDrilldown(row);
        }}
        onFixApplied={() => refetch()}
      />

      <InvoiceRepairAuditPanel
        onInspectInvoice={(id) => {
          const row = rows.find((r) => r.invoiceId === id);
          if (row) setDrilldown(row);
        }}
      />

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-medium">Invoices</CardTitle>
              <CardDescription>
                {branchScopeLabel} · {visibleRows.length} shown
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              <Select value={issueFilter} onValueChange={(v) => setIssueFilter(v as IssueFilter)}>
                <SelectTrigger className="h-9 w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" className="h-9 w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input type="date" className="h-9 w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} />
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="h-9 w-[190px] pl-8"
                  placeholder="Invoice or supplier"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No invoices match the current filters.
            </p>
          ) : (
            <div className="w-full overflow-auto" style={{ maxHeight: 560 }}>
              <Table className="min-w-[1100px]">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-[110px]">Date</TableHead>
                    <TableHead className="w-[150px]">Invoice</TableHead>
                    <TableHead className="w-[180px]">Supplier</TableHead>
                    <TableHead className="w-[140px]">Branch</TableHead>
                    <TableHead className="w-[110px] text-right">Bill total</TableHead>
                    <TableHead className="w-[110px] text-right">Lines sum</TableHead>
                    <TableHead className="w-[110px] text-right">Duplicates</TableHead>
                    <TableHead className="w-[110px] text-right">Ledger DR</TableHead>
                    <TableHead className="w-[200px]">Status</TableHead>
                    <TableHead className="w-[110px] text-right">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.invoiceId}>
                      <TableCell className="text-xs">{r.invoiceDate}</TableCell>
                      <TableCell className="break-words text-xs">{r.invoiceNumber}</TableCell>
                      <TableCell className="break-words text-xs">{r.supplierName ?? "—"}</TableCell>
                      <TableCell className="break-words text-xs">{r.branchName ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(r.invoiceTotal)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(r.itemsSum)}</TableCell>
                      <TableCell
                        className={`text-right text-xs ${r.duplicateAmount > 0 ? "text-destructive" : ""}`}
                      >
                        {r.duplicateAmount > 0 ? fmt(r.duplicateAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {r.ledgerAmount != null ? fmt(r.ledgerAmount) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.issues.length === 0
                            ? issueBadge("ok")
                            : r.issues.map((i) => <span key={i}>{issueBadge(i)}</span>)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDrilldown(r)}>
                          View lines
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!drilldown} onOpenChange={(o) => !o && setDrilldown(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-normal">
              Invoice {drilldown?.invoiceNumber} · {drilldown?.supplierName ?? "No supplier"}
            </DialogTitle>
            <DialogDescription>
              {drilldown?.invoiceDate} · bill {fmt(drilldown?.invoiceTotal ?? 0)} · lines{" "}
              {fmt(drilldown?.itemsSum ?? 0)} · unique lines {fmt(drilldown?.dedupSum ?? 0)} · ledger{" "}
              {drilldown?.ledgerAmount != null ? fmt(drilldown.ledgerAmount) : "not posted"}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-3 pr-3">
              {drilldown && drilldown.duplicateLineCount > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-destructive">
                    <Copy className="h-4 w-4" />
                    {drilldown.duplicateLineCount} duplicated line
                    {drilldown.duplicateLineCount === 1 ? "" : "s"} inflating this bill by{" "}
                    {fmt(drilldown.duplicateAmount)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Re-save the bill from the expense or invoice screen — line edits now go through the
                    atomic replace routine, which removes the duplicates and recomputes the total.
                  </p>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                    <TableHead className="text-right">Occurrences</TableHead>
                    <TableHead className="text-right">Excess</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(drilldown?.groups ?? []).map((g) => (
                    <TableRow key={g.signature} className={g.suspectedDuplicate && g.count > 1 ? "bg-destructive/5" : ""}>
                      <TableCell className="break-words text-xs">{g.description}</TableCell>
                      <TableCell className="text-right text-xs">{g.quantity}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(g.unitPrice)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(g.linePrice)}</TableCell>
                      <TableCell className="text-right text-xs">
                        {g.suspectedDuplicate && g.count > 1 ? (
                          <Badge variant="outline" className="border-destructive/40 text-destructive">
                            ×{g.count}
                          </Badge>
                        ) : (
                          "×1"
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {g.duplicateAmount > 0 ? fmt(g.duplicateAmount) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(drilldown?.groups?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                        This invoice has no line items.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
