import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Percent, X } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatZonedYMD } from "@/lib/timezone";
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
import { useBranchVatRate } from "@/hooks/useBranchVatRate";
import { useCurrency } from "@/hooks/useCurrency";
import { db } from "@/integrations/db/client";
import { splitVat, validateVatConsistency } from "@/lib/vatSplit";
import { toast } from "sonner";

interface PendingRow {
  id: string;
  expense_date: string;
  description: string | null;
  amount: number;
  ledger_posted: boolean | null;
  branch_id: string | null;
}

/**
 * Lists expenses that were recorded without a net / VAT split so the tax
 * portion can be reclassified to 1180 Input VAT after the fact. The recorded
 * total is treated as VAT inclusive, so applying a split never changes the
 * amount owed — it only moves the tax portion out of the expense account.
 */
interface PendingVatSplitPanelProps {
  /** Render the table inside a collapsible section (default: true). */
  collapsible?: boolean;
  /** Initial open state when collapsible (default: false). */
  defaultOpen?: boolean;
  /** Show a "Open full page" link in the header. */
  showPageLink?: boolean;
  /** Render an empty-state card instead of nothing when there is nothing pending. */
  renderWhenEmpty?: boolean;
  /**
   * Limit the list to today's expenses (dashboard embed). The dedicated
   * Pending VAT Split page shows the complete backlog.
   */
  todayOnly?: boolean;
}

