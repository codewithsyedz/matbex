import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client: these tables are newer than the generated types. */
const db = supabase as any;

export type InstallmentProvider = "tabby" | "tamara" | "bank" | "supplier" | "other";
export type InstallmentFrequency = "weekly" | "biweekly" | "monthly";

export interface InstallmentPlan {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  provider: InstallmentProvider;
  supplier_name: string | null;
  description: string;
  purchase_date: string;
  target_account_id: string;
  liability_account_id: string;
  finance_account_id: string | null;
  cash_price: number;
  finance_charge: number;
  total_payable: number;
  installment_count: number;
  first_due_date: string;
  frequency: InstallmentFrequency;
  status: "active" | "completed" | "cancelled";
  notes: string | null;
  batch_id: string | null;
  created_at: string;
  invoice_url: string | null;
  asset_class_id: string | null;
  asset_id: string | null;
}

export interface InstallmentPayment {
  id: string;
  tenant_id: string;
  plan_id: string;
  branch_id: string | null;
  installment_no: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  paid_date: string | null;
  status: "pending" | "paid";
  funding_source: "company" | "partner";
  payment_account_id: string | null;
  capital_account_id: string | null;
  batch_id: string | null;
  reference_number: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface PlanSummary extends InstallmentPlan {
  schedule: InstallmentPayment[];
  paidAmount: number;
  outstanding: number;
  paidCount: number;
  nextDue: InstallmentPayment | null;
  overdueCount: number;
  overdueAmount: number;
}

interface Args {
  /** null / "all" = consolidated across branches. */
  branchId?: string | null;
  status?: "all" | "active" | "completed";
}

export function useInstallmentPlans({ branchId, status = "all" }: Args = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const plansQuery = useQuery({
    queryKey: ["installment-plans", tenantId, branchKey, status],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<InstallmentPlan[]> => {
      let q = db
        .from("installment_plans")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("purchase_date", { ascending: false });
      if (branchKey) q = q.eq("branch_id", branchKey);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InstallmentPlan[];
    },
  });

  const paymentsQuery = useQuery({
    queryKey: ["installment-payments", tenantId, branchKey],
    enabled: !!tenantId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<InstallmentPayment[]> => {
      let q = db
        .from("installment_payments")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("installment_no", { ascending: true });
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InstallmentPayment[];
    },
  });

  const plans = plansQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];

