import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";

export type FineStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "applied"
  | "cancelled";

export interface ViolationType {
  id: string;
  restaurant_id: string;
  code: string;
  name_en: string;
  name_ar: string | null;
  description: string | null;
  default_amount: number;
  is_active: boolean;
  sort_order: number;
  requires_evidence?: boolean;
}

export interface DeductionSettings {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  effective_from: string;
  max_fine_per_violation: number;
  max_fine_per_month: number;
  max_days_wage_per_month: number;
  max_total_deduction_pct: number;
  requires_second_approval: boolean;
  notes: string | null;
}

export interface EmployeeFine {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  staff_id: string;
  fine_number: string | null;
  violation_type_id: string | null;
  violation_date: string;
  payroll_month: string;
  description: string | null;
  attendance_reference: string | null;
  amount: number;
  original_amount: number | null;
  recovered_amount?: number | null;
  evidence_path: string | null;
  status: FineStatus;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  applied_payroll_id: string | null;
  applied_at: string | null;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
  installment_group_id?: string | null;
  installment_number?: number | null;
  installment_count?: number | null;
  installment_total_amount?: number | null;
  staff?: { id: string; name: string; role: string } | null;
  violation_type?: { id: string; name_en: string; name_ar: string | null } | null;
}

export interface FineCapacity {
  staff_id: string;
  payroll_month: string;
  monthly_wage: number;
  max_fine_per_violation: number;
  max_days_wage_per_month: number;
  max_total_deduction_pct: number;
  monthly_fine_limit: number;
  existing_fines: number;
  remaining_fine_capacity: number;
  max_total_deduction: number;
  pending_advances: number;
  settings_effective_from: string | null;
}

export interface CreateFineInput {
  staff_id: string;
  branch_id?: string | null;
  violation_type_id: string | null;
  violation_date: string;
  payroll_month: string;
  description?: string;
  attendance_reference?: string;
  amount: number;
  evidence_path?: string | null;
  status?: FineStatus;
  installment_group_id?: string | null;
  installment_number?: number | null;
  installment_count?: number | null;
  installment_total_amount?: number | null;
}

export const FINE_STATUS_FLOW: FineStatus[] = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "applied",
];

/** Parses the structured compliance errors raised by the database triggers. */
export function parseFineComplianceError(message: string): string {
  if (message.includes("MONTHLY_FINE_LIMIT_EXCEEDED")) {
    return message.split("MONTHLY_FINE_LIMIT_EXCEEDED:")[1]?.trim() || message;
  }
  if (message.includes("FINE_LIMIT_EXCEEDED")) {
    return message.split("FINE_LIMIT_EXCEEDED:")[1]?.trim() || message;
  }
  if (message.includes("DEDUCTION_LIMIT_EXCEEDED")) {
    return message.split("DEDUCTION_LIMIT_EXCEEDED:")[1]?.trim() || message;
  }
  if (message.includes("CANCELLATION_REASON_REQUIRED")) {
    return "A reason is mandatory when cancelling a fine.";
  }
  if (message.includes("FINE_ALREADY_APPLIED")) {
    return "This fine was already applied to payroll and can only be cancelled with a reason.";
  }
  if (message.includes("EVIDENCE_REQUIRED")) {
    return message.split("EVIDENCE_REQUIRED:")[1]?.trim() || message;
  }
  if (message.includes("INVALID_FINE_TRANSITION")) {
    return message.split("INVALID_FINE_TRANSITION:")[1]?.trim() || message;
  }
  if (message.includes("FINE_APPROVAL_FORBIDDEN")) {
    return message.split("FINE_APPROVAL_FORBIDDEN:")[1]?.trim() || message;
  }
  if (message.includes("FINE_SELF_APPROVAL_FORBIDDEN")) {
    return message.split("FINE_SELF_APPROVAL_FORBIDDEN:")[1]?.trim() || message;
  }
  if (message.includes("REJECTION_REASON_REQUIRED")) {
    return "A written reason is mandatory when rejecting a fine.";
  }
  return message;
}

export function useViolationTypes() {
  const { restaurant } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["violation-types", restaurant?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("fine_violation_types")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("sort_order");
      if (error) throw error;
      return data as ViolationType[];
    },
    enabled: !!restaurant?.id,
  });

  const upsertType = useMutation({
    mutationFn: async (input: Partial<ViolationType> & { name_en: string; code: string }) => {
      const payload = { ...input, restaurant_id: restaurant!.id };
      const { error } = input.id
        ? await db.from("fine_violation_types").update(payload).eq("id", input.id)
        : await db.from("fine_violation_types").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["violation-types"] });
      toast.success("Violation type saved");
    },
    onError: (e: Error) => toast.error("Could not save violation type", { description: e.message }),
  });

  return { violationTypes: query.data ?? [], isLoading: query.isLoading, upsertType };
}

