import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toCdnUrl } from "@/lib/imageCdn";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { STORES, getAll, put } from "@/lib/offline/db";
import { isOnline } from "@/lib/offline/connectivity";

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  quarter_price: number;
  half_price: number;
  full_price: number;
  is_active: boolean;
  image_url?: string | null;
}

export function useMenuItems() {
  const { restaurant } = useAuth();
  const restaurantId = restaurant?.id;
  const { activeBranchId, isAllBranches } = useBranch();
  const branchId = isAllBranches ? null : activeBranchId;

  const { data: menuItems, isLoading, error } = useQuery({
    queryKey: ["menu-items-public", restaurantId, branchId ?? "all"],
    queryFn: async () => {
      if (!restaurantId) return [];

      // Read-through cache: if offline (or network fails), serve the last
      // hydrated snapshot from IndexedDB so POS keeps rendering.
      const fromCache = async (): Promise<MenuItem[]> => {
        try {
          const rows = await getAll<{ id: string; data: any }>(STORES.cacheMenu);
          return rows
            .map((r) => r.data as MenuItem)
            .filter((r) => r && r.is_active)
            .sort((a, b) =>
              (a.category || "").localeCompare(b.category || "") ||
              (a.name || "").localeCompare(b.name || ""),
            );
        } catch {
          return [];
        }
      };

      let items: MenuItem[];
      if (!isOnline()) {
        items = await fromCache();
      } else {
        const { data, error } = await supabase
          .from("menu_items")
          .select("id, name, category, selling_price, quarter_price, half_price, full_price, is_active, image_url, updated_at")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .order("category")
          .order("name");
        if (error) {
          // Network hiccup — fall back to cache instead of failing the render.
          items = await fromCache();
        } else {
          items = (data || []) as MenuItem[];
          // Write-through: refresh the offline cache with the latest snapshot.
          void Promise.all(
            (data || []).map((r: any) =>
              put(STORES.cacheMenu, { id: r.id, updated_at: r.updated_at, data: r }),
            ),
          ).catch(() => {});
        }
      }

      if (!branchId) return items;
      const { data: avail } = await supabase
        .from("menu_item_branch_availability" as any)
        .select("menu_item_id, is_available")
        .eq("branch_id", branchId);
      const hidden = new Set(
        ((avail as any[]) || [])
          .filter((a) => a.is_available === false)
          .map((a) => a.menu_item_id as string)
      );
      return items.filter((i) => !hidden.has(i.id));
    },
    enabled: !!restaurantId,
  });

  // Normalize storage image URLs to the CDN host so neither admin nor public
  // pages leak the raw backend storage origin.
  const normalized = (menuItems || []).map((i) => ({
    ...i,
    image_url: toCdnUrl(i.image_url),
  }));

  // Group items by category
  const groupedItems = normalized.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>) || {};

  const categories = Object.keys(groupedItems);

  return {
    menuItems: normalized,
    groupedItems,
    categories,
    isLoading,
    error,
  };
}