  const summaries = useMemo<PlanSummary[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return plans.map((p) => {
      const schedule = payments
        .filter((x) => x.plan_id === p.id)
        .sort((a, b) => a.installment_no - b.installment_no);
      const paidRows = schedule.filter((s) => s.status === "paid");
      const paidAmount = paidRows.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
      const pending = schedule.filter((s) => s.status !== "paid");
      const overdue = pending.filter((s) => s.due_date < today);
      return {
        ...p,
        schedule,
        paidAmount,
        outstanding: Math.max(0, Number(p.total_payable || 0) - paidAmount),
        paidCount: paidRows.length,
        nextDue: pending[0] ?? null,
        overdueCount: overdue.length,
        overdueAmount: overdue.reduce((s, r) => s + Number(r.amount || 0), 0),
      };
    });
  }, [plans, payments]);

  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({
          financed: acc.financed + Number(s.total_payable || 0),
          paid: acc.paid + s.paidAmount,
          outstanding: acc.outstanding + s.outstanding,
          overdue: acc.overdue + s.overdueAmount,
          financeCharges: acc.financeCharges + Number(s.finance_charge || 0),
        }),
        { financed: 0, paid: 0, outstanding: 0, overdue: 0, financeCharges: 0 },
      ),
    [summaries],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["installment-plans"], refetchType: "all" });
    qc.invalidateQueries({ queryKey: ["installment-payments"], refetchType: "all" });
    qc.invalidateQueries({ queryKey: ["fixed-assets"] });
    qc.invalidateQueries({ queryKey: ["chart-of-accounts"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
    qc.invalidateQueries({ queryKey: ["ap-aging"] });
    qc.invalidateQueries({ queryKey: ["bnpl-reporting"] });
    qc.invalidateQueries({ queryKey: ["bnpl-overdue"] });
    qc.invalidateQueries({ queryKey: ["bnpl-payment-audit"] });
  };

  const createPlan = useMutation({
    mutationFn: async (input: {
      description: string;
      targetAccountId: string;
      cashPrice: number;
      installmentCount: number;
      firstDueDate: string;
      provider?: InstallmentProvider;
      supplierName?: string | null;
      purchaseDate?: string;
      financeCharge?: number;
      frequency?: InstallmentFrequency;
      branchId?: string | null;
      notes?: string | null;
      vatRate?: number;
      priceIncludesVat?: boolean;
      vatOnFinanceCharge?: boolean;
      invoiceUrl?: string | null;
      assetClassId?: string | null;
      assetTag?: string | null;
    }) => {
      const { data, error } = await db.rpc("create_installment_plan", {
        p_tenant_id: tenantId,
        p_description: input.description,
        p_target_account_id: input.targetAccountId,
        p_cash_price: input.cashPrice,
        p_installment_count: input.installmentCount,
        p_first_due_date: input.firstDueDate,
        p_provider: input.provider ?? "tabby",
        p_supplier_name: input.supplierName ?? null,
        p_purchase_date: input.purchaseDate ?? new Date().toISOString().slice(0, 10),
        p_finance_charge: input.financeCharge ?? 0,
        p_frequency: input.frequency ?? "monthly",
        p_branch_id: input.branchId ?? null,
        p_notes: input.notes ?? null,
        p_vat_rate: input.vatRate ?? 0,
        p_price_includes_vat: input.priceIncludesVat ?? false,
        p_vat_on_finance_charge: input.vatOnFinanceCharge ?? false,
        p_invoice_url: input.invoiceUrl ?? null,
        p_asset_class_id: input.assetClassId ?? null,
        p_asset_tag: input.assetTag ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const payInstallment = useMutation({
    mutationFn: async (input: {
      installmentId: string;
      paidDate: string;
      fundingSource: "company" | "partner";
      paymentAccountId?: string | null;
      capitalAccountId?: string | null;
      referenceNumber?: string | null;
    }) => {
      const { data, error } = await db.rpc("pay_installment", {
        p_installment_id: input.installmentId,
        p_payment_account_id: input.paymentAccountId ?? null,
        p_paid_date: input.paidDate,
        p_funding_source: input.fundingSource,
        p_capital_account_id: input.capitalAccountId ?? null,
        p_reference_number: input.referenceNumber ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const voidPayment = useMutation({
    mutationFn: async (input: { installmentId: string; reason?: string | null }) => {
      const { data, error } = await db.rpc("void_installment_payment", {
        p_installment_id: input.installmentId,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  /** Correct a mistyped installment count: paid rows stay, pending rows are rebuilt. */
  const updatePlanDetails = useMutation({
    mutationFn: async (input: {
      planId: string;
      invoiceUrl?: string | null;
      clearInvoice?: boolean;
      assetClassId?: string | null;
      assetTag?: string | null;
    }) => {
      const { data, error } = await db.rpc("update_installment_plan_details", {
        p_plan_id: input.planId,
        p_invoice_url: input.invoiceUrl ?? null,
        p_clear_invoice: input.clearInvoice ?? false,
        p_asset_class_id: input.assetClassId ?? null,
        p_asset_tag: input.assetTag ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const reschedulePlan = useMutation({
    mutationFn: async (input: {
      planId: string;
      installmentCount: number;
      firstDueDate?: string | null;
      frequency?: InstallmentFrequency | null;
      financeCharge?: number | null;
    }) => {
      const { data, error } = await db.rpc("reschedule_installment_plan", {
        p_plan_id: input.planId,
        p_installment_count: input.installmentCount,
        p_first_due_date: input.firstDueDate ?? null,
        p_frequency: input.frequency ?? null,
        p_finance_charge: input.financeCharge ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  return {
    plans,
    payments,
    summaries,
    totals,
    isLoading: plansQuery.isLoading || paymentsQuery.isLoading,
    error: plansQuery.error ?? paymentsQuery.error,
    refetch: () => {
      plansQuery.refetch();
      paymentsQuery.refetch();
    },
    createPlan,
    payInstallment,
    voidPayment,
    reschedulePlan,
    updatePlanDetails,
  };
}