export function PendingVatSplitPanel({
  collapsible = true,
  defaultOpen = false,
  showPageLink = false,
  renderWhenEmpty = false,
  todayOnly = false,
}: PendingVatSplitPanelProps = {}) {
  const { activeBranchId } = useBranch();
  const { restaurant } = useAuth();
  const timeZone = (restaurant as any)?.timezone || "Asia/Riyadh";
  const today = formatZonedYMD(new Date(), timeZone);
  const { format: money } = useCurrency();
  const { vatPercent } = useBranchVatRate(activeBranchId);
  const qc = useQueryClient();
  const [rates, setRates] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(defaultOpen);
  const [bulkRate, setBulkRate] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const { data: rows = [], isLoading } = useQuery<PendingRow[]>({
    queryKey: ["pending-vat-split-expenses", activeBranchId, todayOnly ? today : "all"],
    queryFn: async () => {
      let q = (db as any)
        .from("expenses")
        .select("id, expense_date, description, amount, ledger_posted, branch_id")
        .eq("vat_split_status", "pending")
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(100);
      if (activeBranchId && activeBranchId !== "all") {
        q = q.eq("branch_id", activeBranchId);
      }
      if (todayOnly) {
        q = q.eq("expense_date", today);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PendingRow[];
    },
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pending-vat-split-expenses"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["vat-recoverable-reconciliation"] });
    qc.invalidateQueries({ queryKey: ["vat-split-audit"] });
  };

  const applySplit = useMutation({
    mutationFn: async (vars: { id: string; rate: number }) => {
      const { error } = await (db as any).rpc("apply_expense_vat_split", {
        p_expense_id: vars.id,
        p_rate_percent: vars.rate,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("VAT split applied and posted");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not apply the VAT split"),
  });

  const markNa = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (db as any).rpc("mark_expense_vat_not_applicable", {
        p_expense_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as no VAT applicable");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update the expense"),
  });

  const totalPendingVat = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const rate = Number(rates[r.id] ?? vatPercent) || 0;
        return sum + splitVat({ amount: r.amount, ratePercent: rate, inclusive: true }).vat;
      }, 0),
    [rows, rates, vatPercent],
  );

  // ── Batch: apply one rate to every pending row ───────────────────────────
  const effectiveBulkRate =
    bulkRate !== "" ? Number(bulkRate) : Number(vatPercent) || 0;
  const bulkPreview = useMemo(() => {
    const vat = rows.reduce(
      (sum, r) =>
        sum +
        splitVat({ amount: r.amount, ratePercent: effectiveBulkRate, inclusive: true })
          .vat,
      0,
    );
    const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    return { vat, total, count: rows.length };
  }, [rows, effectiveBulkRate]);
  const bulkRateValid = effectiveBulkRate > 0 && effectiveBulkRate <= 100;

  const bulkApply = useMutation({
    mutationFn: async (rate: number) => {
      const targets = [...rows];
      let ok = 0;
      const failures: string[] = [];
      setBulkProgress({ done: 0, total: targets.length });
      for (let i = 0; i < targets.length; i++) {
        const r = targets[i];
        const { error } = await (db as any).rpc("apply_expense_vat_split", {
          p_expense_id: r.id,
          p_rate_percent: rate,
          p_note: `Batch split @ ${rate}%`,
        });
        if (error) failures.push(`${r.expense_date} ${r.description ?? ""}: ${error.message}`);
        else ok++;
        setBulkProgress({ done: i + 1, total: targets.length });
      }
      return { ok, failures };
    },
    onSuccess: ({ ok, failures }) => {
      setBulkProgress(null);
      if (ok > 0) toast.success(`Applied the VAT split to ${ok} expense(s)`);
      if (failures.length > 0) {
        toast.error(
          `${failures.length} expense(s) could not be split. ${failures[0]}`,
          { duration: 8000 },
        );
      }
      invalidate();
    },
    onError: (e: any) => {
      setBulkProgress(null);
      toast.error(e?.message ?? "Batch VAT split failed");
      invalidate();
    },
  });

  if (isLoading) return null;
  if (rows.length === 0) {
    if (!renderWhenEmpty) return null;
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" />
            {todayOnly ? "No pending VAT splits today" : "No pending VAT splits"}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {todayOnly
              ? "Every expense recorded today has a net / VAT split or is marked as no VAT."
              : "Every expense in this branch has a net / VAT split or is marked as no VAT."}
          </p>
        </CardHeader>
      </Card>
    );
  }

  const header = (
    <CardHeader className="pb-3">
      <CardTitle className="text-base font-medium flex flex-wrap items-center gap-2">
        {collapsible ? (
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
        ) : null}
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        {todayOnly ? "Pending VAT split · today" : "Pending VAT split"}
        <Badge variant="outline" className="border-amber-500/40 text-amber-700">
          {rows.length}
        </Badge>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Estimated recoverable VAT: {money(totalPendingVat)}
        </span>
      </CardTitle>
      <p className="text-xs text-muted-foreground">
        {todayOnly ? "Today's expenses" : "These expenses"} recorded without a net / VAT split. Applying a split treats
        the recorded total as VAT inclusive and posts DR 1180 Input VAT · CR the expense
        account — the total never changes.
        {todayOnly ? " Use the full page for the complete backlog." : ""}
      </p>
      {showPageLink ? (
        <Link
          to="/expenses/pending-vat-split"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Open the full Pending VAT Split page
        </Link>
      ) : null}
    </CardHeader>
  );

  const body = (
    <CardContent className="p-0">
        <div className="flex flex-wrap items-end gap-3 border-b bg-muted/20 p-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Batch VAT rate %
            </label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              className="h-8 w-28"
              value={bulkRate === "" ? String(vatPercent ?? "") : bulkRate}
              onChange={(e) => setBulkRate(e.target.value)}
            />
          </div>
          <p className="flex-1 text-[11px] text-muted-foreground">
            Applies the same rate to all {bulkPreview.count} pending expense(s) —
            {" "}
            {money(bulkPreview.total)} total, about {money(bulkPreview.vat)} recoverable
            VAT. Each bill keeps its total; only the tax portion moves to 1180.
          </p>
          <Button
            size="sm"
            className="h-8"
            disabled={!bulkRateValid || bulkApply.isPending || applySplit.isPending}
            onClick={() => setBulkConfirmOpen(true)}
          >
            <Percent className="mr-1 h-3 w-3" />
            {bulkProgress
              ? `Applying ${bulkProgress.done}/${bulkProgress.total}…`
              : "Apply to all pending"}
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-24">Rate %</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const rate = Number(rates[r.id] ?? vatPercent) || 0;
              const split = splitVat({
                amount: r.amount,
                ratePercent: rate,
                inclusive: true,
              });
              const consistency = validateVatConsistency({
                split,
                ratePercent: rates[r.id] ?? vatPercent,
                enteredAmount: r.amount,
                inclusive: true,
                branchRatePercent: vatPercent,
              });
              const busy = applySplit.isPending || markNa.isPending;
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {r.expense_date}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs">
                    {r.description || "—"}
                    {r.ledger_posted ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        posted
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {money(r.amount)}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      className={`h-8 ${
                        consistency.errors.length ? "border-destructive" : ""
                      }`}
                      value={rates[r.id] ?? String(vatPercent)}
                      onChange={(e) =>
                        setRates((p) => ({ ...p, [r.id]: e.target.value }))
                      }
                    />
                    {consistency.issues.length > 0 && (
                      <p
                        className={`mt-1 text-[10px] leading-tight ${
                          consistency.errors.length
                            ? "text-destructive"
                            : "text-amber-700"
                        }`}
                      >
                        {(consistency.errors[0] ?? consistency.issues[0]).message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {money(split.net)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-emerald-700">
                    {money(split.vat)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={busy || !consistency.valid}
                        onClick={() => applySplit.mutate({ id: r.id, rate })}
                      >
                        <Percent className="mr-1 h-3 w-3" />
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={busy}
                        onClick={() => markNa.mutate(r.id)}
                      >
                        <X className="mr-1 h-3 w-3" />
                        No VAT
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      <div className="flex items-center gap-2 border-t p-3 text-[11px] text-muted-foreground">
        <Check className="h-3 w-3" />
        Applied splits update the bill and, when already posted, create a
        &ldquo;Retroactive VAT split&rdquo; correction batch in the ledger.
      </div>
    </CardContent>
  );

  const bulkDialog = (
    <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Apply {effectiveBulkRate}% VAT to {bulkPreview.count} expense(s)?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Each bill is treated as VAT inclusive: {money(bulkPreview.total)} total
            splits into about {money(bulkPreview.total - bulkPreview.vat)} net and{" "}
            {money(bulkPreview.vat)} recoverable VAT. Posted bills get a retroactive
            correction batch in the ledger. This is logged in the VAT split audit trail.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setBulkConfirmOpen(false);
              bulkApply.mutate(effectiveBulkRate);
            }}
          >
            Apply to all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (!collapsible) {
    return (
      <>
      <Card className="border-amber-500/40">
        {header}
        {body}
      </Card>
      {bulkDialog}
      </>
    );
  }

  return (
    <>
    <Card className="border-amber-500/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            {header}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>{body}</CollapsibleContent>
      </Collapsible>
    </Card>
    {bulkDialog}
    </>
  );
}