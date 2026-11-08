import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Per-branch menu item category assignments.
 *
 * A menu item lives in `menu_items.category` tenant-wide. When an item is
 * "moved" to a different category while a specific branch is selected, we
 * store a branch-scoped override here instead of touching the master record,
 * so every other branch keeps the original category.
 */
export function useBranchItemCategories(branchId?: string | null) {
  const { restaurant } = useAuth();

  const query = useQuery({
    queryKey: ["menu-item-branch-categories", restaurant?.id, branchId],
    enabled: !!restaurant?.id && !!branchId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_item_branch_categories" as any)
        .select("menu_item_id, category, display_order")
        .eq("restaurant_id", restaurant!.id)
        .eq("branch_id", branchId!);
      if (error) throw error;
      const map: Record<string, string> = {};
      const order: Record<string, number> = {};
      ((data as any[]) || []).forEach((r) => {
        map[r.menu_item_id] = r.category;
        if (typeof r.display_order === "number") order[r.menu_item_id] = r.display_order;
      });
      return { map, order };
    },
  });

  const categoryMap = query.data?.map || {};
  const orderMap = query.data?.order || {};

  /** Resolve the category an item belongs to for this branch. */
  const categoryFor = (item: { id: string; category: string }) =>
    categoryMap[item.id] ?? item.category;

  /** Resolve the position an item occupies inside its category for this branch. */
  const orderFor = (item: { id: string; display_order?: number | null }) =>
    orderMap[item.id] ?? item.display_order ?? 0;

  return { ...query, categoryMap, orderMap, categoryFor, orderFor };
}

/** Upsert a branch-specific category, or clear it when it matches the master. */
export async function setBranchItemCategory(params: {
  restaurantId: string;
  branchId: string;
  menuItemId: string;
  category: string;
  masterCategory: string;
  displayOrder?: number;
}) {
  const { restaurantId, branchId, menuItemId, category, masterCategory, displayOrder } = params;

  if (category === masterCategory) {
    const { error } = await supabase
      .from("menu_item_branch_categories" as any)
      .delete()
      .eq("branch_id", branchId)
      .eq("menu_item_id", menuItemId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("menu_item_branch_categories" as any)
    .upsert(
      {
        restaurant_id: restaurantId,
        branch_id: branchId,
        menu_item_id: menuItemId,
        category,
        ...(displayOrder !== undefined ? { display_order: displayOrder } : {}),
      },
      { onConflict: "branch_id,menu_item_id" },
    );
  if (error) throw error;
}

/**
 * Next free slot at the end of a category, so a dropped item lands in a
 * predictable position instead of being re-sorted alphabetically.
 */
export function nextOrderInCategory(
  items: { id: string; category: string; display_order?: number | null }[],
  category: string,
  resolveCategory: (i: any) => string,
  resolveOrder: (i: any) => number,
) {
  const orders = items.filter((i) => resolveCategory(i) === category).map((i) => resolveOrder(i));
  return orders.length ? Math.max(...orders) + 1 : 1;
}
