import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface VarianceNoteTemplate {
  id: string;
  tenant_id: string;
  restaurant_id: string | null;
  created_by: string | null;
  label: string;
  body: string;
  reason: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateInput {
  label: string;
  body: string;
  reason?: string | null;
  sort_order?: number;
}

export function useVarianceNoteTemplates() {
  const { user, tenant, restaurant } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["variance-note-templates", tenant?.id, restaurant?.id],
    queryFn: async (): Promise<VarianceNoteTemplate[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabase
        .from("variance_note_templates")
        .select("*")
        .eq("tenant_id", tenant.id)
        .or(`restaurant_id.eq.${restaurant?.id ?? "00000000-0000-0000-0000-000000000000"},restaurant_id.is.null`)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as VarianceNoteTemplate[];
    },
    enabled: !!tenant?.id,
  });

  const create = useMutation({
    mutationFn: async (input: TemplateInput) => {
      if (!tenant?.id) throw new Error("No tenant");
      const { error } = await supabase.from("variance_note_templates").insert({
        tenant_id: tenant.id,
        restaurant_id: restaurant?.id ?? null,
        created_by: user?.id ?? null,
        label: input.label.trim(),
        body: input.body,
        reason: input.reason ?? null,
        sort_order: input.sort_order ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variance-note-templates"] });
      toast.success("Template saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TemplateInput> }) => {
      const { error } = await supabase
        .from("variance_note_templates")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variance-note-templates"] });
      toast.success("Template updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("variance_note_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variance-note-templates"] });
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    templates: query.data ?? [],
    isLoading: query.isLoading,
    create,
    update,
    remove,
  };
}

/** Replace {variance}, {abs_variance}, {direction}, {date} in template body. */
export function renderTemplateBody(
  body: string,
  ctx: { variance: number; formatCurrency: (n: number) => string; businessDate?: string }
) {
  const direction = ctx.variance >= 0 ? "over" : "short";
  return body
    .replace(/\{variance\}/g, ctx.formatCurrency(ctx.variance))
    .replace(/\{abs_variance\}/g, ctx.formatCurrency(Math.abs(ctx.variance)))
    .replace(/\{direction\}/g, direction)
    .replace(/\{date\}/g, ctx.businessDate ?? "");
}