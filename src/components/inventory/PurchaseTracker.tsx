import { Fragment, useState, useEffect, useMemo } from "react";
import { Plus, ShoppingCart, ChevronRight } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import {
  ExpenseLineItemsEditor,
  makeEmptyLine,
  type ExpenseLineItem,
} from "@/components/expenses/ExpenseLineItemsEditor";
import { cn } from "@/lib/utils";

interface Purchase {
  id: string;
  inventory_item_id: string;
  supplier_id: string | null;
  quantity_received: number;
  unit_cost: number;
  total_cost: number;
  invoice_number: string | null;
  notes: string | null;
  received_at: string;
  inventory_items: { name: string; unit: string } | null;
  suppliers: { name: string } | null;
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  unit_cost: number;
  stock_unit?: string | null;
  units_per_pack?: number | null;
  current_stock?: number | null;
}

interface Supplier {
  id: string;
  name: string;
}

const DEFAULT_VAT_RATE = 15;

export function PurchaseTracker() {
  const { restaurant, user } = useAuth();
  const { toast } = useToast();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Multi-item form state — reuses the rich expense line-items editor
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([
    makeEmptyLine(DEFAULT_VAT_RATE),
  ]);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;
    
    try {
      const [purchasesRes, itemsRes, suppliersRes] = await Promise.all([
        db
          .from("purchases")
          .select("*, inventory_items(name, unit), suppliers(name)")
          .eq("restaurant_id", restaurant.id)
          .order("received_at", { ascending: false })
          .limit(50),
        db
          .from("inventory_items")
          .select("id, name, unit, unit_cost, stock_unit, units_per_pack, current_stock")
          .eq("restaurant_id", restaurant.id)
          .order("name"),
        db
          .from("suppliers")
          .select("id, name")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
          .order("name"),
      ]);

      if (purchasesRes.error) throw purchasesRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (suppliersRes.error) throw suppliersRes.error;

      setPurchases(purchasesRes.data || []);
      setInventoryItems(itemsRes.data || []);
      setSuppliers(suppliersRes.data || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const validLineItems = useMemo(
    () =>
      lineItems.filter(
        line => line.inventory_item_id && parseFloat(line.quantity) > 0
      ),
    [lineItems]
  );

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    for (const line of lineItems) {
      const qty = parseFloat(line.quantity) || 0;
      const cost = parseFloat(line.unit_cost) || 0;
      const v = parseFloat(line.vat_rate || "0") || 0;
      const lineNet = qty * cost;
      net += lineNet;
      vat += lineNet * (v / 100);
    }
    return { net, vat, gross: net + vat };
  }, [lineItems]);

  const handleSave = async () => {
    if (validLineItems.length === 0 || !restaurant?.id || !user?.id) {
      toast({ title: "Error", description: "Please add at least one item with quantity", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // Build invoice header
      const sharedInvoiceNumber =
        invoiceNumber.trim() ||
        `PUR-${format(new Date(), "yyyyMMdd-HHmmss")}`;

      // Pre-compute per-line stock-adjusted values
      const prepared = validLineItems.map((line) => {
        const item = inventoryItems.find((i) => i.id === line.inventory_item_id);
        const upp = Number(item?.units_per_pack) || 1;
        const qty = parseFloat(line.quantity);
        const cost = parseFloat(line.unit_cost) || 0;
        const vatPct = parseFloat(line.vat_rate || "0") || 0;
        const stockQty = qty * upp;
        // Re-base unit_price to stock unit so trigger stores stockQty × unitCost correctly
        const unitPriceStock = upp > 0 ? cost / upp : cost;
        const net = stockQty * unitPriceStock;
        const vatAmount = net * (vatPct / 100);
        return {
          inventory_item_id: line.inventory_item_id,
          description: item?.name || "Item",
          quantity: stockQty,
          unit_price: unitPriceStock,
          net,
          vatAmount,
          total: net + vatAmount,
        };
      });

      const subtotal = prepared.reduce((s, l) => s + l.net, 0);
      const taxAmount = prepared.reduce((s, l) => s + l.vatAmount, 0);
      const totalAmount = subtotal + taxAmount;

      // 1) Create the purchase invoice (master)
      const status =
        paymentMethod === "credit" ? "unpaid" : "paid";
      const { data: invoice, error: invoiceError } = await db
        .from("purchase_invoices")
        .insert({
          restaurant_id: restaurant.id,
          supplier_id: selectedSupplier || null,
          invoice_number: sharedInvoiceNumber,
          invoice_date: format(new Date(), "yyyy-MM-dd"),
          subtotal,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          status,
          notes: notes.trim() || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // 2) Write invoice items through the atomic replace routine (direct
      // writes to invoice_items are blocked by trg_guard_invoice_items_writes).
      // The trigger on the inserted rows auto-creates purchases + stock.
      const { error: itemsError } = await (db as any).rpc("replace_invoice_items", {
        p_invoice_id: invoice.id,
        p_items: prepared.map((l) => ({
          inventory_item_id: l.inventory_item_id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          auto_create_purchase: true,
        })),
        p_auto_create_purchase: true,
      });

      if (itemsError) throw itemsError;

      // The routine recomputes the header from net line totals; restore the
      // VAT-inclusive totals captured above so the ledger stays in sync.
      const { error: totalsError } = await db
        .from("purchase_invoices")
        .update({ subtotal, tax_amount: taxAmount, total_amount: totalAmount })
        .eq("id", invoice.id);
      if (totalsError) throw totalsError;

      const { data: insertedItems } = await db
        .from("invoice_items")
        .select("id")
        .eq("invoice_id", invoice.id);

      // 3) Post each auto-created purchase to ledger
      try {
        const itemIds = (insertedItems || []).map((i) => i.id);
        if (itemIds.length > 0) {
          const { data: created } = await db
            .from("purchases")
            .select("id")
            .in("invoice_item_id", itemIds);
          for (const p of created || []) {
            const { error: ledgerError } = await db.rpc(
              "post_inventory_purchase_to_ledger",
              { p_purchase_id: p.id, p_payment_method: paymentMethod }
            );
            if (ledgerError) console.warn("Ledger posting failed:", ledgerError.message);
          }
        }
      } catch (ledgerErr) {
        console.warn("Ledger posting error:", ledgerErr);
      }

      toast({
        title: "Invoice created",
        description: `${sharedInvoiceNumber} · ${prepared.length} item(s) added to inventory`,
      });
      fetchData();
      closeDialog();
    } catch (error: any) {
      console.error("Error saving purchase:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setLineItems([makeEmptyLine(DEFAULT_VAT_RATE)]);
    setSelectedSupplier("");
    setInvoiceNumber("");
    setNotes("");
    setPaymentMethod("cash");
  };

  const totalCost = purchases.reduce((sum, p) => sum + p.total_cost, 0);

  // Group purchases into invoices: same supplier + invoice_number (or same supplier + same-minute bucket as fallback)
  const invoiceGroups = useMemo(() => {
    const groups = new Map<string, { key: string; supplier: string; invoiceNumber: string | null; receivedAt: string; lines: Purchase[]; total: number }>();
    for (const p of purchases) {
      const supplierKey = p.supplier_id || "no-supplier";
      const minuteBucket = p.received_at.slice(0, 16); // group same-minute when no invoice number
      const key = p.invoice_number
        ? `${supplierKey}::${p.invoice_number}`
        : `${supplierKey}::ts:${minuteBucket}`;
      const existing = groups.get(key);
      if (existing) {
        existing.lines.push(p);
        existing.total += p.total_cost;
        if (p.received_at > existing.receivedAt) existing.receivedAt = p.received_at;
      } else {
        groups.set(key, {
          key,
          supplier: p.suppliers?.name || "—",
          invoiceNumber: p.invoice_number,
          receivedAt: p.received_at,
          lines: [p],
          total: p.total_cost,
        });
      }
    }
    return Array.from(groups.values()).sort((a, b) => (a.receivedAt > b.receivedAt ? -1 : 1));
  }, [purchases]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Purchase History</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Total: {totalCost.toFixed(2)} {restaurant?.currency || "SAR"}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Record Purchase
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Record Purchase</DialogTitle>
              <DialogDescription>
                Record received inventory and update stock levels
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-hidden flex flex-col space-y-4 py-2">
              {/* Shared fields: Supplier & Payment */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
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
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card / Bank Transfer</SelectItem>
                      <SelectItem value="credit">On Credit (AP)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Line Items — itemized invoice grid (matches expense editor) */}
              <div className="flex-1 overflow-auto pr-1">
                <ExpenseLineItemsEditor
                  items={lineItems}
                  inventoryItems={inventoryItems.map(i => ({
                    id: i.id,
                    name: i.name,
                    unit: i.unit,
                    stock_unit: i.stock_unit ?? i.unit,
                    units_per_pack: i.units_per_pack ?? 1,
                    unit_cost: i.unit_cost ?? 0,
                    current_stock: i.current_stock ?? 0,
                  }))}
                  onChange={setLineItems}
                  showVat
                  defaultVatRate={DEFAULT_VAT_RATE}
                />
              </div>

              {/* Invoice & Notes */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Invoice Number</Label>
                  <Input
                    placeholder="Optional"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Input
                    placeholder="Any additional notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="p-3 bg-muted rounded-lg flex justify-between items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  {validLineItems.length} item{validLineItems.length !== 1 ? "s" : ""} · VAT {totals.vat.toFixed(2)}
                </span>
                <span className="font-semibold text-lg">
                  {totals.gross.toFixed(2)} {restaurant?.currency || "SAR"}
                </span>
              </div>

              <Button 
                className="w-full" 
                onClick={handleSave}
                disabled={submitting || validLineItems.length === 0}
              >
                {submitting ? "Saving..." : `Record ${validLineItems.length} Purchase${validLineItems.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : purchases.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <ShoppingCart className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No purchases recorded yet</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoiceGroups.map((group) => {
                const isOpen = !!expanded[group.key];
                return (
                  <Fragment key={group.key}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggle(group.key)}
                    >
                      <TableCell className="pr-0">
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            isOpen && "rotate-90"
                          )}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(group.receivedAt), "MMM d, HH:mm")}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {group.invoiceNumber || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{group.supplier}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {group.lines.length}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {group.total.toFixed(2)} {restaurant?.currency || "SAR"}
                      </TableCell>
                    </TableRow>
                    {isOpen &&
                      group.lines.map((line) => (
                        <TableRow key={line.id} className="bg-muted/20">
                          <TableCell></TableCell>
                          <TableCell colSpan={2} className="pl-8 text-sm font-medium">
                            {line.inventory_items?.name || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {line.quantity_received} {line.inventory_items?.unit} × {line.unit_cost.toFixed(2)}
                          </TableCell>
                          <TableCell></TableCell>
                          <TableCell className="text-right text-sm">
                            {line.total_cost.toFixed(2)} {restaurant?.currency || "SAR"}
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
