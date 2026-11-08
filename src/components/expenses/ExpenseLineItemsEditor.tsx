import { useMemo, useRef, useEffect } from "react";
import { Plus, Trash2, Package, AlertCircle, Copy, Merge, PackagePlus } from "lucide-react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export interface ExpenseLineItem {
  uid: string; // local UI id
  inventory_item_id: string;
  quantity: string;            // expense unit qty (string for input control)
  unit_cost: string;           // cost per expense unit (string for input control)
  stock_change_units: string;  // optional override
  movement_reason: string;
  movement_type?: "purchase" | "usage";
  /** Optional per-line VAT % (string for input control). Only used when the
   *  editor is rendered with `showVat`. */
  vat_rate?: string;
}

interface InventoryItemOption {
  id: string;
  name: string;
  unit: string | null;
  stock_unit: string | null;
  units_per_pack: number | null;
  unit_cost: number | null;
  current_stock: number | null;
}

interface ExpenseLineItemsEditorProps {
  items: ExpenseLineItem[];
  inventoryItems: InventoryItemOption[];
  onChange: (items: ExpenseLineItem[]) => void;
  /**
   * If true, line items decrease stock instead of increasing it.
   * Default false (purchase / invoice flow → stock goes up).
   */
  consumesStock?: boolean;
  /**
   * Optional callback to launch a "quick create inventory item" flow.
   * When provided, a button appears in the header and (more prominently)
   * inside the empty state so the user can add an item without leaving
   * the expense dialog.
   */
  onRequestCreateItem?: () => void;
  /** When true, show a VAT % column per line and include VAT in totals. */
  showVat?: boolean;
  /** Default VAT % applied to new lines when `showVat` is true. */
  defaultVatRate?: number;
}

export function makeEmptyLine(defaultVatRate?: number): ExpenseLineItem {
  return {
    uid: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    inventory_item_id: "",
    quantity: "1",
    unit_cost: "",
    stock_change_units: "",
    movement_reason: "",
    vat_rate: typeof defaultVatRate === "number" ? String(defaultVatRate) : undefined,
  };
}

