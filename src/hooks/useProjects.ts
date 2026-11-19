import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  computeProjectReconciliation,
  isAcquisitionDerived,
  type ReconAdjustment,
} from "@/lib/projectReconciliation";
import {
  buildCategoryBreakdown,
  matchesPeriod,
  type BudgetPeriodFilter,
} from "@/lib/projectBudgetBreakdown";

export interface ProjectAdjustmentLeg extends ReconAdjustment {
  id: string;
  label: string;
  date: string | null;
  account_code?: string | null;
}

export interface ProjectPostingRun {
  id: string;
  project_id: string;
  performed_by: string | null;
  performed_by_name?: string | null;
  performed_at: string;
  scope: string;
  category: string | null;
  date_from: string | null;
  date_to: string | null;
  shift: string | null;
  txn_ids: string[];
  txn_count: number;
  failed_count: number;
  total_amount: number;
  undone_at?: string | null;
  undone_by?: string | null;
  undone_count?: number;
}

/** Untyped client: the project tables are newer than the generated types. */
export type ProjectPhase =
  | "acquisition"
  | "construction"
  | "renovation"
  | "equipment"
  | "pre_opening"
  | "opening"
  | "operational";

export type Treatment =
  | "capex"
  | "opex"
  | "inventory"
  | "acquisition"
  | "pre_opening"
  | "license"
  | "deposit"
  | "other";

export type FundingClassification = "capital" | "loan" | "payable";
export type TxnStatus = "needs_review" | "classified" | "posted" | "rejected" | "voided";

export interface Project {
  id: string;
  tenant_id: string;
  restaurant_id: string | null;
  branch_id: string | null;
  code: string;
  name: string;
  description: string | null;
  phase: ProjectPhase;
  status: "active" | "on_hold" | "completed" | "cancelled";
  start_date: string;
  target_open_date: string | null;
  completed_at: string | null;
  total_budget: number;
}

export interface ProjectPartner {
  id: string;
  tenant_id: string;
  project_id: string | null;
  partner_name: string;
  ownership_pct: number;
  capital_account_id: string | null;
  payable_account_id: string | null;
  loan_account_id: string | null;
  opening_capital: number;
  is_active: boolean;
  notes: string | null;
}

export interface ProjectTransaction {
  id: string;
  tenant_id: string;
  project_id: string;
  branch_id: string | null;
  commitment_id: string | null;
  supplier_id: string | null;
  vendor_name: string | null;
  txn_date: string;
  amount: number;
  description: string | null;
  category: string | null;
  treatment: Treatment | null;
  debit_account_id: string | null;
  paid_by: "company" | "partner";
  partner_id: string | null;
  payment_source: string | null;
  payment_account_id: string | null;
  funding_classification: FundingClassification | null;
  is_paid: boolean;
  status: TxnStatus;
  source: string;
  import_batch: string | null;
  notes: string | null;
  batch_id: string | null;
  posted_at: string | null;
  created_at: string;
  capitalize?: boolean;
  asset_class_id?: string | null;
  asset_name?: string | null;
  asset_tag?: string | null;
  asset_useful_life_months?: number | null;
  asset_id?: string | null;
}

export interface ProjectSplit {
  id: string;
  transaction_id: string;
  account_id: string;
  category: string | null;
  treatment: Treatment | null;
  amount: number;
}

export interface BudgetLine {
  id: string;
  project_id: string;
  category: string;
  account_id: string | null;
  budget_amount: number;
  sort_order: number;
  notes: string | null;
}

export interface Commitment {
  id: string;
  project_id: string;
  supplier_id: string | null;
  vendor_name: string | null;
  category: string;
  contract_amount: number;
  contract_date: string;
  status: "open" | "partially_delivered" | "completed" | "cancelled";
  notes: string | null;
}

export interface Acquisition {
  id: string;
  tenant_id: string;
  project_id: string;
  branch_id: string | null;
  acquisition_date: string;
  seller_name: string;
  amount: number;
  payment_method: string | null;
  paid_by: "company" | "partner";
  partner_id: string | null;
  funding_classification: FundingClassification | null;
  payment_account_id: string | null;
  /** VAT portion of the purchase price — posted to 1180 Input VAT, not capitalised. */
  vat_amount?: number | null;
  vat_inclusive?: boolean | null;
  vat_rate?: number | null;
  agreement_url: string | null;
  notes: string | null;
  classification_status: "pending" | "classified" | "posted";
  batch_id: string | null;
  posted_at: string | null;
}

