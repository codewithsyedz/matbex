import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toCdnUrl } from "@/lib/imageCdn";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

export interface LiveMenuItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  selling_price: number;
  quarter_price: number;
  half_price: number;
  full_price: number;
  is_active: boolean;
  is_chefs_special: boolean;
  is_market_price: boolean;
  image_url: string | null;
  nutritional_info: Record<string, unknown> | null;
  allergens: string[] | null;
  dietary_tags: string[] | null;
  is_available: boolean;
}

interface MenuItemAvailability {
  menu_item_id: string;
  is_available: boolean;
  missing_ingredients: { ingredient: string; required: number; available: number }[] | null;
}

export function useLiveMenuItems(restaurantId?: string, branchIdArg?: string | null) {
  const { restaurant } = useAuth();
  const resolvedRestaurantId = restaurantId || restaurant?.id;
  const queryClient = useQueryClient();
  const branchCtx = (() => {
    try { return useBranch(); } catch { return null; }
  })();
  const resolvedBranchId =
    branchIdArg !== undefined
      ? branchIdArg
      : branchCtx && !branchCtx.isAllBranches
      ? branchCtx.activeBranchId
      : null;

  // Fetch menu items with availability
  const { data: menuItems, isLoading, error, refetch } = useQuery({
    queryKey: ["live-menu-items", resolvedRestaurantId, resolvedBranchId ?? "all"],
    queryFn: async () => {
      if (!resolvedRestaurantId) return [];
      
      // Fetch menu items
      const { data: items, error: itemsError } = await db
        .from("menu_items")
        .select(`
          id, name, description, category, selling_price, 
          quarter_price, half_price, full_price, 
          is_active, is_chefs_special, is_market_price, 
          image_url, nutritional_info, allergens, dietary_tags
        `)
        .eq("restaurant_id", resolvedRestaurantId)
        .order("category")
        .order("name");
      
      if (itemsError) throw itemsError;

      // Fetch availability from view
      const { data: availability, error: availError } = await db
        .from("menu_item_availability")
        .select("menu_item_id, is_available, missing_ingredients")
        .eq("restaurant_id", resolvedRestaurantId);

      if (availError) {
        console.warn("Could not fetch availability:", availError);
      }

      const availabilityMap = new Map<string, boolean>();
      (availability || []).forEach((a: MenuItemAvailability) => {
        availabilityMap.set(a.menu_item_id, a.is_available);
      });

      // Per-branch override: hide items explicitly marked unavailable
      // for the active branch.
      let branchHidden = new Set<string>();
      if (resolvedBranchId) {
        const { data: bAvail } = await db
          .from("menu_item_branch_availability" as any)
          .select("menu_item_id, is_available")
          .eq("branch_id", resolvedBranchId);
        branchHidden = new Set(
          ((bAvail as any[]) || [])
            .filter((a) => a.is_available === false)
            .map((a) => a.menu_item_id as string)
        );
      }

      return (items || []).map(item => ({
        ...item,
        image_url: toCdnUrl(item.image_url),
        is_available:
          item.is_active &&
          (availabilityMap.get(item.id) ?? true) &&
          !branchHidden.has(item.id),
      })) as LiveMenuItem[];
    },
    enabled: !!resolvedRestaurantId,
  });

  // Real-time subscription for menu items changes
  useEffect(() => {
    if (!resolvedRestaurantId) return;

    const channel = db
      .channel(`live-menu-${resolvedRestaurantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'menu_items',
          filter: `restaurant_id=eq.${resolvedRestaurantId}`,
        },
        () => {
          // Refetch on any menu item change
          refetch();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'inventory_items',
          filter: `restaurant_id=eq.${resolvedRestaurantId}`,
        },
        () => {
          // Refetch when inventory changes (might affect availability)
          refetch();
        }
      )
      .subscribe();

    return () => {
      db.removeChannel(channel);
    };
  }, [resolvedRestaurantId, refetch]);

  // Group items by category
  const groupedItems = menuItems?.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, LiveMenuItem[]>) || {};

  const categories = Object.keys(groupedItems);

  // Get active items only
  const activeItems = menuItems?.filter(item => item.is_active) || [];
  
  // Get chef's specials
  const chefsSpecials = activeItems.filter(item => item.is_chefs_special);

  // Get sold out items
  const soldOutItems = activeItems.filter(item => !item.is_available);

  return {
    menuItems: menuItems || [],
    activeItems,
    groupedItems,
    categories,
    chefsSpecials,
    soldOutItems,
    isLoading,
    error,
    refetch,
  };
}
