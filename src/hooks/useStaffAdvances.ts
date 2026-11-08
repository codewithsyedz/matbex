import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";
import {
  parseReversalLinkageError,
  formatReversalLinkageToast,
} from "@/lib/reversalLinkageError";
import {
  evaluateReversalEligibility,
  formatReversalBlockToast,
  ReversalBlockedError,
  type ReversalStatus,
} from "@/lib/reversalGuard";
import {
  deriveAdvanceSettlement,
  summarizeAdvanceSettlements,
} from "@/lib/staffAdvanceSettlement";

export interface StaffAdvance {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  branch_id?: string | null;
  staff_id: string;
  amount: number;
  /** Portion already settled from payroll or cash. */
  repaid_amount?: number | null;
  advance_date: string;
  reason: string | null;
  payment_method: "cash" | "bank_transfer" | "cheque";
  status: "pending" | "deducted" | "forgiven";
  funding_source?: "company" | "owner_capital" | "partner_capital";
  funding_account_id?: string | null;
  capital_account_id?: string | null;
  deducted_from_payroll_id: string | null;
  deducted_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  ledger_posted: boolean;
  ledger_transaction_id: string | null;
  ledger_reversed?: boolean | null;
  ledger_reversal_transaction_id?: string | null;
  ledger_reversed_at?: string | null;
  ledger_reversal_reason?: string | null;
  staff?: {
    id: string;
    name: string;
    role: string;
    branch_id?: string | null;
  };
}

export interface CreateAdvanceData {
  staff_id: string;
  amount: number;
  advance_date: string;
  reason?: string;
  payment_method: "cash" | "bank_transfer" | "cheque";
  /** Where the cash came from: company cash/bank, or an owner/partner personal account. */
  funding_source?: "company" | "owner_capital" | "partner_capital";
  funding_account_id?: string | null;
  capital_account_id?: string | null;
}

export interface RecordRepaymentData {
  advanceId: string;
  amount: number;
  repayment_date: string;
  source: "cash" | "bank" | "payroll";
  account_id?: string | null;
  payroll_id?: string | null;
  notes?: string | null;
}

/** Amount still due on an advance after partial repayments / deduction / forgiveness. */
export function advanceOutstanding(
  advance: Pick<StaffAdvance, "amount" | "repaid_amount" | "status"> & {
    ledger_reversed?: boolean | null;
  }
) {
  return deriveAdvanceSettlement(advance).outstanding;
}