export interface AcquisitionAllocation {
  id: string;
  acquisition_id: string;
  account_id: string;
  label: string;
  amount: number;
  capitalize?: boolean;
  asset_class_id?: string | null;
  asset_useful_life_months?: number | null;
  asset_id?: string | null;
}

export interface AcquisitionFunder {
  id: string;
  acquisition_id: string;
  paid_by: "company" | "partner";
  partner_id: string | null;
  funding_classification: FundingClassification | null;
  payment_account_id: string | null;
  amount: number;
  notes: string | null;
}

export interface PartnerFunding {
  partner_id: string;
  partner_name: string;
  ownership_pct: number;
  capital_balance: number;
  loan_balance: number;
  payable_balance: number;
  total_funded: number;
  unclassified_amount: number;
}

/** Default construction categories seeded for a new project budget. */
export const CONSTRUCTION_CATEGORIES = [
  "Civil Work",
  "Electrical",
  "Plumbing",
  "HVAC / AC",
  "Kitchen Construction",
  "Kitchen Equipment",
  "Gas System",
  "Exhaust System",
  "Flooring",
  "Ceiling",
  "Painting",
  "Walls",
  "Signage",
  "Furniture",
  "Interior",
  "Lighting",
  "POS / Technology",
  "CCTV",
  "Networking",
  "Restaurant Equipment",
  "Licensing",
  "Municipality / Balady",
  "Professional Fees",
  "Pre-Opening",
  "Other",
];

export const TREATMENT_LABELS: Record<Treatment, string> = {
  capex: "CAPEX",
  opex: "OPEX",
  inventory: "Inventory / COGS",
  acquisition: "Acquisition",
  pre_opening: "Pre-Opening",
  license: "Licence",
  deposit: "Deposit",
  other: "Other",
};

export const FUNDING_LABELS: Record<FundingClassification, string> = {
  capital: "Partner Capital (equity)",
  loan: "Partner Loan (liability)",
  payable: "Due to Partner (payable)",
};

