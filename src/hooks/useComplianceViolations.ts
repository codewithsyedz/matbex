import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";

export type ComplianceStatus =
  | "identified"
  | "assigned"
  | "action_required"
  | "completed"
  | "verified"
  | "closed"
  | "cancelled";

export type ComplianceSource =
  | "balady_inspection"
  | "internal_inspection"
  | "shift_supervisor"
  | "customer_complaint"
  | "food_safety_inspection"
  | "management_audit"
  | "other";

export const COMPLIANCE_SOURCE_LABELS: Record<ComplianceSource, string> = {
  balady_inspection: "Balady / Municipality inspection",
  internal_inspection: "Internal management inspection",
  shift_supervisor: "Shift supervisor",
  customer_complaint: "Customer complaint",
  food_safety_inspection: "Food safety inspection",
  management_audit: "Management audit",
  other: "Other",
};

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  identified: "Identified",
  assigned: "Assigned",
  action_required: "Corrective action required",
  completed: "Action completed",
  verified: "Supervisor verified",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const COMPLIANCE_STATUS_FLOW: ComplianceStatus[] = [
  "identified",
  "assigned",
  "action_required",
  "completed",
  "verified",
  "closed",
];

export interface ComplianceViolation {
  id: string;
  restaurant_id: string;
  branch_id: string;
  violation_number: string | null;
  category_id: string | null;
  violation_type_id: string | null;
  source: ComplianceSource;
  is_municipality_fine: boolean;
  violation_date: string;
  violation_time: string | null;
  shift_id: string | null;
  description: string | null;
  responsible_staff_id: string | null;
  supervisor_staff_id: string | null;
  fine_amount: number;
  municipality_reference: string | null;
  inspector_name: string | null;
  inspection_date: string | null;
  corrective_action_required: string | null;
  corrective_action_due_date: string | null;
  corrective_action_completed_at: string | null;
  verified_at: string | null;
  status: ComplianceStatus;
  is_overdue: boolean;
  escalation_label: string | null;
  payroll_fine_id: string | null;
  notes: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  branch?: { id: string; name: string } | null;
  category?: { id: string; code: string; name_en: string } | null;
  violation_type?: { id: string; name_en: string; severity: string } | null;
  responsible_staff?: { id: string; name: string } | null;
  supervisor_staff?: { id: string; name: string } | null;
}

export interface ViolationFilters {
  from?: string;
  to?: string;
  status?: ComplianceStatus | "all" | "open" | "overdue";
  categoryId?: string | "all";
  source?: ComplianceSource | "all";
  staffId?: string | "all";
  municipalityOnly?: boolean;
}

const SELECT = `*,
  branch:branches(id,name),
  category:compliance_violation_categories(id,code,name_en),
  violation_type:compliance_violation_types(id,name_en,severity),
  responsible_staff:staff!compliance_violations_responsible_staff_id_fkey(id,name),
  supervisor_staff:staff!compliance_violations_supervisor_staff_id_fkey(id,name)`;

export function useComplianceViolations(filters: ViolationFilters = {}) {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();
  const rid = restaurant?.id;

  const query = useQuery({
    queryKey: ["compliance-violations", rid, activeBranchId, filters],
    queryFn: async () => {
      let q = supabase
        .from("compliance_violations")
        .select(SELECT)
        .eq("restaurant_id", rid!)
        .is("deleted_at", null)
        .order("violation_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      if (filters.from) q = q.gte("violation_date", filters.from);
      if (filters.to) q = q.lte("violation_date", filters.to);
      if (filters.categoryId && filters.categoryId !== "all") q = q.eq("category_id", filters.categoryId);
      if (filters.source && filters.source !== "all") q = q.eq("source", filters.source);
      if (filters.staffId && filters.staffId !== "all") q = q.eq("responsible_staff_id", filters.staffId);
      if (filters.municipalityOnly) q = q.eq("is_municipality_fine", true);
      if (filters.status && filters.status !== "all") {
        if (filters.status === "open") q = q.not("status", "in", "(closed,cancelled)");
        else if (filters.status === "overdue") q = q.eq("is_overdue", true).not("status", "in", "(closed,cancelled)");
        else q = q.eq("status", filters.status);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ComplianceViolation[];
    },
    enabled: !!rid,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["compliance-violations"] });
    qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
    qc.invalidateQueries({ queryKey: ["compliance-timeline"] });
  };

  const saveViolation = useMutation({
    mutationFn: async (input: Partial<ComplianceViolation> & { branch_id: string }) => {
      const payload: Record<string, unknown> = { ...input, restaurant_id: rid! };
      delete payload.branch;
      delete payload.category;
      delete payload.violation_type;
      delete payload.responsible_staff;
      delete payload.supervisor_staff;
      if (input.id) {
        const { error } = await supabase
          .from("compliance_violations")
          .update(payload as never)
          .eq("id", input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from("compliance_violations")
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Violation saved");
    },
    onError: (e: Error) => toast.error("Could not save violation", { description: e.message }),
  });

  const changeStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      comment,
    }: {
      id: string;
      status: ComplianceStatus;
      comment?: string;
    }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "completed") patch.corrective_action_completed_at = new Date().toISOString();
      if (status === "verified") patch.verified_at = new Date().toISOString();
      if (status === "closed") patch.is_overdue = false;
      if (comment) patch.notes = comment;
      const { error } = await supabase.from("compliance_violations").update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Status updated");
    },
    onError: (e: Error) => toast.error("Could not update status", { description: e.message }),
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("compliance_violations")
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Violation removed");
    },
    onError: (e: Error) => toast.error("Could not remove violation", { description: e.message }),
  });

  return {
    violations: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    saveViolation,
    changeStatus,
    softDelete,
  };
}

export function useViolationTimeline(violationId?: string | null) {
  return useQuery({
    queryKey: ["compliance-timeline", violationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_action_events")
        .select("*")
        .eq("violation_id", violationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!violationId,
  });
}

export interface RepeatInfo {
  occurrences: number;
  last_occurrence: string | null;
  recommended_action: string | null;
}

export function useRepeatInfo(violationId?: string | null) {
  return useQuery({
    queryKey: ["compliance-repeat", violationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("compliance_repeat_info", {
        _violation_id: violationId!,
      });
      if (error) throw error;
      const row = (data as RepeatInfo[] | null)?.[0];
      return row ?? { occurrences: 0, last_occurrence: null, recommended_action: null };
    },
    enabled: !!violationId,
  });
}