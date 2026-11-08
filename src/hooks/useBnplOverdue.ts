import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client: installment tables/RPCs are newer than the generated types. */
const db = supabase as any;

export interface OverdueInstallment {
  installment_id: string;
  plan_id: string;
  branch_id: string | null;
  provider: string;
  supplier_name: string | null;
  description: string;
  installment_no: number;
  due_date: string;
  amount: number;
  days_overdue: number;
}

export interface InstallmentAuditEntry {
  id: string;
  action: string;
  entity_id: string;
  user_id: string | null;
  created_at: string;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
}

export function useBnplOverdue(branchId?: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const scope = branchId && branchId !== "all" ? branchId : null;

  return useQuery({
    queryKey: ["bnpl-overdue", tenantId, scope],
    enabled: !!tenantId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_overdue_installments", { p_tenant_id: tenantId });
      if (error) throw error;
      const rows = (data ?? []) as OverdueInstallment[];
      return scope ? rows.filter((r) => r.branch_id === scope) : rows;
    },
  });
}

export function useInstallmentPaymentAudit(limit = 50) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  return useQuery({
    queryKey: ["bnpl-payment-audit", tenantId, limit],
    enabled: !!tenantId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db
        .from("audit_logs")
        .select("id, action, entity_id, user_id, created_at, old_data, new_data")
        .eq("tenant_id", tenantId)
        .eq("entity_type", "installment_payment")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as InstallmentAuditEntry[];
    },
  });
}

export function useQuickPayInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { installmentId: string; paymentAccountId?: string | null; reference?: string | null }) => {
      const { data, error } = await db.rpc("quick_pay_installment", {
        p_installment_id: input.installmentId,
        p_payment_account_id: input.paymentAccountId ?? null,
        p_paid_date: new Date().toISOString().slice(0, 10),
        p_reference_number: input.reference ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      for (const key of [
        "bnpl-overdue",
        "bnpl-reporting",
        "bnpl-payment-audit",
        "installment-plans",
        "installment-payments",
        "trial-balance",
        "chart-of-accounts",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
