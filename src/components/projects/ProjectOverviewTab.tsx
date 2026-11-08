import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import type { useProjects } from "@/hooks/useProjects";
import { ProjectReconciliationBreakdown } from "@/components/projects/ProjectReconciliationBreakdown";
import { ProjectExclusionsCard } from "@/components/projects/ProjectExclusionsCard";

type ProjectsApi = ReturnType<typeof useProjects>;

export function ProjectOverviewTab({
  api,
  onOpenTransaction,
}: {
  api: ProjectsApi;
  onOpenTransaction?: (id: string) => void;
}) {
  const { format: money } = useCurrency();
  const { totals, reconciliation, funding, categoryBreakdown, activeProject } = api;

  const cards = [
    { label: "Total project investment", value: totals.totalInvestment, accent: true },
    { label: "Acquisition cost", value: totals.acquisitionCost },
    { label: "Construction / CAPEX", value: totals.construction },
    { label: "Pre-opening", value: totals.preOpening },
    { label: "Partner capital", value: reconciliation.partnerCapital },
    { label: "Partner loans", value: reconciliation.partnerLoans },
    { label: "Due to partners", value: reconciliation.partnerPayables },
    { label: "Outstanding vendor payables", value: totals.outstandingVendor },
    { label: "Budget", value: totals.budget },
    { label: "Remaining budget", value: totals.remainingBudget },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className={c.accent ? "border-primary/40" : undefined}>
            <CardContent className="pt-6">
              <p className="text-xs font-light text-muted-foreground">{c.label}</p>
              <p className={`mt-1 text-lg font-medium ${c.accent ? "text-primary" : ""}`}>
                {money(c.value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {totals.needsReviewCount > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <div className="text-sm">
              <span className="font-medium">{totals.needsReviewCount} transactions need review</span>{" "}
              <span className="text-muted-foreground">
                ({money(totals.needsReviewAmount)}) — these are not in the ledger yet.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Funding reconciliation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="Total project cost" value={money(reconciliation.costTotal)} />
            <Row label="Total project funding" value={money(reconciliation.fundingTotal)} />
            <Row label="Variance" value={money(reconciliation.variance)} />
            <Row label="Partner capital" value={money(reconciliation.partnerCapital)} />
            <Row label="Partner loans" value={money(reconciliation.partnerLoans)} />
            <Row label="Due to partners" value={money(reconciliation.partnerPayables)} />
            <Row label="Company funding" value={money(reconciliation.companyFunded)} />
            <Row label="Outstanding payables" value={money(totals.outstandingVendor)} />
          </div>
          {reconciliation.balanced ? (
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Reconciled — project cost matches funding sources.
            </div>
          ) : (
            <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Not reconciled — variance {money(Math.abs(reconciliation.variance))}. No automatic adjustment is
                posted.
              </div>
              <p className="text-xs text-muted-foreground">
                {reconciliation.unpostedCount} unposted · {reconciliation.unclassifiedCount} unclassified ·{" "}
                {reconciliation.excludedCount} excluded from reconciliation.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectReconciliationBreakdown api={api} />

      <ProjectExclusionsCard api={api} onOpenTransaction={onOpenTransaction} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Partner funding comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Ownership</TableHead>
                <TableHead className="text-right">Capital</TableHead>
                <TableHead className="text-right">Loan</TableHead>
                <TableHead className="text-right">Payable</TableHead>
                <TableHead className="text-right">Total funded</TableHead>
                <TableHead className="text-right">Unclassified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funding.map((f) => (
                <TableRow key={f.partner_id}>
                  <TableCell className="font-medium">{f.partner_name}</TableCell>
                  <TableCell className="text-right">{Number(f.ownership_pct).toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{money(Number(f.capital_balance))}</TableCell>
                  <TableCell className="text-right">{money(Number(f.loan_balance))}</TableCell>
                  <TableCell className="text-right">{money(Number(f.payable_balance))}</TableCell>
                  <TableCell className="text-right font-medium">{money(Number(f.total_funded))}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {money(Number(f.unclassified_amount))}
                  </TableCell>
                </TableRow>
              ))}
              {funding.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No partners yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            A funding difference between partners does not change ownership percentages.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Project cost breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryBreakdown
                .filter((c) => c.budget || c.actual || c.committed)
                .map((c) => (
                  <TableRow key={c.category}>
                    <TableCell>{c.category}</TableCell>
                    <TableCell className="text-right">{money(c.budget)}</TableCell>
                    <TableCell className="text-right">{money(c.committed)}</TableCell>
                    <TableCell className="text-right">{money(c.actual)}</TableCell>
                    <TableCell className="text-right">{money(c.paid)}</TableCell>
                    <TableCell className="text-right">{money(c.outstanding)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={c.variance < 0 ? "destructive" : "secondary"}>{money(c.variance)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {activeProject && (
        <p className="text-xs text-muted-foreground">
          Project {activeProject.code} · phase {activeProject.phase.replace("_", " ")} · CAPEX and acquisition
          costs are kept out of the operating P&amp;L.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}