export function useDeductionSettings() {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["deduction-settings", restaurant?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("payroll_deduction_settings")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data as DeductionSettings[];
    },
    enabled: !!restaurant?.id,
  });

  const rows = query.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const current =
    rows.find((r) => r.branch_id === activeBranchId && r.effective_from <= today) ??
    rows.find((r) => r.branch_id === null && r.effective_from <= today) ??
    null;

  const saveSettings = useMutation({
    mutationFn: async (input: Partial<DeductionSettings>) => {
      const { error } = await db.from("payroll_deduction_settings").insert({
        restaurant_id: restaurant!.id,
        branch_id: input.branch_id ?? null,
        effective_from: input.effective_from ?? today,
        max_fine_per_violation: input.max_fine_per_violation ?? 0,
        max_fine_per_month: input.max_fine_per_month ?? 0,
        max_days_wage_per_month: input.max_days_wage_per_month ?? 5,
        max_total_deduction_pct: input.max_total_deduction_pct ?? 50,
        requires_second_approval: input.requires_second_approval ?? false,
        notes: input.notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deduction-settings"] });
      queryClient.invalidateQueries({ queryKey: ["fine-capacity"] });
      toast.success("Compliance settings saved", {
        description: "Historical payroll keeps the rules that were effective at the time.",
      });
    },
    onError: (e: Error) => toast.error("Could not save settings", { description: e.message }),
  });

  return { settingsHistory: rows, currentSettings: current, isLoading: query.isLoading, saveSettings };
}

export function useFineCapacity(staffId?: string | null, payrollMonth?: string, excludeFineId?: string) {
  return useQuery({
    queryKey: ["fine-capacity", staffId, payrollMonth, excludeFineId],
    queryFn: async () => {
      const { data, error } = await db.rpc("get_employee_fine_capacity", {
        p_staff_id: staffId!,
        p_payroll_month: payrollMonth!,
        p_exclude_fine_id: excludeFineId ?? null,
      });
      if (error) throw error;
      return data as unknown as FineCapacity;
    },
    enabled: !!staffId && !!payrollMonth,
  });
}

export interface FineFilters {
  staffId?: string;
  status?: FineStatus | "all";
  violationTypeId?: string;
  from?: string;
  to?: string;
  payrollMonth?: string;
}

export function useEmployeeFines(filters: FineFilters = {}) {
  const { restaurant, user } = useAuth();
  const { activeBranchId, isAllBranches } = useBranch();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [
      "employee-fines",
      restaurant?.id,
      isAllBranches ? "all" : activeBranchId,
      filters,
    ],
    queryFn: async () => {
      let q = db
        .from("employee_fines")
        .select("*, staff:staff_id(id,name,role), violation_type:violation_type_id(id,name_en,name_ar)")
        .eq("restaurant_id", restaurant!.id)
        .is("deleted_at", null)
        .order("violation_date", { ascending: false });

      if (!isAllBranches && activeBranchId) {
        q = q.or(`branch_id.eq.${activeBranchId},branch_id.is.null`);
      }
      if (filters.staffId) q = q.eq("staff_id", filters.staffId);
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.violationTypeId) q = q.eq("violation_type_id", filters.violationTypeId);
      if (filters.from) q = q.gte("violation_date", filters.from);
      if (filters.to) q = q.lte("violation_date", filters.to);
      if (filters.payrollMonth) q = q.eq("payroll_month", filters.payrollMonth);

      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as EmployeeFine[];
    },
    enabled: !!restaurant?.id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
    queryClient.invalidateQueries({ queryKey: ["fine-capacity"] });
  };

  const createFine = useMutation({
    mutationFn: async (input: CreateFineInput) => {
      const { data, error } = await db
        .from("employee_fines")
        .insert({
          restaurant_id: restaurant!.id,
          branch_id: input.branch_id ?? activeBranchId,
          staff_id: input.staff_id,
          violation_type_id: input.violation_type_id,
          violation_date: input.violation_date,
          payroll_month: input.payroll_month,
          description: input.description || null,
          attendance_reference: input.attendance_reference || null,
          amount: input.amount,
          evidence_path: input.evidence_path ?? null,
          status: input.status ?? "draft",
          created_by: user!.id,
          installment_group_id: input.installment_group_id ?? null,
          installment_number: input.installment_number ?? null,
          installment_count: input.installment_count ?? null,
          installment_total_amount: input.installment_total_amount ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Fine recorded", { description: "It stays pending until approved." });
    },
    onError: (e: Error) =>
      toast.error("Could not record fine", { description: parseFineComplianceError(e.message) }),
  });

  const changeStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: string;
      status: FineStatus;
      reason?: string;
    }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "approved") {
        patch.approved_by = user!.id;
        patch.approved_at = new Date().toISOString();
      }
      if (status === "under_review") {
        patch.reviewed_by = user!.id;
        patch.reviewed_at = new Date().toISOString();
      }
      if (status === "submitted") patch.submitted_at = new Date().toISOString();
      if (status === "rejected") patch.rejection_reason = reason ?? null;
      if (status === "cancelled") patch.cancellation_reason = reason ?? null;

      const { error } = await db.from("employee_fines").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Fine status updated");
    },
    onError: (e: Error) =>
      toast.error("Compliance validation failed", {
        description: parseFineComplianceError(e.message),
      }),
  });

  const updateAmount = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const { error } = await db.from("employee_fines").update({ amount }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Fine amount updated");
    },
    onError: (e: Error) =>
      toast.error("Could not update amount", { description: parseFineComplianceError(e.message) }),
  });

  const fines = query.data ?? [];

  return {
    fines,
    isLoading: query.isLoading,
    createFine,
    changeStatus,
    updateAmount,
  };
}

export function useFineAudit(fineId?: string) {
  return useQuery({
    queryKey: ["fine-audit", fineId],
    queryFn: async () => {
      const { data, error } = await db
        .from("employee_fine_audit")
        .select("*")
        .eq("fine_id", fineId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!fineId,
  });
}