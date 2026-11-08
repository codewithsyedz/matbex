import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { AlertTriangle, CheckCircle2, Download, Scale, ChevronDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { useBranch } from "@/contexts/BranchContext";
import { ReconciliationDetailsPanel } from "@/components/installments/ReconciliationDetailsPanel";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useInstallmentReconciliation,
  type InstallmentReconRow,
  type MatchStatus,
} from "@/hooks/useInstallmentReconciliation";

const STATUS_META: Record<MatchStatus, { label: string; className: string }> = {
  matched: { label: "Matched", className: "bg-primary/15 text-primary" },
  missing_gl: { label: "Missing GL", className: "bg-destructive/15 text-destructive" },
  amount_mismatch: { label: "Amount mismatch", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  account_mismatch: { label: "Account mismatch", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  unbalanced: { label: "Unbalanced", className: "bg-destructive/15 text-destructive" },
  voided: { label: "Voided", className: "bg-muted text-muted-foreground" },
  overdue: { label: "Missing payment", className: "bg-destructive/15 text-destructive" },
  upcoming: { label: "Upcoming", className: "bg-muted text-muted-foreground" },
};

const ISSUE_STATUSES: MatchStatus[] = [
  "missing_gl",
  "amount_mismatch",
  "account_mismatch",
  "unbalanced",
  "overdue",
];

export default function InstallmentReconciliation() {
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: money } = useCurrency();

  const [periodStart, setPeriodStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const { data, isLoading } = useInstallmentReconciliation({ branchId, periodStart, periodEnd });
  const rows = data?.rows ?? [];
  const totals = data?.totals;

  const branchLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const branchName = (id: string | null) =>
    id ? branches.find((b) => b.id === id)?.name ?? "Unknown" : "-";

  const visible = onlyIssues ? rows.filter((r) => ISSUE_STATUSES.includes(r.matchStatus)) : rows;

  const handleExport = () => {
    if (!rows.length) {
      toast.error("Nothing to export for this period");
      return;
    }
    const head = [
      "Due date",
      "Paid date",
      "Plan",
      "Provider",
      "Branch",
      "Installment",
      "Scheduled",
      "Received",
      "Bank/Cash movement",
      "Difference",
      "Liability debit",
      "Reference",
      "Status",
      "Issues",
    ];
    const body = rows.map((r) => [
      r.due_date,
      r.paid_date ?? "",
      r.plan_description,
      r.provider,
      branchName(r.branch_id),
      `${r.installment_no}/${r.installment_count || "-"}`,
      r.amount,
      r.paid_amount,
      r.cashCredit,
      r.difference,
      r.liabilityDebit,
      r.reference_number ?? "",
      STATUS_META[r.matchStatus].label,
      r.issues.join(" | "),
    ]);
    const csv = [
      `Installment Reconciliation,${branchLabel}`,
      `Period,${periodStart} to ${periodEnd}`,
      "",
      head.join(","),
      ...body.map((line) => line.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `installment-reconciliation-${periodStart}-to-${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-7 w-7" />
            Installment Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Match every received installment against the posted bank/cash movement and surface
            mismatches or missing payments.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button asChild variant="outline">
            <Link to="/accounting/installments">Open plans</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>From</Label>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId} disabled={!!pinnedBranchId}>
              <SelectTrigger>
                <SelectValue />
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
          </div>
          <div className="space-y-2">
            <Label>View</Label>
            <Button
              variant={onlyIssues ? "default" : "outline"}
              className="w-full"
              onClick={() => setOnlyIssues((v) => !v)}
            >
              {onlyIssues ? "Showing issues only" : "Show issues only"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: "Scheduled", value: totals?.scheduled ?? 0 },
          { label: "Received", value: totals?.received ?? 0 },
          { label: "Bank/cash movements", value: totals?.movements ?? 0 },
          { label: "Unmatched delta", value: totals?.unmatchedDelta ?? 0 },
          { label: "Overdue (missing)", value: totals?.overdue ?? 0 },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-3">
              <CardDescription>{c.label}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">{money(c.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && totals && totals.mismatched > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{totals.mismatched} installment(s) do not match the ledger</AlertTitle>
          <AlertDescription>
            Review the rows flagged below - a settlement was recorded without a matching bank/cash
            movement, or the amounts / accounts differ.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Installments {periodStart} → {periodEnd}</CardTitle>
          <CardDescription>{branchLabel} · {visible.length} row(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground flex flex-col items-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <p>{onlyIssues ? "No mismatches in this period." : "No installments due in this period."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Due</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Scheduled</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Bank/Cash</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r: InstallmentReconRow) => {
                    const meta = STATUS_META[r.matchStatus];
                    const isOpen = openRow === r.payment_id;
                    return (
                      <Fragment key={r.payment_id}>
                        <TableRow className="align-top">
                          <TableCell className="whitespace-nowrap">
                            <div>{r.due_date}</div>
                            {r.paid_date && (
                              <div className="text-xs text-muted-foreground">paid {r.paid_date}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{r.plan_description}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.provider}
                              {r.supplier_name ? ` · ${r.supplier_name}` : ""} · #{r.installment_no}
                              {r.installment_count ? `/${r.installment_count}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{branchName(r.branch_id)}</TableCell>
                          <TableCell className="text-right">{money(r.amount)}</TableCell>
                          <TableCell className="text-right">{money(r.paid_amount)}</TableCell>
                          <TableCell className="text-right">{money(r.cashCredit)}</TableCell>
                          <TableCell
                            className={`text-right ${Math.abs(r.difference) > 0.005 ? "text-destructive font-medium" : ""}`}
                          >
                            {money(r.difference)}
                          </TableCell>
                          <TableCell>
                            <Badge className={meta.className} variant="secondary">
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Collapsible
                              open={isOpen}
                              onOpenChange={(o) => setOpenRow(o ? r.payment_id : null)}
                            >
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <ChevronDown
                                    className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                                  />
                                </Button>
                              </CollapsibleTrigger>
                              <CollapsibleContent />
                            </Collapsible>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell colSpan={9} className="bg-muted/40">
                              <div className="space-y-3 py-2">
                                <ReconciliationDetailsPanel row={r} />
                                {r.issues.length > 0 && (
                                  <ul className="text-sm text-destructive list-disc ps-5 space-y-1">
                                    {r.issues.map((i, idx) => (
                                      <li key={idx}>{i}</li>
                                    ))}
                                  </ul>
                                )}
                                <div className="text-xs text-muted-foreground">
                                  Funding: {r.funding_source} · Reference: {r.reference_number ?? "-"} ·
                                  Batch: {r.batch_id ?? "not posted"}
                                </div>
                                {r.lines.length > 0 ? (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Account</TableHead>
                                        <TableHead className="text-right">Debit</TableHead>
                                        <TableHead className="text-right">Credit</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {r.lines.map((l, idx) => (
                                        <TableRow key={idx} className={l.is_voided ? "opacity-50" : ""}>
                                          <TableCell>{l.transaction_date}</TableCell>
                                          <TableCell>
                                            {l.code} - {l.name}
                                            {l.is_voided && " (voided)"}
                                          </TableCell>
                                          <TableCell className="text-right">{money(l.debit)}</TableCell>
                                          <TableCell className="text-right">{money(l.credit)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : (
                                  <p className="text-sm text-muted-foreground">
                                    No ledger movement posted for this installment.
                                  </p>
                                )}
                                <Button asChild variant="outline" size="sm" className="gap-2">
                                  <Link to="/accounting/installments">
                                    <ExternalLink className="h-4 w-4" /> Open plan
                                  </Link>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
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
