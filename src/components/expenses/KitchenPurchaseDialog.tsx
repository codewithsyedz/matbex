import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ChefHat, Plus, Trash2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useExpenseApproval, PaymentMethod } from "@/hooks/useExpenseApproval";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";

interface KitchenPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

interface LineItem {
  id: string;
  inventoryItemId: string;
  quantity: string;
  unitCost: string;
}

export function KitchenPurchaseDialog({ open, onOpenChange }: KitchenPurchaseDialogProps) {
  const { restaurant, profile } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { createExpense } = useExpenseApproval();
  const tenantId = profile?.tenant_id;

  const [purchaseDate, setPurchaseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [supplierId, setSupplierId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid'>('paid');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [items, setItems] = useState<LineItem[]>([
    { id: crypto.randomUUID(), inventoryItemId: '', quantity: '1', unitCost: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // Inventory items (with cost + units_per_pack so we can compute stock change)
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ['kitchen-purchase-inventory', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string; unit: string | null; unit_cost: number | null; default_cogs_account_id: string | null; current_stock: number | null; units_per_pack: number | null; stock_unit: string | null }>;
      const sb = supabase as any;
      const result = await sb
        .from('inventory_items')
        .select('id, name, unit, unit_cost, default_cogs_account_id, current_stock, units_per_pack, stock_unit')
        .eq('restaurant_id', restaurant.id)
        .eq('is_active', true)
        .order('name');
      if (result.error) throw result.error;
      return result.data || [];
    },
    enabled: !!restaurant?.id && open,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['kitchen-purchase-suppliers', restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Array<{ id: string; name: string }>;
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('restaurant_id', restaurant.id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurant?.id && open,
  });

  // Reset on close
  useEffect(() => {
    if (!open) {
      setPurchaseDate(format(new Date(), 'yyyy-MM-dd'));
      setSupplierId('');
      setPaymentMethod('cash');
      setPaymentStatus('paid');
      setReferenceNumber('');
      setItems([{ id: crypto.randomUUID(), inventoryItemId: '', quantity: '1', unitCost: '' }]);
    }
  }, [open]);

  const updateItem = (id: string, patch: Partial<LineItem>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  };

  const addLine = () => {
    setItems(prev => [...prev, { id: crypto.randomUUID(), inventoryItemId: '', quantity: '1', unitCost: '' }]);
  };

  const removeLine = (id: string) => {
    setItems(prev => (prev.length === 1 ? prev : prev.filter(it => it.id !== id)));
  };

  // Auto-fill unit cost when an inventory item is selected
  const onSelectInventoryItem = (lineId: string, invId: string) => {
    const inv = inventoryItems.find(i => i.id === invId);
    updateItem(lineId, {
      inventoryItemId: invId,
      unitCost: inv?.unit_cost ? String(inv.unit_cost) : '',
    });
  };

  const totals = useMemo(() => {
    let total = 0;
    let validLines = 0;
    for (const it of items) {
      const q = parseFloat(it.quantity) || 0;
      const c = parseFloat(it.unitCost) || 0;
      if (it.inventoryItemId && q > 0 && c >= 0) {
        total += q * c;
        validLines += 1;
      }
    }
    return { total, validLines };
  }, [items]);

  const supplierName = useMemo(
    () => suppliers.find(s => s.id === supplierId)?.name || '',
    [suppliers, supplierId]
  );

  const canSubmit = totals.validLines > 0 && !submitting;

  const handleSubmit = async () => {
    if (!tenantId || !restaurant?.id) {
      toast.error('Authentication required');
      return;
    }
    if (totals.validLines === 0) {
      toast.error('Add at least one inventory item with quantity and cost');
      return;
    }

    setSubmitting(true);
    let success = 0;
    let failed = 0;

    for (const it of items) {
      const q = parseFloat(it.quantity) || 0;
      const c = parseFloat(it.unitCost) || 0;
      if (!it.inventoryItemId || q <= 0 || c < 0) continue;

      const inv = inventoryItems.find(i => i.id === it.inventoryItemId);
      if (!inv) continue;

      // Need an account: prefer the inventory item's default COGS account
      if (!inv.default_cogs_account_id) {
        toast.error(`${inv.name}: missing default account mapping. Set it in Inventory.`);
        failed += 1;
        continue;
      }

      const lineAmount = q * c;
      const reasonParts = [
        'Kitchen Purchase',
        supplierName ? `from ${supplierName}` : null,
        referenceNumber ? `(ref ${referenceNumber})` : null,
      ].filter(Boolean).join(' ');

      try {
        await new Promise<void>((resolve, reject) => {
          createExpense.mutate(
            {
              amount: lineAmount,
              description: reasonParts,
              expense_date: purchaseDate,
              account_id: inv.default_cogs_account_id!,
              payment_method: paymentMethod,
              status: paymentStatus,
              inventory_item_id: it.inventoryItemId,
              quantity: q,
              movement_type: 'purchase',
              movement_reason: reasonParts,
            },
            {
              onSuccess: () => resolve(),
              onError: (e) => reject(e),
            }
          );
        });
        success += 1;
      } catch (e) {
        console.error('Kitchen purchase line failed', e);
        failed += 1;
      }
    }

    setSubmitting(false);
    if (success > 0 && failed === 0) {
      toast.success(`Kitchen purchase saved (${success} item${success > 1 ? 's' : ''})`);
      onOpenChange(false);
    } else if (success > 0 && failed > 0) {
      toast.warning(`Saved ${success}, failed ${failed}`);
    } else if (failed > 0) {
      toast.error('Kitchen purchase failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ChefHat className="h-5 w-5 text-primary" />
            Kitchen Purchase
          </DialogTitle>
          <DialogDescription>
            Record a multi-item kitchen supplier purchase. Stock will increase automatically.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="kp-date">Date</Label>
                <Input
                  id="kp-date"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  max={format(new Date(), 'yyyy-MM-dd')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kp-ref">Invoice / Reference #</Label>
                <Input
                  id="kp-ref"
                  placeholder="INV-1234"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Supplier (optional)</Label>
                <Select value={supplierId || 'none'} onValueChange={(v) => setSupplierId(v === 'none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No supplier</SelectItem>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Payment Status</Label>
              <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as 'paid' | 'unpaid')}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid (AP)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Line items */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Items</Label>
                <Button type="button" size="sm" variant="ghost" className="h-7 gap-1" onClick={addLine}>
                  <Plus className="h-3.5 w-3.5" />
                  Add line
                </Button>
              </div>

              <div className="space-y-2">
                {items.map((line, idx) => {
                  const inv = inventoryItems.find(i => i.id === line.inventoryItemId);
                  const stockUnit = inv?.stock_unit || inv?.unit || 'unit';
                  const purchaseUnit = inv?.unit || 'unit';
                  const upp = Number(inv?.units_per_pack) || 1;
                  const qty = parseFloat(line.quantity) || 0;
                  const cost = parseFloat(line.unitCost) || 0;
                  const stockDelta = qty * upp;
                  const lineTotal = qty * cost;

                  return (
                    <div key={line.id} className="rounded-lg border bg-card p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <Label className="text-xs text-muted-foreground">Item #{idx + 1}</Label>
                          <Select
                            value={line.inventoryItemId || 'none'}
                            onValueChange={(v) => onSelectInventoryItem(line.id, v === 'none' ? '' : v)}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select inventory item" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">- Select -</SelectItem>
                              {inventoryItems.map(it => (
                                <SelectItem key={it.id} value={it.id}>
                                  {it.name} {it.unit && `(${it.unit})`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {items.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-destructive"
                            onClick={() => removeLine(line.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">Qty ({purchaseUnit})</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.quantity}
                            onChange={(e) => updateItem(line.id, { quantity: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Unit cost</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.unitCost}
                            onChange={(e) => updateItem(line.id, { unitCost: e.target.value })}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Line total</Label>
                          <div className="h-9 flex items-center font-mono text-sm font-semibold text-foreground">
                            {formatCurrency(lineTotal)}
                          </div>
                        </div>
                      </div>

                      {inv && qty > 0 && (
                        <div className="text-[11px] text-muted-foreground flex items-center justify-between border-t pt-2">
                          <span>
                            Stock: <span className="font-mono">{Number(inv.current_stock || 0).toFixed(2)}</span>
                            <span className="mx-1">→</span>
                            <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                              {(Number(inv.current_stock || 0) + stockDelta).toFixed(2)} {stockUnit}
                            </span>
                          </span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold font-mono">
                            +{stockDelta.toFixed(2)} {stockUnit}
                          </span>
                        </div>
                      )}

                      {inv && qty > 0 && cost > 0 && stockDelta > 0 && (() => {
                        const effectiveCostPerStockUnit = lineTotal / stockDelta;
                        const itemUnitCost = Number(inv.unit_cost) || 0;
                        const expected = upp > 0 ? itemUnitCost / upp : 0;
                        const dev = expected > 0
                          ? ((effectiveCostPerStockUnit - expected) / expected) * 100
                          : 0;
                        return (
                          <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Cost / {stockUnit}
                            </span>
                            <span className="font-mono font-semibold text-foreground">
                              {formatCurrency(effectiveCostPerStockUnit)}
                              {expected > 0 && Math.abs(dev) >= 5 && (
                                <span className={`ml-2 ${dev > 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`}>
                                  {dev > 0 ? '+' : ''}{dev.toFixed(1)}% vs base
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })()}

                      {inv && !inv.default_cogs_account_id && (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <AlertDescription className="text-xs">
                            {inv.name} has no default account. Open Inventory and set one before saving.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total purchase</p>
                <p className="text-xl font-semibold font-mono text-foreground">
                  {formatCurrency(totals.total)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{totals.validLines} item(s)</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {paymentStatus} · {paymentMethod.replace('_', ' ')}
                </p>
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Kitchen Purchase
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}