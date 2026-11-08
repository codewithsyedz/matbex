import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import { buildReconciliationBreakdown, type BreakdownLeg } from "@/lib/projectReconciliationBreakdown";
import {
  downloadReconciliationCsv,
  printReconciliationPdf,
  type ReconciliationExportInput,
} from "@/lib/projectReconciliationExport";
import { toast } from "sonner";
import type { useProjects } from "@/hooks/useProjects";

type ProjectsApi = ReturnType<typeof useProjects>;

export function ProjectReconciliationBreakdown({ api }: { api: ProjectsApi }) {
  const { format: money } = useCurrency();
  const {
    transactions,
    acquisition,
    acquisitionFunders,
    funding,
    partners,
    reconciliation,
    journalAdjustments,
    totals,
    activeProject,
  } = api;

  const breakdown = useMemo(
    () =>
      buildReconciliationBreakdown({
        transactions,
        acquisition,
        acquisitionFunders,
        adjustments: journalAdjustments,
        funding: funding.map((f) => ({
          partner_id: f.partner_id,
          partner_name: f.partner_name,
          capital_balance: f.capital_balance,
          loan_balance: f.loan_balance,
          payable_balance: f.payable_balance,
        })),
        partnerNames: Object.fromEntries(partners.map((p) => [p.id, p.partner_name])),
      }),
    [transactions, acquisition, acquisitionFunders, funding, partners, journalAdjustments],
  );

  const exportInput: ReconciliationExportInput = {
    projectName: activeProject?.name ?? "Project",
    projectCode: activeProject?.code ?? null,
    breakdown,
    summary: {
      costTotal: breakdown.costTotal,
      fundingTotal: breakdown.fundingTotal,
      variance: breakdown.costTotal - breakdown.fundingTotal,
      balanced: reconciliation.balanced,
      partnerCapital: Number(reconciliation.partnerCapital ?? 0),
      partnerLoans: Number(reconciliation.partnerLoans ?? 0),
      partnerPayables: Number(reconciliation.partnerPayables ?? 0),
      companyFunded: Number(reconciliation.companyFunded ?? 0),
      outstandingVendor: Number(totals?.outstandingVendor ?? 0),
    },
    money,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium">Reconciliation breakdown</CardTitle>
            <CardDescription className="font-light">
              Every posted leg that contributes to project cost and project funding, line by line.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                downloadReconciliationCsv(exportInput);
                toast.success("Reconciliation CSV downloaded");
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!printReconciliationPdf(exportInput)) {
                  toast.error("Allow pop-ups to export the reconciliation as PDF");
                }
              }}
            >
              <FileText className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <LegTable
          title="Project cost — posted"
          legs={breakdown.costLegs}
          total={breakdown.costTotal}
          money={money}
          emptyText="No posted project cost yet."
        />
        <LegTable
          title="Project funding — posted"
          legs={breakdown.fundingLegs}
          total={breakdown.fundingTotal}
          money={money}
          emptyText="No posted funding yet."
        />

        <div
          className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
            reconciliation.balanced
              ? "border-primary/30 bg-primary/5"
              : "border-destructive/40 bg-destructive/5"
          }`}
        >
          {reconciliation.balanced ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          )}
          <span>
            Cost {money(breakdown.costTotal)} − funding {money(breakdown.fundingTotal)} ={" "}
            <span className="font-medium">{money(breakdown.costTotal - breakdown.fundingTotal)}</span>
          </span>
        </div>

        {breakdown.excludedLegs.length > 0 && (
          <LegTable
            title="Excluded from reconciliation"
            legs={breakdown.excludedLegs}
            money={money}
            emptyText=""
          />
        )}
        {breakdown.unpostedLegs.length > 0 && (
          <LegTable
            title="Not posted yet (no ledger impact)"
            legs={breakdown.unpostedLegs}
            money={money}
            emptyText=""
          />
        )}
      </CardContent>
    </Card>
  );
}

function LegTable({
  title,
  legs,
  total,
  money,
  emptyText,
}: {
  title: string;
  legs: BreakdownLeg[];
  total?: number;
  money: (v: number) => string;
  emptyText: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {legs.map((l) => (
            <TableRow key={l.key} className={l.informational ? "text-muted-foreground" : undefined}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{l.label}</span>
                  {l.informational && (
                    <Badge variant="outline" className="font-light">
                      not counted
                    </Badge>
                  )}
                </div>
                {l.detail && <p className="text-xs font-light text-muted-foreground">{l.detail}</p>}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">{l.date ?? "—"}</TableCell>
              <TableCell className="text-right">{money(l.amount)}</TableCell>
            </TableRow>
          ))}
          {legs.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                {emptyText}
              </TableCell>
            </TableRow>
          )}
          {typeof total === "number" && (
            <TableRow>
              <TableCell colSpan={2} className="font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-medium">{money(total)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
