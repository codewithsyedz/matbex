import { useQuery } from "@tanstack/react-query";

import { db } from "@/integrations/db/client";
import type { LedgerTotals } from "@/lib/installmentIntegrity";
const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Live ledger totals for one installment plan, split by the role each account
 * plays in the BNPL posting, so the UI can prove the journal still agrees with
 * the plan before a finance-charge edit is saved.
 */
export function useInstallmentLedgerTotals(plan: {
  id: string;
  target_account_id: string;
  liability_account_id: string;
  finance_account_id: string | null;
} | null) {
  const query = useQuery({
    queryKey: ["installment-ledger-totals", plan?.id],
    enabled: !!plan?.id,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("account_transactions")
        .select("account_id, debit, credit, is_voided")
        .eq("reference_type", "installment_plan")
        .eq("reference_id", plan!.id);
      if (error) throw error;
      return (data ?? []) as Array<{
        account_id: string;
        debit: number | null;
        credit: number | null;
        is_voided: boolean | null;
      }>;
    },
  });

  const rows = (query.data ?? []).filter((r) => !r.is_voided);

  const totals: LedgerTotals = {
    targetDebit: 0,
    vatDebit: 0,
    financeDebit: 0,
    liabilityCredit: 0,
    unavailable: !plan || query.isLoading || !!query.error || rows.length === 0,
  };

  if (plan) {
    for (const r of rows) {
      const debit = Number(r.debit || 0);
      const credit = Number(r.credit || 0);
      if (r.account_id === plan.target_account_id) totals.targetDebit += debit;
      else if (r.account_id === plan.liability_account_id) totals.liabilityCredit += credit - debit;
      else if (plan.finance_account_id && r.account_id === plan.finance_account_id)
        totals.financeDebit += debit;
      else totals.vatDebit += debit; // input VAT / any other debit leg
    }
    totals.targetDebit = r2(totals.targetDebit);
    totals.vatDebit = r2(totals.vatDebit);
    totals.financeDebit = r2(totals.financeDebit);
    totals.liabilityCredit = r2(totals.liabilityCredit);
  }

  return { totals, isLoading: query.isLoading, error: query.error };
}
