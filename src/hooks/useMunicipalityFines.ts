import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";

export type MunicipalityFineStatus =
  | "received"
  | "under_review"
  | "appeal_submitted"
  | "confirmed"
  | "paid"
  | "closed";

export const FINE_STATUS_LABELS: Record<MunicipalityFineStatus, string> = {
  received: "Received",
  under_review: "Under review",
  appeal_submitted: "Appeal submitted",
  confirmed: "Confirmed",
  paid: "Paid",
  closed: "Closed",
};

export interface MunicipalityFine {
  id: string;
  restaurant_id: string;
  branch_id: string;
  violation_id: string | null;
  fine_reference: string;
  inspection_date: string | null;
  received_date: string;
  violation_summary: string | null;
  amount: number;
  status: MunicipalityFineStatus;
  due_date: string | null;
  payment_date: string | null;
  payment_reference: string | null;
  document_path: string | null;
  appeal_status: string | null;
  appeal_reference: string | null;
  notes: string | null;
  expense_id: string | null;
  posted_at: string | null;
  created_at: string;
  branch?: { id: string; name: string } | null;
}

export function useMunicipalityFines(range?: { from?: string; to?: string }) {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();
  const rid = restaurant?.id;

  const query = useQuery({
    queryKey: ["municipality-fines", rid, activeBranchId, range],
    queryFn: async () => {
      let q = db
        .from("municipality_fines")
        .select("*, branch:branches(id,name)")
        .eq("restaurant_id", rid!)
        .is("deleted_at", null)
        .order("received_date", { ascending: false });
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      if (range?.from) q = q.gte("received_date", range.from);
      if (range?.to) q = q.lte("received_date", range.to);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as MunicipalityFine[];
    },
    enabled: !!rid,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["municipality-fines"] });
    qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
  };

  const saveFine = useMutation({
    mutationFn: async (input: Partial<MunicipalityFine> & { branch_id: string; fine_reference: string }) => {
      const payload: Record<string, unknown> = { ...input, restaurant_id: rid! };
      delete payload.branch;
      if (input.id) {
        const { error } = await db.from("municipality_fines").update(payload as never).eq("id", input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await db
        .from("municipality_fines")
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Municipality fine saved");
    },
    onError: (e: Error) => toast.error("Could not save fine", { description: e.message }),
  });

  const postToExpense = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await db.rpc("post_municipality_fine_to_expense", { _fine_id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Fine posted to business expenses", {
        description: "It now follows the normal expense approval and payables flow.",
      });
    },
    onError: (e: Error) => toast.error("Could not post fine", { description: e.message }),
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("municipality_fines")
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Fine removed");
    },
    onError: (e: Error) => toast.error("Could not remove fine", { description: e.message }),
  });

  const fines = query.data ?? [];
  const totals = {
    count: fines.length,
    amount: fines.reduce((s, f) => s + Number(f.amount || 0), 0),
    unpaid: fines.filter((f) => f.status !== "paid" && f.status !== "closed")
      .reduce((s, f) => s + Number(f.amount || 0), 0),
    unposted: fines.filter((f) => !f.expense_id).length,
  };

  return { fines, totals, isLoading: query.isLoading, saveFine, postToExpense, softDelete };
}