export function useProjects(projectId?: string | null) {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["project-partners"] });
    qc.invalidateQueries({ queryKey: ["project-transactions"] });
    qc.invalidateQueries({ queryKey: ["project-budget"] });
    qc.invalidateQueries({ queryKey: ["project-commitments"] });
    qc.invalidateQueries({ queryKey: ["project-acquisition"] });
    qc.invalidateQueries({ queryKey: ["partner-funding"] });
  };

  const projectsQuery = useQuery({
    queryKey: ["projects", tenantId],
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await db
        .from("projects")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const activeProject = useMemo(() => {
    const list = projectsQuery.data ?? [];
    if (projectId) return list.find((p) => p.id === projectId) ?? null;
    return list[0] ?? null;
  }, [projectsQuery.data, projectId]);

  const pid = activeProject?.id ?? null;

  const partnersQuery = useQuery({
    queryKey: ["project-partners", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 60 * 2,
    queryFn: async (): Promise<ProjectPartner[]> => {
      const { data, error } = await db
        .from("project_partners")
        .select("*")
        .eq("project_id", pid)
        .order("partner_name");
      if (error) throw error;
      return (data ?? []) as ProjectPartner[];
    },
  });

  const transactionsQuery = useQuery({
    queryKey: ["project-transactions", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 60,
    queryFn: async (): Promise<ProjectTransaction[]> => {
      const { data, error } = await db
        .from("project_transactions")
        .select("*")
        .eq("project_id", pid)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProjectTransaction[];
    },
  });

  /** Approved + posted journal adjustments tagged to this project. */
  const adjustmentsQuery = useQuery({
    queryKey: ["project-journal-adjustments", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 60,
    queryFn: async (): Promise<ProjectAdjustmentLeg[]> => {
      const { data, error } = await db
        .from("account_transactions")
        .select(
          "id, transaction_date, debit, credit, description, reference_type, is_voided, batch_id, chart_of_accounts!inner(code, account_type), journal_entry_batches!inner(entry_type, approval_status, is_posted, project_id, description)",
        )
        .eq("project_id", pid)
        .eq("is_voided", false);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      return rows
        .filter((r) => (r.journal_entry_batches?.entry_type ?? "") === "adjustment")
        .map((r) => {
          const type = String(r.chart_of_accounts?.account_type ?? "");
          const debit = Number(r.debit ?? 0);
          const credit = Number(r.credit ?? 0);
          const isCostAccount = ["asset", "expense", "cogs"].includes(type);
          return {
            id: r.id as string,
            label: r.description || r.journal_entry_batches?.description || "Journal adjustment",
            date: r.transaction_date ?? null,
            account_code: r.chart_of_accounts?.code ?? null,
            side: isCostAccount ? "cost" : "funding",
            amount: isCostAccount ? debit - credit : credit - debit,
            approval_status: r.journal_entry_batches?.approval_status ?? "approved",
            is_posted: r.journal_entry_batches?.is_posted !== false,
            is_voided: !!r.is_voided,
            acquisition_derived: String(r.reference_type ?? "").includes("acquisition"),
          } satisfies ProjectAdjustmentLeg;
        });
    },
  });

  const budgetQuery = useQuery({
    queryKey: ["project-budget", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<BudgetLine[]> => {
      const { data, error } = await db
        .from("project_budget_lines")
        .select("*")
        .eq("project_id", pid)
        .order("sort_order")
        .order("category");
      if (error) throw error;
      return (data ?? []) as BudgetLine[];
    },
  });

  const commitmentsQuery = useQuery({
    queryKey: ["project-commitments", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<Commitment[]> => {
      const { data, error } = await db
        .from("project_commitments")
        .select("*")
        .eq("project_id", pid)
        .order("contract_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Commitment[];
    },
  });

  const acquisitionQuery = useQuery({
    queryKey: ["project-acquisition", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<{
      acquisition: Acquisition | null;
      allocations: AcquisitionAllocation[];
      funders: AcquisitionFunder[];
    }> => {
      const { data, error } = await db
        .from("project_acquisitions")
        .select("*")
        .eq("project_id", pid)
        .order("acquisition_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      const acquisition = (data?.[0] ?? null) as Acquisition | null;
      if (!acquisition) return { acquisition: null, allocations: [], funders: [] };
      const { data: allocs, error: aErr } = await db
        .from("project_acquisition_allocations")
        .select("*")
        .eq("acquisition_id", acquisition.id)
        .order("created_at");
      if (aErr) throw aErr;
      const { data: funders, error: fErr } = await db
        .from("project_acquisition_funders")
        .select("*")
        .eq("acquisition_id", acquisition.id)
        .order("created_at");
      if (fErr) throw fErr;
      return {
        acquisition,
        allocations: (allocs ?? []) as AcquisitionAllocation[],
        funders: (funders ?? []) as AcquisitionFunder[],
      };
    },
  });

  const fundingQuery = useQuery({
    queryKey: ["partner-funding", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 60,
    queryFn: async (): Promise<PartnerFunding[]> => {
      const { data, error } = await db.rpc("get_partner_funding_summary", { p_project_id: pid });
      if (error) throw error;
      return (data ?? []) as PartnerFunding[];
    },
  });

  /* ---------------------------------------------------------------- mutations */

  const createProject = useMutation({
    mutationFn: async (input: {
      code: string;
      name: string;
      restaurantId?: string | null;
      branchId?: string | null;
      phase?: ProjectPhase;
      totalBudget?: number;
      targetOpenDate?: string | null;
      seedBudgetCategories?: boolean;
    }) => {
      await db.rpc("ensure_project_accounts", { p_tenant_id: tenantId });
      const { data, error } = await db
        .from("projects")
        .insert({
          tenant_id: tenantId,
          restaurant_id: input.restaurantId ?? null,
          branch_id: input.branchId ?? null,
          code: input.code,
          name: input.name,
          phase: input.phase ?? "acquisition",
          total_budget: input.totalBudget ?? 0,
          target_open_date: input.targetOpenDate ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      if (input.seedBudgetCategories) {
        const rows = CONSTRUCTION_CATEGORIES.map((category, i) => ({
          tenant_id: tenantId,
          project_id: data.id,
          category,
          budget_amount: 0,
          sort_order: i,
        }));
        await db.from("project_budget_lines").insert(rows);
      }
      return data as Project;
    },
    onSuccess: invalidate,
  });

  const updateProject = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Project> }) => {
      const { error } = await db.from("projects").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const addPartner = useMutation({
    mutationFn: async (input: { name: string; ownershipPct: number; openingCapital?: number }) => {
      const { data, error } = await db
        .from("project_partners")
        .insert({
          tenant_id: tenantId,
          project_id: pid,
          partner_name: input.name,
          ownership_pct: input.ownershipPct,
          opening_capital: input.openingCapital ?? 0,
        })
        .select()
        .single();
      if (error) throw error;
      const { error: rpcErr } = await db.rpc("ensure_partner_funding_accounts", { p_partner_id: data.id });
      if (rpcErr) throw rpcErr;
      return data as ProjectPartner;
    },
    onSuccess: invalidate,
  });

  const updatePartner = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ProjectPartner> }) => {
      const { error } = await db.from("project_partners").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const saveTransaction = useMutation({
    mutationFn: async (input: Partial<ProjectTransaction> & { id?: string }) => {
      const { id, ...rest } = input;
      if (id) {
        const { error } = await db.from("project_transactions").update(rest).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await db
        .from("project_transactions")
        .insert({ ...rest, tenant_id: tenantId, project_id: pid })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: invalidate,
  });

  const bulkImport = useMutation({
    mutationFn: async (rows: Array<Partial<ProjectTransaction>>) => {
      const batch = `IMP-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
      const payload = rows.map((r) => ({
        ...r,
        tenant_id: tenantId,
        project_id: pid,
        status: "needs_review",
        source: "import",
        import_batch: batch,
      }));
      const { error } = await db.from("project_transactions").insert(payload);
      if (error) throw error;
      return { batch, count: payload.length };
    },
    onSuccess: invalidate,
  });

  const postTransaction = useMutation({
    mutationFn: async (txnId: string) => {
      const { data, error } = await db.rpc("post_project_transaction", { p_txn_id: txnId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  /** Confirm posting for a batch of pending transactions (a shift, a day, a category). */
  const postPendingTransactions = useMutation({
    mutationFn: async (
      input:
        | string[]
        | {
            ids: string[];
            total?: number;
            category?: string | null;
            from?: string | null;
            to?: string | null;
            shift?: string | null;
          },
    ) => {
      const txnIds = Array.isArray(input) ? input : input.ids;
      const meta = Array.isArray(input) ? null : input;
      const posted: string[] = [];
      const failures: Array<{ id: string; message: string }> = [];
      for (const id of txnIds) {
        const { error } = await db.rpc("post_project_transaction", { p_txn_id: id });
        if (error) failures.push({ id, message: error.message });
        else posted.push(id);
      }
      if (posted.length > 0 && pid && tenantId) {
        const { data: auth } = await db.auth.getUser();
        const postedSet = new Set(posted);
        const total =
          meta?.total ??
          txns
            .filter((t) => postedSet.has(t.id))
            .reduce((s, t) => s + Number(t.amount ?? 0), 0);
        await db.from("project_posting_runs").insert({
          tenant_id: tenantId,
          project_id: pid,
          performed_by: auth?.user?.id ?? null,
          scope: meta?.category ? "category" : "filter",
          category: meta?.category ?? null,
          date_from: meta?.from || null,
          date_to: meta?.to || null,
          shift: meta?.shift && meta.shift !== "all" ? meta.shift : null,
          txn_ids: posted,
          txn_count: posted.length,
          failed_count: failures.length,
          total_amount: total,
        });
      }
      return { posted, failures };
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["project-posting-runs"] });
    },
  });

  /** Undo a confirm-posting run: reverse the ledger and set transactions back to Pending. */
  const undoPostingRun = useMutation({
    mutationFn: async (run: ProjectPostingRun) => {
      const ids = run.txn_ids ?? [];
      const reverted: string[] = [];
      const failures: Array<{ id: string; message: string }> = [];
      for (const id of ids) {
        const { error } = await db.rpc("undo_project_transaction_posting", { p_txn_id: id });
        if (error) failures.push({ id, message: error.message });
        else reverted.push(id);
      }
      if (reverted.length > 0) {
        const { data: auth } = await db.auth.getUser();
        await db
          .from("project_posting_runs")
          .update({
            undone_at: new Date().toISOString(),
            undone_by: auth?.user?.id ?? null,
            undone_count: reverted.length,
          })
          .eq("id", run.id);
      }
      return { reverted, failures };
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["project-posting-runs"] });
    },
  });

  const reclassifyFunding = useMutation({
    mutationFn: async (input: { txnId: string; classification: FundingClassification; reason: string }) => {
      const { data, error } = await db.rpc("reclassify_project_funding", {
        p_txn_id: input.txnId,
        p_new_classification: input.classification,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: invalidate,
  });

  const saveSplits = useMutation({
    mutationFn: async (input: { txnId: string; splits: Array<Omit<ProjectSplit, "id" | "transaction_id">> }) => {
      await db.from("project_transaction_splits").delete().eq("transaction_id", input.txnId);
      if (input.splits.length === 0) return;
      const { error } = await db.from("project_transaction_splits").insert(
        input.splits.map((s) => ({ ...s, tenant_id: tenantId, transaction_id: input.txnId })),
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const saveBudgetLine = useMutation({
    mutationFn: async (input: { id?: string; category: string; budget_amount: number }) => {
      if (input.id) {
        const { error } = await db
          .from("project_budget_lines")
          .update({ budget_amount: input.budget_amount })
          .eq("id", input.id);
        if (error) throw error;
        return;
      }
      const { error } = await db.from("project_budget_lines").insert({
        tenant_id: tenantId,
        project_id: pid,
        category: input.category,
        budget_amount: input.budget_amount,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const renameBudgetCategory = useMutation({
    mutationFn: async (input: { id?: string | null; from: string; to: string }) => {
      const to = input.to.trim();
      if (!to || to === input.from) return;
      if (input.id) {
        const { error } = await db
          .from("project_budget_lines")
          .update({ category: to })
          .eq("id", input.id);
        if (error) throw error;
      }
      const { error: txnErr } = await db
        .from("project_transactions")
        .update({ category: to })
        .eq("project_id", pid)
        .eq("category", input.from);
      if (txnErr) throw txnErr;
      const { error: cmtErr } = await db
        .from("project_commitments")
        .update({ category: to })
        .eq("project_id", pid)
        .eq("category", input.from);
      if (cmtErr) throw cmtErr;
    },
    onSuccess: invalidate,
  });

  const deleteBudgetLine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("project_budget_lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const bulkAssignCategories = useMutation({
    mutationFn: async (assignments: { id: string; category: string }[]) => {
      const byCategory = new Map<string, string[]>();
      for (const a of assignments) {
        byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a.id]);
      }
      for (const [category, ids] of byCategory) {
        const { error } = await db
          .from("project_transactions")
          .update({ category })
          .in("id", ids);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const reorderBudgetLines = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await db
          .from("project_budget_lines")
          .update({ sort_order: i })
          .eq("id", orderedIds[i]);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const saveCommitment = useMutation({
    mutationFn: async (input: Partial<Commitment> & { id?: string }) => {
      const { id, ...rest } = input;
      if (id) {
        const { error } = await db.from("project_commitments").update(rest).eq("id", id);
        if (error) throw error;
        return;
      }
      const { error } = await db
        .from("project_commitments")
        .insert({ ...rest, tenant_id: tenantId, project_id: pid });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const saveAcquisition = useMutation({
    mutationFn: async (input: Partial<Acquisition> & { id?: string }) => {
      const { id, ...rest } = input;
      if (id) {
        const { error } = await db.from("project_acquisitions").update(rest).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await db
        .from("project_acquisitions")
        .insert({ ...rest, tenant_id: tenantId, project_id: pid })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: invalidate,
  });

  const saveAllocations = useMutation({
    mutationFn: async (input: {
      acquisitionId: string;
      allocations: Array<{
        account_id: string;
        label: string;
        amount: number;
        capitalize?: boolean;
        asset_class_id?: string | null;
        asset_useful_life_months?: number | null;
      }>;
    }) => {
      await db.from("project_acquisition_allocations").delete().eq("acquisition_id", input.acquisitionId);
      if (input.allocations.length === 0) return;
      const { error } = await db.from("project_acquisition_allocations").insert(
        input.allocations.map((a) => ({ ...a, tenant_id: tenantId, acquisition_id: input.acquisitionId })),
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const postAcquisition = useMutation({
    mutationFn: async (acqId: string) => {
      const { data, error } = await db.rpc("post_project_acquisition", { p_acq_id: acqId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const saveFunders = useMutation({
    mutationFn: async (input: {
      acquisitionId: string;
      funders: Array<{
        paid_by: "company" | "partner";
        partner_id: string | null;
        funding_classification: FundingClassification | null;
        payment_account_id: string | null;
        amount: number;
      }>;
    }) => {
      await db.from("project_acquisition_funders").delete().eq("acquisition_id", input.acquisitionId);
      if (input.funders.length === 0) return;
      const { error } = await db.from("project_acquisition_funders").insert(
        input.funders.map((f) => ({ ...f, tenant_id: tenantId, acquisition_id: input.acquisitionId })),
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reimbursePartner = useMutation({
    mutationFn: async (input: {
      partnerId: string;
      amount: number;
      paymentAccountId: string;
      date?: string;
      kind?: FundingClassification;
      notes?: string;
    }) => {
      const { data, error } = await db.rpc("reimburse_project_partner", {
        p_partner_id: input.partnerId,
        p_amount: input.amount,
        p_payment_account_id: input.paymentAccountId,
        p_date: input.date ?? new Date().toISOString().slice(0, 10),
        p_kind: input.kind ?? "payable",
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  /* ---------------------------------------------------------------- derived */

  const txns = transactionsQuery.data ?? [];
  // Exclude project transactions generated from the acquisition header so the
  // same SAR value is never counted twice.
  const posted = txns.filter((t) => t.status === "posted" && !isAcquisitionDerived(t));

  const totals = useMemo(() => {
    const acq = acquisitionQuery.data?.acquisition;
    const byTreatment = (tr: Treatment) =>
      posted.filter((t) => t.treatment === tr).reduce((s, t) => s + Number(t.amount), 0);
    const acquisitionCost = Number(acq?.amount ?? 0);
    const construction = byTreatment("capex");
    const preOpening = byTreatment("pre_opening");
    const opex = byTreatment("opex");
    const other =
      byTreatment("inventory") + byTreatment("license") + byTreatment("deposit") + byTreatment("other");
    const projectSpend = posted.reduce((s, t) => s + Number(t.amount), 0);
    const needsReview = txns.filter((t) => t.status === "needs_review");
    const outstandingVendor = posted
      .filter((t) => !t.is_paid && t.paid_by === "company")
      .reduce((s, t) => s + Number(t.amount), 0);
    const budget = (budgetQuery.data ?? []).reduce((s, b) => s + Number(b.budget_amount), 0);
    const committed = (commitmentsQuery.data ?? [])
      .filter((c) => c.status !== "cancelled")
      .reduce((s, c) => s + Number(c.contract_amount), 0);

    return {
      acquisitionCost,
      construction,
      preOpening,
      opex,
      other,
      projectSpend,
      // A posted acquisition is real project cost and is counted exactly once
      // (header only, never the allocation lines). Drafts are not project cost.
      totalInvestment:
        projectSpend + (acq?.classification_status === "posted" ? acquisitionCost : 0),
      needsReviewCount: needsReview.length,
      needsReviewAmount: needsReview.reduce((s, t) => s + Number(t.amount), 0),
      outstandingVendor,
      budget,
      committed,
      remainingBudget: budget - projectSpend,
    };
  }, [posted, txns, acquisitionQuery.data, budgetQuery.data, commitmentsQuery.data]);

  const funding = fundingQuery.data ?? [];

  /** Last realtime change on this project's transactions (drives toast + row highlight). */
  const [lastTxnEvent, setLastTxnEvent] = useState<{
    at: number;
    type: "INSERT" | "UPDATE" | "DELETE";
    category: string;
    amount: number;
  } | null>(null);

  // Keep the Budget tab in sync the moment any transaction row changes.
  useEffect(() => {
    if (!pid) return;
    const channel = db
      .channel(`project-txns-${pid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_transactions", filter: `project_id=eq.${pid}` },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["project-transactions"] });
          qc.invalidateQueries({ queryKey: ["project-budget"] });
          const row = payload.new ?? payload.old ?? {};
          setLastTxnEvent({
            at: Date.now(),
            type: payload.eventType,
            category: String(row.category ?? "Uncategorised"),
            amount: Number(row.amount ?? 0),
          });
        },
      )
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [pid, qc]);

  const reconciliation = useMemo(
    () =>
      computeProjectReconciliation({
        transactions: txns,
        acquisition: acquisitionQuery.data?.acquisition ?? null,
        funding,
        adjustments: adjustmentsQuery.data ?? [],
      }),
    [funding, txns, acquisitionQuery.data, adjustmentsQuery.data],
  );

  const categoryBreakdown = useMemo(() => {
    // Every recorded transaction (posted or not) counts towards the category
    // spend so the Budget tab reflects new entries immediately.
    return buildCategoryBreakdown(txns, budgetQuery.data ?? [], commitmentsQuery.data ?? []);
  }, [budgetQuery.data, commitmentsQuery.data, txns]);

  /** Same breakdown, restricted to a date range / shift window. */
  const getCategoryBreakdown = (filter?: BudgetPeriodFilter) =>
    buildCategoryBreakdown(txns, budgetQuery.data ?? [], commitmentsQuery.data ?? [], filter);

  /** Audit log of every "confirm posting" run for this project. */
  const postingRunsQuery = useQuery({
    queryKey: ["project-posting-runs", tenantId, pid],
    enabled: !!tenantId && !!pid,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<ProjectPostingRun[]> => {
      const { data, error } = await db
        .from("project_posting_runs")
        .select("*")
        .eq("project_id", pid)
        .order("performed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data ?? []) as ProjectPostingRun[];
      const ids = Array.from(
        new Set(rows.map((r) => r.performed_by).filter((v): v is string => !!v)),
      );
      if (ids.length === 0) return rows;
      const { data: people } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const names = new Map<string, string>(
        ((people ?? []) as any[]).map((p) => [p.id, p.full_name as string]),
      );
      return rows.map((r) => ({
        ...r,
        performed_by_name: r.performed_by ? names.get(r.performed_by) ?? null : null,
      }));
    },
  });

  /** Pending (not yet posted) transactions inside a date range / shift window. */
  const getPendingTransactions = (filter?: BudgetPeriodFilter, category?: string | null) =>
    txns.filter(
      (t) =>
        !isAcquisitionDerived(t) &&
        t.status !== "posted" &&
        t.status !== "rejected" &&
        t.status !== "voided" &&
        matchesPeriod(t, filter) &&
        (!category || (t.category ?? "Uncategorised") === category),
    );

  return {
    projects: projectsQuery.data ?? [],
    activeProject,
    postingRuns: postingRunsQuery.data ?? [],
    postingRunsLoading: postingRunsQuery.isLoading,
    partners: partnersQuery.data ?? [],
    transactions: txns,
    budgetLines: budgetQuery.data ?? [],
    commitments: commitmentsQuery.data ?? [],
    acquisition: acquisitionQuery.data?.acquisition ?? null,
    allocations: acquisitionQuery.data?.allocations ?? [],
    acquisitionFunders: acquisitionQuery.data?.funders ?? [],
    journalAdjustments: adjustmentsQuery.data ?? [],
    funding,
    totals,
    reconciliation,
    categoryBreakdown,
    getCategoryBreakdown,
    getPendingTransactions,
    lastTxnEvent,
    isLoading:
      projectsQuery.isLoading ||
      (!!pid && (transactionsQuery.isLoading || partnersQuery.isLoading)),
    createProject,
    updateProject,
    addPartner,
    updatePartner,
    saveTransaction,
    bulkImport,
    postTransaction,
    postPendingTransactions,
    undoPostingRun,
    reclassifyFunding,
    saveSplits,
    saveBudgetLine,
    renameBudgetCategory,
    deleteBudgetLine,
    reorderBudgetLines,
    bulkAssignCategories,
    saveCommitment,
    saveAcquisition,
    saveAllocations,
    postAcquisition,
    saveFunders,
    reimbursePartner,
  };
}