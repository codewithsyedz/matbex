import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ToolsSettings {
  id: string;
  eyebrow: string;
  headline: string;
  eyebrow_ar: string | null;
  headline_ar: string | null;
  is_active: boolean;
}

export interface ToolsCategory {
  id: string;
  name: string;
  name_ar: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface ToolsItem {
  id: string;
  category_id: string;
  number: number;
  title: string;
  description: string;
  title_ar: string | null;
  description_ar: string | null;
  preview_type: string;
  sort_order: number;
  is_active: boolean;
}

export const useToolsStackContent = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch settings
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["landing-tools-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_tools_settings")
        .select("*")
        .limit(1)
        .maybeSingle(); // Use maybeSingle to avoid error when no data exists
      if (error) throw error;
      return data as ToolsSettings | null;
    },
  });

  // Fetch categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ["landing-tools-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_tools_categories")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as ToolsCategory[];
    },
  });

  // Fetch items
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["landing-tools-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_tools_items")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as ToolsItem[];
    },
  });

  // Update settings
  const updateSettings = useMutation({
    mutationFn: async (updates: Partial<ToolsSettings>) => {
      if (!settings?.id) throw new Error("Settings not found");
      const { error } = await supabase
        .from("landing_tools_settings")
        .update(updates)
        .eq("id", settings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-tools-settings"] });
      toast({ title: "Tools section settings updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating settings", description: error.message, variant: "destructive" });
    },
  });

  // Update category
  const updateCategory = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ToolsCategory> & { id: string }) => {
      const { error } = await supabase
        .from("landing_tools_categories")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-tools-categories"] });
      toast({ title: "Category updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating category", description: error.message, variant: "destructive" });
    },
  });

  // Create category
  const createCategory = useMutation({
    mutationFn: async (category: Omit<ToolsCategory, "id">) => {
      const { error } = await supabase.from("landing_tools_categories").insert(category);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-tools-categories"] });
      toast({ title: "Category created" });
    },
    onError: (error) => {
      toast({ title: "Error creating category", description: error.message, variant: "destructive" });
    },
  });

  // Delete category
  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("landing_tools_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-tools-categories"] });
      toast({ title: "Category deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting category", description: error.message, variant: "destructive" });
    },
  });

  // Update item
  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ToolsItem> & { id: string }) => {
      const { error } = await supabase
        .from("landing_tools_items")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-tools-items"] });
      toast({ title: "Tool item updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating item", description: error.message, variant: "destructive" });
    },
  });

  // Create item
  const createItem = useMutation({
    mutationFn: async (item: Omit<ToolsItem, "id">) => {
      const { error } = await supabase.from("landing_tools_items").insert(item);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-tools-items"] });
      toast({ title: "Tool item created" });
    },
    onError: (error) => {
      toast({ title: "Error creating item", description: error.message, variant: "destructive" });
    },
  });

  // Delete item
  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("landing_tools_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landing-tools-items"] });
      toast({ title: "Tool item deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting item", description: error.message, variant: "destructive" });
    },
  });

  return {
    settings,
    categories,
    items,
    isLoading: settingsLoading || categoriesLoading || itemsLoading,
    updateSettings,
    updateCategory,
    createCategory,
    deleteCategory,
    updateItem,
    createItem,
    deleteItem,
  };
};
