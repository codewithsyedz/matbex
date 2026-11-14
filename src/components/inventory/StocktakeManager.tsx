import { useState, useEffect } from "react";
import { ClipboardList, Plus, Check, X, ChevronRight, ArrowUpDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Stocktake {
  id: string;
  stocktake_date: string;
  status: string;
  notes: string | null;
  total_expected_value: number;
  total_counted_value: number;
  total_variance_value: number;
  created_at: string;
}

interface StocktakeItem {
  id: string;
  stocktake_id: string;
  inventory_item_id: string;
  expected_quantity: number;
  counted_quantity: number | null;
  unit_cost: number;
  variance_quantity: number;
  variance_value: number;
  notes: string | null;
  inventory_items?: { name: string; unit: string };
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  unit_cost: number;
}

export function StocktakeManager() {
  const { restaurant, isManager, user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { toast } = useToast();
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedStocktake, setSelectedStocktake] = useState<Stocktake | null>(null);
  const [stocktakeItems, setStocktakeItems] = useState<StocktakeItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");
  const [countValues, setCountValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;
    
    try {
      const [stocktakesRes, itemsRes] = await Promise.all([
        db
          .from("stocktakes")
          .select("*")
          .eq("restaurant_id", restaurant.id)
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("inventory_items")
          .select("id, name, unit, current_stock, unit_cost")
          .eq("restaurant_id", restaurant.id)
          .order("name"),
      ]);

      if (stocktakesRes.error) throw stocktakesRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setStocktakes(stocktakesRes.data || []);
      setInventoryItems(itemsRes.data || []);
    } catch (error) {
      console.error("Error fetching stocktake data:", error);
    } finally {
      setLoading(false);
    }
  };

  const createStocktake = async () => {
    if (!restaurant?.id || !user?.id) return;
    
    setSubmitting(true);
    try {
      // Create stocktake
      const { data: stocktake, error: stocktakeError } = await db
        .from("stocktakes")
        .insert({
          restaurant_id: restaurant.id,
          notes: notes.trim() || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (stocktakeError) throw stocktakeError;

      // Create stocktake items from current inventory
      const itemsToInsert = inventoryItems.map(item => ({
        stocktake_id: stocktake.id,
        inventory_item_id: item.id,
        expected_quantity: item.current_stock,
        unit_cost: item.unit_cost,
      }));

      const { error: itemsError } = await db
        .from("stocktake_items")
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      toast({ title: "Stocktake created" });
      setNotes("");
      setDialogOpen(false);
      fetchData();
      
      // Open the new stocktake for counting
      openStocktakeDetail(stocktake);
    } catch (error: any) {
      console.error("Error creating stocktake:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const openStocktakeDetail = async (stocktake: Stocktake) => {
    setSelectedStocktake(stocktake);
    setCountValues({});
    
    try {
      const { data, error } = await db
        .from("stocktake_items")
        .select("*, inventory_items(name, unit)")
        .eq("stocktake_id", stocktake.id)
        .order("inventory_items(name)");

      if (error) throw error;
      
      setStocktakeItems(data || []);
      
      // Pre-fill count values
      const values: Record<string, string> = {};
      (data || []).forEach(item => {
        if (item.counted_quantity !== null) {
          values[item.id] = item.counted_quantity.toString();
        }
      });
      setCountValues(values);
      
      setDetailDialogOpen(true);
    } catch (error) {
      console.error("Error fetching stocktake items:", error);
    }
  };

  const updateCount = async (itemId: string, value: string) => {
    setCountValues(prev => ({ ...prev, [itemId]: value }));
  };

  const saveCount = async (itemId: string) => {
    const value = countValues[itemId];
    const numValue = value === "" ? null : parseFloat(value);
    
    try {
      const { error } = await db
        .from("stocktake_items")
        .update({ counted_quantity: numValue })
        .eq("id", itemId);

      if (error) throw error;
      
      // Refresh items
      const { data } = await db
        .from("stocktake_items")
        .select("*, inventory_items(name, unit)")
        .eq("stocktake_id", selectedStocktake?.id)
        .order("inventory_items(name)");
      
      setStocktakeItems(data || []);
    } catch (error) {
      console.error("Error saving count:", error);
    }
  };

  const completeStocktake = async () => {
    if (!selectedStocktake || !user?.id) return;
    
    // Check all items are counted
    const uncountedItems = stocktakeItems.filter(item => item.counted_quantity === null);
    if (uncountedItems.length > 0) {
      toast({ 
        title: "Incomplete", 
        description: `${uncountedItems.length} item(s) not yet counted`,
        variant: "destructive" 
      });
      return;
    }

    setSubmitting(true);
    try {
      // Calculate totals
      const totalExpected = stocktakeItems.reduce((sum, item) => sum + item.expected_quantity * item.unit_cost, 0);
      const totalCounted = stocktakeItems.reduce((sum, item) => sum + (item.counted_quantity || 0) * item.unit_cost, 0);
      const totalVariance = totalCounted - totalExpected;

      // Update stocktake
      const { error: updateError } = await db
        .from("stocktakes")
        .update({
          status: "completed",
          completed_by: user.id,
          completed_at: new Date().toISOString(),
          total_expected_value: totalExpected,
          total_counted_value: totalCounted,
          total_variance_value: totalVariance,
        })
        .eq("id", selectedStocktake.id);

      if (updateError) throw updateError;

      // Update inventory levels to match counted quantities
      for (const item of stocktakeItems) {
        if (item.counted_quantity !== null) {
          const { error } = await db
            .from("inventory_items")
            .update({ current_stock: item.counted_quantity })
            .eq("id", item.inventory_item_id);
          
          if (error) console.error("Error updating inventory:", error);
        }
      }

      toast({ title: "Stocktake completed", description: "Inventory levels updated" });
      setDetailDialogOpen(false);
      fetchData();
    } catch (error: any) {
      console.error("Error completing stocktake:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const getVarianceColor = (variance: number) => {
    if (variance === 0) return "text-muted-foreground";
    return variance > 0 ? "text-emerald-600" : "text-red-600";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Stocktake / Physical Count</CardTitle>
          <CardDescription>Verify inventory levels and track variances</CardDescription>
        </div>
        {isManager && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                New Stocktake
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Start New Stocktake</DialogTitle>
                <DialogDescription>
                  Create a new stocktake to verify physical inventory counts
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <p className="text-sm font-medium">{inventoryItems.length} items will be included</p>
                  <p className="text-xs text-muted-foreground">
                    Current stock levels will be used as expected quantities
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    placeholder="e.g., Monthly stocktake, post-event inventory check..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button 
                  className="w-full" 
                  onClick={createStocktake}
                  disabled={submitting || inventoryItems.length === 0}
                >
                  {submitting ? "Creating..." : "Start Stocktake"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : stocktakes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <ClipboardList className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No stocktakes yet</p>
            <p className="text-sm">Start a stocktake to verify inventory levels</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stocktakes.map((stocktake) => (
                <TableRow 
                  key={stocktake.id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openStocktakeDetail(stocktake)}
                >
                  <TableCell>
                    {format(new Date(stocktake.stocktake_date), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    {stocktake.status === "completed" ? (
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
                        <Check className="h-3 w-3 mr-1" />
                        Completed
                      </Badge>
                    ) : stocktake.status === "cancelled" ? (
                      <Badge variant="secondary" className="bg-muted">
                        <X className="h-3 w-3 mr-1" />
                        Cancelled
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
                        <ClipboardList className="h-3 w-3 mr-1" />
                        In Progress
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {stocktake.status === "completed" ? formatCurrency(stocktake.total_expected_value) : "-"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {stocktake.status === "completed" ? formatCurrency(stocktake.total_counted_value) : "-"}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono text-sm", getVarianceColor(stocktake.total_variance_value))}>
                    {stocktake.status === "completed" ? (
                      <>
                        {stocktake.total_variance_value >= 0 ? "+" : ""}
                        {formatCurrency(stocktake.total_variance_value)}
                      </>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Stocktake - {selectedStocktake && format(new Date(selectedStocktake.stocktake_date), "MMMM d, yyyy")}
              {selectedStocktake?.status === "completed" && (
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
                  Completed
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedStocktake?.status === "draft" 
                ? "Enter counted quantities for each item"
                : "View stocktake results and variances"}
            </DialogDescription>
          </DialogHeader>

          {selectedStocktake?.status === "completed" && (
            <div className="grid grid-cols-3 gap-4 py-4">
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <p className="text-sm text-muted-foreground">Expected Value</p>
                <p className="text-lg font-semibold">{formatCurrency(selectedStocktake.total_expected_value)}</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 text-center">
                <p className="text-sm text-muted-foreground">Counted Value</p>
                <p className="text-lg font-semibold">{formatCurrency(selectedStocktake.total_counted_value)}</p>
              </div>
              <div className={cn(
                "p-4 rounded-lg text-center",
                selectedStocktake.total_variance_value >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"
              )}>
                <p className="text-sm text-muted-foreground">Variance</p>
                <p className={cn("text-lg font-semibold", getVarianceColor(selectedStocktake.total_variance_value))}>
                  {selectedStocktake.total_variance_value >= 0 ? "+" : ""}
                  {formatCurrency(selectedStocktake.total_variance_value)}
                </p>
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right w-32">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stocktakeItems.map((item) => {
                const variance = (item.counted_quantity ?? 0) - item.expected_quantity;
                const varianceValue = variance * item.unit_cost;
                const hasVariance = item.counted_quantity !== null && variance !== 0;
                
                return (
                  <TableRow key={item.id} className={hasVariance ? (variance > 0 ? "bg-emerald-500/5" : "bg-red-500/5") : ""}>
                    <TableCell>
                      <div className="font-medium">{item.inventory_items?.name}</div>
                      <div className="text-xs text-muted-foreground">{item.inventory_items?.unit}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {item.expected_quantity}
                    </TableCell>
                    <TableCell className="text-right">
                      {selectedStocktake?.status === "draft" ? (
                        <Input
                          type="number"
                          className="w-24 h-8 text-right font-mono ml-auto"
                          placeholder="0"
                          value={countValues[item.id] ?? ""}
                          onChange={(e) => updateCount(item.id, e.target.value)}
                          onBlur={() => saveCount(item.id)}
                          min="0"
                          step="0.01"
                        />
                      ) : (
                        <span className="font-mono text-sm">{item.counted_quantity ?? "-"}</span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-sm", getVarianceColor(variance))}>
                      {item.counted_quantity !== null ? (
                        <>
                          {variance >= 0 ? "+" : ""}{variance.toFixed(2)}
                        </>
                      ) : "-"}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-sm", getVarianceColor(varianceValue))}>
                      {item.counted_quantity !== null ? (
                        <>
                          {varianceValue >= 0 ? "+" : ""}{formatCurrency(varianceValue)}
                        </>
                      ) : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {selectedStocktake?.status === "draft" && isManager && (
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
                Save & Close
              </Button>
              <Button onClick={completeStocktake} disabled={submitting}>
                {submitting ? "Completing..." : "Complete Stocktake"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
