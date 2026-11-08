import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import type { ProjectPhase, ProjectTransaction, Treatment, useProjects } from "@/hooks/useProjects";
import { ProjectInvestmentSummary } from "./ProjectInvestmentSummary";

type ProjectsApi = ReturnType<typeof useProjects>;

/** Ordered delivery phases with the transaction treatments that roll into each. */
const PHASES: {
  key: ProjectPhase;
  label: string;
  description: string;
  treatments: Treatment[];
}[] = [
  {
    key: "acquisition",
    label: "Acquisition",
    description: "Buying the existing restaurant and allocating the purchase price",
    treatments: ["acquisition"],
  },
  {
    key: "construction",
    label: "Construction & fit-out",
    description: "Renovation works capitalised into the asset base",
    treatments: ["capex"],
  },
  {
    key: "equipment",
    label: "Equipment",
    description: "Capitalised equipment registered in the fixed asset register",
    treatments: [],
  },
  {
    key: "pre_opening",
    label: "Pre-opening",
    description: "Licences, deposits, opening stock and trial-run costs",
    treatments: ["pre_opening", "license", "deposit", "inventory"],
  },
  {
    key: "opening",
    label: "Opening & handover",
    description: "Running costs incurred before the branch trades normally",
    treatments: ["opex", "other"],
  },
];

const PHASE_ORDER: ProjectPhase[] = [
  "acquisition",
  "construction",
  "renovation",
  "equipment",
  "pre_opening",
  "opening",
  "operational",
];

