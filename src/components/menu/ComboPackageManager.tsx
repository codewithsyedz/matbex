import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Package, X, FileDown } from "lucide-react";
import { exportToCSV } from "@/lib/exportUtils";

interface MenuItem {
  id: string;
  name: string;
  category?: string;
  quarter_price: number;
  half_price: number;
  full_price: number;
  selling_price: number;
}

interface ComboItem {
  menu_item_id: string;
  quantity: number;
  portion_type: "quarter" | "half" | "full";
}

interface ComboPackage {
  id: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
  items?: Array<{
    id: string;
    menu_item_id: string;
    quantity: number;
    portion_type: string;
    menu_items?: {
      id: string;
      name: string;
      quarter_price: number;
      half_price: number;
      full_price: number;
      selling_price: number;
    };
  }>;
}

export function ComboPackageManager() {
  const { restaurant } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ComboPackage | null>(null);
  const [newCombo, setNewCombo] = useState({ name: "", description: "", price: "" });
  const [selectedItems, setSelectedItems] = useState<ComboItem[]>([]);

  // Fetch menu items
  const { data: menuItems = [] } = useQuery({
    queryKey: ["menu-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as MenuItem[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch combo packages
  const { data: combos = [], isLoading } = useQuery({
    queryKey: ["combo-packages", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("combo_packages")
        .select(`
          *,
          items:combo_package_items(
            id,
            menu_item_id,
            quantity,
            portion_type,
            menu_items(id, name, quarter_price, half_price, full_price, selling_price)
          )
        `)
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data as ComboPackage[];
    },
    enabled: !!restaurant?.id,
  });

  // Add combo mutation
  const addComboMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id) throw new Error("No restaurant");
      
      // Create combo package
      const { data: combo, error: comboError } = await supabase
        .from("combo_packages")
        .insert({
          restaurant_id: restaurant.id,
          name: newCombo.name,
          description: newCombo.description || null,
          price: parseFloat(newCombo.price) || 0,
        })
        .select()
        .single();
      
      if (comboError) throw comboError;

      // Add combo items
      if (selectedItems.length > 0) {
        const { error: itemsError } = await supabase
          .from("combo_package_items")
          .insert(
            selectedItems.map((item) => ({
              combo_id: combo.id,
              menu_item_id: item.menu_item_id,
              quantity: item.quantity,
              portion_type: item.portion_type,
            }))
          );
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combo-packages"] });
      setIsAddOpen(false);
      setNewCombo({ name: "", description: "", price: "" });
      setSelectedItems([]);
      toast.success("Combo package created");
    },
    onError: () => toast.error("Failed to create combo"),
  });

  // Update combo mutation
  const updateComboMutation = useMutation({
    mutationFn: async () => {
      if (!editingCombo) throw new Error("No combo");

      // Update combo package
      const { error: comboError } = await supabase
        .from("combo_packages")
        .update({
          name: editingCombo.name,
          description: editingCombo.description,
          price: editingCombo.price,
          is_active: editingCombo.is_active,
        })
        .eq("id", editingCombo.id);

      if (comboError) throw comboError;

      // Delete existing items
      await supabase
        .from("combo_package_items")
        .delete()
        .eq("combo_id", editingCombo.id);

      // Add new items
      if (selectedItems.length > 0) {
        const { error: itemsError } = await supabase
          .from("combo_package_items")
          .insert(
            selectedItems.map((item) => ({
              combo_id: editingCombo.id,
              menu_item_id: item.menu_item_id,
              quantity: item.quantity,
              portion_type: item.portion_type,
            }))
          );
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combo-packages"] });
      setEditingCombo(null);
      setSelectedItems([]);
      toast.success("Combo updated");
    },
    onError: () => toast.error("Failed to update combo"),
  });

  // Delete combo mutation
  const deleteComboMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("combo_packages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combo-packages"] });
      toast.success("Combo deleted");
    },
    onError: () => toast.error("Failed to delete combo"),
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("combo_packages")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combo-packages"] });
      toast.success("Status updated");
    },
    onError: () => toast.error("Failed to update status"),
  });

  const addItemToCombo = (menuItemId: string) => {
    if (selectedItems.some((i) => i.menu_item_id === menuItemId && i.portion_type === "full")) {
      return;
    }
    setSelectedItems([...selectedItems, { menu_item_id: menuItemId, quantity: 1, portion_type: "full" }]);
  };

  const removeItemFromCombo = (index: number) => {
    setSelectedItems(selectedItems.filter((_, i) => i !== index));
  };

  const updateItemQuantity = (index: number, quantity: number) => {
    const updated = [...selectedItems];
    updated[index].quantity = quantity;
    setSelectedItems(updated);
  };

  const updateItemPortion = (index: number, portion: "quarter" | "half" | "full") => {
    const updated = [...selectedItems];
    updated[index].portion_type = portion;
    setSelectedItems(updated);
  };

  const getItemPrice = (item: MenuItem, portion: string) => {
    if (portion === "quarter" && item.quarter_price > 0) return item.quarter_price;
    if (portion === "half" && item.half_price > 0) return item.half_price;
    return item.full_price || item.selling_price;
  };

  const calculateTotalValue = () => {
    return selectedItems.reduce((sum, item) => {
      const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
      if (!menuItem) return sum;
      return sum + getItemPrice(menuItem, item.portion_type) * item.quantity;
    }, 0);
  };

  const openEditDialog = (combo: ComboPackage) => {
    setEditingCombo(combo);
    setSelectedItems(
      combo.items?.map((i) => ({
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
        portion_type: i.portion_type as "quarter" | "half" | "full",
      })) || []
    );
  };

  const renderItemSelector = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Add Menu Items</Label>
        <Select onValueChange={addItemToCombo}>
          <SelectTrigger>
            <SelectValue placeholder="Select item to add..." />
          </SelectTrigger>
          <SelectContent>
            {menuItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name} - {formatCurrency(item.full_price || item.selling_price)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedItems.length > 0 && (
        <div className="space-y-2">
          <Label>Selected Items</Label>
          <div className="border rounded-lg divide-y">
            {selectedItems.map((item, index) => {
              const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
              if (!menuItem) return null;
              const hasVariants = menuItem.quarter_price > 0 || menuItem.half_price > 0;

              return (
                <div key={index} className="p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{menuItem.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(getItemPrice(menuItem, item.portion_type))} each
                    </p>
                  </div>
                  {hasVariants && (
                    <Select
                      value={item.portion_type}
                      onValueChange={(val) => updateItemPortion(index, val as "quarter" | "half" | "full")}
                    >
                      <SelectTrigger className="w-24 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {menuItem.quarter_price > 0 && <SelectItem value="quarter">Qtr</SelectItem>}
                        {menuItem.half_price > 0 && <SelectItem value="half">Half</SelectItem>}
                        <SelectItem value="full">Full</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateItemQuantity(index, parseInt(e.target.value) || 1)}
                    className="w-16 h-8"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeItemFromCombo(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-sm pt-2">
            <span className="text-muted-foreground">Total value:</span>
            <span className="font-medium">{formatCurrency(calculateTotalValue())}</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Combo Packages</h3>
          <p className="text-sm text-muted-foreground">
            Create meal combos by combining menu items at a special price
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const headers = ["Combo Name", "Description", "Price", "Items", "Active"];
              const rows = combos.map(combo => [
                combo.name,
                combo.description || "",
                combo.price,
                combo.items?.map(i => `${i.quantity}x ${i.menu_items?.name || ""} (${i.portion_type})`).join(", ") || "",
                combo.is_active ? "Yes" : "No"
              ]);
              exportToCSV({ headers, rows, filename: "Combo_Packages" });
              toast.success("Combos exported to CSV");
            }}
            disabled={combos.length === 0}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) setSelectedItems([]); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Combo
            </Button>
          </DialogTrigger>
          <DialogContent
            description={
              newCombo.name
                ? `Create combo "${newCombo.name}" - ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} selected.`
                : `Bundle menu items into a combo - ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} selected so far.`
            }
            className="max-w-lg max-h-[90vh] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle>Create Combo Package</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Combo Name</Label>
                <Input
                  value={newCombo.name}
                  onChange={(e) => setNewCombo({ ...newCombo, name: e.target.value })}
                  placeholder="e.g., Family Meal Deal"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  value={newCombo.description}
                  onChange={(e) => setNewCombo({ ...newCombo, description: e.target.value })}
                  placeholder="e.g., Perfect for 4 people"
                />
              </div>

              {renderItemSelector()}

              <div className="space-y-2">
                <Label>Combo Price</Label>
                <Input
                  type="number"
                  value={newCombo.price}
                  onChange={(e) => setNewCombo({ ...newCombo, price: e.target.value })}
                  placeholder="0.00"
                />
                {selectedItems.length > 0 && parseFloat(newCombo.price) > 0 && (
                  <p className="text-xs text-green-600">
                    Savings: {formatCurrency(calculateTotalValue() - parseFloat(newCombo.price))} 
                    ({((1 - parseFloat(newCombo.price) / calculateTotalValue()) * 100).toFixed(0)}% off)
                  </p>
                )}
              </div>

              <Button
                onClick={() => addComboMutation.mutate()}
                disabled={!newCombo.name || selectedItems.length === 0 || addComboMutation.isPending}
                className="w-full"
              >
                Create Combo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Combo List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
      ) : combos.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No combo packages yet</p>
            <p className="text-sm text-muted-foreground">Create your first combo to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {combos.map((combo) => (
            <Card key={combo.id} className={!combo.is_active ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      {combo.name}
                      {!combo.is_active && <Badge variant="secondary">Inactive</Badge>}
                    </CardTitle>
                    {combo.description && (
                      <p className="text-sm text-muted-foreground mt-1">{combo.description}</p>
                    )}
                  </div>
                  <p className="text-lg font-semibold">{formatCurrency(combo.price)}</p>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {combo.items?.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span>
                        {item.quantity}x {item.menu_items?.name}
                        {item.portion_type !== "full" && (
                          <span className="text-muted-foreground ml-1">
                            ({item.portion_type})
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={combo.is_active}
                      onCheckedChange={(checked) =>
                        toggleActiveMutation.mutate({ id: combo.id, is_active: checked })
                      }
                    />
                    <span className="text-sm text-muted-foreground">Active</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditDialog(combo)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => deleteComboMutation.mutate(combo.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingCombo} onOpenChange={() => { setEditingCombo(null); setSelectedItems([]); }}>
        <DialogContent
          description={
            editingCombo
              ? `Edit combo "${editingCombo.name}" - ${formatCurrency(editingCombo.price)}, ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}.`
              : "Edit combo package."
          }
          className="max-w-lg max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Edit Combo Package</DialogTitle>
          </DialogHeader>
          {editingCombo && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Combo Name</Label>
                <Input
                  value={editingCombo.name}
                  onChange={(e) => setEditingCombo({ ...editingCombo, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  value={editingCombo.description || ""}
                  onChange={(e) => setEditingCombo({ ...editingCombo, description: e.target.value })}
                />
              </div>

              {renderItemSelector()}

              <div className="space-y-2">
                <Label>Combo Price</Label>
                <Input
                  type="number"
                  value={editingCombo.price}
                  onChange={(e) => setEditingCombo({ ...editingCombo, price: parseFloat(e.target.value) || 0 })}
                />
                {selectedItems.length > 0 && editingCombo.price > 0 && (
                  <p className="text-xs text-green-600">
                    Savings: {formatCurrency(calculateTotalValue() - editingCombo.price)} 
                    ({((1 - editingCombo.price / calculateTotalValue()) * 100).toFixed(0)}% off)
                  </p>
                )}
              </div>

              <Button
                onClick={() => updateComboMutation.mutate()}
                disabled={!editingCombo.name || selectedItems.length === 0 || updateComboMutation.isPending}
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
