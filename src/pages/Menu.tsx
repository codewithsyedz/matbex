import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useQuota } from "@/hooks/useQuota";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, Image as ImageIcon, UtensilsCrossed, Package, Calculator, Calendar, Layers, QrCode, FileDown, BookOpen, CalendarDays, TrendingUp, TrendingDown, Pencil, Globe, GlobeLock, Tags } from "lucide-react";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { exportToCSV } from "@/lib/exportUtils";
import { toCdnUrl } from "@/lib/imageCdn";
import { downloadKeetaCsv } from "@/lib/keetaMenuExport";
import { downloadJahezMenu } from "@/lib/jahezMenuExport";
import { toast } from "sonner";
import { DailyMenuManager } from "@/components/menu/DailyMenuManager";
import { ComboPackageManager } from "@/components/menu/ComboPackageManager";
import { MenuQRCodes } from "@/components/menu/MenuQRCodes";
import { MenuItemImageUploader } from "@/components/menu/MenuItemImageUploader";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { QuotaInfoCard } from "@/components/quota/QuotaInfoCard";
import { CopyMenuToBranchDialog } from "@/components/menu/CopyMenuToBranchDialog";
import { Copy } from "lucide-react";
import { useBranchPrices, applyBranchPrices } from "@/hooks/useBranchPrices";
import { useMenuCategories } from "@/hooks/useMenuCategories";
import {
  useBranchItemCategories,
  setBranchItemCategory,
  nextOrderInCategory,
} from "@/hooks/useBranchItemCategories";
import { MenuCategoryManager } from "@/components/menu/MenuCategoryManager";

interface MenuItem {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  quarter_price: number;
  half_price: number;
  full_price: number;
  is_active: boolean;
  image_url?: string | null;
  available_online?: boolean;
  print_route?: "kitchen" | "bar" | "none";
}

interface RecipeCost {
  menu_item_id: string;
  total_cost: number;
}