export function ExpenseLineItemsEditor({
  items,
  inventoryItems,
  onChange,
  consumesStock = false,
  onRequestCreateItem,
  showVat = false,
  defaultVatRate,
}: ExpenseLineItemsEditorProps) {
  const lastRowRef = useRef<HTMLDivElement | null>(null);
  const prevLengthRef = useRef(items.length);

  useEffect(() => {
    if (items.length > prevLengthRef.current && lastRowRef.current) {
      lastRowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    prevLengthRef.current = items.length;
  }, [items]);
  const itemMap = useMemo(() => {
    const m = new Map<string, InventoryItemOption>();
    for (const i of inventoryItems) m.set(i.id, i);
    return m;
  }, [inventoryItems]);

  const updateLine = (uid: string, patch: Partial<ExpenseLineItem>) => {
    onChange(items.map(li => (li.uid === uid ? { ...li, ...patch } : li)));
  };

  const removeLine = (uid: string) => {
    onChange(items.filter(li => li.uid !== uid));
  };

  const addLine = () => {
    onChange([...items, makeEmptyLine(showVat ? defaultVatRate : undefined)]);
  };

  // Auto-fill unit_cost when an item is picked and unit_cost is blank
  const handleItemSelect = (uid: string, inventoryItemId: string) => {
    const item = itemMap.get(inventoryItemId);
    const current = items.find(li => li.uid === uid);
    const patch: Partial<ExpenseLineItem> = { inventory_item_id: inventoryItemId };
    if (current && !current.unit_cost && item?.unit_cost) {
      patch.unit_cost = String(item.unit_cost);
    }
    updateLine(uid, patch);
  };

  const computeLineTotals = (li: ExpenseLineItem) => {
    const q = parseFloat(li.quantity) || 0;
    const c = parseFloat(li.unit_cost) || 0;
    const v = showVat ? parseFloat(li.vat_rate || "0") || 0 : 0;
    const net = q * c;
    const vat = net * (v / 100);
    return { net, vat, gross: net + vat };
  };
  const totals = items.reduce(
    (acc, li) => {
      const t = computeLineTotals(li);
      acc.net += t.net;
      acc.vat += t.vat;
      acc.gross += t.gross;
      return acc;
    },
    { net: 0, vat: 0, gross: 0 }
  );
  const grandTotal = showVat ? totals.gross : totals.net;

  // Detect duplicate selections so we can flag them visually (still allowed)
  const duplicateIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const li of items) {
      if (!li.inventory_item_id) continue;
      counts.set(li.inventory_item_id, (counts.get(li.inventory_item_id) || 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([id]) => id));
  }, [items]);

  // For each line, compute its duplicate index ("2 of 3") so each row knows where it sits.
  const duplicatePositionByUid = useMemo(() => {
    const counters = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const li of items) {
      if (!li.inventory_item_id) continue;
      totals.set(li.inventory_item_id, (totals.get(li.inventory_item_id) || 0) + 1);
    }
    const result = new Map<string, { index: number; total: number }>();
    for (const li of items) {
      if (!li.inventory_item_id) continue;
      const total = totals.get(li.inventory_item_id) || 1;
      if (total < 2) continue;
      const next = (counters.get(li.inventory_item_id) || 0) + 1;
      counters.set(li.inventory_item_id, next);
      result.set(li.uid, { index: next, total });
    }
    return result;
  }, [items]);

  const hasDuplicates = duplicateIds.size > 0;

  // Merge duplicate rows: for each repeated inventory_item_id, sum quantities and
  // compute a weighted-average unit cost so the invoice total is preserved.
  // Lines with no item selected are left untouched.
  const mergeDuplicates = () => {
    if (!hasDuplicates) return;
    const mergedByItem = new Map<string, ExpenseLineItem>();
    const result: ExpenseLineItem[] = [];
    for (const li of items) {
      if (!li.inventory_item_id) {
        result.push(li);
        continue;
      }
      const existing = mergedByItem.get(li.inventory_item_id);
      if (!existing) {
        const copy = { ...li };
        mergedByItem.set(li.inventory_item_id, copy);
        result.push(copy);
        continue;
      }
      // Combine into existing row (mutates the object already pushed into result)
      const qA = parseFloat(existing.quantity) || 0;
      const cA = parseFloat(existing.unit_cost) || 0;
      const qB = parseFloat(li.quantity) || 0;
      const cB = parseFloat(li.unit_cost) || 0;
      const totalQty = qA + qB;
      const totalCost = qA * cA + qB * cB;
      const avgUnitCost = totalQty > 0 ? totalCost / totalQty : cA || cB;
      existing.quantity = totalQty > 0 ? String(Number(totalQty.toFixed(4))) : existing.quantity;
      existing.unit_cost = totalQty > 0 ? String(Number(avgUnitCost.toFixed(4))) : existing.unit_cost;
      // Preserve a movement reason if either had one
      if (!existing.movement_reason && li.movement_reason) {
        existing.movement_reason = li.movement_reason;
      }
    }
    onChange(result);
  };

  // Aggregate signed stock impact per inventory item across all lines so that
  // multiple lines on the same item are evaluated together against current stock.
  const projectedStockById = useMemo(() => {
    const map = new Map<string, { current: number; delta: number; projected: number; unit: string }>();
    for (const li of items) {
      if (!li.inventory_item_id) continue;
      const item = itemMap.get(li.inventory_item_id);
      if (!item) continue;
      const upp = Number(item.units_per_pack) || 1;
      const qty = parseFloat(li.quantity) || 0;
      const stockUnits = qty * upp;
      const signed = consumesStock ? -stockUnits : stockUnits;
      const existing = map.get(li.inventory_item_id);
      const current = Number(item.current_stock) || 0;
      const stockUnit = item.stock_unit || item.unit || "unit";
      if (existing) {
        existing.delta += signed;
        existing.projected = existing.current + existing.delta;
      } else {
        map.set(li.inventory_item_id, {
          current,
          delta: signed,
          projected: current + signed,
          unit: stockUnit,
        });
      }
    }
    return map;
  }, [items, itemMap, consumesStock]);

  const hasNegativeProjection = Array.from(projectedStockById.values()).some(p => p.projected < 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Package className="h-4 w-4" />
          Invoice line items <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {hasDuplicates && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
              onClick={mergeDuplicates}
              title="Combine repeated items into a single line (sums qty, weighted-averages cost)"
            >
              <Merge className="h-3.5 w-3.5" />
              Merge duplicates ({duplicateIds.size})
            </Button>
          )}
          {onRequestCreateItem && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1"
              onClick={onRequestCreateItem}
              title="Create a new inventory item"
            >
              <PackagePlus className="h-3.5 w-3.5" />
              New Item
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={addLine}
            disabled={inventoryItems.length === 0}
            title={inventoryItems.length === 0 ? "Create an inventory item first" : "Add a line item"}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Item
          </Button>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
        <div className={showVat ? "min-w-[48rem]" : "min-w-[42rem]"}>
        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/40 border-b text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          <div className={showVat ? "col-span-3" : "col-span-4"}>Item</div>
          <div className="col-span-2 text-right">Qty</div>
          <div className="col-span-2 text-right">Stock units (auto)</div>
          <div className="col-span-2 text-right">Unit cost</div>
          {showVat && <div className="col-span-1 text-right">VAT %</div>}
          <div className="col-span-2 text-right pr-7">Line total</div>
        </div>

        {items.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground space-y-3">
            {inventoryItems.length === 0 ? (
              <>
                <p>
                  You don't have any inventory items yet. Create one to start
                  building this invoice.
                </p>
                {onRequestCreateItem && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={onRequestCreateItem}
                    className="gap-1"
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    Create your first item
                  </Button>
                )}
              </>
            ) : (
              <p>
                No line items yet. Click <strong>Add Item</strong> to start.
              </p>
            )}
          </div>
        )}

        <div className="divide-y">
          {items.map((li, index) => {
            const item = li.inventory_item_id ? itemMap.get(li.inventory_item_id) : undefined;
            const purchaseUnit = item?.unit || "unit";
            const stockUnit = item?.stock_unit || item?.unit || "unit";
            const upp = Number(item?.units_per_pack) || 1;
            const qty = parseFloat(li.quantity) || 0;
            // Stock units are now strictly derived from quantity × units-per-pack.
            // The stock_change_units field is kept on the model for backwards
            // compatibility but is no longer user-editable.
            const stockDelta = qty * upp;
            const cost = parseFloat(li.unit_cost) || 0;
            const vatPct = showVat ? parseFloat(li.vat_rate || "0") || 0 : 0;
            const lineNet = qty * cost;
            const lineTotal = showVat ? lineNet * (1 + vatPct / 100) : lineNet;
            const isDuplicate = li.inventory_item_id && duplicateIds.has(li.inventory_item_id);
            const projection = li.inventory_item_id ? projectedStockById.get(li.inventory_item_id) : undefined;
            const willGoNegative = !!projection && projection.projected < 0;

            return (
              <div
                key={li.uid}
                ref={index === items.length - 1 ? (el) => { lastRowRef.current = el; } : undefined}
                className={`px-3 py-2.5 ${
                  willGoNegative ? "bg-destructive/5" : isDuplicate ? "bg-amber-500/5" : ""
                }`}
              >
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className={showVat ? "col-span-3" : "col-span-4"}>
                    <Select
                      value={li.inventory_item_id || "none"}
                      onValueChange={(v) => {
                        if (v === "__create__") {
                          onRequestCreateItem?.();
                          return;
                        }
                        handleItemSelect(li.uid, v === "none" ? "" : v);
                      }}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">- Select -</SelectItem>
                        {inventoryItems.map(it => (
                          <SelectItem key={it.id} value={it.id}>
                            {it.name} {it.unit && `(${it.unit})`}
                          </SelectItem>
                        ))}
                        {onRequestCreateItem && (
                          <SelectItem
                            value="__create__"
                            className="text-primary font-medium border-t mt-1"
                          >
                            + Add new item…
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {isDuplicate && duplicatePositionByUid.get(li.uid) && (
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className="h-5 px-1.5 gap-1 text-[10px] font-normal border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/5"
                        >
                          <Copy className="h-2.5 w-2.5" />
                          Same as another line · {duplicatePositionByUid.get(li.uid)!.index} of {duplicatePositionByUid.get(li.uid)!.total}
                        </Badge>
                      </div>
                    )}
                    {item && (
                      <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                        Stock: {(Number(item.current_stock) || 0).toFixed(2)} {stockUnit}
                        {upp !== 1 && (
                          <> · 1 {purchaseUnit} = {upp} {stockUnit}</>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={li.quantity}
                      onChange={(e) => updateLine(li.uid, { quantity: e.target.value })}
                      placeholder="1"
                      className="h-9 text-right font-mono"
                    />
                    {item && (
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">
                        {purchaseUnit}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2">
                    <div
                      className="h-9 px-2 flex items-center justify-end font-mono text-sm rounded-md bg-muted/40 border text-foreground"
                      title="Auto-calculated: quantity × units per pack"
                    >
                      {item ? stockDelta.toFixed(2) : "-"}
                    </div>
                    {item && (
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">
                        {stockUnit} {upp !== 1 && <>· {qty || 0}×{upp}</>}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={li.unit_cost}
                      onChange={(e) => updateLine(li.uid, { unit_cost: e.target.value })}
                      placeholder={item?.unit_cost ? String(item.unit_cost) : "0.00"}
                      className="h-9 text-right font-mono"
                    />
                    {item && (
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">
                        per {purchaseUnit}
                      </p>
                    )}
                  </div>

                  {showVat && (
                    <div className="col-span-1">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={li.vat_rate ?? ""}
                        onChange={(e) => updateLine(li.uid, { vat_rate: e.target.value })}
                        placeholder={defaultVatRate != null ? String(defaultVatRate) : "0"}
                        className="h-9 text-right font-mono"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">%</p>
                    </div>
                  )}

                  <div className="col-span-2 flex items-start gap-1">
                    <div className="flex-1 h-9 px-2 flex items-center justify-end font-mono text-sm font-semibold rounded-md bg-muted/40 border">
                      {lineTotal.toFixed(2)}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-9 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={() => removeLine(li.uid)}
                      title="Remove line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {willGoNegative && projection && (
                  <p className="mt-1.5 text-[11px] text-destructive flex items-center gap-1 font-medium">
                    <AlertCircle className="h-3 w-3" />
                    {consumesStock ? "Usage exceeds stock" : "Negative projected stock"}: {projection.current.toFixed(2)} {projection.unit}
                    {" "}
                    {projection.delta >= 0 ? "+" : ""}{projection.delta.toFixed(2)} ={" "}
                    <span className="font-mono">{projection.projected.toFixed(2)} {projection.unit}</span>
                    {duplicateIds.has(li.inventory_item_id) && " (combined across all lines for this item)"}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {items.length > 0 && (
          <div className="border-t bg-muted/20">
            <div className="px-3 py-2 border-b">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Cost summary - review before submitting
              </p>
              <div className="space-y-1">
                {(() => {
                  let running = 0;
                  return items.map((li, idx) => {
                    const item = li.inventory_item_id ? itemMap.get(li.inventory_item_id) : undefined;
                    const qty = parseFloat(li.quantity) || 0;
                    const cost = parseFloat(li.unit_cost) || 0;
                    const lineTotal = qty * cost;
                    running += lineTotal;
                    const purchaseUnit = item?.unit || "unit";
                    const label = item?.name || `Line ${idx + 1}`;
                    return (
                      <div
                        key={li.uid}
                        className="grid grid-cols-12 gap-2 text-xs items-center"
                      >
                        <div className="col-span-5 truncate text-foreground">
                          <span className="text-muted-foreground mr-1.5">#{idx + 1}</span>
                          {label}
                        </div>
                        <div className="col-span-3 text-right font-mono text-muted-foreground">
                          {qty.toFixed(2)} {purchaseUnit} × {cost.toFixed(2)}
                        </div>
                        <div className="col-span-2 text-right font-mono text-foreground">
                          {lineTotal.toFixed(2)}
                        </div>
                        <div className="col-span-2 text-right pr-7 font-mono text-muted-foreground">
                          ∑ {running.toFixed(2)}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            {showVat ? (
              <div className="px-3 py-2.5 text-sm space-y-1">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8 text-right text-muted-foreground">Subtotal</div>
                  <div className="col-span-4 text-right pr-7 font-mono text-foreground">{totals.net.toFixed(2)}</div>
                </div>
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8 text-right text-muted-foreground">VAT</div>
                  <div className="col-span-4 text-right pr-7 font-mono text-foreground">{totals.vat.toFixed(2)}</div>
                </div>
                <div className="grid grid-cols-12 gap-2 pt-1 border-t">
                  <div className="col-span-8 text-right font-medium text-muted-foreground">
                    Invoice total ({items.length} line{items.length === 1 ? "" : "s"})
                  </div>
                  <div className="col-span-4 text-right pr-7 font-mono font-bold text-base text-foreground">
                    {totals.gross.toFixed(2)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-2 px-3 py-2.5 text-sm">
                <div className="col-span-8 text-right font-medium text-muted-foreground">
                  Invoice total ({items.length} line{items.length === 1 ? "" : "s"}) - posts to ledger
                </div>
                <div className="col-span-4 text-right pr-7 font-mono font-bold text-base text-foreground">
                  {grandTotal.toFixed(2)}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
        </div>
      </div>

      {items.length > 0 && items.some(li => !li.inventory_item_id) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Every line must have an inventory item selected.
          </AlertDescription>
        </Alert>
      )}

      {hasNegativeProjection && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            One or more line items would drive inventory below zero after this entry.
            Review the highlighted rows - adjust quantities, split the entry, or record a stock correction first.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}