import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, CalendarClock, AlertTriangle, Scale, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useBnplReporting, AGING_BUCKETS, type BnplGroupRow } from "@/hooks/useBnplReporting";
import { BnplOverduePanel } from "@/components/accounting/BnplOverduePanel";

export default function BnplReport() {
  const { branches, activeBranchId, pinnedBranchId } = useBranch();
  const { format: money } = useCurrency();

  const [branchId, setBranchId] = useState<string>(pinnedBranchId ?? activeBranchId ?? "all");
  const [provider, setProvider] = useState<string>("all");

  const { data, isLoading } = useBnplReporting({ branchId, provider });
  const totals = data?.totals;
  const byProvider = data?.byProvider ?? [];
  const bySupplier = data?.bySupplier ?? [];

  const branchLabel = useMemo(
    () =>
      !branchId || branchId === "all"
        ? "All branches"
        : branches.find((b) => b.id === branchId)?.name ?? branchId,
    [branchId, branches],
  );

  const exportCsv = (rows: BnplGroupRow[], label: string, withSupplier: boolean) => {
    if (!rows.length) {
      toast.error("Nothing to export");
      return;
    }
    const head = [
      "Provider",
      ...(withSupplier ? ["Supplier"] : []),
      "Plans",
      "Active plans",
      "Cash price",
      "Finance charges",
      "Total payable",
      "Paid to date",
      "Outstanding",
      "Remaining installments",
      "Next due",
      "Overdue",
      ...AGING_BUCKETS.map((b) => b.label),
    ];
    const body = rows.map((r) => [
      r.provider,
      ...(withSupplier ? [r.supplier] : []),
      r.plans,
      r.activePlans,
      r.cashPrice,
      r.financeCharge,
      r.totalPayable,
      r.paid,
      r.outstanding,
      r.remainingInstallments,
      r.nextDueDate ?? "",
      r.overdue,
      ...AGING_BUCKETS.map((b) => r.aging[b.key]),
    ]);
    const csv = [head, ...body]
      .map((line) => line.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bnpl-${label}-${branchLabel.replace(/\s+/g, "-").toLowerCase()}-${data?.asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const kpis = [
    { label: "Total outstanding", value: totals ? money(totals.outstanding) : "-", hint: `${totals?.activePlans ?? 0} active plans` },
    { label: "Remaining installments", value: totals ? String(totals.remainingInstallments) : "-", hint: "Unpaid scheduled payments" },
    { label: "Finance charges", value: totals ? money(totals.financeCharge) : "-", hint: "Total cost of financing" },
    { label: "Overdue", value: totals ? money(totals.overdue) : "-", hint: "Past due and unpaid" },
  ];

  const renderGroupTable = (rows: BnplGroupRow[], withSupplier: boolean) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            {withSupplier && <TableHead>Supplier</TableHead>}
            <TableHead className="text-right">Plans</TableHead>
            <TableHead className="text-right">Finance charges</TableHead>
            <TableHead className="text-right">Total payable</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead>Next due</TableHead>
            <TableHead className="text-right">Overdue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={withSupplier ? 10 : 9} className="text-center text-muted-foreground py-8">
                No BNPL plans for this selection.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-medium">{r.provider}</TableCell>
              {withSupplier && <TableCell>{r.supplier}</TableCell>}
              <TableCell className="text-right">
                {r.activePlans}/{r.plans}
              </TableCell>
              <TableCell className="text-right">{money(r.financeCharge)}</TableCell>
              <TableCell className="text-right">{money(r.totalPayable)}</TableCell>
              <TableCell className="text-right">{money(r.paid)}</TableCell>
              <TableCell className="text-right font-medium">{money(r.outstanding)}</TableCell>
              <TableCell className="text-right">{r.remainingInstallments}</TableCell>
              <TableCell>{r.nextDueDate ?? "-"}</TableCell>
              <TableCell className="text-right">
                {r.overdue > 0 ? (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                    {money(r.overdue)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            BNPL Reporting
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Outstanding installment liabilities, aging and finance charges — {branchLabel}
            {data?.asOf ? ` · as of ${data.asOf}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-[180px]">
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
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {(data?.providers ?? []).map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" asChild>
            <Link to="/accounting/installment-reconciliation">
              <Scale className="h-4 w-4 mr-2" />
              Reconciliation
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-3">
              <CardDescription>{k.label}</CardDescription>
              <CardTitle className="text-base font-medium">
                {isLoading ? <Skeleton className="h-7 w-24" /> : k.value}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <BnplOverduePanel branchId={branchId} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Aging of outstanding installments
          </CardTitle>
          <CardDescription>Unpaid scheduled installments bucketed by days past due.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
              {AGING_BUCKETS.map((b) => (
                <div key={b.key} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{b.label}</p>
                  <p className="text-lg font-light">{money(totals?.aging[b.key] ?? 0)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="provider">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <TabsList>
            <TabsTrigger value="provider">By provider</TabsTrigger>
            <TabsTrigger value="supplier">By supplier</TabsTrigger>
            <TabsTrigger value="plans">Plans</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="provider" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base font-medium">Provider summary</CardTitle>
              <Button variant="outline" size="sm" onClick={() => exportCsv(byProvider, "provider", false)}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-40 w-full" /> : renderGroupTable(byProvider, false)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="supplier" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base font-medium">Supplier summary</CardTitle>
              <Button variant="outline" size="sm" onClick={() => exportCsv(bySupplier, "supplier", true)}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-40 w-full" /> : renderGroupTable(bySupplier, true)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Plan detail</CardTitle>
              <CardDescription>Every plan with its remaining exposure.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Purchased</TableHead>
                        <TableHead className="text-right">Finance charge</TableHead>
                        <TableHead className="text-right">Total payable</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead>Next due</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.planRows ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                            No BNPL plans yet.{" "}
                            <Link to="/accounting/installments" className="text-primary inline-flex items-center gap-1">
                              Create one <ExternalLink className="h-3 w-3" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      )}
                      {(data?.planRows ?? []).map((p) => (
                        <TableRow key={p.planId}>
                          <TableCell className="font-medium">{p.description}</TableCell>
                          <TableCell>{p.provider}</TableCell>
                          <TableCell>{p.supplier}</TableCell>
                          <TableCell>{p.purchaseDate}</TableCell>
                          <TableCell className="text-right">{money(p.financeCharge)}</TableCell>
                          <TableCell className="text-right">{money(p.totalPayable)}</TableCell>
                          <TableCell className="text-right font-medium">{money(p.outstanding)}</TableCell>
                          <TableCell className="text-right">
                            {p.remainingInstallments}/{p.installmentCount}
                          </TableCell>
                          <TableCell>{p.nextDueDate ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
