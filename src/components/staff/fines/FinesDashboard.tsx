import { useMemo } from "react";
import { format, startOfMonth } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Gavel, Users, Clock } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import type { EmployeeFine } from "@/hooks/useEmployeeFines";

/** Management overview of fines for the current payroll month. */
export function FinesDashboard({ fines }: { fines: EmployeeFine[] }) {
  const { format: fmt } = useCurrency();
  const month = format(startOfMonth(new Date()), "yyyy-MM");

  const stats = useMemo(() => {
    const inMonth = fines.filter((f) => f.payroll_month.startsWith(month));
    const counted = inMonth.filter((f) => ["approved", "applied"].includes(f.status));
    const byType = new Map<string, number>();
    counted.forEach((f) => {
      const key = f.violation_type?.name_en ?? "Other";
      byType.set(key, (byType.get(key) ?? 0) + Number(f.amount));
    });
    const total = counted.reduce((s, f) => s + Number(f.amount), 0);
    return {
      total,
      employees: new Set(counted.map((f) => f.staff_id)).size,
      pending: inMonth.filter((f) => ["submitted", "under_review"].includes(f.status)).length,
      rejected: inMonth.filter((f) => f.status === "rejected").length,
      byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [fines, month]);

  const cards = [
    { label: "Fines this month", value: fmt(stats.total), icon: Gavel },
    { label: "Employees fined", value: String(stats.employees), icon: Users },
    { label: "Pending approvals", value: String(stats.pending), icon: Clock },
    { label: "Rejected fines", value: String(stats.rejected), icon: AlertTriangle },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="border-border/40">
            <CardContent className="pt-6 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-lg font-semibold tracking-tight">{c.value}</p>
              </div>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Fines by violation type</CardTitle>
          <CardDescription>Approved and applied fines for {format(new Date(), "MMMM yyyy")}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stats.byType.length === 0 && (
            <p className="text-sm text-muted-foreground">No approved fines this month.</p>
          )}
          {stats.byType.map(([name, amount]) => (
            <div key={name} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>{name}</span>
                <Badge variant="secondary">{fmt(amount)}</Badge>
              </div>
              <Progress value={stats.total ? (amount / stats.total) * 100 : 0} className="h-1.5" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}