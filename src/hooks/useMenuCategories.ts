import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MenuCategory {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  branch_id: string | null;
  key: string;
  name_en: string;
  name_ar: string | null;
  color: string | null;
  display_order: number;
  is_active: boolean;
}

export const CATEGORY_COLORS = [
  "blue",
  "amber",
  "pink",
  "cyan",
  "green",
  "violet",
  "orange",
  "rose",
  "slate",
] as const;

const COLOR_CLASSES: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  amber: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  pink: "bg-pink-500/10 text-pink-600 border-pink-500/20",
  cyan: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  green: "bg-green-500/10 text-green-600 border-green-500/20",
  violet: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  orange: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  rose: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  slate: "bg-slate-500/10 text-slate-600 border-slate-500/20",
};

export function categoryColorClass(color?: string | null) {
  return COLOR_CLASSES[color || ""] || "bg-muted text-muted-foreground border-border";
}

/** Turn a free-text name into a stable storage key. */
export function slugifyCategoryKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * Menu categories for the restaurant, resolved tenant-wide first and then
 * overridden/extended per branch. A branch row with the same `key` as a
 * tenant-wide row wins for that branch (localised name / colour / order).
 *
 * Pass branchId = null to get only the shared (tenant-wide) categories.
 */
export function useMenuCategories(branchId?: string | null) {
  const { restaurant } = useAuth();
  const { i18n } = useTranslation();
  const isArabic = (i18n.language || "en").startsWith("ar");

  const query = useQuery({
    queryKey: ["menu-categories", restaurant?.id],
    enabled: !!restaurant?.id,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("display_order", { ascending: true })
        .order("name_en", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as MenuCategory[];
    },
  });

  const all = query.data || [];
  const tenantWide = all.filter((c) => !c.branch_id);
  const branchScoped = branchId ? all.filter((c) => c.branch_id === branchId) : [];

  const merged = new Map<string, MenuCategory>();
  tenantWide.forEach((c) => merged.set(c.key, c));
  branchScoped.forEach((c) => merged.set(c.key, c));

  const categories = Array.from(merged.values())
    .filter((c) => c.is_active)
    .sort((a, b) => a.display_order - b.display_order || a.name_en.localeCompare(b.name_en));

  const labelOf = (key: string) => {
    const c = merged.get(key);
    if (!c) return key;
    return (isArabic && c.name_ar) || c.name_en;
  };

  const colorOf = (key: string) => categoryColorClass(merged.get(key)?.color);

  return {
    ...query,
    allCategories: all,
    categories,
    labelOf,
    colorOf,
    isArabic,
  };
}