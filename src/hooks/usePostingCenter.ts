import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ReasonCode =
  | "ready"
  | "pending_approval"
  | "period_locked"
  | "missing_account"
  | "cogs_routed"
  | "missing_branch_visibility"
  | "deleted"
  | "already_posted"
  | "validation_failed"
  | "posted"
  | "auto_reconciled"
  | "ambiguous_imbalance"
  | string;

export interface UnpostedExpense {
  id: string;
  expense_date: string;
  amount: number;
  description: string | null;
  branch_id: string | null;
  account_id: string | null;
  approval_status: string | null;
  status: string | null;
  classification: {
    status: string;
    reason_code: ReasonCode;
    reason_detail: string;
    suggested_action?: string;
    target_account_id?: string;
  };
  branch?: { name: string } | null;
  account?: { account_code: string; account_name: string } | null;
}

export function useUnpostedExpenses(branchId: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  return useQuery<UnpostedExpense[]>({
    queryKey: ["unposted-expenses", tenantId, branchId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (db as any)
        .from("expenses")
        .select(
          `id, expense_date, amount, description, branch_id, account_id,
           approval_status, status,
           branch:branches!expenses_branch_id_fkey(name),
           account:chart_of_accounts!expenses_account_id_fkey(account_code, account_name)`
        )
        .eq("tenant_id", tenantId)
        .eq("ledger_posted", false)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(500);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      // Classify in parallel
      const classified = await Promise.all(
        rows.map(async (r) => {
          const { data: cls } = await (db as any).rpc("classify_unposted_expense", {
            p_expense_id: r.id,
          });
          return { ...r, classification: cls } as UnpostedExpense;
        })
      );
      return classified;
    },
    staleTime: 30_000,
  });
}

export interface ImbalancedExpense {
  id: string;
  expense_date: string;
  amount: number;
  description: string | null;
  branch_id: string | null;
  status: string | null;
  dr_total: number;
  cr_total: number;
  diff: number;
  branch?: { name: string } | null;
}

export function useImbalancedExpenses(branchId: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  return useQuery<ImbalancedExpense[]>({
    queryKey: ["imbalanced-expenses", tenantId, branchId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (db as any)
        .from("expenses")
        .select(
          `id, expense_date, amount, description, branch_id, status,
           branch:branches!expenses_branch_id_fkey(name)`
        )
        .eq("tenant_id", tenantId)
        .eq("ledger_posted", true)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(1000);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data: rows, error } = await q;
      if (error) throw error;
      const ids = (rows ?? []).map((r: any) => r.id);
      if (ids.length === 0) return [];
      const { data: txns, error: txErr } = await (db as any)
        .from("account_transactions")
        .select("reference_id, debit, credit, is_voided")
        .eq("reference_type", "expense")
        .in("reference_id", ids);
      if (txErr) throw txErr;
      const totals = new Map<string, { dr: number; cr: number }>();
      for (const t of (txns ?? []) as any[]) {
        if (t.is_voided) continue;
        const cur = totals.get(t.reference_id) ?? { dr: 0, cr: 0 };
        cur.dr += Number(t.debit ?? 0);
        cur.cr += Number(t.credit ?? 0);
        totals.set(t.reference_id, cur);
      }
      return (rows as any[])
        .map((r) => {
          const tot = totals.get(r.id) ?? { dr: 0, cr: 0 };
          const diff = +(tot.dr - tot.cr).toFixed(2);
          return { ...r, dr_total: tot.dr, cr_total: tot.cr, diff };
        })
        .filter((r) => Math.abs(r.diff) > 0.005) as ImbalancedExpense[];
    },
    staleTime: 30_000,
  });
}

export interface PostingAuditRow {
  id: string;
  expense_id: string;
  branch_id: string | null;
  action: string;
  outcome: string;
  reason_code: string;
  reason_detail: string | null;
  batch_id: string | null;
  transaction_ids: string[] | null;
  dr_total: number | null;
  cr_total: number | null;
  trigger_source: string;
  triggered_by: string | null;
  created_at: string;
  triggered_by_profile?: { full_name: string | null } | null;
  branch?: { name: string } | null;
}

export function usePostingAudit(branchId: string | null, limit = 100) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  return useQuery<PostingAuditRow[]>({
    queryKey: ["posting-audit", tenantId, branchId, limit],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (db as any)
        .from("expense_posting_audit")
        .select(
          `id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
           batch_id, transaction_ids, dr_total, cr_total, trigger_source,
           triggered_by, created_at,
           triggered_by_profile:profiles!expense_posting_audit_triggered_by_fkey(full_name),
           branch:branches!expense_posting_audit_branch_id_fkey(name)`
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) {
        // Fallback without foreign-key embeds (FK may not be declared explicitly)
        let q2 = (db as any)
          .from("expense_posting_audit")
          .select(
            `id, expense_id, branch_id, action, outcome, reason_code, reason_detail,
             batch_id, transaction_ids, dr_total, cr_total, trigger_source,
             triggered_by, created_at`
          )
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (branchId) q2 = q2.eq("branch_id", branchId);
        const { data: d2, error: e2 } = await q2;
        if (e2) throw e2;
        return (d2 ?? []) as PostingAuditRow[];
      }
      return (data ?? []) as PostingAuditRow[];
    },
    staleTime: 15_000,
  });
}

