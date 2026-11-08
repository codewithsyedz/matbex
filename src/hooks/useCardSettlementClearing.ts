import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client: this table is newer than the generated types. */
const db = supabase as any;

export interface CardSettlementDeposit {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  deposit_date: string;
  period_from: string | null;
  period_to: string | null;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  bank_account_id: string | null;
  reference: string | null;
  notes: string | null;
  journal_batch_id: string | null;
  is_reversed: boolean;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export interface NewDepositInput {
  depositDate: string;
  grossAmount: number;
  feeAmount: number;
  branchId?: string | null;
  bankAccountId?: string | null;
  reference?: string | null;
  notes?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
}

interface Args {
  /** null / "all" = consolidated across branches. */
  branchId?: string | null;
}

/**
 * Card takings sit in 1015 "Card Settlements Receivable" from day-end posting
 * until the acquirer payout lands, at which point a deposit clears them into 1010.
 */
export function useCardSettlementClearing({ branchId }: Args = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  /** Bank / cash asset accounts the payout can land in. */
  const accounts = useQuery({
    queryKey: ["card-clearing-accounts", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("id, account_code, account_name")
        .eq("tenant_id", tenantId)
        .eq("account_type", "asset")
        .eq("is_active", true)
        .order("account_code");
      if (error) throw error;
      const rows = (data ?? []) as { id: string; account_code: string; account_name: string }[];
      return {
        clearing: rows.find((r) => r.account_code === "1015") ?? null,
        banks: rows.filter((r) => r.account_code >= "1000" && r.account_code < "1050" && r.account_code !== "1015"),
      };
    },
  });

  const clearingAccountId = accounts.data?.clearing?.id ?? null;

  /** Ledger movement on 1015: debits (card takings) vs credits (payouts cleared). */
  const clearingBalance = useQuery({
    queryKey: ["card-clearing-balance", tenantId, clearingAccountId, branchKey],
    enabled: !!tenantId && !!clearingAccountId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      let q = db
        .from("account_transactions")
        .select("transaction_date, debit, credit, branch_id, description")
        .eq("tenant_id", tenantId)
        .eq("account_id", clearingAccountId)
        .order("transaction_date", { ascending: false })
        .limit(1000);
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as {
        transaction_date: string;
        debit: number | null;
        credit: number | null;
        branch_id: string | null;
        description: string | null;
      }[];
      const debit = rows.reduce((s, r) => s + Number(r.debit ?? 0), 0);
      const credit = rows.reduce((s, r) => s + Number(r.credit ?? 0), 0);
      // Oldest unsettled debit tells us how long money has been in transit.
      const openDebits = rows.filter((r) => Number(r.debit ?? 0) > 0);
      const oldest = openDebits.length
        ? openDebits[openDebits.length - 1].transaction_date
        : null;
      return {
        cardTakings: debit,
        settled: credit,
        outstanding: debit - credit,
        oldestTakingDate: oldest,
        rows,
      };
    },
  });

  const deposits = useQuery({
    queryKey: ["card-settlement-deposits", tenantId, branchKey],
    enabled: !!tenantId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      let q = db
        .from("card_settlement_deposits")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("deposit_date", { ascending: false })
        .limit(300);
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CardSettlementDeposit[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["card-settlement-deposits"] });
    qc.invalidateQueries({ queryKey: ["card-clearing-balance"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
  };

  const postDeposit = useMutation({
    mutationFn: async (input: NewDepositInput) => {
      const { data, error } = await db.rpc("post_card_settlement_deposit", {
        p_deposit_date: input.depositDate,
        p_gross_amount: input.grossAmount,
        p_fee_amount: input.feeAmount ?? 0,
        p_branch_id: input.branchId ?? null,
        p_bank_account_id: input.bankAccountId ?? null,
        p_reference: input.reference ?? null,
        p_notes: input.notes ?? null,
        p_period_from: input.periodFrom ?? null,
        p_period_to: input.periodTo ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const reverseDeposit = useMutation({
    mutationFn: async ({ depositId, reason }: { depositId: string; reason: string }) => {
      const { data, error } = await db.rpc("reverse_card_settlement_deposit", {
        p_deposit_id: depositId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  return {
    clearingAccount: accounts.data?.clearing ?? null,
    bankAccounts: accounts.data?.banks ?? [],
    balance: clearingBalance.data ?? {
      cardTakings: 0,
      settled: 0,
      outstanding: 0,
      oldestTakingDate: null as string | null,
      rows: [],
    },
    deposits: deposits.data ?? [],
    isLoading: accounts.isLoading || clearingBalance.isLoading || deposits.isLoading,
    postDeposit,
    reverseDeposit,
  };
}
