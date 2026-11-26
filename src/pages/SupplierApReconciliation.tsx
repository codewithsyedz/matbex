import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Scale, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { db } from "@/integrations/db/client";
import { useCurrency } from "@/hooks/useCurrency";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { useSupplierApReconciliation } from "@/hooks/useSupplierApReconciliation";
import { SupplierApHeadGapCard } from "@/components/accounting/SupplierApHeadGapCard";

export default function SupplierApReconciliation() {
  const { tenant, hasFeature, loading } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();
  const queryClient = useQueryClient();

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [onlyVariance, setOnlyVariance] = useState(false);
  const [remapping, setRemapping] = useState<string | null>(null);

  const { rows, totals, isLoading, isFetching, refetch } = useSupplierApReconciliation(branchId);

  const handleRemap = async (supplierId: string | null, label: string) => {
    setRemapping(supplierId ?? "all");
    try {
      const { data, error } = await db.rpc("remap_expenses_to_supplier_ap_head", {
        p_supplier_id: supplierId,
        p_branch_id: branchId && branchId !== "all" ? branchId : null,
      });
      if (error) throw error;
      const result = (data ?? {}) as {
        entries_moved?: number;
        amount_moved?: number;
        suppliers_without_head?: number;
      };
      if (!result.entries_moved) {
        toast.info(`Nothing to move for ${label}`);
      } else {
        toast.success(
          `Moved ${result.entries_moved} payable ${
            result.entries_moved === 1 ? "entry" : "entries"
          } (${fmt(result.amount_moved ?? 0)}) onto supplier heads`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["supplier-ap-reconciliation"] });
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not remap supplier payables");
    } finally {
      setRemapping(null);
    }
  };

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const visibleRows = onlyVariance ? rows.filter((r) => Math.abs(r.variance) > 0.01) : rows;

  const handleExportCsv = () => {
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(`Supplier Payables Reconciliation,${tenant?.name ?? ""}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push(`Generated,${format(new Date(), "yyyy-MM-dd HH:mm")}`);
    lines.push("");
    lines.push(
      [
        "Supplier",
        "AP Head Code",
        "AP Head Name",
        "Open Bills",
        "Unpaid Bills Total",
        "GL Dedicated Head",
        "GL Shared Control",
        "GL Total",
        "Variance",
      ].join(","),
    );
    for (const r of visibleRows) {
      lines.push(
        [
          esc(r.supplierName),
          esc(r.apAccountCode ?? "—"),
          esc(r.apAccountName ?? "No dedicated head"),
          r.openBills,
          r.subledgerOpen.toFixed(2),
          r.glDedicated.toFixed(2),
          r.glShared.toFixed(2),
          r.glOpen.toFixed(2),
          r.variance.toFixed(2),
        ].join(","),
      );
    }
    lines.push("");
    lines.push(
      [
        "TOTAL",
        "",
        "",
        "",
        totals.subledgerOpen.toFixed(2),
        "",
        totals.glShared.toFixed(2),
        totals.glOpen.toFixed(2),
        totals.variance.toFixed(2),
      ].join(","),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier-ap-reconciliation-${format(new Date(), "yyyyMMdd")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Reconciliation exported");
  };

  if (!loading && !hasFeature("accounting")) {
    return (
      <LockedFeatureScreen
        featureName="Supplier Payables Reconciliation"
        description="Compare unpaid supplier bills against the balances sitting on each supplier's AP head."
        featureKey="accounting"
      />
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-7 w-7 text-primary" />
            Supplier Payables Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unpaid bills in the expense sub-ledger vs. the balance posted on each supplier's payable
            head · {branchScopeLabel}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[180px]">
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

          <Button
            variant={onlyVariance ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => setOnlyVariance((v) => !v)}
          >
            Variances only
          </Button>

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

          {totals.onSharedControl > 0 && (
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => handleRemap(null, "all suppliers")}
              disabled={remapping !== null}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Move shared 2000 to supplier heads
            </Button>
          )}
        </div>
      </header>

      <SupplierApHeadGapCard />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Unpaid bills (sub-ledger)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totals.subledgerOpen)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">AP heads balance (GL)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(totals.glOpen)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Net variance</p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${
                Math.abs(totals.variance) > 0.01 ? "text-amber-600" : "text-emerald-600"
              }`}
            >
              {fmt(totals.variance)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Suppliers out of balance</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{totals.mismatched}</p>
            {totals.onSharedControl > 0 && (
              <p className="mt-1 text-xs font-light text-muted-foreground">
                {totals.onSharedControl} still on shared control
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">By supplier</CardTitle>
          <CardDescription className="font-light">
            Variance = unpaid bills minus the net credit sitting on the supplier's payable
            account(s). A non-zero figure means a bill was never posted, was settled outside AP, or
            landed on the shared control account.
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
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {onlyVariance
                ? "No variances — every supplier's payables tie out to the ledger."
                : "No supplier payable activity for this scope."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>AP head</TableHead>
                    <TableHead className="text-right">Open bills</TableHead>
                    <TableHead className="text-right">Unpaid total</TableHead>
                    <TableHead className="text-right">Own head</TableHead>
                    <TableHead className="text-right">Shared 2000</TableHead>
                    <TableHead className="text-right">GL total</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Fix</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => {
                    const off = Math.abs(r.variance) > 0.01;
                    return (
                      <TableRow key={r.supplierId}>
                        <TableCell className="font-medium">
                          {r.supplierName}
                          {r.unpostedBills > 0 && (
                            <Badge variant="outline" className="ml-2 text-[10px] font-light">
                              {r.unpostedBills} unposted
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.apAccountCode ? (
                            <>
                              {r.apAccountCode} · {r.apAccountName}
                            </>
                          ) : (
                            <span className="text-amber-600">no dedicated head</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.openBills}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(r.subledgerOpen)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(r.glDedicated)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Math.abs(r.glShared) > 0.01 ? (
                            <span className="text-amber-600">{fmt(r.glShared)}</span>
                          ) : (
                            fmt(0)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.glOpen)}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-medium ${
                            off ? "text-amber-600" : "text-muted-foreground"
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {off && <AlertTriangle className="h-3 w-3" />}
                            {fmt(r.variance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {Math.abs(r.glShared) > 0.01 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={() => handleRemap(r.supplierId, r.supplierName)}
                              disabled={remapping !== null}
                            >
                              <Wand2 className="h-3 w-3" />
                              Move to head
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(totals.subledgerOpen)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">{fmt(totals.glShared)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.glOpen)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(totals.variance)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
