import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Untyped client: these tables are newer than the generated types. */
const db = supabase as any;

export interface FixedAssetSettings {
  tenant_id: string;
  capitalization_threshold: number;
  auto_expense_below_threshold: boolean;
  default_useful_life_months: number;
  default_expense_account_id: string | null;
  depreciation_method: string;
  auto_post_enabled: boolean;
  auto_post_day: number;
  last_auto_posted_month: string | null;
}

export interface FixedAssetClass {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  code: string;
  template_key: string | null;
  name: string;
  description: string | null;
  asset_account_id: string;
  accum_dep_account_id: string;
  dep_expense_account_id: string;
  useful_life_months: number;
  depreciation_method: "straight_line" | "reducing_balance";
  salvage_rate_pct: number;
  sort_order: number;
  is_active: boolean;
}

export interface FixedAsset {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  class_id: string | null;
  asset_tag: string | null;
  name: string;
  description: string | null;
  supplier_name: string | null;
  acquisition_date: string;
  in_service_date: string;
  cost: number;
  vat_amount: number;
  salvage_value: number;
  useful_life_months: number;
  accumulated_depreciation: number;
  status: "active" | "fully_depreciated" | "disposed";
  funding_source: "company" | "partner" | "credit" | "installment";
  source: "manual" | "expense" | "installment";
  batch_id: string | null;
  disposal_date: string | null;
  disposal_proceeds: number | null;
  notes: string | null;
  created_at: string;
}

export interface DepreciationRow {
  id: string;
  asset_id: string;
  branch_id: string | null;
  period_month: string;
  amount: number;
  batch_id: string | null;
  posted_at: string;
}

export interface DepreciationRun {
  id: string;
  period_month: string;
  run_type: "auto" | "manual";
  status: "success" | "skipped" | "failed";
  assets_count: number;
  total_amount: number;
  batch_id: string | null;
  branch_id: string | null;
  error_message: string | null;
  created_at: string;
}

export type DisposalType = "sale" | "trade_in" | "scrap" | "write_off" | "theft" | "donation";
export type SettlementMethod = "none" | "cash" | "bank" | "receivable";

export interface AssetDisposal {
  id: string;
  asset_id: string;
  branch_id: string | null;
  disposal_date: string;
  disposal_type: DisposalType;
  settlement_method: SettlementMethod;
  settlement_account_id: string | null;
  settlement_status: "settled" | "pending";
  settled_on: string | null;
  counterparty_name: string | null;
  reference_number: string | null;
  proceeds: number;
  vat_amount: number;
  cost: number;
  accumulated_depreciation: number;
  net_book_value: number;
  gain_loss: number;
  batch_id: string | null;
  settlement_batch_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface FixedAssetSummary extends FixedAsset {
  netBookValue: number;
  monthlyDepreciation: number;
  className: string;
  monthsRemaining: number;
}

export interface RecordEquipmentInput {
  name: string;
  cost: number;
  classId?: string | null;
  branchId?: string | null;
  purchaseDate?: string;
  supplierName?: string | null;
  fundingSource?: "company" | "partner" | "credit";
  paymentAccountId?: string | null;
  capitalAccountId?: string | null;
  expenseAccountId?: string | null;
  usefulLifeMonths?: number | null;
  salvageValue?: number;
  vatRate?: number;
  priceIncludesVat?: boolean;
  assetTag?: string | null;
  notes?: string | null;
  forceCapitalize?: boolean;
  forceExpense?: boolean;
  projectId?: string | null;
}

export interface PurchaseDecision {
  decision: "capitalized" | "expensed";
  asset_id: string | null;
  batch_id: string;
  net_amount: number;
  vat_amount: number;
  threshold: number;
}

interface Args {
  /** null / "all" = consolidated across branches. */
  branchId?: string | null;
  status?: "all" | "active" | "fully_depreciated" | "disposed";
}

export function useFixedAssets({ branchId, status = "all" }: Args = {}) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();
  const branchKey = branchId && branchId !== "all" ? branchId : null;

