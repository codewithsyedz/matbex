import { useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";
import { CalendarIcon, CreditCard, Download, AlertTriangle, Banknote } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useCardSalesByBranch, type CardSalesBranchRow } from "@/hooks/useCardSalesByBranch";
import { SettleBranchCardSalesDialog } from "@/components/finance/SettleBranchCardSalesDialog";

export default function CardSalesByBranch() {
  const { tenant } = useAuth();
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: fmt } = useCurrency();

  const [from, setFrom] = useState<Date>(startOfMonth(new Date()));
  const [to, setTo] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [settleRow, setSettleRow] = useState<CardSalesBranchRow | null>(null);

  const { branchRows, dayRows, totals, isLoading } = useCardSalesByBranch({ from, to, branchId });

  const branchScopeLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const varianceRows = dayRows.filter((r) => Math.abs(r.variance) > 0.005);

  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push(`Card Sales by Branch,${tenant?.name ?? ""}`);
    lines.push(`Period,${format(from, "yyyy-MM-dd")} to ${format(to, "yyyy-MM-dd")}`);
    lines.push(`Branch,${branchScopeLabel}`);
    lines.push("");
    lines.push(
      ["Branch", "Transactions", "Card Gross", "VAT", "Card Net (ex-VAT)", "Day-end Declared", "Variance", "Settled", "Fees", "Unsettled"].join(","),
    );
    for (const r of branchRows) {
      lines.push(
        [
          `"${r.branchName.replace(/"/g, '""')}"`,
          String(r.txnCount),
          r.posGross.toFixed(2),
          r.posVat.toFixed(2),
          r.posNet.toFixed(2),
          r.declared.toFixed(2),
          r.variance.toFixed(2),
          r.settledGross.toFixed(2),
          r.settlementFees.toFixed(2),
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
        totals.posNet.toFixed(2),
        totals.declared.toFixed(2),
        totals.variance.toFixed(2),
        totals.settledGross.toFixed(2),
        totals.settlementFees.toFixed(2),
        totals.unsettled.toFixed(2),
      ].join(","),
    );
    lines.push("");
    lines.push(["Date", "Branch", "Transactions", "Card Gross", "VAT", "Day-end Declared", "Variance"].join(","));
    for (const r of dayRows) {
      lines.push(
        [
          r.date,
          `"${r.branchName.replace(/"/g, '""')}"`,
          String(r.txnCount),
          r.posGross.toFixed(2),
          r.posVat.toFixed(2),
          r.declared.toFixed(2),
          r.variance.toFixed(2),
        ].join(","),
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-sales-by-branch-${format(from, "yyyyMMdd")}-${format(to, "yyyyMMdd")}${
      branchId !== "all" ? `-${branchScopeLabel.replace(/\s+/g, "_")}` : ""
    }.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Card sales exported");
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
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <CreditCard className="h-7 w-7 text-primary" />
            Card Sales by Branch
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Card (debit/credit) receipts per branch with VAT split and day-end reconciliation ·{" "}
            {branchScopeLabel}
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
            disabled={isLoading || branchRows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {[
          { label: "Card gross", value: fmt(totals.posGross) },
          { label: "VAT on card", value: fmt(totals.posVat) },
          { label: "Card net (ex-VAT)", value: fmt(totals.posNet) },
          { label: "Transactions", value: String(totals.txnCount) },
          { label: "Settled", value: fmt(totals.settledGross) },
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

      {Math.abs(totals.variance) > 0.005 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Day-end card declarations differ from POS card receipts by{" "}
          <span className="font-medium text-foreground">{fmt(Math.abs(totals.variance))}</span> across{" "}
          {varianceRows.length} day(s).
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">By branch</CardTitle>
          <CardDescription>
            Card receipts recorded on POS transactions, split by VAT, compared with day-end declarations
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : branchRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No card sales recorded in this period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                  <TableHead className="text-right">Card gross</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Net (ex-VAT)</TableHead>
                  <TableHead className="text-right">Declared</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Settled</TableHead>
                  <TableHead className="text-right">Unsettled</TableHead>
                  <TableHead className="text-right">Settle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branchRows.map((r) => (
                  <TableRow key={r.branchId ?? "unassigned"}>
                    <TableCell className="font-medium">{r.branchName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.txnCount}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmt(r.posGross)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.posVat)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.posNet)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.declared > 0.005 ? fmt(r.declared) : "-"}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        Math.abs(r.variance) > 0.005 ? "text-amber-600" : "text-muted-foreground"
                      }`}
                    >
                      {Math.abs(r.variance) > 0.005 ? fmt(r.variance) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.settledGross > 0.005 ? fmt(r.settledGross) : "-"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        r.unsettled > 0.005 ? "text-amber-600" : "text-muted-foreground"
                      }`}
                    >
                      {fmt(r.unsettled)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        disabled={r.unsettled <= 0.005}
                        onClick={() => setSettleRow(r)}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Settle
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{totals.txnCount}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(totals.posGross)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(totals.posVat)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(totals.posNet)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(totals.declared)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(totals.variance)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(totals.settledGross)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmt(totals.unsettled)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Daily detail</CardTitle>
          <CardDescription>Business-date card receipts per branch (restaurant timezone)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : dayRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Nothing to show for this period.</div>
          ) : (
            <ScrollArea className="max-h-[65vh]">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Txns</TableHead>
                    <TableHead className="text-right">Card gross</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Declared</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayRows.map((r) => (
                    <TableRow key={`${r.date}-${r.branchId ?? "unassigned"}`}>
                      <TableCell className="tabular-nums">{r.date}</TableCell>
                      <TableCell>{r.branchName}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.txnCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.posGross)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(r.posVat)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.declared > 0.005 ? fmt(r.declared) : "-"}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          Math.abs(r.variance) > 0.005 ? "text-amber-600" : "text-muted-foreground"
                        }`}
                      >
                        {Math.abs(r.variance) > 0.005 ? fmt(r.variance) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {settleRow && (
        <SettleBranchCardSalesDialog
          open={!!settleRow}
          onOpenChange={(o) => !o && setSettleRow(null)}
          branchId={settleRow.branchId}
          branchName={settleRow.branchName}
          unsettled={settleRow.unsettled}
          periodFrom={from}
          periodTo={to}
        />
      )}
    </div>
  );
}
