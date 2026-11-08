import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileWarning, Scale, ShieldAlert } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrency } from "@/hooks/useCurrency";

type Issue = "failed_attempt" | "missing_gl" | "unbalanced_gl";

type Flagged = {
  expenseId: string;
  description: string | null;
  amount: number;
  expenseDate: string | null;
  status: string | null;
  branchId: string | null;
  issues: Issue[];
  reasonCode: string | null;
  reasonDetail: string | null;
  drTotal: number;
  crTotal: number;
};

const FAILED_OUTCOMES = ["failed", "blocked", "needs_manual_review"];

const ISSUE_META: Record<Issue, { label: string; icon: typeof AlertTriangle; tone: string }> = {
  failed_attempt: { label: "Settlement failed", icon: ShieldAlert, tone: "text-destructive" },
  missing_gl: { label: "No GL entry", icon: FileWarning, tone: "text-amber-600" },
  unbalanced_gl: { label: "Unbalanced GL", icon: Scale, tone: "text-amber-600" },
};

type Props = {
  from: Date;
  to: Date;
  branchId?: string;
};

export function BillPostingReconciliationWidget({ from, to, branchId }: Props) {
  const { format: fmt } = useCurrency();
  const [expanded, setExpanded] = useState(false);

  const fromStr = format(from, "yyyy-MM-dd");
  const toStr = format(to, "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    queryKey: ["bill-posting-reconciliation", fromStr, toStr, branchId ?? "all"],
    queryFn: async (): Promise<Flagged[]> => {
      let expenseQuery = supabase
        .from("expenses")
        .select("id, description, amount, expense_date, status, branch_id, deleted_at")
        .gte("expense_date", fromStr)
        .lte("expense_date", toStr)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(1000);
      if (branchId && branchId !== "all") expenseQuery = expenseQuery.eq("branch_id", branchId);

      const { data: expenses, error } = await expenseQuery;
      if (error) throw error;
      const rows = (expenses || []) as any[];
      if (rows.length === 0) return [];
      const ids = rows.map((e) => e.id);

      const chunk = <T,>(arr: T[], size: number) =>
        Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

      const legTotals = new Map<string, { dr: number; cr: number }>();
      const failures = new Map<string, { at: string; reason_code: string | null; reason_detail: string | null }>();
      const successes = new Map<string, string>();

      for (const part of chunk(ids, 200)) {
        const [legRes, auditRes] = await Promise.all([
          supabase
            .from("account_transactions")
            .select("reference_id, debit, credit, is_voided")
            .eq("reference_type", "expense")
            .in("reference_id", part),
          supabase
            .from("expense_posting_audit")
            .select("expense_id, outcome, reason_code, reason_detail, created_at")
            .in("expense_id", part),
        ]);
        if (legRes.error) throw legRes.error;
        if (auditRes.error) throw auditRes.error;

        (legRes.data || []).forEach((l: any) => {
          if (l.is_voided) return;
          const cur = legTotals.get(l.reference_id) ?? { dr: 0, cr: 0 };
          cur.dr += Number(l.debit) || 0;
          cur.cr += Number(l.credit) || 0;
          legTotals.set(l.reference_id, cur);
        });

        (auditRes.data || []).forEach((a: any) => {
          if (a.outcome === "success") {
            const prev = successes.get(a.expense_id);
            if (!prev || a.created_at > prev) successes.set(a.expense_id, a.created_at);
          } else if (FAILED_OUTCOMES.includes(a.outcome)) {
            const prev = failures.get(a.expense_id);
            if (!prev || a.created_at > prev.at) {
              failures.set(a.expense_id, {
                at: a.created_at,
                reason_code: a.reason_code,
                reason_detail: a.reason_detail,
              });
            }
          }
        });
      }

      const flagged: Flagged[] = [];
      rows.forEach((e) => {
        const totals = legTotals.get(e.id) ?? { dr: 0, cr: 0 };
        const issues: Issue[] = [];

        const failure = failures.get(e.id);
        const success = successes.get(e.id);
        if (failure && (!success || success < failure.at)) issues.push("failed_attempt");

        const hasLegs = totals.dr > 0 || totals.cr > 0;
        if (!hasLegs && e.status !== "rejected" && e.status !== "pending") issues.push("missing_gl");
        if (hasLegs && Math.abs(totals.dr - totals.cr) > 0.005) issues.push("unbalanced_gl");

        if (issues.length === 0) return;
        flagged.push({
          expenseId: e.id,
          description: e.description,
          amount: Number(e.amount) || 0,
          expenseDate: e.expense_date,
          status: e.status,
          branchId: e.branch_id,
          issues,
          reasonCode: failure?.reason_code ?? null,
          reasonDetail: failure?.reason_detail ?? null,
          drTotal: totals.dr,
          crTotal: totals.cr,
        });
      });

      return flagged;
    },
  });

  const counts = useMemo(() => {
    const list = data ?? [];
    return {
      total: list.length,
      failed: list.filter((f) => f.issues.includes("failed_attempt")).length,
      missing: list.filter((f) => f.issues.includes("missing_gl")).length,
      unbalanced: list.filter((f) => f.issues.includes("unbalanced_gl")).length,
      value: list.reduce((s, f) => s + f.amount, 0),
    };
  }, [data]);

  const visible = expanded ? data ?? [] : (data ?? []).slice(0, 8);

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Scale className="h-4 w-4" /> Posting reconciliation
            </CardTitle>
            <CardDescription>
              Bills between {fromStr} and {toStr} with settlement failures, missing GL entries, or unbalanced ledger
              lines.
            </CardDescription>
          </div>
          {!isLoading && counts.total > 0 && (
            <Badge variant="destructive" className="shrink-0">
              {counts.total} flagged · {fmt(counts.value)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : counts.total === 0 ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Every bill in this period is posted and balanced.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["failed_attempt", counts.failed],
                  ["missing_gl", counts.missing],
                  ["unbalanced_gl", counts.unbalanced],
                ] as [Issue, number][]
              ).map(([issue, n]) => {
                const meta = ISSUE_META[issue];
                const Icon = meta.icon;
                return (
                  <div key={issue} className="rounded-lg border p-2">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon className={`h-3.5 w-3.5 ${meta.tone}`} /> {meta.label}
                    </p>
                    <p className="text-lg font-semibold">{n}</p>
                  </div>
                );
              })}
            </div>

            <ScrollArea className="max-h-[360px] pr-3">
              <ul className="space-y-2">
                {visible.map((f) => (
                  <li key={f.expenseId} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{f.description || "Untitled bill"}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.expenseDate} · {f.status ?? "—"} · DR {fmt(f.drTotal)} / CR {fmt(f.crTotal)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{fmt(f.amount)}</span>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/reports/ap-audit-trail?expenseId=${f.expenseId}`}>Investigate</Link>
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.issues.map((i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {ISSUE_META[i].label}
                        </Badge>
                      ))}
                      {f.reasonCode && (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {f.reasonCode}
                        </Badge>
                      )}
                    </div>
                    {f.reasonDetail && <p className="mt-1 text-xs text-muted-foreground">{f.reasonDetail}</p>}
                  </li>
                ))}
              </ul>
            </ScrollArea>

            {(data?.length ?? 0) > 8 && (
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Show less" : `Show all ${data?.length} flagged bills`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}