export function useBulkPostExpenses() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { branchId: string | null; expenseIds?: string[] }) => {
      const { data, error } = await (db as any).rpc("bulk_post_expenses", {
        p_tenant_id: tenantId,
        p_branch_id: vars.branchId,
        p_expense_ids: vars.expenseIds ?? null,
      });
      if (error) throw error;
      return data as {
        attempted: number;
        posted: number;
        skipped: number;
        failed: number;
        details: any[];
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["unposted-expenses"] });
      qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
      qc.invalidateQueries({ queryKey: ["posting-audit"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success(
        `Bulk post complete: ${res.posted} posted, ${res.skipped} skipped, ${res.failed} failed`
      );
    },
    onError: (e: any) => toast.error("Bulk post failed", { description: e?.message }),
  });
}

export function useAutoReconcileImbalanced() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (branchId: string | null) => {
      const { data, error } = await (db as any).rpc(
        "auto_reconcile_imbalanced_expenses",
        { p_tenant_id: tenantId, p_branch_id: branchId }
      );
      if (error) throw error;
      return data as {
        fixed: number;
        manual_review_count: number;
        manual_review: any[];
      };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
      qc.invalidateQueries({ queryKey: ["posting-audit"] });
      qc.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success(
        `Auto-reconcile: ${res.fixed} fixed, ${res.manual_review_count} need manual review`
      );
    },
    onError: (e: any) => toast.error("Reconcile failed", { description: e?.message }),
  });
}

/** Post a single expense (used for live progress + retry). */
export async function postSingleExpense(expenseId: string) {
  const { data, error } = await (db as any).rpc("post_single_expense", {
    p_expense_id: expenseId,
  });
  if (error) {
    return { outcome: "failed", error: error.message } as any;
  }
  return data as {
    outcome: "posted" | "blocked" | "failed";
    reason_code?: string;
    reason_detail?: string;
    error?: string;
    batch_id?: string;
    dr_total?: number;
    cr_total?: number;
  };
}

/** Auto-reconcile a single imbalanced expense (used for live progress). */
export async function autoReconcileSingleExpense(expenseId: string) {
  const { data, error } = await (db as any).rpc(
    "auto_reconcile_single_expense",
    { p_expense_id: expenseId }
  );
  if (error) {
    return { outcome: "failed", error: error.message } as any;
  }
  return data as {
    outcome:
      | "fixed"
      | "already_balanced"
      | "needs_manual_review"
      | "failed";
    reason_code?: string;
    error?: string;
    diff?: number;
    batch_id?: string;
  };
}

/** Map of expense_id -> latest failure detail, from the audit trail. */
export function useLatestPostingErrors(expenseIds: string[]) {
  return useQuery<Record<string, { reason_code: string; reason_detail: string; created_at: string }>>({
    queryKey: ["posting-last-errors", expenseIds.sort().join(",")],
    enabled: expenseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("expense_posting_audit")
        .select("expense_id, reason_code, reason_detail, outcome, created_at")
        .in("expense_id", expenseIds)
        .in("outcome", ["failed", "blocked", "needs_manual_review"])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const map: Record<string, { reason_code: string; reason_detail: string; created_at: string }> = {};
      for (const r of (data ?? []) as any[]) {
        if (!map[r.expense_id]) {
          map[r.expense_id] = {
            reason_code: r.reason_code,
            reason_detail: r.reason_detail ?? "",
            created_at: r.created_at,
          };
        }
      }
      return map;
    },
    staleTime: 15_000,
  });
}

export interface ExplainImbalanceResult {
  expense: {
    id: string;
    description: string | null;
    amount: number;
    expense_date: string;
    status: string | null;
    branch_name: string | null;
    account_code: string | null;
    account_name: string | null;
  };
  totals: { dr_total: number; cr_total: number; diff: number };
  batches: Array<{
    batch_id: string;
    batch_number: string | null;
    description: string | null;
    entry_date: string;
    status: string | null;
    total_amount: number | null;
  }>;
  legs: Array<{
    id: string;
    transaction_date: string;
    debit: number | null;
    credit: number | null;
    description: string | null;
    batch_id: string | null;
    is_voided: boolean;
    account_code: string | null;
    account_name: string | null;
    account_type: string | null;
  }>;
  suggested_fix: {
    pattern: "missing_credit_leg" | "ambiguous" | string;
    fixable_automatically: boolean;
    fields: string[];
    proposed_action: string;
    credit_account?: { id: string; account_code: string; account_name: string } | null;
    credit_amount?: number;
  };
}

export function useExplainImbalance(expenseId: string | null) {
  return useQuery<ExplainImbalanceResult>({
    queryKey: ["explain-imbalance", expenseId],
    enabled: !!expenseId,
    queryFn: async () => {
      const { data, error } = await (db as any).rpc("explain_imbalance", {
        p_expense_id: expenseId,
      });
      if (error) throw error;
      return data as ExplainImbalanceResult;
    },
    staleTime: 10_000,
  });
}