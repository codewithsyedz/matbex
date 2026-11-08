import { useState, useEffect } from "react";
import { Plus, Trash, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

interface WasteRecord {
  id: string;
  inventory_item_id: string;
  quantity_wasted: number;
  unit_cost: number;
  total_cost: number;
  waste_reason: string;
  notes: string | null;
  waste_date: string;
  ledger_posted: boolean;
  inventory_items: { name: string; unit: string } | null;
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  unit_cost: number;
  current_stock: number;
}

const WASTE_REASONS = [
  { value: "expired", label: "Expired" },
  { value: "spoiled", label: "Spoiled" },
  { value: "damaged", label: "Damaged" },
  { value: "preparation_waste", label: "Preparation Waste" },
  { value: "customer_return", label: "Customer Return" },
  { value: "quality_issue", label: "Quality Issue" },
  { value: "other", label: "Other" },
];

export function WasteTracker() {
  const { restaurant, user } = useAuth();
  const { toast } = useToast();
  const [wasteRecords, setWasteRecords] = useState<WasteRecord[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedItem, setSelectedItem] = useState("");
  const [quantity, setQuantity] = useState("");
  const [wasteReason, setWasteReason] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;
    
    try {
      const [wasteRes, itemsRes] = await Promise.all([
        supabase
          .from("waste_records")
          .select("id, inventory_item_id, quantity_wasted, unit_cost, total_cost, waste_reason, notes, waste_date, ledger_posted, inventory_items(name, unit)")
          .eq("restaurant_id", restaurant.id)
          .order("waste_date", { ascending: false })
          .limit(50),
        supabase
          .from("inventory_items")
          .select("id, name, unit, unit_cost, current_stock")
          .eq("restaurant_id", restaurant.id)
          .order("name"),
      ]);

      if (wasteRes.error) throw wasteRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setWasteRecords(wasteRes.data || []);
      setInventoryItems(itemsRes.data || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedItem || !quantity || !wasteReason || !restaurant?.id || !user?.id) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    const item = inventoryItems.find(i => i.id === selectedItem);
    if (!item) return;

    const qty = parseFloat(quantity);
    if (qty > item.current_stock) {
      toast({ title: "Error", description: "Cannot waste more than current stock", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const total = qty * item.unit_cost;

      // Insert waste record
      const { error: wasteError } = await supabase
        .from("waste_records")
        .insert({
          restaurant_id: restaurant.id,
          inventory_item_id: selectedItem,
          quantity_wasted: qty,
          unit_cost: item.unit_cost,
          total_cost: total,
          waste_reason: wasteReason,
          notes: notes.trim() || null,
          recorded_by: user.id,
        });

      if (wasteError) throw wasteError;

      // Deduct from inventory
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ current_stock: item.current_stock - qty })
        .eq("id", selectedItem);

      if (updateError) throw updateError;

      toast({ title: "Waste recorded", description: `${qty} ${item.unit} of ${item.name} removed from stock` });
      fetchData();
      closeDialog();
    } catch (error: any) {
      console.error("Error saving waste:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelectedItem("");
    setQuantity("");
    setWasteReason("");
    setNotes("");
  };

  const totalWasteCost = wasteRecords.reduce((sum, w) => sum + w.total_cost, 0);
  const selectedItemData = inventoryItems.find(i => i.id === selectedItem);

  const getReasonLabel = (value: string) => {
    return WASTE_REASONS.find(r => r.value === value)?.label || value;
  };

  const getReasonColor = (reason: string) => {
    switch (reason) {
      case "expired":
      case "spoiled":
        return "bg-red-500/10 text-red-600";
      case "preparation_waste":
        return "bg-amber-500/10 text-amber-600";
      case "customer_return":
        return "bg-blue-500/10 text-blue-600";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Waste Tracking
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Total waste cost: {totalWasteCost.toFixed(2)} {restaurant?.currency || "SAR"}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Record Waste
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Record Waste</DialogTitle>
              <DialogDescription>
                Record spoiled or wasted inventory
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Inventory Item *</Label>
                <Select value={selectedItem} onValueChange={setSelectedItem}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select item" />
                  </SelectTrigger>
                  <SelectContent>
                    {inventoryItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} ({item.current_stock} {item.unit} in stock)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quantity Wasted *</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    min="0"
                    max={selectedItemData?.current_stock || 0}
                    step="0.01"
                  />
                  {selectedItemData && (
                    <p className="text-xs text-muted-foreground">
                      Max: {selectedItemData.current_stock} {selectedItemData.unit}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Reason *</Label>
                  <Select value={wasteReason} onValueChange={setWasteReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {WASTE_REASONS.map((reason) => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Additional details..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>

              {selectedItemData && quantity && (
                <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                  <div className="flex justify-between text-sm">
                    <span className="text-destructive">Waste Cost:</span>
                    <span className="font-semibold text-destructive">
                      {((parseFloat(quantity) || 0) * selectedItemData.unit_cost).toFixed(2)} {restaurant?.currency || "SAR"}
                    </span>
                  </div>
                </div>
              )}

              <Button 
                className="w-full" 
                variant="destructive"
                onClick={handleSave}
                disabled={submitting || !selectedItem || !quantity || !wasteReason}
              >
                {submitting ? "Saving..." : "Record Waste"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : wasteRecords.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Trash className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No waste recorded yet</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Ledger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wasteRecords.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="text-sm">
                    {format(new Date(record.waste_date), "MMM d")}
                  </TableCell>
                  <TableCell className="font-medium">
                    {record.inventory_items?.name || "-"}
                  </TableCell>
                  <TableCell>
                    {record.quantity_wasted} {record.inventory_items?.unit}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={getReasonColor(record.waste_reason)}>
                      {getReasonLabel(record.waste_reason)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-destructive">
                    -{record.total_cost.toFixed(2)} {restaurant?.currency || "SAR"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={record.ledger_posted ? "default" : "outline"} className={record.ledger_posted ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : ""}>
                      {record.ledger_posted ? "Posted" : "Pending"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
