import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subMonths } from "date-fns";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalSettings, getFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { BranchBadge, branchDisplayLabel } from "@/components/branch/BranchBadge";
import { exportToCSV } from "@/lib/exportUtils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, RefreshCw, Wallet } from "lucide-react";

interface AuditRow {
  id: string;
  name: string;
  monthlyAmount: number;
  branchId: string | null;
  branchName: string | null;
  isShared: boolean;
  paidAmount: number;
  isPaid: boolean;
  paymentDate: string | null;
  paymentMethod: string | null;
  ledgerPosted: boolean | null;
  countedAsFixed: number;
}

export default function OverheadAudit() {
  const { restaurant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const { monthStartDay, isLoading: fiscalLoading } = useFiscalSettings();

  const defaultBranch = pinnedBranchId ?? (activeBranchId && activeBranchId !== "__all__" ? activeBranchId : null);
  const [branchId, setBranchId] = useState<string | null>(defaultBranch);
  const [monthOffset, setMonthOffset] = useState(0);

  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const range = getFiscalMonthRange(subMonths(new Date(), i), monthStartDay);
      return {
        offset: i,
        start: range.start,
        end: range.end,
        key: format(range.start, "yyyy-MM-dd"),
        label: `${format(range.start, "dd MMM yyyy")} – ${format(range.end, "dd MMM yyyy")}`,
      };
    });
  }, [monthStartDay]);

  const selectedMonth = monthOptions[monthOffset];
  const branchName = branches.find((b) => b.id === branchId)?.name ?? null;
  const lockedToBranch = !!pinnedBranchId;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["overhead-audit", restaurant?.id, branchId, selectedMonth?.key],
    enabled: !!restaurant?.id && !fiscalLoading && !!selectedMonth,
    queryFn: async (): Promise<AuditRow[]> => {
      const rid = restaurant!.id;
      const monthKey = selectedMonth.key;
      const branchFilter = branchId ? `branch_id.eq.${branchId},branch_id.is.null` : null;

      let allocQ = db
        .from("overhead_allocation")
        .select("id, name, monthly_amount, is_active, branch_id")
        .eq("restaurant_id", rid)
        .eq("is_active", true);
      if (branchFilter) allocQ = allocQ.or(branchFilter);

      let payQ = db
        .from("overhead_payments")
        .select("overhead_allocation_id, amount_paid, payment_date, payment_method, ledger_posted, branch_id")
        .eq("restaurant_id", rid)
        .eq("payment_month", monthKey);
      if (branchFilter) payQ = payQ.or(branchFilter);

      const [allocRes, payRes] = await Promise.all([
        allocQ.order("monthly_amount", { ascending: false }),
        payQ,
      ]);
      if (allocRes.error) throw allocRes.error;
      if (payRes.error) throw payRes.error;

      const payments = new Map<string, any>();
      (payRes.data || []).forEach((p: any) => payments.set(p.overhead_allocation_id, p));

      return (allocRes.data || []).map((item: any) => {
        const payment = payments.get(item.id);
        const monthlyAmount = Number(item.monthly_amount) || 0;
        const isPaid = !!payment;
        return {
          id: item.id,
          name: item.name,
          monthlyAmount,
          branchId: item.branch_id ?? null,
          branchName: branches.find((b) => b.id === item.branch_id)?.name ?? null,
          isShared: !item.branch_id,
          paidAmount: payment ? Number(payment.amount_paid) || 0 : 0,
          isPaid,
          paymentDate: payment?.payment_date ?? null,
          paymentMethod: payment?.payment_method ?? null,
          ledgerPosted: payment ? !!payment.ledger_posted : null,
          countedAsFixed: isPaid ? 0 : monthlyAmount,
        };
      });
    },
  });

  const rows = data ?? [];
  const totals = useMemo(() => ({
    allocated: rows.reduce((s, r) => s + r.monthlyAmount, 0),
    paid: rows.reduce((s, r) => s + r.paidAmount, 0),
    fixed: rows.reduce((s, r) => s + r.countedAsFixed, 0),
    excluded: rows.filter((r) => r.isPaid).length,
  }), [rows]);

  const handleExport = () => {
    exportToCSV({
      headers: [
        "Overhead item", "Scope", "Branch", "Branch ID", "Monthly amount",
        "Payment status", "Paid amount", "Payment date", "Payment method",
        "Ledger posted", "Counted as fixed", "Treatment",
      ],
      rows: rows.map((r) => [
        r.name,
        r.isShared ? "Shared (tenant-wide)" : "Branch-specific",
        branchDisplayLabel(r.branchName, "Shared"),
        r.branchId ?? "",
        r.monthlyAmount.toFixed(2),
        r.isPaid ? "Paid" : "Unpaid",
        r.paidAmount.toFixed(2),
        r.paymentDate ?? "",
        r.paymentMethod ?? "",
        r.ledgerPosted === null ? "" : r.ledgerPosted ? "Yes" : "No",
        r.countedAsFixed.toFixed(2),
        r.isPaid ? "Excluded as paid" : "Counted as fixed cost",
      ]),
      filename: `overhead-audit_${branchName ?? "all-branches"}_${selectedMonth?.key ?? ""}`,
    });
  };

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Overhead Audit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every overhead allocation for the selected branch and fiscal month, with payment status and
            whether it was counted as fixed cost or excluded because it was already paid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={branchId ?? "__none__"}
            onValueChange={(v) => setBranchId(v === "__none__" ? null : v)}
            disabled={lockedToBranch}
          >
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">All branches (shared view)</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(monthOffset)} onValueChange={(v) => setMonthOffset(Number(v))}>
            <SelectTrigger className="w-[240px]"><SelectValue placeholder="Select month" /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m.key} value={String(m.offset)}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total allocated", value: totals.allocated, hint: `${rows.length} item(s)` },
          { label: "Counted as fixed cost", value: totals.fixed, hint: "Unpaid this month" },
          { label: "Excluded as paid", value: totals.paid, hint: `${totals.excluded} item(s)` },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-3">
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-base font-medium">{formatCurrency(c.value)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{c.hint}</CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Scope</CardDescription>
            <CardTitle className="text-base font-medium">
              {branchId ? <BranchBadge name={branchName} branchId={branchId} /> : "All branches"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{selectedMonth?.label}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Allocation detail
          </CardTitle>
          <CardDescription>
            Shared (tenant-wide) items are included for every branch. Paid items are excluded from the
            dashboard fixed-cost figure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No active overhead items for this scope.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">Monthly</TableHead>
                    <TableHead>Payment status</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Paid on</TableHead>
                    <TableHead>Ledger</TableHead>
                    <TableHead className="text-right">Counted as fixed</TableHead>
                    <TableHead>Treatment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        {r.isShared
                          ? <Badge variant="outline">Shared</Badge>
                          : <BranchBadge name={r.branchName} branchId={r.branchId} size="sm" />}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(r.monthlyAmount)}</TableCell>
                      <TableCell>
                        <Badge variant={r.isPaid ? "default" : "secondary"}>{r.isPaid ? "Paid" : "Unpaid"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.paidAmount ? formatCurrency(r.paidAmount) : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.paymentDate ? format(new Date(r.paymentDate), "dd MMM yyyy") : "—"}
                        {r.paymentMethod ? ` · ${r.paymentMethod}` : ""}
                      </TableCell>
                      <TableCell>
                        {r.ledgerPosted === null ? "—" : (
                          <Badge variant={r.ledgerPosted ? "outline" : "destructive"}>
                            {r.ledgerPosted ? "Posted" : "Not posted"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(r.countedAsFixed)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.isPaid ? "Excluded as paid" : "Counted as fixed cost"}
                      </TableCell>
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
