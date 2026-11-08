import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { toast } from "sonner";

export type ChecklistKind = "opening" | "during_shift" | "closing";

export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  opening: "Opening",
  during_shift: "During shift",
  closing: "Closing",
};

export interface ChecklistTemplate {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  kind: ChecklistKind;
  name: string;
  is_active: boolean;
}

export interface ChecklistItem {
  id: string;
  template_id: string;
  label_en: string;
  label_ar: string | null;
  requires_photo: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface ChecklistRun {
  id: string;
  restaurant_id: string;
  branch_id: string;
  template_id: string;
  run_date: string;
  shift_id: string | null;
  completed_by: string | null;
  completed_by_staff_id: string | null;
  completed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comments: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_signature: string | null;
  approval_comments: string | null;
}

export interface ChecklistRunItem {
  id: string;
  run_id: string;
  item_id: string;
  is_checked: boolean;
  note: string | null;
  photo_path: string | null;
  checked_at: string | null;
}

export function useChecklistTemplates() {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();

  const templates = useQuery({
    queryKey: ["checklist-templates", restaurant?.id, activeBranchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_checklist_templates")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("kind");
      if (error) throw error;
      const rows = (data ?? []) as ChecklistTemplate[];
      // Branch-specific template wins over the tenant-wide default.
      const byKind = new Map<ChecklistKind, ChecklistTemplate>();
      for (const t of rows) {
        const current = byKind.get(t.kind);
        if (!current || (t.branch_id && t.branch_id === activeBranchId)) byKind.set(t.kind, t);
      }
      return Array.from(byKind.values());
    },
    enabled: !!restaurant?.id,
  });

  const items = useQuery({
    queryKey: ["checklist-items", restaurant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_checklist_items")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
    enabled: !!restaurant?.id,
  });

  return {
    templates: templates.data ?? [],
    items: items.data ?? [],
    isLoading: templates.isLoading || items.isLoading,
  };
}

export function useChecklistRun(templateId: string | null, runDate: string) {
  const { restaurant, user } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();

  const run = useQuery({
    queryKey: ["checklist-run", templateId, runDate, activeBranchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_checklist_runs")
        .select("*")
        .eq("template_id", templateId!)
        .eq("run_date", runDate)
        .eq("branch_id", activeBranchId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ChecklistRun | null;
    },
    enabled: !!templateId && !!activeBranchId,
  });

  const runItems = useQuery({
    queryKey: ["checklist-run-items", run.data?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_checklist_run_items")
        .select("*")
        .eq("run_id", run.data!.id);
      if (error) throw error;
      return (data ?? []) as ChecklistRunItem[];
    },
    enabled: !!run.data?.id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["checklist-run"] });
    qc.invalidateQueries({ queryKey: ["checklist-run-items"] });
    qc.invalidateQueries({ queryKey: ["checklist-runs-summary"] });
    qc.invalidateQueries({ queryKey: ["compliance-dashboard"] });
  };

  const ensureRun = async () => {
    if (run.data?.id) return run.data.id;
    const { data, error } = await supabase
      .from("compliance_checklist_runs")
      .insert({
        restaurant_id: restaurant!.id,
        branch_id: activeBranchId!,
        template_id: templateId!,
        run_date: runDate,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  };

  const toggleItem = useMutation({
    mutationFn: async ({ itemId, checked, note }: { itemId: string; checked: boolean; note?: string }) => {
      const runId = await ensureRun();
      const { error } = await supabase.from("compliance_checklist_run_items").upsert(
        {
          restaurant_id: restaurant!.id,
          run_id: runId,
          item_id: itemId,
          is_checked: checked,
          note: note ?? null,
          checked_by: checked ? user?.id ?? null : null,
          checked_at: checked ? new Date().toISOString() : null,
        } as never,
        { onConflict: "run_id,item_id" },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Could not update checklist", { description: e.message }),
  });

  const markCompleted = useMutation({
    mutationFn: async (staffId?: string | null) => {
      const runId = await ensureRun();
      const { error } = await supabase
        .from("compliance_checklist_runs")
        .update({
          completed_by: user?.id ?? null,
          completed_by_staff_id: staffId ?? null,
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Checklist submitted for review");
    },
    onError: (e: Error) => toast.error("Could not submit checklist", { description: e.message }),
  });

  const markReviewed = useMutation({
    mutationFn: async (comments: string) => {
      const runId = await ensureRun();
      const { error } = await supabase
        .from("compliance_checklist_runs")
        .update({
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
          review_comments: comments || null,
        } as never)
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Supervisor review recorded");
    },
    onError: (e: Error) => toast.error("Could not record review", { description: e.message }),
  });

  const approve = useMutation({
    mutationFn: async ({ signature, comments }: { signature: string; comments: string }) => {
      const runId = await ensureRun();
      const { error } = await supabase
        .from("compliance_checklist_runs")
        .update({
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
          approval_signature: signature,
          approval_comments: comments || null,
        } as never)
        .eq("id", runId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Checklist approved and locked");
    },
    onError: (e: Error) => toast.error("Could not approve checklist", { description: e.message }),
  });

  return {
    run: run.data ?? null,
    runItems: runItems.data ?? [],
    isLoading: run.isLoading,
    toggleItem,
    markCompleted,
    markReviewed,
    approve,
  };
}

export function useChecklistCompletion(from: string, to: string) {
  const { restaurant } = useAuth();
  const { activeBranchId } = useBranch();

  return useQuery({
    queryKey: ["checklist-runs-summary", restaurant?.id, activeBranchId, from, to],
    queryFn: async () => {
      let q = supabase
        .from("compliance_checklist_runs")
        .select("id, branch_id, template_id, run_date, completed_at, reviewed_at, approved_at")
        .eq("restaurant_id", restaurant!.id)
        .gte("run_date", from)
        .lte("run_date", to)
        .order("run_date", { ascending: false });
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Pick<
        ChecklistRun,
        "id" | "branch_id" | "template_id" | "run_date" | "completed_at" | "reviewed_at" | "approved_at"
      >[];
    },
    enabled: !!restaurant?.id,
  });
}