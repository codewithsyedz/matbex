import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Sliders, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface ManualStockAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultItemId?: string | null;
  onAdjusted?: (info: { movementId: string; itemName: string; signedDelta: number; stockUnit: string }) => void;
}

const ADJUSTMENT_REASONS = [
  { value: 'stocktake_correction', label: 'Stocktake correction' },
  { value: 'damaged', label: 'Damaged / broken' },
  { value: 'expired', label: 'Expired' },
  { value: 'theft_loss', label: 'Theft / loss' },
  { value: 'transfer_in', label: 'Transfer in' },
  { value: 'transfer_out', label: 'Transfer out' },
  { value: 'opening_balance', label: 'Opening balance' },
  { value: 'other', label: 'Other' },
];

export function ManualStockAdjustmentDialog({ open, onOpenChange, defaultItemId, onAdjusted }: ManualStockAdjustmentDialogProps) {
  const { restaurant, profile, user } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = profile?.tenant_id;

  const [itemId, setItemId] = useState<string>("");
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [qty, setQty] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("stocktake_correction");
  const [referenceNumber, setReferenceNumber] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ['inventory-items-for-adjust', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string; unit: string | null; stock_unit: string | null; current_stock: number | null }>;
      const sb = supabase as any;
      const result = await sb
        .from('inventory_items')
        .select('id, name, unit, stock_unit, current_stock')
        .eq('restaurant_id', restaurant.id)
        .eq('is_active', true)
        .order('name');
      if (result.error) throw result.error;
      return result.data || [];
    },
    enabled: !!restaurant?.id && open,
  });

  useEffect(() => {
    if (!open) {
      setItemId("");
      setDirection('add');
      setQty("");
      setReasonCode("stocktake_correction");
      setReferenceNumber("");
      setNotes("");
    } else if (defaultItemId) {
      setItemId(defaultItemId);
    }
  }, [open, defaultItemId]);

  const selected = useMemo(() => items.find(i => i.id === itemId), [items, itemId]);
  const stockUnit = selected?.stock_unit || selected?.unit || 'unit';
  const currentStock = Number(selected?.current_stock) || 0;
  const qtyNum = parseFloat(qty) || 0;
  const signedDelta = direction === 'add' ? qtyNum : -qtyNum;
  const projectedStock = currentStock + signedDelta;
  const wouldGoNegative = projectedStock < 0;
  const reasonLabel = ADJUSTMENT_REASONS.find(r => r.value === reasonCode)?.label || reasonCode;

  const canSubmit = !!itemId && qtyNum > 0 && !!reasonCode && !submitting;

  const handleSubmit = async () => {
    if (!restaurant?.id || !user?.id || !tenantId || !selected) {
      toast.error('Authentication required');
      return;
    }
    if (qtyNum <= 0) {
      toast.error('Enter a quantity greater than zero');
      return;
    }

    setSubmitting(true);
    try {
      const stockBefore = currentStock;
      const stockAfter = stockBefore + signedDelta;

      const { error: updateErr } = await supabase
        .from('inventory_items')
        .update({ current_stock: stockAfter, updated_at: new Date().toISOString() })
        .eq('id', selected.id);
      if (updateErr) throw updateErr;

      const sb = supabase as any;
      const fullReason = [reasonLabel, notes].filter(Boolean).join(' - ');
      const { data: movementRow, error: movementErr } = await sb
        .from('stock_movements')
        .insert({
          tenant_id: tenantId,
          restaurant_id: restaurant.id,
          inventory_item_id: selected.id,
          movement_type: 'adjustment',
          quantity_change: signedDelta,
          stock_before: stockBefore,
          stock_after: stockAfter,
          reason: fullReason || 'Manual adjustment',
          reference_type: 'manual_adjustment',
          reference_id: referenceNumber || null,
          created_by: user.id,
        })
        .select('id')
        .single();
      if (movementErr) throw movementErr;

      toast.success(`Adjusted ${selected.name}: ${signedDelta > 0 ? '+' : ''}${signedDelta.toFixed(2)} ${stockUnit}`);
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items-for-adjust'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      if (movementRow?.id && onAdjusted) {
        onAdjusted({
          movementId: movementRow.id,
          itemName: selected.name,
          signedDelta,
          stockUnit,
        });
      }
      onOpenChange(false);
    } catch (e: any) {
      console.error('Manual adjustment failed', e);
      toast.error(e.message || 'Adjustment failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-primary" />
            Manual Stock Adjustment
          </DialogTitle>
          <DialogDescription>
            Add or remove stock with a reason. Logged to the stock movements audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Inventory item</Label>
            <Select value={itemId || 'none'} onValueChange={(v) => setItemId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">- Select -</SelectItem>
                {items.map(it => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.name} {it.unit && `(${it.unit})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
              <span>Current stock</span>
              <span className="font-mono font-semibold text-foreground">
                {currentStock.toFixed(2)} {stockUnit}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-medium">Direction</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('add')}
                className={`flex items-center justify-center gap-2 rounded-md border-2 p-2 text-sm transition-colors ${
                  direction === 'add'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-medium'
                    : 'border-border hover:border-emerald-500/50'
                }`}
              >
                <ArrowUp className="h-4 w-4" />
                Add stock
              </button>
              <button
                type="button"
                onClick={() => setDirection('remove')}
                className={`flex items-center justify-center gap-2 rounded-md border-2 p-2 text-sm transition-colors ${
                  direction === 'remove'
                    ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 font-medium'
                    : 'border-border hover:border-amber-500/50'
                }`}
              >
                <ArrowDown className="h-4 w-4" />
                Remove stock
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="adj-qty">Quantity ({stockUnit})</Label>
              <Input
                id="adj-qty"
                type="number"
                step="0.01"
                min="0.01"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_REASONS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adj-ref">Reference # <span className="text-muted-foreground text-xs">- optional</span></Label>
            <Input
              id="adj-ref"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Stocktake-2026-04, INV-1234, etc."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adj-notes">Notes <span className="text-muted-foreground text-xs">- optional</span></Label>
            <Textarea
              id="adj-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add context for the audit trail"
              className="min-h-[60px]"
            />
          </div>

          {selected && qtyNum > 0 && (
            <div className={`rounded-md border p-2.5 text-sm ${
              wouldGoNegative
                ? 'border-destructive/40 bg-destructive/5'
                : direction === 'remove'
                  ? 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/20'
                  : 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Change</span>
                <span className={`font-mono font-semibold ${
                  direction === 'remove' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
                }`}>
                  {signedDelta > 0 ? '+' : ''}{signedDelta.toFixed(2)} {stockUnit}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-border/50">
                <span className="text-xs text-muted-foreground">
                  {currentStock.toFixed(2)} → <span className={wouldGoNegative ? 'text-destructive font-semibold' : 'text-foreground font-semibold'}>
                    {projectedStock.toFixed(2)} {stockUnit}
                  </span>
                </span>
                {wouldGoNegative && (
                  <span className="text-[11px] text-destructive font-medium">Would go negative</span>
                )}
              </div>
            </div>
          )}

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This adjustment is logged to <strong>stock_movements</strong> with reason and reference for full traceability.
            </AlertDescription>
          </Alert>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Adjustment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
