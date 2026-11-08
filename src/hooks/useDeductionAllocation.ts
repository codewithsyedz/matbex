import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

export interface AllocationFineItem {
  kind: "fine";
  id: string;
  label: string;
  amount: number;
  payroll_month: string;
}

export interface DeductionAllocationPreview {
  payroll_id: string;
  staff_id: string;
  branch_id: string | null;
  gross_wage: number;
  max_deduction_pct: number;
  max_deduction: number;
  other_deductions: number;
  advance_recovered: number;
  fines_total: number;
  requested_total: number;
  excess_amount: number;
  requires_allocation: boolean;
  fines: AllocationFineItem[];
}

export type AllocationDecision =
  | { kind: "fine"; id: string; action: "keep" | "defer"; defer_to?: string }
  | { kind: "advance"; amount: number }
  | { kind: "other"; amount: number };

/** Detects "50% rule" excess and lets an authorized user decide what to defer. */
export function useDeductionAllocation(payrollId?: string | null) {
  const queryClient = useQueryClient();

  const preview = useQuery({
    queryKey: ["deduction-allocation-preview", payrollId],
    queryFn: async () => {
      const { data, error } = await db.rpc("preview_payroll_deduction_allocation", {
        p_payroll_id: payrollId!,
      });
      if (error) throw error;
      return data as unknown as DeductionAllocationPreview;
    },
    enabled: !!payrollId,
  });

  const applyAllocation = useMutation({
    mutationFn: async ({
      decisions,
      reason,
    }: {
      decisions: AllocationDecision[];
      reason: string;
    }) => {
      const { data, error } = await db.rpc("apply_payroll_deduction_allocation", {
        p_payroll_id: payrollId!,
        p_decisions: decisions as unknown as never,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["employee-fines"] });
      queryClient.invalidateQueries({ queryKey: ["deduction-allocation-preview"] });
      queryClient.invalidateQueries({ queryKey: ["fine-capacity"] });
      toast.success("Deduction allocation recorded", {
        description: "Deferred items keep their full value and move to a later payroll month.",
      });
    },
    onError: (e: Error) =>
      toast.error("Allocation rejected", { description: parseAllocationError(e.message) }),
  });

  return { preview: preview.data, isLoading: preview.isLoading, applyAllocation };
}

export function parseAllocationError(message: string): string {
  const codes = [
    "DEDUCTION_ALLOCATION_REQUIRED",
    "ALLOCATION_STILL_EXCEEDS",
    "ALLOCATION_REASON_REQUIRED",
    "ALLOCATION_FORBIDDEN",
  ];
  for (const c of codes) {
    if (message.includes(c)) return message.split(`${c}:`)[1]?.trim() || message;
  }
  return message;
}

export function isAllocationRequiredError(message?: string | null) {
  return !!message && message.includes("DEDUCTION_ALLOCATION_REQUIRED");
}
