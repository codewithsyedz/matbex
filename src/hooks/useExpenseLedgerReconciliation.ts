import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ExpenseLedgerIssue =
  | "ok"
  | "not_posted"
  | "posted_no_legs"
  | "unbalanced"
  | "amount_mismatch";

export interface ExpenseLedgerReconRow {
  id: string;
  expenseDate: string;
  description: string | null;
  branchId: string | null;
  branchName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: string | null;
  approvalStatus: string | null;
  ledgerPosted: boolean;
  billed: number;
  drTotal: number;
  primaryDrTotal: number;
  crTotal: number;
  diff: number;
  legCount: number;
  issue: ExpenseLedgerIssue;
}

export interface ExpenseLedgerReconTotals {
  scanned: number;
  flagged: number;
  notPosted: number;
  notPostedAmount: number;
  postedNoLegs: number;
  postedNoLegsAmount: number;
  unbalanced: number;
  unbalancedAmount: number;
  amountMismatch: number;
  amountMismatchAmount: number;
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ExpenseLedgerReconFilters {
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * Automated reconciliation between the expense sub-ledger and the transactional
 * ledger: every non-deleted expense is checked for a balanced set of ledger legs.
 */
export function useExpenseLedgerReconciliation(filters: ExpenseLedgerReconFilters) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const branchKey = filters.branchId && filters.branchId !== "all" ? filters.branchId : null;
  const from = filters.from || null;
  const to = filters.to || null;

  const query = useQuery({
    queryKey: ["expense-ledger-reconciliation", tenantId, branchKey, from, to],
    enabled: !!tenantId,
    staleTime: 1000 * 60,
    queryFn: async (): Promise<ExpenseLedgerReconRow[]> => {
      let expQ: any = (supabase as any)
        .from("expenses")
        .select(
          "id, expense_date, description, amount, vat_amount, branch_id, supplier_id, status, approval_status, ledger_posted",
        )
        .eq("tenant_id", tenantId!)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .limit(2000);
      if (branchKey) expQ = expQ.eq("branch_id", branchKey);
      if (from) expQ = expQ.gte("expense_date", from);
      if (to) expQ = expQ.lte("expense_date", to);

      const [expRes, branchRes, supplierRes]: any[] = await Promise.all([
        expQ,
        (supabase as any).from("branches").select("id, name").eq("tenant_id", tenantId!),
        (supabase as any).from("suppliers").select("id, name").eq("restaurant_id", tenantId!),
      ]);
      const expenses = expRes.data as any[] | null;
      const expErr = expRes.error;
      if (expErr) throw expErr;

      const branchNames = new Map<string, string>(
        (branchRes.data ?? []).map((b: any) => [b.id as string, b.name as string]),
      );
      const supplierNames = new Map<string, string>(
        (supplierRes.data ?? []).map((s: any) => [s.id as string, s.name as string]),
      );

      const ids = (expenses ?? []).map((e: any) => e.id as string);
      const totals = new Map<string, { dr: number; cr: number; legs: number; primaryDr: number }>();
      // Settlement / payment batches (EXPPAY-*) re-use the same reference_id as the
      // original posting (EXP-*). Only the original posting should be compared to the
      // bill total, otherwise every paid bill looks like a double-charge.
      const rawLegs: any[] = [];
      for (const part of chunk(ids, 150)) {
        if (part.length === 0) continue;
        const { data, error } = await (supabase as any)
          .from("account_transactions")
          .select("reference_id, debit, credit, is_voided, batch_id")
          .eq("tenant_id", tenantId!)
          .eq("reference_type", "expense")
          .in("reference_id", part);
        if (error) throw error;
        for (const leg of (data ?? []) as any[]) if (!leg.is_voided) rawLegs.push(leg);
      }

      // Resolve which batches are settlement/payment batches so they can be excluded
      // from the bill-vs-ledger amount comparison.
      const batchIds = Array.from(
        new Set(rawLegs.map((l) => l.batch_id).filter(Boolean) as string[]),
      );
      const settlementBatches = new Set<string>();
      for (const part of chunk(batchIds, 150)) {
        if (part.length === 0) continue;
        const { data } = await (supabase as any)
          .from("journal_entry_batches")
          .select("id, entry_type, reference_number")
          .in("id", part);
        for (const b of (data ?? []) as any[]) {
          const ref = String(b.reference_number ?? "");
          if (b.entry_type === "payment" || ref.startsWith("EXPPAY-") || ref.startsWith("APREMAP")) {
            settlementBatches.add(b.id as string);
          }
        }
      }

      for (const leg of rawLegs) {
        const cur =
          totals.get(leg.reference_id) ?? { dr: 0, cr: 0, legs: 0, primaryDr: 0 };
        const dr = Number(leg.debit ?? 0);
        cur.dr += dr;
        cur.cr += Number(leg.credit ?? 0);
        cur.legs += 1;
        if (!leg.batch_id || !settlementBatches.has(leg.batch_id)) cur.primaryDr += dr;
        totals.set(leg.reference_id, cur);
      }

      return (expenses ?? []).map((e: any) => {
        const t = totals.get(e.id) ?? { dr: 0, cr: 0, legs: 0, primaryDr: 0 };
        // `amount` is already VAT-inclusive; vat_amount is the embedded tax portion.
        const billed = round2(Number(e.amount ?? 0));
        const drTotal = round2(t.dr);
        const crTotal = round2(t.cr);
        const primaryDr = round2(t.primaryDr);
        const diff = round2(drTotal - crTotal);
        const posted = !!e.ledger_posted;

        let issue: ExpenseLedgerIssue = "ok";
        if (t.legs === 0) {
          issue = posted ? "posted_no_legs" : "not_posted";
        } else if (Math.abs(diff) > 0.005) {
          issue = "unbalanced";
        } else if (billed > 0 && Math.abs(primaryDr - billed) > 0.01) {
          issue = "amount_mismatch";
        }

        return {
          id: e.id,
          expenseDate: e.expense_date,
          description: e.description ?? null,
          branchId: e.branch_id ?? null,
          branchName: e.branch_id ? branchNames.get(e.branch_id) ?? null : null,
          supplierId: e.supplier_id ?? null,
          supplierName: e.supplier_id ? supplierNames.get(e.supplier_id) ?? null : null,
          status: e.status ?? null,
          approvalStatus: e.approval_status ?? null,
          ledgerPosted: posted,
          billed,
          drTotal,
          primaryDrTotal: primaryDr,
          crTotal,
          diff,
          legCount: t.legs,
          issue,
        } satisfies ExpenseLedgerReconRow;
      });
    },
  });

  const rows = query.data ?? [];

  const totals = useMemo<ExpenseLedgerReconTotals>(() => {
    const acc: ExpenseLedgerReconTotals = {
      scanned: rows.length,
      flagged: 0,
      notPosted: 0,
      notPostedAmount: 0,
      postedNoLegs: 0,
      postedNoLegsAmount: 0,
      unbalanced: 0,
      unbalancedAmount: 0,
      amountMismatch: 0,
      amountMismatchAmount: 0,
    };
    for (const r of rows) {
      if (r.issue === "ok") continue;
      acc.flagged += 1;
      if (r.issue === "not_posted") {
        acc.notPosted += 1;
        acc.notPostedAmount = round2(acc.notPostedAmount + r.billed);
      } else if (r.issue === "posted_no_legs") {
        acc.postedNoLegs += 1;
        acc.postedNoLegsAmount = round2(acc.postedNoLegsAmount + r.billed);
      } else if (r.issue === "unbalanced") {
        acc.unbalanced += 1;
        acc.unbalancedAmount = round2(acc.unbalancedAmount + Math.abs(r.diff));
      } else if (r.issue === "amount_mismatch") {
        acc.amountMismatch += 1;
        acc.amountMismatchAmount = round2(
          acc.amountMismatchAmount + Math.abs(r.primaryDrTotal - r.billed),
        );
      }
    }
    return acc;
  }, [rows]);

  return {
    rows,
    totals,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export const EXPENSE_LEDGER_ISSUE_LABELS: Record<ExpenseLedgerIssue, string> = {
  ok: "Reconciled",
  not_posted: "Never posted",
  posted_no_legs: "Marked posted, no ledger legs",
  unbalanced: "Debits ≠ credits",
  amount_mismatch: "Ledger total ≠ bill total",
};