export function useStaffAdvances() {
  const { user, profile, restaurant } = useAuth();
  const { activeBranchId, isAllBranches } = useBranch();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;

  // Fetch all advances for the restaurant
  const { data: advances = [], isLoading } = useQuery({
    queryKey: ["staff-advances", restaurant?.id, isAllBranches ? "all" : activeBranchId],
    queryFn: async () => {
      if (!restaurant?.id) return [];

      let q = supabase
        .from("staff_advances")
        .select("*, staff:staff_id(id, name, role, branch_id)")
        .eq("restaurant_id", restaurant.id)
        .order("advance_date", { ascending: false });
      if (!isAllBranches && activeBranchId) {
        // Include branch rows + legacy null-branch rows so pre-branch data stays visible.
        q = q.or(`branch_id.eq.${activeBranchId},branch_id.is.null`);
      }
      const { data, error } = await q;

      if (error) throw error;
      return data as StaffAdvance[];
    },
    enabled: !!restaurant?.id,
  });

  // Get pending advances for a specific staff member
  const getPendingAdvancesForStaff = (staffId: string) => {
    return advances.filter(
      (a) => a.staff_id === staffId && a.status === "pending"
    );
  };

  // Get total pending advances for a staff member
  const getTotalPendingForStaff = (staffId: string) => {
    return getPendingAdvancesForStaff(staffId).reduce(
      (sum, a) => sum + advanceOutstanding(a),
      0
    );
  };

  // Create a new advance
  const createAdvance = useMutation({
    mutationFn: async (data: CreateAdvanceData) => {
      if (!tenantId || !restaurant?.id || !user?.id) {
        throw new Error("Authentication required");
      }

      const { data: advance, error } = await supabase
        .from("staff_advances")
        .insert({
          tenant_id: tenantId,
          restaurant_id: restaurant.id,
          // Stamp the branch the user is actually viewing, otherwise the DB
          // trigger falls back to the primary branch and the new row is
          // filtered out of the branch-scoped list.
          branch_id: !isAllBranches && activeBranchId ? activeBranchId : undefined,
          staff_id: data.staff_id,
          amount: data.amount,
          advance_date: data.advance_date,
          reason: data.reason || null,
          payment_method: data.payment_method,
          funding_source: data.funding_source ?? "company",
          funding_account_id:
            (data.funding_source ?? "company") === "company" ? data.funding_account_id ?? null : null,
          capital_account_id:
            (data.funding_source ?? "company") === "company" ? null : data.capital_account_id ?? null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-post to ledger (DR 1150 / CR the selected funding account)
      const { error: ledgerError } = await supabase.rpc("post_staff_advance_to_ledger", {
        p_advance_id: advance.id,
      });
      if (ledgerError) {
        console.warn("Failed to post advance to ledger:", ledgerError);
        toast.warning("Advance saved but not posted to the ledger", {
          description: ledgerError.message,
        });
      }

      return advance;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success("Advance payment recorded");
    },
    onError: (error: Error) => {
      toast.error("Failed to record advance", { description: error.message });
    },
  });

  // Mark advance as deducted from payroll
  const deductFromPayroll = useMutation({
    mutationFn: async ({
      advanceId,
      payrollId,
    }: {
      advanceId: string;
      payrollId: string;
    }) => {
      const { error } = await supabase.rpc("deduct_advance_from_payroll", {
        p_advance_id: advanceId,
        p_payroll_id: payrollId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success("Advance marked as deducted");
    },
    onError: (error: Error) => {
      toast.error("Failed to deduct advance", { description: error.message });
    },
  });

  // Forgive an advance (write it off)
  // Record a partial (or final) repayment against an advance
  const recordRepayment = useMutation({
    mutationFn: async (data: RecordRepaymentData) => {
      const { error } = await supabase.rpc("record_staff_advance_repayment", {
        p_advance_id: data.advanceId,
        p_amount: data.amount,
        p_repayment_date: data.repayment_date,
        p_source: data.source,
        p_account_id: data.account_id ?? null,
        p_payroll_id: data.payroll_id ?? null,
        p_notes: data.notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advance-repayments"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advance-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success("Repayment recorded");
    },
    onError: (error: Error) => {
      toast.error("Failed to record repayment", { description: error.message });
    },
  });

  // Undo a repayment (removes its ledger legs and restores the balance)
  const deleteRepayment = useMutation({
    mutationFn: async (repaymentId: string) => {
      const { error } = await supabase.rpc("delete_staff_advance_repayment", {
        p_repayment_id: repaymentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advance-repayments"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success("Repayment removed");
    },
    onError: (error: Error) => {
      toast.error("Failed to remove repayment", { description: error.message });
    },
  });

  const forgiveAdvance = useMutation({
    mutationFn: async (advanceId: string) => {
      // Single transaction: the reversal legs and the status change either
      // both land or both roll back.
      const { error } = await supabase.rpc("reverse_staff_advance_atomic", {
        p_advance_id: advanceId,
        p_reason: "Advance forgiven (written off)",
        p_settlement: "forgive",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advance-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success("Advance marked as forgiven");
    },
    onError: (error: Error) => {
      toast.error("Failed to update advance", { description: error.message });
    },
  });

  // Explicitly reverse the ledger entry for an advance
  const reverseLedger = useMutation({
    mutationFn: async ({ advanceId, reason }: { advanceId: string; reason?: string }) => {
      const advance = advances.find((a) => a.id === advanceId);
      // Block the save client-side when the original is already reversed or
      // was never posted — the DB would reject it anyway.
      const status = evaluateReversalEligibility({
        posted: advance?.ledger_posted,
        originalTransactionId: advance?.ledger_transaction_id,
        reversed: advance?.ledger_reversed,
        reversedAt: advance?.ledger_reversed_at,
        reversalReason: advance?.ledger_reversal_reason,
        label: "advance",
      });
      if (!status.allowed) throw new ReversalBlockedError(status);

      const { error } = await supabase.rpc("reverse_staff_advance_atomic", {
        p_advance_id: advanceId,
        p_reason: reason ?? null,
        p_settlement: "none",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advance-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success("Ledger entry reversed");
    },
    onError: (error: Error) => {
      if (error instanceof ReversalBlockedError) {
        toast.error(error.status.title ?? "Reversal blocked", {
          description: formatReversalBlockToast(error.status),
        });
        return;
      }
      const parsed = parseReversalLinkageError(error);
      if (parsed) {
        toast.error(parsed.title, { description: formatReversalLinkageToast(parsed) });
        return;
      }
      toast.error("Failed to reverse ledger entry", { description: error.message });
    },
  });

  // Delete an advance (only if not deducted)
  const deleteAdvance = useMutation({
    mutationFn: async (advanceId: string) => {
      // Reversal + row removal in one transaction so a posted journal can
      // never be orphaned by a partially applied delete.
      const { error } = await supabase.rpc("reverse_staff_advance_atomic", {
        p_advance_id: advanceId,
        p_reason: "Advance deleted",
        p_settlement: "delete",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-advances"] });
      queryClient.invalidateQueries({ queryKey: ["staff-advance-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["account-transactions"] });
      toast.success("Advance deleted");
    },
    onError: (error: Error) => {
      const parsed = parseReversalLinkageError(error);
      if (parsed) {
        toast.error(`Can't delete: ${parsed.title.toLowerCase()}`, {
          description: formatReversalLinkageToast(parsed),
        });
        return;
      }
      toast.error("Failed to delete advance", { description: error.message });
    },
  });

  // Calculate totals from the canonical settlement derivation
  const settlementSummary = summarizeAdvanceSettlements(advances);
  const totalPending = settlementSummary.outstandingTotal;
  const totalDeducted = settlementSummary.repaidTotal;
  const totalForgiven = settlementSummary.forgivenTotal;

  /** Current reversal status for an advance — drives disabled buttons/badges. */
  const getReversalStatus = (advanceId: string): ReversalStatus => {
    const advance = advances.find((a) => a.id === advanceId);
    return evaluateReversalEligibility({
      posted: advance?.ledger_posted,
      originalTransactionId: advance?.ledger_transaction_id,
      reversed: advance?.ledger_reversed,
      reversedAt: advance?.ledger_reversed_at,
      reversalReason: advance?.ledger_reversal_reason,
      label: "advance",
    });
  };

  return {
    advances,
    isLoading,
    totalPending,
    totalDeducted,
    totalForgiven,
    settlementSummary,
    getPendingAdvancesForStaff,
    getTotalPendingForStaff,
    getReversalStatus,
    createAdvance,
    deductFromPayroll,
    recordRepayment,
    deleteRepayment,
    forgiveAdvance,
    deleteAdvance,
    reverseLedger,
    isCreating: createAdvance.isPending,
    isDeducting: deductFromPayroll.isPending,
    isReversing: reverseLedger.isPending,
  };
}
