import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ComplianceCategory {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  code: string;
  name_en: string;
  name_ar: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface ComplianceType {
  id: string;
  restaurant_id: string;
  category_id: string;
  branch_id: string | null;
  name_en: string;
  name_ar: string | null;
  severity: string;
  default_correction_days: number;
  requires_evidence: boolean;
  default_fine_amount: number;
  is_active: boolean;
  sort_order: number;
}

export interface EscalationRule {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  occurrence_count: number;
  action_label: string;
  notes: string | null;
  is_active: boolean;
}

export interface ComplianceSettings {
  id: string;
  restaurant_id: string;
  repeat_lookback_days: number;
  default_correction_days: number;
  weight_cleanliness: number;
  weight_food_safety: number;
  weight_employee_sop: number;
  weight_checklists: number;
  notify_roles: string[];
}

export function useComplianceConfig() {
  const { restaurant } = useAuth();
  const qc = useQueryClient();
  const rid = restaurant?.id;

  const settings = useQuery({
    queryKey: ["compliance-settings", rid],
    queryFn: async () => {
      const { data, error } = await db
        .from("compliance_settings")
        .select("*")
        .eq("restaurant_id", rid!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ComplianceSettings | null;
    },
    enabled: !!rid,
  });

  const categories = useQuery({
    queryKey: ["compliance-categories", rid],
    queryFn: async () => {
      const { data, error } = await db
        .from("compliance_violation_categories")
        .select("*")
        .eq("restaurant_id", rid!)
        .is("deleted_at", null)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as ComplianceCategory[];
    },
    enabled: !!rid,
  });

  const types = useQuery({
    queryKey: ["compliance-types", rid],
    queryFn: async () => {
      const { data, error } = await db
        .from("compliance_violation_types")
        .select("*")
        .eq("restaurant_id", rid!)
        .is("deleted_at", null)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as ComplianceType[];
    },
    enabled: !!rid,
  });

  const escalationRules = useQuery({
    queryKey: ["compliance-escalation", rid],
    queryFn: async () => {
      const { data, error } = await db
        .from("compliance_escalation_rules")
        .select("*")
        .eq("restaurant_id", rid!)
        .order("occurrence_count");
      if (error) throw error;
      return (data ?? []) as EscalationRule[];
    },
    enabled: !!rid,
  });

  const invalidate = () => {
    ["compliance-settings", "compliance-categories", "compliance-types", "compliance-escalation"].forEach(
      (k) => qc.invalidateQueries({ queryKey: [k] }),
    );
  };

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("seed_compliance_defaults", {
        _restaurant_id: rid!,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Default compliance configuration installed");
    },
    onError: (e: Error) => toast.error("Could not install defaults", { description: e.message }),
  });

  const saveSettings = useMutation({
    mutationFn: async (input: Partial<ComplianceSettings>) => {
      const { error } = await db
        .from("compliance_settings")
        .upsert({ ...input, restaurant_id: rid! } as never, { onConflict: "restaurant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Compliance settings saved");
    },
    onError: (e: Error) => toast.error("Could not save settings", { description: e.message }),
  });

  const saveType = useMutation({
    mutationFn: async (input: Partial<ComplianceType> & { category_id: string; name_en: string }) => {
      const payload = { ...input, restaurant_id: rid! };
      const { error } = input.id
        ? await db.from("compliance_violation_types").update(payload as never).eq("id", input.id)
        : await db.from("compliance_violation_types").insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Violation type saved");
    },
    onError: (e: Error) => toast.error("Could not save violation type", { description: e.message }),
  });

  const saveCategory = useMutation({
    mutationFn: async (input: Partial<ComplianceCategory> & { name_en: string; code: string }) => {
      const payload = { ...input, restaurant_id: rid! };
      const { error } = input.id
        ? await db.from("compliance_violation_categories").update(payload as never).eq("id", input.id)
        : await db.from("compliance_violation_categories").insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Category saved");
    },
    onError: (e: Error) => toast.error("Could not save category", { description: e.message }),
  });

  const saveEscalationRule = useMutation({
    mutationFn: async (input: Partial<EscalationRule> & { occurrence_count: number; action_label: string }) => {
      const payload = { ...input, restaurant_id: rid! };
      const { error } = input.id
        ? await db.from("compliance_escalation_rules").update(payload as never).eq("id", input.id)
        : await db.from("compliance_escalation_rules").insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Escalation rule saved");
    },
    onError: (e: Error) => toast.error("Could not save rule", { description: e.message }),
  });

  const deleteEscalationRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("compliance_escalation_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Rule removed");
    },
    onError: (e: Error) => toast.error("Could not remove rule", { description: e.message }),
  });

  return {
    settings: settings.data ?? null,
    categories: categories.data ?? [],
    types: types.data ?? [],
    escalationRules: escalationRules.data ?? [],
    isLoading:
      settings.isLoading || categories.isLoading || types.isLoading || escalationRules.isLoading,
    isSeeded: (categories.data ?? []).length > 0,
    seedDefaults,
    saveSettings,
    saveType,
    saveCategory,
    saveEscalationRule,
    deleteEscalationRule,
  };
}