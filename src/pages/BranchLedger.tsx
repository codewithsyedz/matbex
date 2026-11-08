import { useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";
import { Banknote, CalendarIcon, Download, Landmark, Scale } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useBranchLedger, type BranchLedgerRow } from "@/hooks/useBranchLedger";
import { SettleBranchCardSalesDialog } from "@/components/finance/SettleBranchCardSalesDialog";

export default function BranchLedger() {
  const { tenant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();

  const [from, setFrom] = useState<Date>(startOfMonth(new Date()));
  const [to, setTo] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [settleRow, setSettleRow] = useState<BranchLedgerRow | null>(null);

  const { rows, adjustments, payouts, totals, isLoading } = useBranchLedger({ from, to, branchId });

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const branchName = (bid: string | null) =>
    rows.find((r) => r.branchId === bid)?.branchName ?? (bid ? "Unknown branch" : "Unassigned");

  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push(`Branch Ledger,${tenant?.name ?? ""}`);
    lines.push(`Period,${format(from, "yyyy-MM-dd")} to ${format(to, "yyyy-MM-dd")}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push("");
    lines.push(
      ["Branch", "Txns", "Card Gross", "VAT", "Adjustments", "Payouts (net)", "Fees", "Settled", "Unsettled"].join(","),
    );
    for (const r of rows) {
      lines.push(
        [
          `"${r.branchName.replace(/"/g, '""')}"`,
          String(r.txnCount),
          r.posGross.toFixed(2),
          r.posVat.toFixed(2),
          r.adjustments.toFixed(2),
          r.payoutsNet.toFixed(2),
          r.settlementFees.toFixed(2),
          r.settledGross.toFixed(2),
          r.unsettled.toFixed(2),
        ].join(","),
      );
    }
    lines.push(
      [
        "TOTAL",
        String(totals.txnCount),
        totals.posGross.toFixed(2),
        totals.posVat.toFixed(2),
        totals.adjustments.toFixed(2),
        totals.payoutsNet.toFixed(2),
        totals.settlementFees.toFixed(2),
        totals.settledGross.toFixed(2),
        totals.unsettled.toFixed(2),
      ].join(","),
    );
    lines.push("");
    lines.push(["Adjustments"].join(","));
    lines.push(["Date", "Branch", "Scope", "Reason", "Amount", "Posted", "Notes"].join(","));
    for (const a of adjustments) {
      lines.push(
        [
          a.businessDate,
          `"${branchName(a.branchId).replace(/"/g, '""')}"`,
          a.scope,
          a.reason,
          a.amount.toFixed(2),
          a.ledgerPosted ? "yes" : "no",
          `"${(a.notes ?? "").replace(/"/g, '""')}"`,
        ].join(","),
      );
    }
    lines.push("");
    lines.push(["Payouts"].join(","));
    lines.push(["Date", "Branch", "Gross", "Fee", "Net", "Reference"].join(","));
    for (const p of payouts) {
      lines.push(
        [
          p.depositDate,
          `"${branchName(p.branchId).replace(/"/g, '""')}"`,
          p.gross.toFixed(2),
          p.fee.toFixed(2),
          p.net.toFixed(2),
          `"${(p.reference ?? "").replace(/"/g, '""')}"`,
        ].join(","),
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `branch-ledger-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Branch ledger exported");
  };

  const DatePick = ({ value, onChange, label }: { value: Date; onChange: (d: Date) => void; label: string }) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5" />
          {label} {format(value, "MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && onChange(d)}
          initialFocus
          className="pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between min-h-[56px]">
        <div className="min-w-[240px] flex-1">
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Scale className="h-7 w-7 text-primary" />
            Branch Ledger
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Card sales, day-end adjustments and acquirer payouts per branch · {branchScopeLabel}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-[190px]">
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

          <DatePick value={from} onChange={setFrom} label="From" />
          <DatePick value={to} onChange={setTo} label="To" />

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExportCsv}
            disabled={isLoading || rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Card gross", value: fmt(totals.posGross) },
          { label: "Adjustments", value: fmt(totals.adjustments) },
          { label: "Payouts received", value: fmt(totals.payoutsNet) },
          { label: "Acquirer fees", value: fmt(totals.settlementFees) },
          { label: "Unsettled", value: fmt(totals.unsettled) },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Per branch</CardTitle>
          <CardDescription>
            Settling a branch posts the acquirer payout to the ledger and refreshes P&amp;L figures
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nothing recorded for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Txns</TableHead>
                    <TableHead className="text-right">Card gross</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Adjustments</TableHead>
                    <TableHead className="text-right">Payouts (net)</TableHead>
                    <TableHead className="text-right">Unsettled</TableHead>
                    <TableHead className="text-right">Settle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.branchId ?? "unassigned"}>
                      <TableCell className="font-medium">{r.branchName}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.txnCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.posGross)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.posVat)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.adjustmentCount ? fmt(r.adjustments) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.payoutCount ? fmt(r.payoutsNet) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.unsettled)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={r.unsettled > 0.005 ? "default" : "outline"}
                          className="h-8 gap-1.5"
                          onClick={() => setSettleRow(r)}
                        >
                          <Banknote className="h-3.5 w-3.5" />
                          Settle
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Day-end adjustments</CardTitle>
            <CardDescription>Active (unreversed) adjustments in the period</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {adjustments.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No adjustments.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Ledger</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjustments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(`${a.businessDate}T12:00:00`), "MMM d")}
                        </TableCell>
                        <TableCell>{branchName(a.branchId)}</TableCell>
                        <TableCell className="capitalize">{a.reason.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(a.amount)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={a.ledgerPosted ? "default" : "outline"}>
                            {a.ledgerPosted ? "Posted" : "Pending"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              Acquirer payouts
            </CardTitle>
            <CardDescription>Settlements banked in the period</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {payouts.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No payouts recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(`${p.depositDate}T12:00:00`), "MMM d")}
                        </TableCell>
                        <TableCell>{branchName(p.branchId)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.gross)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.fee)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <SettleBranchCardSalesDialog
        open={!!settleRow}
        onOpenChange={(o) => !o && setSettleRow(null)}
        branchId={settleRow?.branchId ?? null}
        branchName={settleRow?.branchName ?? ""}
        unsettled={settleRow?.unsettled ?? 0}
        periodFrom={from}
        periodTo={to}
      />
    </div>
  );
}