export function ProjectDashboardTab({ api }: { api: ProjectsApi }) {
  const { format: money } = useCurrency();
  const { totals, categoryBreakdown, transactions, acquisition, activeProject, commitments } = api;

  const posted = useMemo(
    () => transactions.filter((t) => t.status === "posted"),
    [transactions],
  );

  const paidTotal = useMemo(
    () => posted.filter((t) => t.is_paid).reduce((s, t) => s + Number(t.amount), 0),
    [posted],
  );
  const unpaidTotal = Math.max(0, totals.projectSpend - paidTotal);
  const openCommitment = Math.max(0, totals.committed - totals.projectSpend);
  // The budget on the Budget tab covers post-acquisition setup/construction
  // only — the acquisition price is never merged into it, so budget
  // consumption is measured against project spend excluding the acquisition.
  const budgetSpend = totals.projectSpend;
  const budgetUsedPct = totals.budget > 0 ? (budgetSpend / totals.budget) * 100 : 0;
  const hasBudget = totals.budget > 0;
  const paidPct = totals.projectSpend > 0 ? (paidTotal / totals.projectSpend) * 100 : 0;

  const chartData = useMemo(
    () =>
      categoryBreakdown
        .filter((c) => c.budget || c.actual || c.committed)
        .map((c) => ({
          category: c.category,
          Budget: Number(c.budget.toFixed(2)),
          Committed: Number(c.committed.toFixed(2)),
          Actual: Number(c.actual.toFixed(2)),
          Paid: Number(c.paid.toFixed(2)),
          over: c.actual > c.budget && c.budget > 0,
        })),
    [categoryBreakdown],
  );

  const currentPhaseIdx = activeProject ? PHASE_ORDER.indexOf(activeProject.phase) : -1;

  const phaseRows = useMemo(() => {
    const inPhase = (t: ProjectTransaction, treatments: Treatment[], isEquipment: boolean) => {
      if (isEquipment) return !!t.capitalize;
      if (t.capitalize) return false;
      return !!t.treatment && treatments.includes(t.treatment);
    };

    return PHASES.map((phase) => {
      const isEquipment = phase.key === "equipment";
      const rows = posted.filter((t) => inPhase(t, phase.treatments, isEquipment));
      let actual = rows.reduce((s, t) => s + Number(t.amount), 0);
      let paid = rows.filter((t) => t.is_paid).reduce((s, t) => s + Number(t.amount), 0);
      let dates = rows.map((t) => t.txn_date).filter(Boolean).sort();

      if (phase.key === "acquisition" && acquisition) {
        actual += Number(acquisition.amount ?? 0);
        paid += Number(acquisition.amount ?? 0);
        if (acquisition.acquisition_date) dates = [...dates, acquisition.acquisition_date].sort();
      }

      const committed = commitments
        .filter((c) => c.status !== "cancelled")
        .filter((c) => rows.some((t) => t.commitment_id === c.id))
        .reduce((s, c) => s + Number(c.contract_amount), 0);

      const phaseIdx = PHASE_ORDER.indexOf(phase.key);
      const status: "done" | "active" | "upcoming" =
        currentPhaseIdx < 0
          ? actual > 0
            ? "active"
            : "upcoming"
          : phaseIdx < currentPhaseIdx
            ? "done"
            : phaseIdx === currentPhaseIdx
              ? "active"
              : actual > 0
                ? "active"
                : "upcoming";

      return {
        ...phase,
        actual,
        paid,
        committed,
        outstanding: actual - paid,
        count: rows.length,
        first: dates[0] ?? null,
        last: dates[dates.length - 1] ?? null,
        status,
      };
    });
  }, [posted, acquisition, commitments, currentPhaseIdx]);

  const phaseTotal = phaseRows.reduce((s, p) => s + p.actual, 0);

  const kpis: Array<{
    label: string;
    value: number;
    accent?: boolean;
    signed?: boolean;
    hint?: string;
    empty?: boolean;
  }> = [
    { label: "Budget", value: totals.budget, hint: hasBudget ? undefined : "No budget lines yet" },
    { label: "Committed (contracts)", value: totals.committed },
    { label: "Actual to date", value: totals.totalInvestment, accent: true, hint: "Incl. acquisition" },
    { label: "Paid", value: paidTotal },
    { label: "Unpaid / accrued", value: unpaidTotal },
    {
      label: "Remaining budget",
      value: totals.budget - budgetSpend,
      signed: true,
      hint: "Excl. acquisition",
      empty: !hasBudget,
    },
  ];

  return (
    <div className="space-y-6">
      <ProjectInvestmentSummary api={api} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className={k.accent ? "border-primary/40" : undefined}>
            <CardContent className="pt-6">
              <p className="text-xs font-light text-muted-foreground">{k.label}</p>
              <p
                className={`mt-1 text-lg font-medium ${
                  k.empty
                    ? "text-muted-foreground"
                    : k.accent
                      ? "text-primary"
                      : k.signed && k.value < 0
                        ? "text-destructive"
                        : ""
                }`}
              >
                {k.empty ? "—" : money(k.value)}
              </p>
              {k.hint && <p className="mt-1 text-[11px] font-light text-muted-foreground">{k.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Budget consumption</CardTitle>
            <CardDescription>
              {hasBudget
                ? `${budgetUsedPct.toFixed(1)}% of the approved setup budget is spent to date. The acquisition price is excluded — it is not part of the setup budget.`
                : "No budget lines captured yet — add them on the Budget tab. Until then, remaining budget cannot be calculated (the acquisition price is not a budget overrun)."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={Math.min(100, budgetUsedPct)} />
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Budget" value={money(totals.budget)} />
              <Row label="Actual (excl. acquisition)" value={money(budgetSpend)} />
              <Row label="Business acquisition" value={money(totals.acquisitionCost)} />
              <Row label="Open commitments" value={money(openCommitment)} />
              <Row
                label="Forecast at completion"
                value={money(budgetSpend + openCommitment)}
              />
            </div>
            {hasBudget && budgetSpend + openCommitment > totals.budget && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Forecast exceeds budget by{" "}
                {money(budgetSpend + openCommitment - totals.budget)}.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Committed vs paid</CardTitle>
            <CardDescription>
              Contracts signed, costs recognised in the ledger and cash actually settled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={Math.min(100, paidPct)} />
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Contracted" value={money(totals.committed)} />
              <Row label="Recognised (actual)" value={money(totals.projectSpend)} />
              <Row label="Cash paid" value={money(paidTotal)} />
              <Row label="Still to pay" value={money(unpaidTotal)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {paidPct.toFixed(1)}% of recognised project cost has been settled. Unpaid amounts sit in
              payables or partner accounts.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Budget vs actual by category</CardTitle>
          <CardDescription>Bars in red exceed the approved budget line.</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No budget lines or posted costs yet.
            </p>
          ) : (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-15} height={50} />
                  <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => money(Number(v))} />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Budget" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Committed" fill="hsl(var(--chart-2, var(--primary)))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Actual" radius={[4, 4, 0, 0]}>
                    {chartData.map((d) => (
                      <Cell
                        key={d.category}
                        fill={d.over ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Phase-by-phase progress</CardTitle>
          <CardDescription>
            Spend grouped by delivery phase. The active phase follows the project status.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phaseRows.map((p, idx) => (
            <div key={p.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <PhaseIcon status={p.status} />
                {idx < phaseRows.length - 1 && <div className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <div className="flex-1 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  <Badge variant={p.status === "active" ? "default" : "secondary"}>
                    {p.status === "done" ? "Complete" : p.status === "active" ? "In progress" : "Upcoming"}
                  </Badge>
                  {p.first && (
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(p.first), "d MMM yyyy")}
                      {p.last && p.last !== p.first ? ` – ${format(parseISO(p.last), "d MMM yyyy")}` : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{p.description}</p>
                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
                  <Row label="Actual" value={money(p.actual)} />
                  <Row label="Paid" value={money(p.paid)} />
                  <Row label="Outstanding" value={money(p.outstanding)} />
                  <Row label="Entries" value={String(p.count)} />
                </div>
                <Progress
                  className="mt-2 h-1.5"
                  value={phaseTotal > 0 ? (p.actual / phaseTotal) * 100 : 0}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Budget vs actual detail</CardTitle>
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
                <TableHead className="text-right">Unpaid</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Used</TableHead>
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
                      <Badge variant={c.variance < 0 ? "destructive" : "secondary"}>
                        {money(c.variance)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {c.budget > 0 ? `${((c.actual / c.budget) * 100).toFixed(0)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              {categoryBreakdown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Nothing to compare yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totals.needsReviewCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {totals.needsReviewCount} transaction(s) worth {money(totals.needsReviewAmount)} are still in the
          review queue and are excluded from every figure above.
        </p>
      )}
    </div>
  );
}

function PhaseIcon({ status }: { status: "done" | "active" | "upcoming" }) {
  if (status === "done") return <CheckCircle2 className="h-5 w-5 text-primary" />;
  if (status === "active") return <Loader2 className="h-5 w-5 text-primary" />;
  return <CircleDashed className="h-5 w-5 text-muted-foreground" />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
