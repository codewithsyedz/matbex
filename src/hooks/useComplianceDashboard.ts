import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

export interface BranchComplianceScore {
  branch_id: string;
  branch_name: string;
  score: number;
  cleanliness: number;
  food_safety: number;
  employee_sop: number;
  checklists: number;
  open_violations: number;
  overdue_violations: number;
  municipality_fines_total: number;
  internal_violations: number;
  repeat_violations: number;
}

export function useComplianceDashboard(from: string, to: string) {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["compliance-dashboard", restaurant?.id, activeBranchId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("compliance_branch_score", {
        _restaurant_id: restaurant!.id,
        _branch_id: activeBranchId,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return ((data ?? []) as unknown as BranchComplianceScore[]).map((r) => ({
        ...r,
        score: Number(r.score ?? 0),
        cleanliness: Number(r.cleanliness ?? 0),
        food_safety: Number(r.food_safety ?? 0),
        employee_sop: Number(r.employee_sop ?? 0),
        checklists: Number(r.checklists ?? 0),
        municipality_fines_total: Number(r.municipality_fines_total ?? 0),
      }));
    },
    enabled: !!restaurant?.id,
  });
}

export interface EmployeeSopSummary {
  staff_id: string;
  staff_name: string;
  open: number;
  this_month: number;
  previous_month: number;
  repeated: number;
  total: number;
}

export function useEmployeeSopSummary(from: string, to: string) {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["compliance-employee-sop", restaurant?.id, activeBranchId, from, to],
    queryFn: async () => {
      let q = supabase
        .from("compliance_violations")
        .select(
          "id, status, violation_date, violation_type_id, responsible_staff_id, is_municipality_fine, staff:staff!compliance_violations_responsible_staff_id_fkey(id,name)",
        )
        .eq("restaurant_id", restaurant!.id)
        .is("deleted_at", null)
        .not("responsible_staff_id", "is", null)
        .gte("violation_date", from)
        .lte("violation_date", to);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;

      const now = new Date();
      const thisMonth = now.toISOString().slice(0, 7);
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

      const map = new Map<string, EmployeeSopSummary & { types: Record<string, number> }>();
      for (const row of (data ?? []) as never[]) {
        const r = row as {
          status: string;
          violation_date: string;
          violation_type_id: string | null;
          responsible_staff_id: string;
          staff: { id: string; name: string } | null;
        };
        const key = r.responsible_staff_id;
        if (!map.has(key)) {
          map.set(key, {
            staff_id: key,
            staff_name: r.staff?.name ?? "Unknown",
            open: 0,
            this_month: 0,
            previous_month: 0,
            repeated: 0,
            total: 0,
            types: {},
          });
        }
        const e = map.get(key)!;
        e.total += 1;
        if (!["closed", "cancelled"].includes(r.status)) e.open += 1;
        if (r.violation_date.slice(0, 7) === thisMonth) e.this_month += 1;
        if (r.violation_date.slice(0, 7) === prev) e.previous_month += 1;
        if (r.violation_type_id) e.types[r.violation_type_id] = (e.types[r.violation_type_id] ?? 0) + 1;
      }

      return Array.from(map.values())
        .map(({ types, ...rest }) => ({
          ...rest,
          repeated: Object.values(types).filter((c) => c > 1).length,
        }))
        .sort((a, b) => b.total - a.total);
    },
    enabled: !!restaurant?.id,
  });
}