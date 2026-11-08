import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import {
  parseLedgerValidationError,
  type ParsedLedgerValidationError,
} from "@/lib/ledgerValidationError";
import { LedgerValidationAlert } from "@/components/expenses/LedgerValidationAlert";

type AuditRow = {
  id: string;
  expense_id: string;
  branch_id: string | null;
  outcome: string;
  reason_code: string | null;
  reason_detail: string | null;
  created_at: string;
};

type FailedSettlement = {
  attemptId: string;
  expenseId: string;
  description: string | null;
  amount: number;
  expenseDate: string | null;
  branchName: string | null;
  reasonCode: string | null;
  reasonDetail: string | null;
  failedAt: string;
};

const FAILED_OUTCOMES = ["failed", "blocked", "needs_manual_review"];

export function FailedApSettlementsCard({ branchId }: { branchId?: string }) {
  const queryClient = useQueryClient();
  const { format: fmt } = useCurrency();
  const [ledgerError, setLedgerError] = useState<ParsedLedgerValidationError | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["failed-ap-settlements", branchId ?? "all"],
    queryFn: async (): Promise<FailedSettlement[]> => {
      const { data: audits, error } = await supabase
        .from("expense_posting_audit")
        .select("id, expense_id, branch_id, outcome, reason_code, reason_detail, created_at")
        .eq("action", "reconcile")
        .in("outcome", FAILED_OUTCOMES)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      const rows = (audits || []) as AuditRow[];
      // Keep only the latest failed attempt per expense.
      const latest = new Map<string, AuditRow>();
      rows.forEach((r) => {
        if (!latest.has(r.expense_id)) latest.set(r.expense_id, r);
      });
      const expenseIds = Array.from(latest.keys());
      if (expenseIds.length === 0) return [];

      const [successRes, expenseRes, branchRes] = await Promise.all([
        supabase
          .from("expense_posting_audit")
          .select("expense_id, created_at")
          .eq("action", "reconcile")
          .eq("outcome", "success")
          .in("expense_id", expenseIds),
        supabase
          .from("expenses")
          .select("id, description, amount, expense_date, status, branch_id, deleted_at")
          .in("id", expenseIds),
        supabase.from("branches").select("id, name"),
      ]);

      const lastSuccess = new Map<string, string>();
      (successRes.data || []).forEach((s: { expense_id: string; created_at: string }) => {
        const prev = lastSuccess.get(s.expense_id);
        if (!prev || s.created_at > prev) lastSuccess.set(s.expense_id, s.created_at);
      });

      const branchNames = new Map<string, string>();
      (branchRes.data || []).forEach((b: { id: string; name: string }) => branchNames.set(b.id, b.name));

      const expenses = new Map<string, any>();
      (expenseRes.data || []).forEach((e: any) => expenses.set(e.id, e));

      return expenseIds
        .map((id) => ({ audit: latest.get(id)!, expense: expenses.get(id) }))
        .filter(({ audit, expense }) => {
          if (!expense || expense.deleted_at) return false;
          if (expense.status !== "paid") return false;
          const success = lastSuccess.get(audit.expense_id);
          // Resolved already if a successful reconcile happened after this failure.
          if (success && success > audit.created_at) return false;
          if (branchId && branchId !== "all" && expense.branch_id !== branchId) return false;
          return true;
        })
        .map(({ audit, expense }) => ({
          attemptId: audit.id,
          expenseId: audit.expense_id,
          description: expense.description,
          amount: Number(expense.amount) || 0,
          expenseDate: expense.expense_date,
          branchName: expense.branch_id ? branchNames.get(expense.branch_id) ?? null : null,
          reasonCode: audit.reason_code,
          reasonDetail: audit.reason_detail,
          failedAt: audit.created_at,
        }));
    },
  });

  const retry = useMutation({
    mutationFn: async (expenseId: string) => {
      const { data: result, error } = await supabase.rpc("retry_ap_settlement", {
        p_expense_id: expenseId,
        p_reason: "manual retry from AP audit trail",
      });
      if (error) throw error;
      return result as { outcome?: string; reason_code?: string; amount?: number; batch_id?: string };
    },
    onMutate: (expenseId: string) => {
      setRetryingId(expenseId);
      setLedgerError(null);
    },
    onSettled: () => setRetryingId(null),
    onSuccess: (result) => {
      const outcome = result?.outcome ?? "unknown";
      if (outcome === "success") {
        toast.success("Settlement posted", {
          description: `DR 2000 Accounts Payable / CR funding account${
            result?.amount ? ` — ${result.amount}` : ""
          }`,
        });
      } else if (outcome === "unchanged") {
        toast.info("Already settled", {
          description: "No duplicate ledger lines were created.",
        });
      } else if (outcome === "skipped") {
        toast.warning("Retry skipped", { description: result?.reason_code ?? "Nothing to settle" });
      } else {
        toast.error("Retry did not post", { description: result?.reason_code ?? outcome });
      }
      queryClient.invalidateQueries({ queryKey: ["failed-ap-settlements"] });
      queryClient.invalidateQueries({ queryKey: ["ap-audit-trail"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err: unknown) => {
      const parsed = parseLedgerValidationError(err);
      setLedgerError(parsed);
      toast.error(parsed.title, { description: parsed.detail });
    },
  });

  const items = useMemo(() => data ?? [], [data]);

  if (!isLoading && items.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Failed AP settlements
          </CardTitle>
          <CardDescription>
            No failed settlement postings need a retry. Paid bills are fully reflected in the ledger.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" /> Failed AP settlements
          {items.length > 0 && <Badge variant="outline">{items.length}</Badge>}
        </CardTitle>
        <CardDescription>
          These paid bills never produced a DR 2000 / CR funding entry. Retrying is safe — the posting is locked per
          expense and skipped when the payable is already settled, so no duplicate ledger lines are created.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ledgerError && (
          <LedgerValidationAlert error={ledgerError} onDismiss={() => setLedgerError(null)} />
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.attemptId}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">{item.description || "Expense"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.expenseDate ?? "—"}
                  {item.branchName ? ` · ${item.branchName}` : ""} · last attempt{" "}
                  {format(new Date(item.failedAt), "dd MMM yyyy HH:mm")}
                </p>
                {item.reasonDetail && (
                  <p className="max-w-xl text-xs text-amber-700 dark:text-amber-400">{item.reasonDetail}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{fmt(item.amount)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate(item.expenseId)}
                >
                  {retryingId === item.expenseId ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Retry posting
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
