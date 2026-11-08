import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { FineStatus } from "@/hooks/useEmployeeFines";

export interface FineHistoryFilters {
  staffId?: string;
  branchId?: string;
  department?: string;
  violationTypeId?: string;
  status?: FineStatus | "all";
  from?: string;
  to?: string;
  payrollMonth?: string;
  search?: string;
}

export interface FineHistoryRow {
  id: string;
  fine_number: string | null;
  branch_id: string | null;
  staff_id: string;
  violation_date: string;
  payroll_month: string;
  description: string | null;
  attendance_reference: string | null;
  amount: number;
  original_amount: number | null;
  status: FineStatus;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  applied_payroll_id: string | null;
  applied_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  staff?: { id: string; name: string; role: string; branch_id: string | null } | null;
  violation_type?: { id: string; name_en: string } | null;
  createdByName?: string;
  reviewedByName?: string;
  approvedByName?: string;
}

/** Full fines & deductions history with audit provenance (no branch-context coupling). */
export function useFinesHistory(filters: FineHistoryFilters) {
  const { restaurant } = useAuth();

  return useQuery({
    queryKey: ["fines-history", restaurant?.id, filters],
    queryFn: async () => {
      let q = supabase
        .from("employee_fines")
        .select(
          "*, staff:staff_id(id,name,role,branch_id), violation_type:violation_type_id(id,name_en)"
        )
        .eq("restaurant_id", restaurant!.id)
        .is("deleted_at", null)
        .order("violation_date", { ascending: false });

      if (filters.staffId) q = q.eq("staff_id", filters.staffId);
      if (filters.branchId) q = q.eq("branch_id", filters.branchId);
      if (filters.violationTypeId) q = q.eq("violation_type_id", filters.violationTypeId);
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.from) q = q.gte("violation_date", filters.from);
      if (filters.to) q = q.lte("violation_date", filters.to);
      if (filters.payrollMonth) q = q.eq("payroll_month", filters.payrollMonth);

      const { data, error } = await q;
      if (error) throw error;

      let rows = (data ?? []) as unknown as FineHistoryRow[];

      if (filters.department) {
        rows = rows.filter((r) => r.staff?.role === filters.department);
      }
      if (filters.search) {
        const s = filters.search.toLowerCase();
        rows = rows.filter(
          (r) =>
            (r.fine_number ?? "").toLowerCase().includes(s) ||
            (r.description ?? "").toLowerCase().includes(s) ||
            (r.staff?.name ?? "").toLowerCase().includes(s)
        );
      }

      // Resolve audit actor names.
      const ids = Array.from(
        new Set(
          rows.flatMap((r) => [r.created_by, r.reviewed_by, r.approved_by].filter(Boolean) as string[])
        )
      );
      if (ids.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        const map = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? "—"]));
        rows = rows.map((r) => ({
          ...r,
          createdByName: map.get(r.created_by) ?? "—",
          reviewedByName: r.reviewed_by ? map.get(r.reviewed_by) ?? "—" : undefined,
          approvedByName: r.approved_by ? map.get(r.approved_by) ?? "—" : undefined,
        }));
      }

      return rows;
    },
    enabled: !!restaurant?.id,
  });
}
