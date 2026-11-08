import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ClipboardCheck, Landmark, ShieldCheck, TrendingUp } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import type { BranchComplianceScore, EmployeeSopSummary } from "@/hooks/useComplianceDashboard";

interface Props {
  scores: BranchComplianceScore[];
  employees: EmployeeSopSummary[];
  isLoading: boolean;
}

function scoreTone(score: number) {
  if (score >= 90) return "text-emerald-600";
  if (score >= 75) return "text-amber-600";
  return "text-destructive";
}

export function ComplianceOverviewTab({ scores, employees, isLoading }: Props) {
  const { format: money } = useCurrency();

  const totals = scores.reduce(
    (acc, s) => ({
      open: acc.open + s.open_violations,
      overdue: acc.overdue + s.overdue_violations,
      fines: acc.fines + s.municipality_fines_total,
      repeats: acc.repeats + s.repeat_violations,
      score: acc.score + s.score,
    }),
    { open: 0, overdue: 0, fines: 0, repeats: 0, score: 0 },
  );
  const avgScore = scores.length ? Math.round(totals.score / scores.length) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Compliance score"
          value={`${avgScore}%`}
          hint="Weighted across cleanliness, food safety, SOP and checklists"
          tone={scoreTone(avgScore)}
        />
        <Kpi
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Open violations"
          value={String(totals.open)}
          hint={`${totals.overdue} past their corrective action due date`}
          tone={totals.overdue ? "text-destructive" : undefined}
        />
        <Kpi
          icon={<Landmark className="h-4 w-4" />}
          label="Municipality fines"
          value={money(totals.fines)}
          hint="Company liability — never deducted from staff wages"
        />
        <Kpi
          icon={<TrendingUp className="h-4 w-4" />}
          label="Repeat violations"
          value={String(totals.repeats)}
          hint="Same violation type recurring inside the lookback window"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Branch compliance scoreboard</CardTitle>
          <CardDescription>
            Each branch is scored on the four configured weights. Lower scores flag where inspections
            and retraining are needed first.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Cleanliness</TableHead>
                <TableHead className="text-right">Food safety</TableHead>
                <TableHead className="text-right">Employee SOP</TableHead>
                <TableHead className="text-right">Checklists</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Fines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : scores.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">No compliance activity in this period.</TableCell></TableRow>
              ) : (
                scores.map((s) => (
                  <TableRow key={s.branch_id}>
                    <TableCell className="font-medium">{s.branch_name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={s.score} className="h-1.5 w-16" />
                        <span className={scoreTone(s.score)}>{Math.round(s.score)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{Math.round(s.cleanliness)}%</TableCell>
                    <TableCell className="text-right">{Math.round(s.food_safety)}%</TableCell>
                    <TableCell className="text-right">{Math.round(s.employee_sop)}%</TableCell>
                    <TableCell className="text-right">{Math.round(s.checklists)}%</TableCell>
                    <TableCell className="text-right">{s.open_violations}</TableCell>
                    <TableCell className="text-right">
                      {s.overdue_violations ? (
                        <Badge variant="destructive">{s.overdue_violations}</Badge>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="text-right">{money(s.municipality_fines_total)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Employee accountability</CardTitle>
          <CardDescription>
            Violations attributed to staff for coaching purposes only. Wage deductions stay in Team →
            Fines &amp; Deductions with their own approval chain.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">This month</TableHead>
                <TableHead className="text-right">Previous month</TableHead>
                <TableHead className="text-right">Repeated types</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No employee-attributed violations in this period.</TableCell></TableRow>
              ) : (
                employees.map((e) => (
                  <TableRow key={e.staff_id}>
                    <TableCell className="font-medium">{e.staff_name}</TableCell>
                    <TableCell className="text-right">{e.total}</TableCell>
                    <TableCell className="text-right">{e.open}</TableCell>
                    <TableCell className="text-right">{e.this_month}</TableCell>
                    <TableCell className="text-right">{e.previous_month}</TableCell>
                    <TableCell className="text-right">
                      {e.repeated ? <Badge variant="secondary">{e.repeated}</Badge> : 0}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-light ${tone ?? ""}`}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export const ComplianceChecklistIcon = ClipboardCheck;