export default function Menu() {
  const { restaurant, tenant, isOwner, hasFeature, loading: authLoading } = useAuth();
  const { t } = useTranslation();
  const { activeBranchId, isAllBranches, activeBranch, hasMultipleBranches, branches } = useBranch();

  // Show locked screen if menu feature is not enabled
  if (!authLoading && !hasFeature("menu")) {
    return (
      <>
        <LockedFeatureScreen 
          featureName="Menu Management" 
          description="Create and manage your menu items, set pricing tiers, and calculate recipe costs with our menu tools."
          featureKey="menu"
        />
      </>
    );
  }

  const { format: formatCurrency } = useCurrency();
  const { usage, quotaLimits } = useQuota();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("master");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [newItem, setNewItem] = useState({ 
    name: "", 
    category: "main", 
    quarter_price: "", 
    half_price: "", 
    full_price: "", 
    hasVariants: false,
    image_url: null as string | null
  });
  const [editHasVariants, setEditHasVariants] = useState(false);
  // "branch" = move the item for the previewed branch only, "all" = master menu.
  const [categoryScope, setCategoryScope] = useState<"branch" | "all">("branch");
  const [isQROpen, setIsQROpen] = useState(false);
  const [isCopyOpen, setIsCopyOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);

  const scopedBranchId = !isAllBranches ? activeBranchId : null;

  // Preview branch: lets the user see per-branch price overrides applied
  // to the master menu without switching the whole app's active branch.
  const [previewBranchId, setPreviewBranchId] = useState<string>("");
  // Fallback chain: explicit preview pick → app's active branch → primary
  // branch → first active branch. Guarantees we always resolve to a real
  // branch so the price map is never silently empty.
  const fallbackBranchId =
    branches.find((b) => b.is_active && b.is_primary)?.id ||
    branches.find((b) => b.is_active)?.id ||
    "";
  const effectivePreviewBranchId = previewBranchId || scopedBranchId || fallbackBranchId;

  // If the previewed branch disappears (deactivated/removed) or the app's
  // active branch changes, drop the stale preview pick so we follow the
  // current branch instead of showing another branch's prices.
  useEffect(() => {
    if (previewBranchId && !branches.some((b) => b.id === previewBranchId && b.is_active)) {
      setPreviewBranchId("");
    }
  }, [branches, previewBranchId]);
  useEffect(() => {
    setPreviewBranchId("");
  }, [scopedBranchId]);

  const { priceMap: previewPriceMap, refetch: refetchPreviewPrices } = useBranchPrices(
    effectivePreviewBranchId || null,
  );

  // Categories: tenant-wide list, overridden per branch for the previewed branch.
  const {
    categories: categoryRows,
    labelOf: categoryLabel,
    colorOf: categoryColor,
  } = useMenuCategories(effectivePreviewBranchId || null);
  const categories = categoryRows.map((c) => c.key);

  // Per-branch category assignments for the previewed branch. Moving an item
  // to another category while a branch is selected only affects that branch.
  const { categoryMap: branchCategoryMap, orderMap: branchOrderMap } =
    useBranchItemCategories(effectivePreviewBranchId || null);
  const categoryOf = (item: MenuItem) => branchCategoryMap[item.id] ?? item.category;
  // Position inside the resolved category. Branch overrides win, otherwise the
  // tenant-wide order stored on the item itself.
  const orderOf = (item: MenuItem) =>
    branchOrderMap[item.id] ?? (item as any).display_order ?? 0;
  const byOrderThenName = (a: MenuItem, b: MenuItem) =>
    orderOf(a) - orderOf(b) || a.name.localeCompare(b.name);

  // Keep the "new item" default on a category that actually exists.
  useEffect(() => {
    if (categories.length && !categories.includes(newItem.category)) {
      setNewItem((p) => ({ ...p, category: categories[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join(",")]);

  // Always pull the newly selected branch's active prices on switch.
  useEffect(() => {
    if (effectivePreviewBranchId) void refetchPreviewPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePreviewBranchId]);

  // Fetch menu items
  const { data: menuItems = [], isLoading } = useQuery({
    queryKey: ["menu-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("category", { ascending: true })
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as MenuItem[];
    },
    enabled: !!restaurant?.id,
  });

  // Per-branch availability overrides for the active branch. Empty when
  // "All branches" is selected.
  const { data: branchAvailability = {} } = useQuery({
    queryKey: ["menu-branch-availability", restaurant?.id, scopedBranchId],
    queryFn: async () => {
      if (!restaurant?.id || !scopedBranchId) return {} as Record<string, boolean>;
      const { data, error } = await supabase
        .from("menu_item_branch_availability" as any)
        .select("menu_item_id, is_available")
        .eq("branch_id", scopedBranchId);
      if (error) return {} as Record<string, boolean>;
      const map: Record<string, boolean> = {};
      ((data as any[]) || []).forEach((r) => {
        map[r.menu_item_id] = r.is_available !== false;
      });
      return map;
    },
    enabled: !!restaurant?.id && !!scopedBranchId,
  });

  const setBranchAvailability = useMutation({
    mutationFn: async ({ menu_item_id, is_available }: { menu_item_id: string; is_available: boolean }) => {
      if (!restaurant?.id || !scopedBranchId) throw new Error("No branch selected");
      const { error } = await supabase
        .from("menu_item_branch_availability" as any)
        .upsert(
          {
            restaurant_id: restaurant.id,
            branch_id: scopedBranchId,
            menu_item_id,
            is_available,
          },
          { onConflict: "branch_id,menu_item_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-branch-availability"] });
      queryClient.invalidateQueries({ queryKey: ["live-menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["menu-items-public"] });
      toast.success("Branch availability updated");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to update availability"),
  });

  // Fetch recipe costs for all menu items
  const { data: recipeCosts = [] } = useQuery({
    queryKey: ["recipe-costs", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("recipe_ingredients")
        .select("menu_item_id, quantity_required, inventory_items(unit_cost)")
        .eq("restaurant_id", restaurant.id);
      if (error) throw error;

      // Calculate total cost per menu item
      const costMap = new Map<string, number>();
      data?.forEach((ing: any) => {
        const cost = Number(ing.quantity_required) * (ing.inventory_items?.unit_cost || 0);
        costMap.set(ing.menu_item_id, (costMap.get(ing.menu_item_id) || 0) + cost);
      });

      return Array.from(costMap.entries()).map(([menu_item_id, total_cost]) => ({
        menu_item_id,
        total_cost,
      })) as RecipeCost[];
    },
    enabled: !!restaurant?.id,
  });

  // Create cost lookup map
  const costLookup = new Map(recipeCosts.map((c) => [c.menu_item_id, c.total_cost]));

  // Add menu item mutation
  const addItemMutation = useMutation({
    mutationFn: async (item: typeof newItem) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const quarterPrice = parseFloat(item.quarter_price) || 0;
      const halfPrice = parseFloat(item.half_price) || 0;
      const fullPrice = parseFloat(item.full_price) || 0;
      const { error } = await supabase.from("menu_items").insert({
        restaurant_id: restaurant.id,
        name: item.name,
        category: item.category,
        quarter_price: quarterPrice,
        half_price: halfPrice,
        full_price: fullPrice,
        selling_price: fullPrice,
        image_url: item.image_url,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      setIsAddOpen(false);
      setNewItem({ name: "", category: "main", quarter_price: "", half_price: "", full_price: "", hasVariants: false, image_url: null });
      toast.success("Menu item added");
    },
    onError: () => toast.error("Failed to add item"),
  });

  // Update menu item mutation
  const updateItemMutation = useMutation({
    mutationFn: async ({ item, scope }: { item: MenuItem; scope: "branch" | "all" }) => {
      const master = menuItems.find((m) => m.id === item.id);
      const masterCategory = master?.category ?? item.category;
      const branchScoped = scope === "branch" && !!effectivePreviewBranchId;

      const { error } = await supabase
        .from("menu_items")
        .update({
          name: item.name,
          category: branchScoped ? masterCategory : item.category,
          quarter_price: item.quarter_price,
          half_price: item.half_price,
          full_price: item.full_price,
          selling_price: item.full_price,
          is_active: item.is_active,
          image_url: item.image_url,
          print_route: item.print_route ?? "kitchen",
        })
        .eq("id", item.id);
      if (error) throw error;

      if (branchScoped && restaurant?.id) {
        await setBranchItemCategory({
          restaurantId: restaurant.id,
          branchId: effectivePreviewBranchId,
          menuItemId: item.id,
          category: item.category,
          masterCategory,
        });

        // When this branch has an active price override, the master price is
        // ignored on this screen and at the till. Keep the override in sync
        // with what was just typed so the edit actually takes effect here.
        const override = previewPriceMap[item.id];
        if (override) {
          const { error: priceErr } = await supabase
            .from("menu_item_branch_prices" as any)
            .update({
              quarter_price: override.quarter_price != null ? item.quarter_price : null,
              half_price: override.half_price != null ? item.half_price : null,
              full_price: override.full_price != null ? item.full_price : null,
            } as any)
            .eq("branch_id", effectivePreviewBranchId)
            .eq("menu_item_id", item.id)
            .eq("effective_from", override.effective_from);
          if (priceErr) throw priceErr;
        }
      } else if (scope === "all" && restaurant?.id) {

        // Moving on the master menu clears any branch overrides for this item
        // only when the user explicitly chose "all branches".
        await supabase
          .from("menu_item_branch_categories" as any)
          .delete()
          .eq("restaurant_id", restaurant.id)
          .eq("menu_item_id", item.id);

        // Branch price overrides would keep the old price on the menu and at
        // the till, so a master-wide price change must clear the currently
        // active overrides for this item too.
        const { error: clearPriceErr } = await supabase
          .from("menu_item_branch_prices" as any)
          .delete()
          .eq("restaurant_id", restaurant.id)
          .eq("menu_item_id", item.id)
          .is("effective_to", null);
        if (clearPriceErr) throw clearPriceErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["menu-item-branch-categories"] });
      queryClient.invalidateQueries({ queryKey: ["branch-menu-prices"] });
      void refetchPreviewPrices();
      setEditingItem(null);
      toast.success("Item updated");

    },
    onError: (e: any) => toast.error(e?.message || "Failed to update item"),
  });

  // Toggle active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("menu_items")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      toast.success("Item status updated");
    },
    onError: () => toast.error("Failed to update status"),
  });

  // Toggle online availability mutation
  const toggleOnlineMutation = useMutation({
    mutationFn: async ({ id, available_online }: { id: string; available_online: boolean }) => {
      const { error } = await supabase
        .from("menu_items")
        .update({ available_online } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      toast.success(vars.available_online ? "Now visible on online store" : "Hidden from online store");
    },
    onError: () => toast.error("Failed to update online visibility"),
  });

  // ---- Drag & drop: move/copy an item into another category ----
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropOverCategory, setDropOverCategory] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ items: MenuItem[]; target: string } | null>(null);
  const [dropScope, setDropScope] = useState<"branch" | "all">("all");
  // Items that just landed in a category — briefly highlighted so the drop
  // reads as a "snap into place" instead of a silent list refresh.
  const [snapItemIds, setSnapItemIds] = useState<string[]>([]);
  // Multi-select: ids picked with the card checkboxes, dragged as one batch.
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const isSelected = (id: string) => selectedItemIds.includes(id);
  const toggleSelected = (id: string) =>
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  const dropMutation = useMutation({
    mutationFn: async ({
      items,
      target,
      mode,
      scope,
    }: { items: MenuItem[]; target: string; mode: "move" | "copy"; scope: "branch" | "all" }) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      const branchScoped = scope === "branch" && !!effectivePreviewBranchId;
      // Land at the end of the destination category so the position is
      // predictable and the rest of the category keeps its existing order.
      let landingOrder = nextOrderInCategory(
        menuItems as any,
        target,
        (i) => categoryOf(i as MenuItem),
        (i) => orderOf(i as MenuItem),
      );
      const landed: string[] = [];

      // Process sequentially so each item keeps its own slot in the target
      // category and the batch preserves the order it was displayed in.
      for (const item of items) {
        const master = menuItems.find((m) => m.id === item.id) || item;
        const masterCategory = master.category;
        const slot = landingOrder++;

        if (mode === "move") {
          if (branchScoped) {
            await setBranchItemCategory({
              restaurantId: restaurant.id,
              branchId: effectivePreviewBranchId!,
              menuItemId: item.id,
              category: target,
              masterCategory,
              displayOrder: slot,
            });
          } else {
            const { error } = await supabase
              .from("menu_items")
              .update({ category: target, display_order: slot } as any)
              .eq("id", item.id);
            if (error) throw error;
            await supabase
              .from("menu_item_branch_categories" as any)
              .delete()
              .eq("restaurant_id", restaurant.id)
              .eq("menu_item_id", item.id);
          }
          landed.push(item.id);
          continue;
        }

        // Copy: duplicate the master record into the target category.
        const { data: inserted, error } = await supabase
          .from("menu_items")
          .insert({
            restaurant_id: restaurant.id,
            name: `${master.name} (copy)`,
            category: branchScoped ? masterCategory : target,
            display_order: slot,
            quarter_price: master.quarter_price,
            half_price: master.half_price,
            full_price: master.full_price,
            selling_price: master.full_price || master.selling_price,
            is_active: master.is_active,
            image_url: master.image_url,
          } as any)
          .select("id")
          .single();
        if (error) throw error;

        if (branchScoped && inserted?.id) {
          await setBranchItemCategory({
            restaurantId: restaurant.id,
            branchId: effectivePreviewBranchId!,
            menuItemId: inserted.id,
            category: target,
            masterCategory,
            displayOrder: slot,
          });
        }
        if (inserted?.id) landed.push(inserted.id);
      }
      return landed;
    },
    onSuccess: (landedIds, vars) => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      queryClient.invalidateQueries({ queryKey: ["menu-item-branch-categories"] });
      setPendingDrop(null);
      setSelectedItemIds([]);
      // Follow the item to its destination and flash it into place.
      if (selectedCategory !== "all") setSelectedCategory(vars.target);
      if (landedIds?.length) {
        setSnapItemIds(landedIds);
        window.setTimeout(() => setSnapItemIds([]), 900);
      }
      const n = vars.items.length;
      const label = n > 1 ? `${n} items` : `"${vars.items[0]?.name}"`;
      toast.success(
        vars.mode === "move"
          ? `Moved ${label} to ${categoryLabel(vars.target)}`
          : `Copied ${label} to ${categoryLabel(vars.target)}`,
      );
    },
    onError: (e: any) => toast.error(e?.message || "Failed to update category"),
  });

  const handleDropOnCategory = (target: string) => {
    setDropOverCategory(null);
    // Dragging any selected card carries the whole selection.
    const batchIds =
      dragItemId && selectedItemIds.includes(dragItemId)
        ? selectedItemIds
        : dragItemId
          ? [dragItemId]
          : [];
    setDragItemId(null);
    const items = filteredItems
      .filter((m) => batchIds.includes(m.id))
      .filter((m) => categoryOf(m) !== target);
    if (!items.length) return;
    setDropScope(effectivePreviewBranchId ? "branch" : "all");
    setPendingDrop({ items, target });
  };

  // Delete menu item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("menu_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      toast.success("Item deleted");
    },
    onError: () => toast.error("Failed to delete item"),
  });

  // Filter items by category, then apply per-branch price overrides
  // for the currently-previewed branch (so the grid reflects what a
  // POS at that branch would actually charge).
  const filteredItemsRaw = selectedCategory === "all"
    ? [...menuItems].sort(
        (a, b) => categoryOf(a).localeCompare(categoryOf(b)) || byOrderThenName(a, b),
      )
    : menuItems.filter((item) => categoryOf(item) === selectedCategory).sort(byOrderThenName);
  const filteredItems = effectivePreviewBranchId
    ? applyBranchPrices(filteredItemsRaw as any, previewPriceMap) as MenuItem[]
    : filteredItemsRaw;
  const previewBranchName = branches.find((b) => b.id === effectivePreviewBranchId)?.name;

  // Group items by category
  const groupedItems = filteredItems.reduce((acc, item) => {
    const key = categoryOf(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);
  Object.values(groupedItems).forEach((list) => list.sort(byOrderThenName));

  // Item count per category key (all items, unfiltered) for the manager.
  const categoryItemCounts = menuItems.reduce((acc, item) => {
    const key = categoryOf(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Calculate margin
  const calculateMargin = (price: number, cost: number) => {
    if (price === 0) return 0;
    return ((price - cost) / price) * 100;
  };

  // Summary stats
  const totalItems = menuItems.length;
  const activeItems = menuItems.filter((i) => i.is_active).length;
  const avgMargin = menuItems.length > 0
    ? menuItems.reduce((sum, item) => {
        const cost = costLookup.get(item.id) || 0;
        return sum + calculateMargin(item.full_price || item.selling_price, cost);
      }, 0) / menuItems.length
    : 0;

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Quota Info */}
        <QuotaInfoCard quotaType="menu_items" className="mb-4" />
        
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 fade-slide-in mb-6 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">{t("app.menu.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.menu.subtitle")}
            </p>
          </div>
          {activeTab === "master" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsQROpen(true)}
                disabled={menuItems.length === 0}
                className="gap-1.5"
              >
                <QrCode className="h-4 w-4" />
                <span className="hidden sm:inline">{t("app.menu.qrCodes")}</span>
              </Button>
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCopyOpen(true)}
                  disabled={menuItems.length === 0}
                  className="gap-1.5"
                >
                  <Copy className="h-4 w-4" />
                  <span className="hidden sm:inline">Copy to Branch</span>
                </Button>
              )}
              {isOwner && hasMultipleBranches && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  <Link to="/branch-prices">
                    <Tags className="h-4 w-4" />
                    <span className="hidden sm:inline">Branch Prices</span>
                  </Link>
                </Button>
              )}
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setIsCategoriesOpen(true)}
                >
                  <Layers className="h-4 w-4" />
                  <span className="hidden sm:inline">Categories</span>
                </Button>
              )}
              {hasMultipleBranches && (
                <div className="flex items-center gap-1.5" title="Preview per-branch prices">
                  <Tags className="h-4 w-4 text-muted-foreground" />
                  <Select
                    value={effectivePreviewBranchId || "__base__"}
                    onValueChange={(v) => setPreviewBranchId(v === "__base__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 w-[170px] text-xs">
                      <SelectValue placeholder="Preview prices…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__base__">Base prices</SelectItem>
                      {branches.filter((b) => b.is_active).map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}{b.is_primary ? " · Primary" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const headers = ["Name", "Category", "Quarter Price", "Half Price", "Full Price", "Active"];
                  const rows = menuItems.map(item => [
                    item.name,
                    item.category || "",
                    item.quarter_price || 0,
                    item.half_price || 0,
                    item.full_price || item.selling_price || 0,
                    item.is_active ? "Yes" : "No"
                  ]);
                  exportToCSV({ headers, rows, filename: "Menu_Master" });
                  toast.success("Menu exported to CSV");
                }}
                disabled={menuItems.length === 0}
                className="gap-1.5"
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">{t("app.menu.export")}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const source = (filteredItems.length > 0 ? filteredItems : menuItems)
                    .filter((item) => item.is_active);

                  downloadKeetaCsv(
                    source.map((item) => ({
                      name: item.name,
                      category: categoryLabel(categoryOf(item)) || "Meal",
                      price: item.full_price || item.selling_price || 0,
                      pickupPrice: item.full_price || item.selling_price || 0,
                    })),
                    `Keeta_Menu_${new Date().toISOString().slice(0, 10)}`,
                  );
                  toast.success("Keeta-compatible menu exported");
                }}
                disabled={menuItems.length === 0}
                className="gap-1.5"
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">Keeta Export</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const source = (filteredItems.length > 0 ? filteredItems : menuItems)
                    .filter((item) => item.is_active);

                  downloadJahezMenu(
                    source.map((item) => ({
                      name: item.name,
                      category: categoryLabel(categoryOf(item)) || "Meal",
                      price: item.full_price || item.selling_price || 0,
                      imageUrl: toCdnUrl(item.image_url) || "",
                      sizes: [
                        { label: "Quarter", labelArabic: "ربع", price: item.quarter_price || 0 },
                        { label: "Half", labelArabic: "نصف", price: item.half_price || 0 },
                        { label: "Full", labelArabic: "كامل", price: item.full_price || 0 },
                      ].filter((s) => s.price > 0 && s.price !== (item.full_price || item.selling_price || 0)),
                    })),
                    `Jahez_Menu_${new Date().toISOString().slice(0, 10)}`,
                  );
                  toast.success("Jahez-compatible menu exported");
                }}
                disabled={menuItems.length === 0}
                className="gap-1.5"
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">Jahez Export</span>
              </Button>



              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    <span className="hidden xs:inline">{t("app.menu.add")}</span>
                    <span className="hidden sm:inline">{t("app.menu.item")}</span>
                  </Button>
                </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Menu Item</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {restaurant?.id && (
                    <MenuItemImageUploader
                      currentImageUrl={toCdnUrl(newItem.image_url)}
                      onImageUploaded={(url) => setNewItem({ ...newItem, image_url: url })}
                      restaurantId={restaurant.id}
                    />
                  )}
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={newItem.name}
                      onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                      placeholder="e.g., Chicken Burger"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={newItem.category}
                      onValueChange={(val) => setNewItem({ ...newItem, category: val })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {categoryLabel(cat)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="hasVariants"
                      checked={newItem.hasVariants}
                      onCheckedChange={(checked) => 
                        setNewItem({ 
                          ...newItem, 
                          hasVariants: !!checked, 
                          quarter_price: checked ? newItem.quarter_price : "",
                          half_price: checked ? newItem.half_price : "" 
                        })
                      }
                    />
                    <Label htmlFor="hasVariants" className="text-sm font-normal cursor-pointer">
                      Has quarter / half / full option
                    </Label>
                  </div>
                  {newItem.hasVariants ? (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>Quarter</Label>
                        <Input
                          type="number"
                          value={newItem.quarter_price}
                          onChange={(e) => setNewItem({ ...newItem, quarter_price: e.target.value })}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Half</Label>
                        <Input
                          type="number"
                          value={newItem.half_price}
                          onChange={(e) => setNewItem({ ...newItem, half_price: e.target.value })}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Full</Label>
                        <Input
                          type="number"
                          value={newItem.full_price}
                          onChange={(e) => setNewItem({ ...newItem, full_price: e.target.value })}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Price</Label>
                      <Input
                        type="number"
                        value={newItem.full_price}
                        onChange={(e) => setNewItem({ ...newItem, full_price: e.target.value })}
                        placeholder="0.00"
                      />
                    </div>
                  )}
                  <Button
                    onClick={() => addItemMutation.mutate(newItem)}
                    disabled={!newItem.name || addItemMutation.isPending}
                    className="w-full"
                  >
                    Add Menu Item
                  </Button>
                </div>
              </DialogContent>
              </Dialog>
            </div>
          )}
        </header>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="master" className="gap-2">
              <BookOpen className="h-4 w-4" />
              {t("app.menu.tabs.master")}
            </TabsTrigger>
            <TabsTrigger value="daily" className="gap-2">
              <CalendarDays className="h-4 w-4" />
              {t("app.menu.tabs.daily")}
            </TabsTrigger>
            <TabsTrigger value="combos" className="gap-2">
              <Package className="h-4 w-4" />
              {t("app.menu.tabs.combos")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="master" className="mt-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="fade-slide-in" style={{ animationDelay: "0.1s" }}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Items</p>
                      <p className="text-2xl font-semibold">{totalItems}</p>
                    </div>
                    <UtensilsCrossed className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                </CardContent>
              </Card>
              <Card className="fade-slide-in" style={{ animationDelay: "0.2s" }}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Active Items</p>
                      <p className="text-2xl font-semibold">
                        {activeItems}
                        <span className="text-sm text-muted-foreground ml-1">/ {totalItems}</span>
                      </p>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center">
                      <div className="h-3 w-3 rounded-full bg-green-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="fade-slide-in" style={{ animationDelay: "0.3s" }}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Avg. Margin</p>
                      <p className="text-2xl font-semibold">{avgMargin.toFixed(1)}%</p>
                    </div>
                    {avgMargin >= 50 ? (
                      <TrendingUp className="h-8 w-8 text-green-500" />
                    ) : (
                      <TrendingDown className="h-8 w-8 text-amber-500" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={selectedCategory === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory("all")}
              >
                All
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant={selectedCategory === cat ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(cat)}
                  onDragOver={(e) => {
                    if (!dragItemId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropOverCategory(cat);
                  }}
                  onDragLeave={() => setDropOverCategory((c) => (c === cat ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnCategory(cat);
                  }}
                  className={`relative transition-all duration-200 ease-out ${
                    dropOverCategory === cat
                      ? "scale-110 ring-2 ring-primary ring-offset-2 bg-primary/10 text-primary shadow-lg drop-target-pulse"
                      : dragItemId
                        ? "border-dashed border-primary/60 bg-primary/5"
                        : ""
                  }`}
                >
                  {categoryLabel(cat)}
                  {dropOverCategory === cat && (
                    <span className="ml-2 text-[10px] font-medium uppercase tracking-wide opacity-80">
                      Drop here
                    </span>
                  )}
                </Button>
              ))}
            </div>
            {dragItemId && (
              <p className="text-xs text-primary flex items-center gap-1 fade-slide-in">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                {dropOverCategory
                  ? `Release to place in ${categoryLabel(dropOverCategory)}`
                  : "Drop the item on a category above to move or copy it."}
              </p>
            )}

            {/* Menu Items Grid */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium">
                  Menu Items
                  {selectedCategory !== "all" && (
                    <Badge variant="secondary" className="ml-2">
                      {categoryLabel(selectedCategory)}
                    </Badge>
                  )}
                </h3>
                {effectivePreviewBranchId && previewBranchName && (
                  <Badge variant="outline" className="text-[11px] gap-1">
                    <Tags className="h-3 w-3" />
                    Previewing prices for {previewBranchName}
                  </Badge>
                )}
              </div>
              
              {isLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
              ) : filteredItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No menu items found
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filteredItems.map((item) => {
                    const cost = costLookup.get(item.id) || 0;
                    const price = item.full_price || item.selling_price;
                    const margin = calculateMargin(price, cost);
                    const hasVariants = item.quarter_price > 0 || item.half_price > 0;

                    return (
                      <Card
                        key={item.id}
                        draggable
                        onDragStart={(e) => {
                          setDragItemId(item.id);
                          // Dragging an unselected card drags just that card.
                          if (!isSelected(item.id)) setSelectedItemIds([]);
                          e.dataTransfer.effectAllowed = "copyMove";
                          e.dataTransfer.setData("text/plain", item.id);
                        }}
                        onDragEnd={() => {
                          setDragItemId(null);
                          setDropOverCategory(null);
                        }}
                        className={`overflow-hidden transition-all duration-200 ease-out hover:shadow-md ${
                          !item.is_active ? "opacity-50" : ""
                        } ${
                          dragItemId === item.id || (dragItemId && isSelected(item.id))
                            ? "opacity-40 scale-95 border-2 border-dashed border-primary bg-primary/5"
                            : dragItemId
                              ? "opacity-70"
                              : ""
                        } ${snapItemIds.includes(item.id) ? "drop-snap ring-2 ring-primary" : ""} ${
                          isSelected(item.id) ? "ring-2 ring-primary" : ""
                        } cursor-grab active:cursor-grabbing`}
                      >
                        {/* Image */}
                        <div className="aspect-square bg-muted relative overflow-hidden flex items-center justify-center">
                          {/* Multi-select checkbox */}
                          <div
                            className="absolute bottom-2 left-2 z-10 rounded-md bg-background/90 p-1 shadow-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected(item.id)}
                              onCheckedChange={() => toggleSelected(item.id)}
                              aria-label={`Select ${item.name}`}
                            />
                          </div>
                          {item.image_url ? (
                            <img
                              src={toCdnUrl(item.image_url) || ""}
                              alt={item.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <UtensilsCrossed className="h-12 w-12 text-muted-foreground/40" />
                          )}
                          {/* Active badge overlay */}
                          {!item.is_active && (
                            <Badge variant="secondary" className="absolute top-2 right-2 text-[10px]">
                              Inactive
                            </Badge>
                          )}
                          {/* Online visibility badge */}
                          <Badge
                            variant={item.available_online === false ? "outline" : "secondary"}
                            className="absolute top-2 left-2 text-[10px] gap-1"
                          >
                            {item.available_online === false ? (
                              <><GlobeLock className="h-3 w-3" /> POS only</>
                            ) : (
                              <><Globe className="h-3 w-3" /> Online</>
                            )}
                          </Badge>
                        </div>
                        
                        <CardContent className="pt-6">
                          {/* Name & Category */}
                          <div className="mb-2">
                            <p className="font-medium text-sm line-clamp-1" title={item.name}>
                              {item.name}
                            </p>
                            <Badge variant="outline" className={`text-[10px] mt-1 ${categoryColor(categoryOf(item))}`}>
                              {categoryLabel(categoryOf(item))}
                            </Badge>
                          </div>
                          
                          {/* Pricing */}
                          <div className="space-y-1 text-xs">
                            {hasVariants ? (
                              <div className="flex flex-wrap gap-1">
                                {item.quarter_price > 0 && (
                                  <span className="text-muted-foreground">Qtr: <span className="font-medium text-foreground">{formatCurrency(item.quarter_price)}</span></span>
                                )}
                                {item.half_price > 0 && (
                                  <span className="text-muted-foreground">Half: <span className="font-medium text-foreground">{formatCurrency(item.half_price)}</span></span>
                                )}
                              </div>
                            ) : null}
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Full:</span>
                              <span className="font-semibold text-foreground">{formatCurrency(price)}</span>
                            </div>
                            {cost > 0 && (
                              <div className="flex items-center justify-between text-muted-foreground">
                                <span>Margin:</span>
                                <span className={margin >= 50 ? "text-green-600" : "text-amber-600"}>
                                  {margin.toFixed(0)}%
                                </span>
                              </div>
                            )}
                          </div>
                          
                          {/* Actions */}
                          <div className="flex items-center justify-between pt-2 mt-2 border-t gap-2">
                            {isOwner && (
                              <div className="flex flex-col gap-1">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <Switch
                                    checked={item.is_active}
                                    onCheckedChange={(checked) =>
                                      toggleActiveMutation.mutate({ id: item.id, is_active: checked })
                                    }
                                    className="scale-75"
                                  />
                                  <span className="text-[10px] text-muted-foreground">Active</span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <Switch
                                    checked={item.available_online !== false}
                                    onCheckedChange={(checked) =>
                                      toggleOnlineMutation.mutate({ id: item.id, available_online: checked })
                                    }
                                    className="scale-75"
                                  />
                                  <span className="text-[10px] text-muted-foreground">Online</span>
                                </label>
                                {scopedBranchId && (
                                  <label className="flex items-center gap-1.5 cursor-pointer" title={`Available at ${activeBranch?.name ?? "this branch"}`}>
                                    <Switch
                                      checked={branchAvailability[item.id] !== false}
                                      onCheckedChange={(checked) =>
                                        setBranchAvailability.mutate({ menu_item_id: item.id, is_available: checked })
                                      }
                                      className="scale-75"
                                    />
                                    <span className="text-[10px] text-muted-foreground">
                                      {activeBranch?.name ? `@ ${activeBranch.name}` : "@ Branch"}
                                    </span>
                                  </label>
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-1 ml-auto">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  // Open with the branch-effective category so a
                                  // "move" defaults to the previewed branch.
                                  setEditingItem({ ...item, category: categoryOf(item) });
                                  setCategoryScope(effectivePreviewBranchId ? "branch" : "all");
                                  setEditHasVariants(hasVariants);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete {item.name}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete this menu item. This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteItemMutation.mutate(item.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="daily" className="mt-6">
            <DailyMenuManager />
          </TabsContent>

          <TabsContent value="combos" className="mt-6">
            <ComboPackageManager />
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={!!editingItem} onOpenChange={() => { setEditingItem(null); setEditHasVariants(false); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Menu Item</DialogTitle>
            </DialogHeader>
            {editingItem && restaurant?.id && (
              <div className="space-y-4 py-4">
                  <MenuItemImageUploader
                      currentImageUrl={toCdnUrl(editingItem.image_url)}
                      onImageUploaded={(url) => setEditingItem({ ...editingItem, image_url: url })}
                  restaurantId={restaurant.id}
                  menuItemId={editingItem.id}
                />
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={editingItem.name}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={editingItem.category}
                    onValueChange={(val) =>
                      setEditingItem({ ...editingItem, category: val })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {categoryLabel(cat)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {effectivePreviewBranchId && (
                    <div className="space-y-1.5 rounded-md border p-2.5">
                      <Label className="text-xs">Apply category change to</Label>
                      <Select value={categoryScope} onValueChange={(v) => setCategoryScope(v as "branch" | "all")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="branch">
                            {previewBranchName || "This branch"} only
                          </SelectItem>
                          <SelectItem value="all">All branches (master menu)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {categoryScope === "branch"
                          ? `Other branches keep "${categoryLabel(menuItems.find((m) => m.id === editingItem.id)?.category || editingItem.category)}".`
                          : "Moves the item everywhere and clears branch-specific placements."}
                      </p>
                      {branchCategoryMap[editingItem.id] && (
                        <Badge variant="outline" className="text-[10px]">
                          Branch override active · master: {categoryLabel(menuItems.find((m) => m.id === editingItem.id)?.category || "")}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="editHasVariants"
                    checked={editHasVariants}
                    onCheckedChange={(checked) => {
                      setEditHasVariants(!!checked);
                      if (!checked) {
                        setEditingItem({ ...editingItem, quarter_price: 0, half_price: 0 });
                      }
                    }}
                  />
                  <Label htmlFor="editHasVariants" className="text-sm font-normal cursor-pointer">
                    Has quarter / half / full option
                  </Label>
                </div>
                {editHasVariants ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Quarter</Label>
                      <Input
                        type="number"
                        value={editingItem.quarter_price}
                        onChange={(e) =>
                          setEditingItem({
                            ...editingItem,
                            quarter_price: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Half</Label>
                      <Input
                        type="number"
                        value={editingItem.half_price}
                        onChange={(e) =>
                          setEditingItem({
                            ...editingItem,
                            half_price: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Full</Label>
                      <Input
                        type="number"
                        value={editingItem.full_price}
                        onChange={(e) =>
                          setEditingItem({
                            ...editingItem,
                            full_price: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Price</Label>
                    <Input
                      type="number"
                      value={editingItem.full_price}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          full_price: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label>Active</Label>
                  <Switch
                    checked={editingItem.is_active}
                    onCheckedChange={(checked) =>
                      setEditingItem({ ...editingItem, is_active: checked })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Print Route</Label>
                  <Select
                    value={editingItem.print_route ?? "kitchen"}
                    onValueChange={(val) =>
                      setEditingItem({ ...editingItem, print_route: val as "kitchen" | "bar" | "none" })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kitchen">Kitchen printer</SelectItem>
                      <SelectItem value="bar">Bar printer (drinks)</SelectItem>
                      <SelectItem value="none">Don't print a ticket</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Decides which station printer this item is sent to when a sale is recorded.
                  </p>
                </div>
                <Button
                  onClick={() => updateItemMutation.mutate({ item: editingItem, scope: categoryScope })}
                  disabled={updateItemMutation.isPending}
                  className="w-full"
                >
                  Save Changes
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* QR Codes Dialog */}
        {restaurant?.id && (
          <MenuQRCodes
            isOpen={isQROpen}
            onClose={() => setIsQROpen(false)}
            menuItems={menuItems}
            restaurantId={restaurant.id}
          />
        )}

        {/* Copy Menu to another branch */}
        {restaurant?.id && tenant?.id && (
          <CopyMenuToBranchDialog
            open={isCopyOpen}
            onOpenChange={setIsCopyOpen}
            sourceRestaurantId={restaurant.id}
            tenantId={tenant.id}
            sourceItemCount={menuItems.length}
          />
        )}

        {/* Category manager (tenant-wide + per-branch overrides) */}
        <MenuCategoryManager
          open={isCategoriesOpen}
          onOpenChange={setIsCategoriesOpen}
          itemCounts={categoryItemCounts}
        />

        {/* Drag & drop: move or copy the dropped item */}
        {selectedItemIds.length > 0 && (
          <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur flex items-center gap-3">
            <span className="text-sm font-medium">{selectedItemIds.length} selected</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Drag any selected item onto a category to move or copy them together
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedItemIds(filteredItems.map((i) => i.id))}
            >
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedItemIds([])}>
              Clear
            </Button>
          </div>
        )}

        <Dialog open={!!pendingDrop} onOpenChange={(o) => !o && setPendingDrop(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {pendingDrop
                  ? pendingDrop.items.length > 1
                    ? `Move ${pendingDrop.items.length} items`
                    : `Move "${pendingDrop.items[0]?.name}"`
                  : "Move items"}
              </DialogTitle>
            </DialogHeader>
            {pendingDrop && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  From{" "}
                  {Array.from(new Set(pendingDrop.items.map((i) => categoryOf(i)))).map((c) => (
                    <Badge key={c} variant="outline" className="mx-1">{categoryLabel(c)}</Badge>
                  ))}
                  to <Badge variant="outline" className="mx-1">{categoryLabel(pendingDrop.target)}</Badge>
                </p>
                {pendingDrop.items.length > 1 && (
                  <div className="max-h-32 overflow-y-auto rounded-md border p-2 text-xs space-y-1">
                    {pendingDrop.items.map((i) => (
                      <div key={i.id} className="truncate">{i.name}</div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {pendingDrop.items.length > 1 ? "They" : "It"} will be placed at the end of{" "}
                  {categoryLabel(pendingDrop.target)} (from position{" "}
                  {menuItems.filter((m) => categoryOf(m) === pendingDrop.target).length + 1}
                  ). Existing items keep their current order.
                </p>

                {effectivePreviewBranchId && (
                  <div className="space-y-1.5">
                    <Label>Apply to</Label>
                    <Select value={dropScope} onValueChange={(v) => setDropScope(v as "branch" | "all")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="branch">
                          This branch only{previewBranchName ? ` (${previewBranchName})` : ""}
                        </SelectItem>
                        <SelectItem value="all">All branches</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={dropMutation.isPending}
                    onClick={() =>
                      dropMutation.mutate({ ...pendingDrop, mode: "move", scope: dropScope })
                    }
                  >
                    Move here
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-1"
                    disabled={dropMutation.isPending}
                    onClick={() =>
                      dropMutation.mutate({ ...pendingDrop, mode: "copy", scope: dropScope })
                    }
                  >
                    <Copy className="h-4 w-4" /> Copy here
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Copy creates a duplicate item in the target category; the original stays put.
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
