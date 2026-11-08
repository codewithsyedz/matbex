import { useState } from "react";
import { qk } from "@/lib/query/queryKeys";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, Package, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";

interface InventoryUsage {
  id: string;
  inventory_item_id: string;
  quantity_used: number;
  unit_cost: number;
  total_cost: number;
  usage_date: string;
  notes: string | null;
  inventory_items?: { name: string; unit: string };
}

interface InventoryUsageTrackerProps {
  selectedDate?: Date;
  shiftId?: string;
}

export function InventoryUsageTracker({ selectedDate = new Date(), shiftId }: InventoryUsageTrackerProps) {
  const { restaurant, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const [isAdding, setIsAdding] = useState(false);
  const [newUsage, setNewUsage] = useState({ itemId: "", quantity: "", notes: "" });

  // Fetch inventory items
  const { data: inventoryItems } = useQuery({
    queryKey: ["inventory-items", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch usage for the day
  const { data: usageData, isLoading } = useQuery({
    queryKey: ["inventory-usage", restaurant?.id, dateStr],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("inventory_usage")
        .select("*, inventory_items(name, unit)")
        .eq("restaurant_id", restaurant.id)
        .eq("usage_date", dateStr)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as InventoryUsage[];
    },
    enabled: !!restaurant?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (item: { inventory_item_id: string; quantity_used: number; notes?: string }) => {
      if (!restaurant?.id || !user?.id) throw new Error("Not authenticated");
      
      // Get the item's unit cost and current stock
      const inventoryItem = inventoryItems?.find(i => i.id === item.inventory_item_id);
      if (!inventoryItem) throw new Error("Inventory item not found");
      
      const unitCost = Number(inventoryItem.unit_cost);
      const totalCost = item.quantity_used * unitCost;
      const currentStock = Number(inventoryItem.current_stock);

      // Frontend validation for negative inventory (DB trigger will also enforce)
      if (item.quantity_used > currentStock) {
        throw new Error(`Insufficient stock: Available ${currentStock} ${inventoryItem.unit}, requested ${item.quantity_used}`);
      }

      const { data, error } = await supabase
        .from("inventory_usage")
        .insert({
          restaurant_id: restaurant.id,
          inventory_item_id: item.inventory_item_id,
          quantity_used: item.quantity_used,
          unit_cost: unitCost,
          total_cost: totalCost,
          usage_date: dateStr,
          shift_id: shiftId || null,
          notes: item.notes || null,
          created_by: user.id,
        })
        .select("*, inventory_items(name, unit)")
        .single();
      
      if (error) {
        // Parse database validation errors
        if (error.message.includes('VALIDATION_ERROR:')) {
          const cleanMessage = error.message.replace(/.*VALIDATION_ERROR:\s*/, '').replace(/\s*CONTEXT:.*/, '');
          throw new Error(cleanMessage);
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-usage"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("inventory-usage") });
      queryClient.invalidateQueries({ queryKey: ["unposted-cogs-usage"] });
      toast.success("Usage recorded - inventory auto-deducted");
      setNewUsage({ itemId: "", quantity: "", notes: "" });
      setIsAdding(false);
    },
    onError: (err: Error) => {
      console.error(err);
      toast.error(err.message || "Failed to record usage");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("inventory_usage")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-usage"] });
      queryClient.invalidateQueries({ queryKey: qk.dailyProfit.entityAll("inventory-usage") });
      toast.success("Usage entry removed");
    },
    onError: () => toast.error("Failed to remove entry"),
  });

  const handleAdd = () => {
    const quantity = parseFloat(newUsage.quantity);
    if (!newUsage.itemId || isNaN(quantity) || quantity <= 0) {
      toast.error("Please select an item and enter a valid quantity");
      return;
    }
    createMutation.mutate({
      inventory_item_id: newUsage.itemId,
      quantity_used: quantity,
      notes: newUsage.notes,
    });
  };

  const totalCost = usageData?.reduce((sum, u) => sum + Number(u.total_cost), 0) || 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56 mt-1" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-medium">Inventory Usage</CardTitle>
            <CardDescription>
              Track daily food & beverage consumption
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {format(selectedDate, "MMM d, yyyy")}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
          <div>
            <p className="text-sm text-muted-foreground">Items Used Today</p>
            <p className="text-2xl font-semibold">{usageData?.length || 0}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total Cost</p>
            <p className="text-lg font-medium text-primary">{formatCurrency(totalCost)}</p>
          </div>
        </div>

        {/* Usage List */}
        <div className="space-y-2">
          {usageData?.map((usage) => (
            <div
              key={usage.id}
              className="flex items-center gap-4 p-3 rounded-lg border bg-card"
            >
              <div className="p-2 rounded-md bg-accent/50">
                <Package className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{usage.inventory_items?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {usage.quantity_used} {usage.inventory_items?.unit} @ {formatCurrency(usage.unit_cost)} each
                  {usage.notes && ` • ${usage.notes}`}
                </p>
              </div>
              <p className="text-sm font-medium">{formatCurrency(usage.total_cost)}</p>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => deleteMutation.mutate(usage.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {usageData?.length === 0 && !isAdding && (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No inventory usage recorded today</p>
              <p className="text-xs">Track consumption for accurate food cost</p>
            </div>
          )}
        </div>

        {/* Add New */}
        {isAdding ? (
          <div className="space-y-3 p-3 rounded-lg border border-dashed">
            <Select value={newUsage.itemId} onValueChange={(v) => setNewUsage(p => ({ ...p, itemId: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select inventory item" />
              </SelectTrigger>
              <SelectContent>
                {inventoryItems?.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <span className="flex items-center gap-2">
                      {item.name}
                      <span className="text-muted-foreground text-xs">
                        ({formatCurrency(item.unit_cost)}/{item.unit})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Quantity used"
                value={newUsage.quantity}
                onChange={(e) => setNewUsage(p => ({ ...p, quantity: e.target.value }))}
                className="flex-1"
              />
              <Input
                placeholder="Notes (optional)"
                value={newUsage.notes}
                onChange={(e) => setNewUsage(p => ({ ...p, notes: e.target.value }))}
                className="flex-1"
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleAdd} disabled={createMutation.isPending}>
                Record Usage
              </Button>
              <Button variant="ghost" onClick={() => setIsAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Record Inventory Usage
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
