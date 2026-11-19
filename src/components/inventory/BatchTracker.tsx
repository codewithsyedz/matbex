import { useState, useEffect } from "react";
import { Plus, Package, Calendar, AlertTriangle, Pencil, Trash2 } from "lucide-react";
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
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { format, differenceInDays, isPast, addDays } from "date-fns";

interface Batch {
  id: string;
  inventory_item_id: string;
  batch_number: string;
  quantity: number;
  unit_cost: number;
  manufacture_date: string | null;
  expiry_date: string | null;
  received_date: string;
  supplier_id: string | null;
  notes: string | null;
  status: string;
  inventory_items: { name: string; unit: string } | null;
  suppliers: { name: string } | null;
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
}

interface Supplier {
  id: string;
  name: string;
}

export function BatchTracker() {
  const { restaurant, isManager, user } = useAuth();
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedItem, setSelectedItem] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;
    
    try {
      const [batchesRes, itemsRes, suppliersRes] = await Promise.all([
        db
          .from("inventory_batches")
          .select("*, inventory_items(name, unit), suppliers(name)")
          .eq("restaurant_id", restaurant.id)
          .eq("status", "active")
          .order("expiry_date", { ascending: true, nullsFirst: false }),
        db
          .from("inventory_items")
          .select("id, name, unit")
          .eq("restaurant_id", restaurant.id)
          .order("name"),
        db
          .from("suppliers")
          .select("id, name")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
          .order("name"),
      ]);

      if (batchesRes.error) throw batchesRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (suppliersRes.error) throw suppliersRes.error;

      setBatches(batchesRes.data || []);
      setInventoryItems(itemsRes.data || []);
      setSuppliers(suppliersRes.data || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedItem || !batchNumber.trim() || !quantity || !restaurant?.id) {
      toast({ title: "Error", description: "Please fill required fields", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const batchData = {
        restaurant_id: restaurant.id,
        inventory_item_id: selectedItem,
        batch_number: batchNumber.trim(),
        quantity: parseFloat(quantity),
        unit_cost: parseFloat(unitCost) || 0,
        manufacture_date: manufactureDate || null,
        expiry_date: expiryDate || null,
        supplier_id: selectedSupplier || null,
        notes: notes.trim() || null,
      };

      if (editingBatch) {
        const { error } = await db
          .from("inventory_batches")
          .update(batchData)
          .eq("id", editingBatch.id);

        if (error) throw error;
        toast({ title: "Batch updated" });
      } else {
        const { error } = await db
          .from("inventory_batches")
          .insert(batchData);

        if (error) throw error;
        toast({ title: "Batch added" });
      }

      fetchData();
      closeDialog();
    } catch (error: any) {
      console.error("Error saving batch:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (batch: Batch) => {
    if (!confirm(`Delete batch "${batch.batch_number}"?`)) return;

    try {
      const { error } = await db
        .from("inventory_batches")
        .update({ status: "deleted" })
        .eq("id", batch.id);

      if (error) throw error;
      toast({ title: "Batch deleted" });
      fetchData();
    } catch (error: any) {
      console.error("Error deleting batch:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const openEditDialog = (batch: Batch) => {
    setEditingBatch(batch);
    setSelectedItem(batch.inventory_item_id);
    setBatchNumber(batch.batch_number);
    setQuantity(batch.quantity.toString());
    setUnitCost(batch.unit_cost.toString());
    setManufactureDate(batch.manufacture_date || "");
    setExpiryDate(batch.expiry_date || "");
    setSelectedSupplier(batch.supplier_id || "");
    setNotes(batch.notes || "");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingBatch(null);
    setSelectedItem("");
    setBatchNumber("");
    setQuantity("");
    setUnitCost("");
    setManufactureDate("");
    setExpiryDate("");
    setSelectedSupplier("");
    setNotes("");
  };

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return "none";
    const expiry = new Date(expiryDate);
    if (isPast(expiry)) return "expired";
    const daysUntil = differenceInDays(expiry, new Date());
    if (daysUntil <= 7) return "warning";
    if (daysUntil <= 30) return "caution";
    return "ok";
  };

  const expiringBatches = batches.filter(b => {
    const status = getExpiryStatus(b.expiry_date);
    return status === "expired" || status === "warning";
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Batch / Lot Tracking</CardTitle>
          {expiringBatches.length > 0 && (
            <p className="text-sm text-amber-600 mt-1 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              {expiringBatches.length} batch(es) expired or expiring soon
            </p>
          )}
        </div>
        {isManager && (
          <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Batch
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingBatch ? "Edit Batch" : "Add Batch"}</DialogTitle>
                <DialogDescription>
                  Track inventory by batch/lot with expiry dates
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Inventory Item *</Label>
                    <Select value={selectedItem} onValueChange={setSelectedItem}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {inventoryItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Batch/Lot Number *</Label>
                    <Input
                      placeholder="e.g., LOT-2024-001"
                      value={batchNumber}
                      onChange={(e) => setBatchNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Quantity *</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Unit Cost ({restaurant?.currency || "SAR"})</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={unitCost}
                      onChange={(e) => setUnitCost(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Manufacture Date</Label>
                    <Input
                      type="date"
                      value={manufactureDate}
                      onChange={(e) => setManufactureDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Expiry Date</Label>
                    <Input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    placeholder="Additional notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                <Button 
                  className="w-full" 
                  onClick={handleSave}
                  disabled={submitting || !selectedItem || !batchNumber.trim() || !quantity}
                >
                  {submitting ? "Saving..." : editingBatch ? "Update Batch" : "Add Batch"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : batches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No batches tracked yet</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch #</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                {isManager && <TableHead className="w-20">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => {
                const expiryStatus = getExpiryStatus(batch.expiry_date);
                const daysUntilExpiry = batch.expiry_date 
                  ? differenceInDays(new Date(batch.expiry_date), new Date())
                  : null;
                
                return (
                  <TableRow key={batch.id} className={expiryStatus === "expired" ? "bg-red-500/5" : ""}>
                    <TableCell className="font-mono text-sm">{batch.batch_number}</TableCell>
                    <TableCell className="font-medium">{batch.inventory_items?.name}</TableCell>
                    <TableCell>{batch.quantity} {batch.inventory_items?.unit}</TableCell>
                    <TableCell>
                      {batch.expiry_date ? (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className={
                            expiryStatus === "expired" ? "text-red-600" :
                            expiryStatus === "warning" ? "text-amber-600" :
                            "text-muted-foreground"
                          }>
                            {format(new Date(batch.expiry_date), "MMM d, yyyy")}
                            {daysUntilExpiry !== null && (
                              <span className="text-xs ml-1">
                                ({daysUntilExpiry < 0 ? `${Math.abs(daysUntilExpiry)}d ago` : `${daysUntilExpiry}d`})
                              </span>
                            )}
                          </span>
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {batch.suppliers?.name || "-"}
                    </TableCell>
                    <TableCell>
                      {expiryStatus === "expired" && (
                        <Badge variant="destructive">Expired</Badge>
                      )}
                      {expiryStatus === "warning" && (
                        <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
                          Expiring Soon
                        </Badge>
                      )}
                      {expiryStatus === "caution" && (
                        <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600">
                          {daysUntilExpiry}d left
                        </Badge>
                      )}
                      {(expiryStatus === "ok" || expiryStatus === "none") && (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
                          Good
                        </Badge>
                      )}
                    </TableCell>
                    {isManager && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(batch)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(batch)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
