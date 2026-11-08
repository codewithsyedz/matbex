import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client: these tables are newer than the generated types. */
const db = supabase as any;

export interface OwnerCapitalAccount {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  partner_name: string;
  bank_name: string;
  account_last4: string;
  equity_account_id: string;
  opening_balance: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CapitalMovement {
  id: string;
  capital_account_id: string;
  branch_id: string | null;
  counter_account_id: string;
  movement_type: "injection" | "withdrawal";
  movement_date: string;
  amount: number;
  reference_number: string | null;
  description: string | null;
  batch_id: string | null;
  is_reversed: boolean;
  reversal_reason: string | null;
  created_at: string;
}

export interface CapitalAccountSummary extends OwnerCapitalAccount {
  injections: number;
  withdrawals: number;
  /** opening + injections − withdrawals (equity credit balance). */
  balance: number;
  movementCount: number;
}

interface Args {
  /** null / "all" = consolidated across branches. */
  branchId?: string | null;
  from?: string;
  to?: string;
}

export function useOwnerCapital({ branchId, from, to }: Args = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const accountsQuery = useQuery({
    queryKey: ["owner-capital-accounts", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<OwnerCapitalAccount[]> => {
      const { data, error } = await db
        .from("owner_capital_accounts")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("partner_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OwnerCapitalAccount[];
    },
  });

  const movementsQuery = useQuery({
    queryKey: ["capital-movements", tenantId, branchKey, from ?? null, to ?? null],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<CapitalMovement[]> => {
      let q = db
        .from("capital_movements")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("movement_date", { ascending: false });
      if (branchKey) q = q.eq("branch_id", branchKey);
      if (from) q = q.gte("movement_date", from);
      if (to) q = q.lte("movement_date", to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CapitalMovement[];
    },
  });

  const accounts = accountsQuery.data ?? [];
  const movements = movementsQuery.data ?? [];

  const summaries = useMemo<CapitalAccountSummary[]>(() => {
    const scoped = branchKey
      ? accounts.filter((a) => a.branch_id === branchKey || a.branch_id === null)
      : accounts;
    return scoped.map((a) => {
      const rows = movements.filter((m) => m.capital_account_id === a.id && !m.is_reversed);
      const injections = rows
        .filter((m) => m.movement_type === "injection")
        .reduce((s, m) => s + Number(m.amount || 0), 0);
      const withdrawals = rows
        .filter((m) => m.movement_type === "withdrawal")
        .reduce((s, m) => s + Number(m.amount || 0), 0);
      const opening = Number(a.opening_balance || 0);
      return {
        ...a,
        injections,
        withdrawals,
        balance: opening + injections - withdrawals,
        movementCount: rows.length,
      };
    });
  }, [accounts, movements, branchKey]);

  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({
          opening: acc.opening + Number(s.opening_balance || 0),
          injections: acc.injections + s.injections,
          withdrawals: acc.withdrawals + s.withdrawals,
          balance: acc.balance + s.balance,
        }),
        { opening: 0, injections: 0, withdrawals: 0, balance: 0 },
      ),
    [summaries],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["owner-capital-accounts"] });
    qc.invalidateQueries({ queryKey: ["capital-movements"] });
    qc.invalidateQueries({ queryKey: ["chart-of-accounts"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
  };

  const createAccount = useMutation({
    mutationFn: async (input: {
      partnerName: string;
      bankName: string;
      last4: string;
      branchId?: string | null;
      openingBalance?: number;
      notes?: string | null;
    }) => {
      const { data, error } = await db.rpc("create_owner_capital_account", {
        p_tenant_id: tenantId,
        p_partner_name: input.partnerName,
        p_bank_name: input.bankName,
        p_account_last4: input.last4,
        p_branch_id: input.branchId ?? null,
        p_opening_balance: input.openingBalance ?? 0,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const postMovement = useMutation({
    mutationFn: async (input: {
      capitalAccountId: string;
      counterAccountId: string;
      movementType: "injection" | "withdrawal";
      amount: number;
      movementDate: string;
      branchId?: string | null;
      referenceNumber?: string | null;
      description?: string | null;
    }) => {
      const { data, error } = await db.rpc("post_capital_movement", {
        p_capital_account_id: input.capitalAccountId,
        p_counter_account_id: input.counterAccountId,
        p_movement_type: input.movementType,
        p_amount: input.amount,
        p_movement_date: input.movementDate,
        p_branch_id: input.branchId ?? null,
        p_reference_number: input.referenceNumber ?? null,
        p_description: input.description ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const reverseMovement = useMutation({
    mutationFn: async (input: { movementId: string; reason?: string }) => {
      const { data, error } = await db.rpc("reverse_capital_movement", {
        p_movement_id: input.movementId,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  return {
    accounts,
    summaries,
    movements,
    totals,
    isLoading: accountsQuery.isLoading || movementsQuery.isLoading,
    error: accountsQuery.error ?? movementsQuery.error,
    createAccount,
    postMovement,
    reverseMovement,
  };
}
