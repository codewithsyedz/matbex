import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ReceiptTemplatePreset =
  | "simple"
  | "tax_invoice"
  | "detailed"
  | "saudi_bilingual"
  | "zatca_standard";

export type ReceiptTemplateLanguage = "en" | "ar" | "bilingual";

export interface ReceiptTemplateOptions {
  showLogo?: boolean;
  showCashier?: boolean;
  showCustomer?: boolean;
  showOrderType?: boolean;
  showItemNotes?: boolean;
  showQR?: boolean;
  showVat?: boolean;
  showBranchName?: boolean;
  showBuyerBlock?: boolean;
}

export interface ReceiptTemplate {
  id: string;
  tenant_id: string;
  restaurant_id: string | null;
  name: string;
  preset: ReceiptTemplatePreset;
  language: ReceiptTemplateLanguage;
  paper_width: 58 | 80;
  options: ReceiptTemplateOptions;
  header_note_en: string | null;
  header_note_ar: string | null;
  footer_note_en: string | null;
  footer_note_ar: string | null;
  is_default_simplified: boolean;
  is_default_standard: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ReceiptTemplateInput = Omit<
  ReceiptTemplate,
  "id" | "tenant_id" | "deleted_at" | "created_at" | "updated_at"
>;

// Cast: types.ts is regenerated post-migration; use untyped client here.
 
export function useReceiptTemplates() {
  const auth = useAuth() as {
    restaurant?: { id?: string; tenant_id?: string } | null;
    profile?: { tenant_id?: string | null } | null;
    tenant?: { id?: string | null } | null;
  };
  const tid =
    auth.profile?.tenant_id ??
    auth.tenant?.id ??
    auth.restaurant?.tenant_id ??
    null;
  const restaurant = auth.restaurant ?? null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["receipt-templates", tid],
    queryFn: async (): Promise<ReceiptTemplate[]> => {
      if (!tid) return [];
      const { data, error } = await db
        .from("receipt_templates")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReceiptTemplate[];
    },
    enabled: !!tid,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["receipt-templates", tid] });

  const createMut = useMutation({
    mutationFn: async (input: ReceiptTemplateInput) => {
      if (!tid) throw new Error("No tenant");
      const payload = {
        ...input,
        tenant_id: tid,
        restaurant_id: input.restaurant_id ?? restaurant?.id ?? null,
      };
      const { error } = await db.from("receipt_templates").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template created");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Create failed"),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ReceiptTemplateInput> }) => {
      const { error } = await db.from("receipt_templates").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete to match project convention
      const { error } = await db
        .from("receipt_templates")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Delete failed"),
  });

  const setDefaultMut = useMutation({
    mutationFn: async ({
      id,
      kind,
    }: {
      id: string;
      kind: "simplified" | "standard";
    }) => {
      if (!tid) throw new Error("No tenant");
      const col =
        kind === "simplified" ? "is_default_simplified" : "is_default_standard";
      // Clear other defaults first, then set this one
      await db.from("receipt_templates").update({ [col]: false }).eq("tenant_id", tid);
      const { error } = await db.from("receipt_templates").update({ [col]: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Default updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  const templates = (data ?? []) as ReceiptTemplate[];
  return {
    templates,
    isLoading,
    defaultSimplified: templates.find((t) => t.is_default_simplified) ?? null,
    defaultStandard: templates.find((t) => t.is_default_standard) ?? null,
    createTemplate: createMut.mutate,
    updateTemplate: updateMut.mutate,
    deleteTemplate: deleteMut.mutate,
    setDefault: setDefaultMut.mutate,
    isMutating:
      createMut.isPending ||
      updateMut.isPending ||
      deleteMut.isPending ||
      setDefaultMut.isPending,
  };
}

/** Picks the right template for a sale at print time. */
export function pickTemplateForInvoice(
  templates: ReceiptTemplate[],
  subtype: "SIMPLIFIED" | "STANDARD" | null | undefined,
): ReceiptTemplate | null {
  if (subtype === "STANDARD") {
    return (
      templates.find((t) => t.is_default_standard) ??
      templates.find((t) => t.preset === "zatca_standard") ??
      null
    );
  }
  return (
    templates.find((t) => t.is_default_simplified) ??
    templates.find(
      (t) => t.preset === "saudi_bilingual" || t.preset === "tax_invoice",
    ) ??
    null
  );
}