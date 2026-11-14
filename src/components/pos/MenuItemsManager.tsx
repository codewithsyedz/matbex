import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useQuota } from "@/hooks/useQuota";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ChefHat, DollarSign, Globe, GlobeLock } from "lucide-react";
import { QuotaAlert } from "@/components/quota/QuotaAlert";

interface MenuItem {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  is_active: boolean;
  available_online?: boolean;
  vat_category?: string;
  vat_exemption_reason_code?: string | null;
}

interface RecipeIngredient {
  id: string;
  menu_item_id: string;
  inventory_item_id: string;
  quantity_required: number;
  inventory_items?: { name: string; unit: string; unit_cost: number };
}

export function MenuItemsManager() {
  const { restaurant, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { usage, quotaLimits, checkQuota, isAtLimit } = useQuota();
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedItemForRecipe, setSelectedItemForRecipe] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({
    name: "",
    category: "main",
    selling_price: "",
    vat_category: "S",
    vat_exemption_reason_code: "",
  });
  const [newIngredient, setNewIngredient] = useState({ inventory_item_id: "", quantity_required: "" });

  // Fetch menu items
  const { data: menuItems = [], isLoading } = useQuery({
    queryKey: ["menu-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("category", { ascending: true });
      if (error) throw error;
      return data as MenuItem[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch inventory items for recipe
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory-items-for-recipe", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("inventory_items")
        .select("id, name, unit, unit_cost")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Fetch recipe ingredients for selected item
  const { data: recipeIngredients = [] } = useQuery({
    queryKey: ["recipe-ingredients", selectedItemForRecipe],
    queryFn: async () => {
      if (!selectedItemForRecipe) return [];
      const { data, error } = await db
        .from("recipe_ingredients")
        .select("*, inventory_items(name, unit, unit_cost)")
        .eq("menu_item_id", selectedItemForRecipe);
      if (error) throw error;
      return data as RecipeIngredient[];
    },
    enabled: !!selectedItemForRecipe,
  });

  // Calculate recipe cost
  const recipeCost = recipeIngredients.reduce((sum, ing) => {
    const unitCost = ing.inventory_items?.unit_cost || 0;
    return sum + (Number(ing.quantity_required) * unitCost);
  }, 0);

  // Add menu item mutation
  const addItemMutation = useMutation({
    mutationFn: async (item: typeof newItem) => {
      if (!restaurant?.id) throw new Error("No restaurant");
      
      // Check quota before adding
      const quotaCheck = await checkQuota("menu_items");
      if (!quotaCheck.allowed) {
        throw new Error(`Menu item limit reached (${quotaCheck.current}/${quotaCheck.limit}). Please upgrade your plan.`);
      }
      
      const { error } = await db.from("menu_items").insert({
        restaurant_id: restaurant.id,
        name: item.name,
        category: item.category,
        selling_price: parseFloat(item.selling_price) || 0,
        vat_category: item.vat_category || "S",
        vat_exemption_reason_code:
          item.vat_category === "E" || item.vat_category === "O"
            ? item.vat_exemption_reason_code || null
            : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      setIsAddOpen(false);
      setNewItem({
        name: "",
        category: "main",
        selling_price: "",
        vat_category: "S",
        vat_exemption_reason_code: "",
      });
      toast.success("Menu item added");
    },
    onError: () => toast.error("Failed to add item"),
  });

  // Update menu item mutation
  const updateItemMutation = useMutation({
    mutationFn: async (item: MenuItem) => {
      const { error } = await db
        .from("menu_items")
        .update({
          name: item.name,
          category: item.category,
          selling_price: item.selling_price,
          is_active: item.is_active,
          vat_category: item.vat_category || "S",
          vat_exemption_reason_code:
            item.vat_category === "E" || item.vat_category === "O"
              ? item.vat_exemption_reason_code || null
              : null,
        })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      setEditingItem(null);
      toast.success("Item updated");
    },
    onError: () => toast.error("Failed to update item"),
  });

  // Delete menu item mutation
  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("menu_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-items"] });
      toast.success("Item deleted");
    },
    onError: () => toast.error("Failed to delete item"),
  });

  // Add recipe ingredient mutation
  const addIngredientMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItemForRecipe || !restaurant?.id) throw new Error("Missing data");
      const { error } = await db.from("recipe_ingredients").insert({
        menu_item_id: selectedItemForRecipe,
        inventory_item_id: newIngredient.inventory_item_id,
        quantity_required: parseFloat(newIngredient.quantity_required) || 1,
        restaurant_id: restaurant.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-ingredients"] });
      setNewIngredient({ inventory_item_id: "", quantity_required: "" });
      toast.success("Ingredient added to recipe");
    },
    onError: () => toast.error("Failed to add ingredient"),
  });

  // Delete recipe ingredient mutation
  const deleteIngredientMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("recipe_ingredients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-ingredients"] });
      toast.success("Ingredient removed");
    },
    onError: () => toast.error("Failed to remove ingredient"),
  });

  const categories = ["main", "appetizer", "dessert", "beverage", "side"];
  const vatCategoryOptions = [
    { value: "S", label: "S - Standard 15%", description: "Default VAT-rated goods/services" },
    { value: "Z", label: "Z - Zero-rated 0%", description: "Exports, qualifying medicines" },
    { value: "E", label: "E - Exempt", description: "Financial services, residential rent (requires reason)" },
    { value: "O", label: "O - Out of scope", description: "Outside KSA VAT scope (requires reason)" },
  ];
  const vatBadgeVariant = (cat?: string) =>
    cat === "S" || !cat ? "secondary" : cat === "Z" ? "outline" : "default";
  const groupedItems = menuItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);

  return (
    <div className="space-y-6">
      {/* Quota Alert */}
      <QuotaAlert quotaType="menu_items" />
      
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Menu Items & Recipes</h3>
          <p className="text-sm text-muted-foreground">
            Configure menu items with recipes for accurate food cost calculation
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Quota remaining indicator */}
          {quotaLimits.menu_items && usage && (
            <div className="text-sm text-muted-foreground">
              <span className={(usage.menu_item_count ?? 0) >= quotaLimits.menu_items ? "text-destructive font-medium" : ""}>
                {Math.max(0, quotaLimits.menu_items - (usage.menu_item_count ?? 0))}
              </span>
              {" "}remaining
            </div>
          )}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </DialogTrigger>
          <DialogContent
            description={
              newItem.name
                ? `Add "${newItem.name}"${newItem.category ? ` to ${newItem.category}` : ""} - set price variants and image.`
                : "Add a new menu item - name, category, price variants, and image."
            }
          >
            <DialogHeader>
              <DialogTitle>Add Menu Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
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
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Selling Price</Label>
                <Input
                  type="number"
                  value={newItem.selling_price}
                  onChange={(e) => setNewItem({ ...newItem, selling_price: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>ZATCA VAT Category</Label>
                <Select
                  value={newItem.vat_category}
                  onValueChange={(val) =>
                    setNewItem({ ...newItem, vat_category: val, vat_exemption_reason_code: "" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {vatCategoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex flex-col">
                          <span>{opt.label}</span>
                          <span className="text-xs text-muted-foreground">{opt.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(newItem.vat_category === "E" || newItem.vat_category === "O") && (
                <div className="space-y-2">
                  <Label>Exemption Reason Code</Label>
                  <Input
                    value={newItem.vat_exemption_reason_code}
                    onChange={(e) =>
                      setNewItem({ ...newItem, vat_exemption_reason_code: e.target.value })
                    }
                    placeholder="e.g., VATEX-SA-29, VATEX-SA-32, VATEX-SA-EDU"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for exempt / out-of-scope items per ZATCA UBL specification.
                  </p>
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Menu Items List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ChefHat className="h-4 w-4" />
              Menu Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : menuItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No menu items yet</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedItems).map(([category, items]) => (
                  <div key={category}>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      {category}
                    </h4>
                    <div className="space-y-2">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                            selectedItemForRecipe === item.id
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/50"
                          }`}
                          onClick={() => setSelectedItemForRecipe(item.id)}
                        >
                          <div>
                            <span className="font-medium">{item.name}</span>
                            {!item.is_active && (
                              <Badge variant="secondary" className="ml-2 text-xs">
                                Inactive
                              </Badge>
                            )}
                            <Badge
                              variant={vatBadgeVariant(item.vat_category)}
                              className="ml-2 text-[10px] uppercase"
                            >
                              VAT {item.vat_category || "S"}
                            </Badge>
                            {item.available_online === false ? (
                              <Badge variant="outline" className="ml-2 text-[10px] gap-1">
                                <GlobeLock className="h-3 w-3" /> POS only
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="ml-2 text-[10px] gap-1">
                                <Globe className="h-3 w-3" /> Online
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              {formatCurrency(item.selling_price)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={item.available_online === false ? "Show on online store" : "Hide from online store"}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const next = !(item.available_online !== false);
                                const { error } = await db
                                  .from("menu_items")
                                  .update({ available_online: next } as any)
                                  .eq("id", item.id);
                                if (error) toast.error(error.message);
                                else {
                                  toast.success(next ? "Now visible online" : "Hidden from online store");
                                  queryClient.invalidateQueries({ queryKey: ["menu-items", restaurant?.id] });
                                }
                              }}
                            >
                              {item.available_online === false ? (
                                <GlobeLock className="h-3 w-3" />
                              ) : (
                                <Globe className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingItem(item);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteItemMutation.mutate(item.id);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recipe Editor */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Recipe Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedItemForRecipe ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <span className="font-medium">
                    {menuItems.find((i) => i.id === selectedItemForRecipe)?.name}
                  </span>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Recipe Cost</p>
                    <p className="font-semibold text-lg">{formatCurrency(recipeCost)}</p>
                  </div>
                </div>

                {recipeIngredients.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Ingredients</p>
                    {recipeIngredients.map((ing) => (
                      <div
                        key={ing.id}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <div>
                          <span className="text-sm">{ing.inventory_items?.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            × {ing.quantity_required} {ing.inventory_items?.unit}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">
                            {formatCurrency(
                              Number(ing.quantity_required) *
                                (ing.inventory_items?.unit_cost || 0)
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => deleteIngredientMutation.mutate(ing.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t pt-4 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase">
                    Add Ingredient
                  </p>
                  <Select
                    value={newIngredient.inventory_item_id}
                    onValueChange={(val) =>
                      setNewIngredient({ ...newIngredient, inventory_item_id: val })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select ingredient" />
                    </SelectTrigger>
                    <SelectContent>
                      {inventoryItems.map((inv) => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.name} ({formatCurrency(inv.unit_cost)}/{inv.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    placeholder="Quantity"
                    value={newIngredient.quantity_required}
                    onChange={(e) =>
                      setNewIngredient({ ...newIngredient, quantity_required: e.target.value })
                    }
                  />
                  <Button
                    onClick={() => addIngredientMutation.mutate()}
                    disabled={
                      !newIngredient.inventory_item_id ||
                      !newIngredient.quantity_required ||
                      addIngredientMutation.isPending
                    }
                    size="sm"
                    className="w-full"
                  >
                    Add to Recipe
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Select a menu item to edit its recipe
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingItem} onOpenChange={() => setEditingItem(null)}>
        <DialogContent
          description={
            editingItem
              ? `Edit "${editingItem.name}"${editingItem.category ? ` (${editingItem.category})` : ""} - name, pricing, and image.`
              : "Edit menu item."
          }
        >
          <DialogHeader>
            <DialogTitle>Edit Menu Item</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-4 py-4">
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
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Selling Price</Label>
                <Input
                  type="number"
                  value={editingItem.selling_price}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      selling_price: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>ZATCA VAT Category</Label>
                <Select
                  value={editingItem.vat_category || "S"}
                  onValueChange={(val) =>
                    setEditingItem({
                      ...editingItem,
                      vat_category: val,
                      vat_exemption_reason_code:
                        val === "E" || val === "O"
                          ? editingItem.vat_exemption_reason_code || ""
                          : null,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {vatCategoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex flex-col">
                          <span>{opt.label}</span>
                          <span className="text-xs text-muted-foreground">{opt.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(editingItem.vat_category === "E" || editingItem.vat_category === "O") && (
                <div className="space-y-2">
                  <Label>Exemption Reason Code</Label>
                  <Input
                    value={editingItem.vat_exemption_reason_code || ""}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        vat_exemption_reason_code: e.target.value,
                      })
                    }
                    placeholder="e.g., VATEX-SA-29, VATEX-SA-32, VATEX-SA-EDU"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for exempt / out-of-scope items per ZATCA UBL specification.
                  </p>
                </div>
              )}
              <Button
                onClick={() => updateItemMutation.mutate(editingItem)}
                disabled={updateItemMutation.isPending}
                className="w-full"
              >
                Save Changes
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