  const settingsQuery = useQuery({
    queryKey: ["fixed-asset-settings", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<FixedAssetSettings | null> => {
      const { data, error } = await db
        .from("fixed_asset_settings")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as FixedAssetSettings | null;
    },
  });

  const classesQuery = useQuery({
    queryKey: ["fixed-asset-classes", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<FixedAssetClass[]> => {
      const { data, error } = await db
        .from("fixed_asset_classes")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as FixedAssetClass[];
    },
  });

  const assetsQuery = useQuery({
    queryKey: ["fixed-assets", tenantId, branchKey, status],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<FixedAsset[]> => {
      let q = db
        .from("fixed_assets")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("acquisition_date", { ascending: false });
      if (branchKey) q = q.eq("branch_id", branchKey);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as FixedAsset[];
    },
  });

  const depreciationQuery = useQuery({
    queryKey: ["fixed-asset-depreciation", tenantId, branchKey],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<DepreciationRow[]> => {
      let q = db
        .from("fixed_asset_depreciation")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("period_month", { ascending: false });
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DepreciationRow[];
    },
  });

  const runsQuery = useQuery({
    queryKey: ["fixed-asset-depreciation-runs", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<DepreciationRun[]> => {
      const { data, error } = await db
        .from("fixed_asset_depreciation_runs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as DepreciationRun[];
    },
  });

  const assets = assetsQuery.data ?? [];
  const allClasses = classesQuery.data ?? [];
  /** Effective classes for the scoped branch: a branch override replaces the tenant template. */
  const classes = useMemo(() => {
    const active = allClasses.filter((c) => c.is_active);
    const byCode = new Map<string, FixedAssetClass>();
    for (const c of active) {
      if (c.branch_id && c.branch_id !== branchKey) continue;
      const existing = byCode.get(c.code);
      if (!existing || (c.branch_id && !existing.branch_id)) byCode.set(c.code, c);
    }
    return Array.from(byCode.values()).sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
  }, [allClasses, branchKey]);
  const depreciation = depreciationQuery.data ?? [];
  const settings = settingsQuery.data ?? null;

  const disposalsQuery = useQuery({
    queryKey: ["fixed-asset-disposals", tenantId, branchKey],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<AssetDisposal[]> => {
      let q = db
        .from("fixed_asset_disposals")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("disposal_date", { ascending: false });
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AssetDisposal[];
    },
  });
  const threshold = Number(settings?.capitalization_threshold ?? 1500);

  const summaries = useMemo<FixedAssetSummary[]>(
    () =>
      assets.map((a) => {
        const cost = Number(a.cost || 0);
        const salvage = Number(a.salvage_value || 0);
        const accum = Number(a.accumulated_depreciation || 0);
        const monthly = Math.round(((cost - salvage) / Math.max(a.useful_life_months, 1)) * 100) / 100;
        const remaining = Math.max(cost - salvage - accum, 0);
        return {
          ...a,
          netBookValue: Math.round((cost - accum) * 100) / 100,
          monthlyDepreciation: monthly,
          className: classes.find((c) => c.id === a.class_id)?.name ?? "Unclassified",
          monthsRemaining: monthly > 0 ? Math.ceil(remaining / monthly) : 0,
        };
      }),
    [assets, classes],
  );

  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => ({
          count: acc.count + (s.status === "disposed" ? 0 : 1),
          cost: acc.cost + (s.status === "disposed" ? 0 : Number(s.cost || 0)),
          accumulated: acc.accumulated + (s.status === "disposed" ? 0 : Number(s.accumulated_depreciation || 0)),
          netBookValue: acc.netBookValue + (s.status === "disposed" ? 0 : s.netBookValue),
          monthlyCharge: acc.monthlyCharge + (s.status === "active" ? s.monthlyDepreciation : 0),
        }),
        { count: 0, cost: 0, accumulated: 0, netBookValue: 0, monthlyCharge: 0 },
      ),
    [summaries],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fixed-assets"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-depreciation"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-depreciation-runs"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-disposals"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-settings"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-classes"] });
    qc.invalidateQueries({ queryKey: ["chart-of-accounts"] });
    qc.invalidateQueries({ queryKey: ["trial-balance"] });
    qc.invalidateQueries({ queryKey: ["profit-loss"] });
  };

  /** Provisions asset accounts, default classes and settings for the tenant. */
  const bootstrap = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("ensure_fixed_asset_accounts", { _tenant_id: tenantId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** Create or update an asset class template (tenant-wide when branchId is null). */
  const saveClass = useMutation({
    mutationFn: async (input: {
      id?: string;
      branchId: string | null;
      code: string;
      name: string;
      description?: string | null;
      assetAccountId: string;
      accumDepAccountId: string;
      depExpenseAccountId: string;
      usefulLifeMonths: number;
      depreciationMethod: "straight_line" | "reducing_balance";
      salvageRatePct: number;
      isActive?: boolean;
      sortOrder?: number;
    }) => {
      const row = {
        tenant_id: tenantId,
        branch_id: input.branchId,
        code: input.code,
        template_key: input.code,
        name: input.name,
        description: input.description ?? null,
        asset_account_id: input.assetAccountId,
        accum_dep_account_id: input.accumDepAccountId,
        dep_expense_account_id: input.depExpenseAccountId,
        useful_life_months: input.usefulLifeMonths,
        depreciation_method: input.depreciationMethod,
        salvage_rate_pct: input.salvageRatePct,
        is_active: input.isActive ?? true,
        ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
      };
      const { error } = input.id
        ? await db.from("fixed_asset_classes").update(row).eq("id", input.id)
        : await db.from("fixed_asset_classes").insert(row);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** Copies the company-wide templates into a branch so they can be customized there. */
  const copyClassesToBranch = useMutation({
    mutationFn: async (input: { branchId: string; classIds?: string[] | null }) => {
      const { data, error } = await db.rpc("copy_asset_classes_to_branch", {
        p_tenant_id: tenantId,
        p_branch_id: input.branchId,
        p_class_ids: input.classIds ?? null,
      });
      if (error) throw error;
      return data as { copied: number; skipped: number };
    },
    onSuccess: invalidate,
  });

  /** Removes a branch-level override so the branch falls back to the company template. */
  const deleteBranchClass = useMutation({
    mutationFn: async (classId: string) => {
      const { error } = await db
        .from("fixed_asset_classes")
        .delete()
        .eq("id", classId)
        .eq("tenant_id", tenantId)
        .not("branch_id", "is", null);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const saveSettings = useMutation({
    mutationFn: async (input: {
      capitalizationThreshold: number;
      autoExpenseBelowThreshold: boolean;
      defaultUsefulLifeMonths: number;
      defaultExpenseAccountId: string | null;
      autoPostEnabled?: boolean;
      autoPostDay?: number;
    }) => {
      const { error } = await db.from("fixed_asset_settings").upsert(
        {
          tenant_id: tenantId,
          capitalization_threshold: input.capitalizationThreshold,
          auto_expense_below_threshold: input.autoExpenseBelowThreshold,
          default_useful_life_months: input.defaultUsefulLifeMonths,
          default_expense_account_id: input.defaultExpenseAccountId,
          ...(input.autoPostEnabled !== undefined ? { auto_post_enabled: input.autoPostEnabled } : {}),
          ...(input.autoPostDay !== undefined ? { auto_post_day: input.autoPostDay } : {}),
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const recordPurchase = useMutation({
    mutationFn: async (input: RecordEquipmentInput): Promise<PurchaseDecision> => {
      const { data, error } = await db.rpc("record_equipment_purchase", {
        p_tenant_id: tenantId,
        p_name: input.name,
        p_cost: input.cost,
        p_class_id: input.classId ?? null,
        p_branch_id: input.branchId ?? null,
        p_purchase_date: input.purchaseDate ?? new Date().toISOString().slice(0, 10),
        p_supplier_name: input.supplierName ?? null,
        p_funding_source: input.fundingSource ?? "company",
        p_payment_account_id: input.paymentAccountId ?? null,
        p_capital_account_id: input.capitalAccountId ?? null,
        p_expense_account_id: input.expenseAccountId ?? null,
        p_useful_life_months: input.usefulLifeMonths ?? null,
        p_salvage_value: input.salvageValue ?? 0,
        p_vat_rate: input.vatRate ?? 0,
        p_price_includes_vat: input.priceIncludesVat ?? false,
        p_asset_tag: input.assetTag ?? null,
        p_notes: input.notes ?? null,
        p_force_capitalize: input.forceCapitalize ?? false,
        p_force_expense: input.forceExpense ?? false,
        p_project_id: input.projectId ?? null,
      });
      if (error) throw error;
      return data as PurchaseDecision;
    },
    onSuccess: invalidate,
  });

  const postDepreciation = useMutation({
    mutationFn: async (input: { periodMonth: string; branchId?: string | null }) => {
      const { data, error } = await db.rpc("post_monthly_depreciation", {
        p_tenant_id: tenantId,
        p_period_month: input.periodMonth,
        p_branch_id: input.branchId ?? null,
      });
      if (error) throw error;
      return data as { period: string; assets: number; amount: number; batch_id: string | null };
    },
    onSuccess: invalidate,
  });

  const disposeAsset = useMutation({
    mutationFn: async (input: {
      assetId: string;
      disposalDate: string;
      disposalType?: DisposalType;
      proceeds?: number;
      vatAmount?: number;
      settlementMethod?: SettlementMethod;
      settlementAccountId?: string | null;
      counterparty?: string | null;
      reference?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await db.rpc("dispose_fixed_asset_v2", {
        p_asset_id: input.assetId,
        p_disposal_date: input.disposalDate,
        p_disposal_type: input.disposalType ?? "sale",
        p_proceeds: input.proceeds ?? 0,
        p_vat_amount: input.vatAmount ?? 0,
        p_settlement_method: input.settlementMethod ?? "none",
        p_settlement_account_id: input.settlementAccountId ?? null,
        p_counterparty: input.counterparty ?? null,
        p_reference: input.reference ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as {
        net_book_value: number;
        gain_loss: number;
        proceeds: number;
        vat_amount: number;
        settlement_status: "settled" | "pending";
      };
    },
    onSuccess: invalidate,
  });

  const settleDisposal = useMutation({
    mutationFn: async (input: { disposalId: string; settledOn: string; accountId?: string | null }) => {
      const { data, error } = await db.rpc("settle_fixed_asset_disposal", {
        p_disposal_id: input.disposalId,
        p_settled_on: input.settledOn,
        p_account_id: input.accountId ?? null,
      });
      if (error) throw error;
      return data as { disposal_id: string; batch_id: string; amount: number };
    },
    onSuccess: invalidate,
  });

  return {
    settings,
    threshold,
    classes,
    allClasses,
    assets,
    summaries,
    depreciation,
    runs: runsQuery.data ?? [],
    disposals: disposalsQuery.data ?? [],
    totals,
    isLoading: assetsQuery.isLoading || classesQuery.isLoading || settingsQuery.isLoading,
    error: assetsQuery.error ?? classesQuery.error ?? settingsQuery.error,
    needsSetup: !settingsQuery.isLoading && !classesQuery.isLoading && (!settings || classes.length === 0),
    refetch: () => {
      assetsQuery.refetch();
      classesQuery.refetch();
      settingsQuery.refetch();
      depreciationQuery.refetch();
      runsQuery.refetch();
      disposalsQuery.refetch();
    },
    bootstrap,
    saveSettings,
    saveClass,
    copyClassesToBranch,
    deleteBranchClass,
    recordPurchase,
    postDepreciation,
    disposeAsset,
    settleDisposal,
  };
}
