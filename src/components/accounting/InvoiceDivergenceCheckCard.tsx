import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useBulkInvoiceFix,
  useInvoiceDivergenceCheck,
  type InvoiceBulkFixRow,
  type InvoiceDivergenceRow,
} from "@/hooks/useInvoiceDivergenceCheck";
import { INVOICE_RECON_ISSUE_LABELS, type InvoiceReconIssue } from "@/hooks/useInvoiceLedgerReconciliation";

interface Props {
  branchId: string;
  from: string;
  to: string;
  onInspectInvoice?: (invoiceId: string) => void;
  onFixApplied?: () => void;
}

const issueLabel = (issue: string) =>
  INVOICE_RECON_ISSUE_LABELS[issue as InvoiceReconIssue] ?? issue;

const FIX_STATUS_LABELS: Record<string, string> = {
  no_change: "Nothing to fix",
  would_fix: "Would fix",
  fixed: "Fixed",
  fixed_needs_repost: "Fixed · repost ledger",
  needs_ledger_repost: "Needs ledger repost",
};

export function InvoiceDivergenceCheckCard({
  branchId,
  from,
  to,
  onInspectInvoice,
  onFixApplied,
}: Props) {
  const { format: fmt } = useCurrency();
  const check = useInvoiceDivergenceCheck();
  const bulkFix = useBulkInvoiceFix();
  const rows = (check.data ?? []) as InvoiceDivergenceRow[];
  const hasRun = check.isSuccess;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fixResults, setFixResults] = useState<InvoiceBulkFixRow[] | null>(null);
  const [previewMode, setPreviewMode] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fixableRows = useMemo(
    () => rows.filter((r) => r.duplicate_line_count > 0 || r.issues.includes("total_mismatch") || r.issues.includes("expense_mismatch")),
    [rows],
  );
  const selectedIds = useMemo(
    () => fixableRows.filter((r) => selected.has(r.invoice_id)).map((r) => r.invoice_id),
    [fixableRows, selected],
  );
  const allSelected = fixableRows.length > 0 && selectedIds.length === fixableRows.length;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(fixableRows.map((r) => r.invoice_id)));

  const runFix = async (dryRun: boolean) => {
    if (selectedIds.length === 0) return;
    const res = await bulkFix.mutateAsync({ invoiceIds: selectedIds, dryRun });
    setFixResults(res);
    setPreviewMode(dryRun);
    if (!dryRun) {
      const fixed = res.filter((r) => r.status.startsWith("fixed")).length;
      toast.success(
        fixed > 0 ? `Reconciled ${fixed} bill${fixed === 1 ? "" : "s"}` : "No changes were needed",
      );
      setSelected(new Set());
      onFixApplied?.();
      check.mutate({ branchId, from, to });
    }
  };

  const summary = useMemo(() => {
    const dupBills = rows.filter((r) => r.duplicate_line_count > 0);
    return {
      flagged: rows.length,
      dupBills: dupBills.length,
      dupAmount: dupBills.reduce((s, r) => s + r.duplicate_amount, 0),
      ledgerGaps: rows.filter(
        (r) => r.issues.includes("ledger_mismatch") || r.issues.includes("not_posted"),
      ).length,
    };
  }, [rows]);

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Automated bill vs ledger check
          </CardTitle>
          <CardDescription>
            Server-side scan that flags bills whose computed line total diverges from their ledger
            postings, and lists the suspected duplicate line groups.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setSelected(new Set());
            setFixResults(null);
            check.mutate({ branchId, from, to });
          }}
          disabled={check.isPending}
        >
          {check.isPending ? "Running…" : "Run check"}
        </Button>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {!hasRun && !check.isPending && (
          <p className="text-sm text-muted-foreground">
            Run the check to scan the selected branch and period.
          </p>
        )}

        {hasRun && rows.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            No divergence found — every bill matches its lines and ledger postings.
          </p>
        )}

        {hasRun && rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  disabled={fixableRows.length === 0}
                />
                <span>
                  Select all fixable ({fixableRows.length}) · {selectedIds.length} selected
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={selectedIds.length === 0 || bulkFix.isPending}
                  onClick={() => runFix(true)}
                >
                  Preview fix
                </Button>
                <Button
                  size="sm"
                  disabled={selectedIds.length === 0 || bulkFix.isPending}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  {bulkFix.isPending ? "Working…" : "Reconcile & fix"}
                </Button>
              </div>
            </div>

            {fixResults && fixResults.length > 0 && (
              <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs font-medium">
                  {previewMode ? "Preview — nothing has been changed yet" : "Fix applied"}
                </p>
                {fixResults.map((r) => (
                  <p key={r.invoice_id} className="break-words text-xs text-muted-foreground">
                    {r.invoice_number} · {FIX_STATUS_LABELS[r.status] ?? r.status} · −{r.removed_lines}{" "}
                    line(s) · {fmt(r.old_total)} → {fmt(r.new_total)}
                    {r.message ? ` · ${r.message}` : ""}
                  </p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Bills flagged</p>
                <p className="text-lg font-light">{summary.flagged}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">With duplicate lines</p>
                <p className="text-lg font-light">{summary.dupBills}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Duplicate value</p>
                <p className="text-lg font-light">{fmt(summary.dupAmount)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Ledger gaps</p>
                <p className="text-lg font-light">{summary.ledgerGaps}</p>
              </div>
            </div>

            <ScrollArea className="max-h-[420px]">
              <div className="space-y-3 pr-3">
                {rows.map((r) => (
                  <div key={r.invoice_id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(r.invoice_id)}
                          disabled={!fixableRows.some((f) => f.invoice_id === r.invoice_id)}
                          onCheckedChange={() => toggleOne(r.invoice_id)}
                        />
                        <div className="min-w-0">
                        <p className="break-words text-sm">
                          {r.invoice_number} · {r.supplier_name ?? "No supplier"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.invoice_date} · bill {fmt(r.invoice_total)} · lines {fmt(r.lines_total)} ·
                          ledger {r.ledger_debit != null ? fmt(r.ledger_debit) : "not posted"}
                        </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {r.issues.map((i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="gap-1 border-destructive/40 text-destructive"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {issueLabel(i)}
                          </Badge>
                        ))}
                        {onInspectInvoice && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onInspectInvoice(r.invoice_id)}
                          >
                            Inspect
                          </Button>
                        )}
                      </div>
                    </div>

                    {r.duplicate_groups.length > 0 && (
                      <div className="mt-2 space-y-1 rounded-md bg-destructive/5 p-2">
                        <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                          <Copy className="h-3 w-3" />
                          Suspected duplicate line groups (excess {fmt(r.duplicate_amount)})
                        </p>
                        {r.duplicate_groups.map((g, idx) => (
                          <p key={idx} className="break-words text-xs text-muted-foreground">
                            {g.description} — {g.quantity} × {fmt(g.unit_price)} = {fmt(g.line_total)} ·
                            ×{g.occurrences} · excess {fmt(g.excess_amount)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconcile and fix {selectedIds.length} bill(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Duplicated lines will be removed (one copy of each identical line is kept) and the bill
              total recomputed from the remaining lines. Linked expenses are realigned only when they
              are not yet posted; already-posted bills are reported as needing a ledger repost. Every
              change is written to the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void runFix(false);
              }}
            >
              Apply fix
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
