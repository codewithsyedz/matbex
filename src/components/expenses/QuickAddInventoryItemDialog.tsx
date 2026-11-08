import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, PackagePlus } from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { canAddInventory } from "@/lib/accountantCorrections";

interface QuickAddInventoryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string | null | undefined;
  onCreated?: (item: { id: string; name: string }) => void;
}

/**
 * Minimal inventory item creation form for use inside the expense flow.
 * Captures only the fields needed for itemized invoices (name, unit,
 * unit cost, units per pack, stock unit). Defaults current stock to 0;
 * stock will be incremented by the invoice line itself.
 */
export function QuickAddInventoryItemDialog({
  open,
  onOpenChange,
  restaurantId,
  onCreated,
}: QuickAddInventoryItemDialogProps) {
  const { activeBranchId } = useBranch();
  const { hasRole } = useAuth();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [stockUnit, setStockUnit] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setUnit("");
      setUnitCost("");
      setUnitsPerPack("1");
      setStockUnit("");
      setSaving(false);
    }
  }, [open]);

  const canSubmit = canAddInventory(hasRole) && !!name.trim() && !!restaurantId && !saving;

  const handleSave = async () => {
    if (!canSubmit || !restaurantId) return;
    setSaving(true);
    try {
      const sb = db as any;
      const { data, error } = await sb
        .from("inventory_items")
        .insert({
          restaurant_id: restaurantId,
          branch_id: activeBranchId && activeBranchId !== "all" ? activeBranchId : null,
          name: name.trim(),
          unit: unit.trim() || "unit",
          unit_cost: unitCost ? parseFloat(unitCost) : 0,
          units_per_pack: unitsPerPack ? parseFloat(unitsPerPack) : 1,
          stock_unit: (stockUnit.trim() || unit.trim()) || null,
          current_stock: 0,
          is_active: true,
        })
        .select("id, name")
        .single();
      if (error) throw error;
      toast.success(`Created "${data.name}"`);
      onCreated?.(data);
      onOpenChange(false);
    } catch (e: any) {
      console.error("Quick add inventory item failed", e);
      toast.error(e?.message || "Failed to create item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5" />
            New inventory item
          </DialogTitle>
          <DialogDescription>
            Quick-create an item so you can add it to this invoice. You can
            refine more details (category, supplier, reorder level) later in
            Inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="qa-name">Item name *</Label>
            <Input
              id="qa-name"
              autoFocus
              placeholder="e.g., Chicken breast"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qa-unit">Purchase unit</Label>
              <Input
                id="qa-unit"
                placeholder="kg, pcs, L"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-cost">Unit cost</Label>
              <Input
                id="qa-cost"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qa-upp">Units per pack</Label>
              <Input
                id="qa-upp"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="1"
                value={unitsPerPack}
                onChange={(e) => setUnitsPerPack(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-stock-unit">Stock unit (label)</Label>
              <Input
                id="qa-stock-unit"
                placeholder={unit || "liter, gram, piece"}
                value={stockUnit}
                onChange={(e) => setStockUnit(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
            Create item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
