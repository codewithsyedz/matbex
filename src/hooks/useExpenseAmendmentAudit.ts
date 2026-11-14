import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";

export interface AmendmentLedgerLine {
  transaction_id: string | null;
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
  branch_id: string | null;
  debit: number | null;
  credit: number | null;
  transaction_date: string | null;
}

export interface ExpenseAmendmentAuditEntry {
  id: string;
  expense_id: string;
  branch_id: string | null;
  amended_by: string | null;
  amended_at: string;
  reason: string;
  changed_fields: string[];
  before_values: Record<string, unknown>;
  after_values: Record<string, unknown>;
  reversal_batch_id: string | null;
  reversed_lines: AmendmentLedgerLine[];
  reversed_line_count: number;
  new_transaction_id: string | null;
  new_lines: AmendmentLedgerLine[];
  amendedByName?: string | null;
}

/**
 * Full audit trail of posted-expense amendments: who amended, when, why,
 * which fields changed and which ledger rows were reversed / re-posted.
 */
export function useExpenseAmendmentAudit(expenseId: string | null | undefined) {
  return useQuery<ExpenseAmendmentAuditEntry[]>({
    queryKey: ["expense-amendment-audit", expenseId],
    enabled: !!expenseId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (db as any)
        .from("expense_amendment_audit")
        .select("*")
        .eq("expense_id", expenseId)
        .order("amended_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const userIds = Array.from(
        new Set(rows.map((r) => r.amended_by).filter(Boolean)),
      ) as string[];

      const names: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await (db as any)
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        for (const p of (profiles ?? []) as any[]) names[p.id] = p.full_name;
      }

      return rows.map((r) => ({
        ...r,
        changed_fields: (r.changed_fields ?? []) as string[],
        reversed_lines: (r.reversed_lines ?? []) as AmendmentLedgerLine[],
        new_lines: (r.new_lines ?? []) as AmendmentLedgerLine[],
        amendedByName: r.amended_by ? names[r.amended_by] ?? null : null,
      })) as ExpenseAmendmentAuditEntry[];
    },
  });
}
