import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ExpenseAiJournalAudit {
  id: string;
  selected_account_id: string | null;
  confidence: number | null;
  classification: string | null;
  rationale: string | null;
  outcome: string;
  error_message: string | null;
  is_manual_override: boolean;
  override_reason: string | null;
  created_at: string;
  account: { account_code: string; account_name: string } | null;
}

export function useExpenseAiJournalAudit(expenseId: string | null | undefined) {
  return useQuery<ExpenseAiJournalAudit[]>({
    queryKey: ["expense-ai-journal-audit", expenseId],
    enabled: Boolean(expenseId),
    queryFn: async () => {
      if (!expenseId) return [];
      const { data, error } = await supabase
        .from("ai_expense_journal_audit")
        .select(`
          id, selected_account_id, confidence, classification, rationale,
          outcome, error_message, is_manual_override, override_reason, created_at,
          account:chart_of_accounts!ai_expense_journal_audit_selected_account_id_fkey(account_code, account_name)
        `)
        .eq("expense_id", expenseId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as ExpenseAiJournalAudit[];
    },
    staleTime: 30_000,
  });
}