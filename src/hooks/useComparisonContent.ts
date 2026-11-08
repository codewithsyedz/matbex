import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type ComparisonCellValue = boolean | "addon" | string;

export interface ComparisonSettings {
  id: string;
  eyebrow: string;
  eyebrow_ar: string | null;
  headline_prefix: string;
  headline_prefix_ar: string | null;
  headline_bold: string;
  headline_bold_ar: string | null;
  subtitle: string;
  subtitle_ar: string | null;
  footnote: string;
  footnote_ar: string | null;
  is_active: boolean;
}

export interface ComparisonColumn {
  id: string;
  column_key: string;
  name: string;
  name_ar: string | null;
  sublabel: string | null;
  sublabel_ar: string | null;
  is_highlighted: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface ComparisonRow {
  id: string;
  label: string;
  label_ar: string | null;
  cells: Record<string, ComparisonCellValue>;
  is_footer: boolean;
  sort_order: number;
  is_active: boolean;
}

export const useComparisonContent = () => {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["landing-comparison-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_comparison_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ComparisonSettings | null;
    },
  });

  const { data: columns = [], isLoading: columnsLoading } = useQuery({
    queryKey: ["landing-comparison-columns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_comparison_columns")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as ComparisonColumn[];
    },
  });

  const { data: rows = [], isLoading: rowsLoading } = useQuery({
    queryKey: ["landing-comparison-rows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_comparison_rows")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data as any[]).map((r) => ({
        ...r,
        cells: typeof r.cells === "object" && r.cells !== null ? r.cells : {},
      })) as ComparisonRow[];
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: Partial<ComparisonSettings>) => {
      if (!settings?.id) throw new Error("Settings not initialized");
      const { error } = await supabase
        .from("landing_comparison_settings")
        .update(updates)
        .eq("id", settings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-comparison-settings"] });
      toast({ title: "Comparison settings updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateColumn = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ComparisonColumn> & { id: string }) => {
      const { error } = await supabase.from("landing_comparison_columns").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-comparison-columns"] });
      toast({ title: "Column updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createColumn = useMutation({
    mutationFn: async (col: Omit<ComparisonColumn, "id">) => {
      const { error } = await supabase.from("landing_comparison_columns").insert(col);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-comparison-columns"] });
      toast({ title: "Column added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteColumn = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("landing_comparison_columns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-comparison-columns"] });
      toast({ title: "Column deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateRow = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ComparisonRow> & { id: string }) => {
      const { error } = await supabase.from("landing_comparison_rows").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-comparison-rows"] });
      toast({ title: "Row updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createRow = useMutation({
    mutationFn: async (row: Omit<ComparisonRow, "id">) => {
      const { error } = await supabase.from("landing_comparison_rows").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-comparison-rows"] });
      toast({ title: "Row added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteRow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("landing_comparison_rows").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-comparison-rows"] });
      toast({ title: "Row deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return {
    settings,
    columns,
    rows,
    isLoading: settingsLoading || columnsLoading || rowsLoading,
    updateSettings,
    updateColumn,
    createColumn,
    deleteColumn,
    updateRow,
    createRow,
    deleteRow,
  };
};