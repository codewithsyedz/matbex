import { useState, useEffect } from "react";
import { Plus, FileText, Pencil, Trash2, Eye, CheckCircle, Clock, AlertTriangle, Loader2, Download, Check } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ViewInvoiceDialog } from "./ViewInvoiceDialog";
import { InvoiceImageUploader } from "./InvoiceImageUploader";

interface Invoice {
  id: string;
  invoice_number: string;
  supplier_id: string | null;
  invoice_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  notes: string | null;
  image_url: string | null;
  account_id: string | null;
  ledger_posted: boolean | null;
  suppliers: { name: string } | null;
}

interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  inventory_item_id?: string;
}

interface InventoryItem {
  id: string;
  name: string;
  unit_cost: number;
}

interface Supplier {
  id: string;
  name: string;
}

export function InvoiceManager() {
  const { restaurant, user, isManager } = useAuth();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [invoiceToMarkPaid, setInvoiceToMarkPaid] = useState<Invoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");
  const [markingPaid, setMarkingPaid] = useState(false);

  // Form state
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState("pending");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unit_price: 0, total_price: 0 }]);

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;
    
    try {
      const [invoicesRes, suppliersRes, itemsRes] = await Promise.all([
        supabase
          .from("purchase_invoices")
          .select("*, suppliers(name)")
          .eq("restaurant_id", restaurant.id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("suppliers")
          .select("id, name")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("inventory_items")
          .select("id, name, unit_cost")
          .eq("restaurant_id", restaurant.id)
          .order("name"),
      ]);

      if (invoicesRes.error) throw invoicesRes.error;
      if (suppliersRes.error) throw suppliersRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setInvoices(invoicesRes.data || []);
      setSuppliers(suppliersRes.data || []);
      setInventoryItems(itemsRes.data || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const generateInvoiceNumber = () => {
    const prefix = "INV";
    const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
    return `${prefix}-${date}-${random}`;
  };

  const addItem = () => {
    setItems([...items, { description: "", quantity: 1, unit_price: 0, total_price: 0 }]);
  };

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Recalculate total
    if (field === "quantity" || field === "unit_price") {
      newItems[index].total_price = newItems[index].quantity * newItems[index].unit_price;
    }
    
    setItems(newItems);
  };

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + item.total_price, 0);
    const tax = subtotal * 0.15; // 15% VAT
    return { subtotal, tax, total: subtotal + tax };
  };

  const handleSave = async () => {
    if (!invoiceNumber.trim() || !restaurant?.id || !user?.id) {
      toast({ title: "Error", description: "Please enter an invoice number", variant: "destructive" });
      return;
    }

    if (items.every(item => !item.description.trim())) {
      toast({ title: "Error", description: "Please add at least one item", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const totals = calculateTotals();
      const invoiceData = {
        restaurant_id: restaurant.id,
        invoice_number: invoiceNumber.trim(),
        supplier_id: selectedSupplier || null,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        subtotal: totals.subtotal,
        tax_amount: totals.tax,
        total_amount: totals.total,
        notes: notes.trim() || null,
        image_url: imageUrl,
        status: selectedStatus,
      };

      if (editingInvoice) {
        // Lines are replaced atomically server-side (delete + insert + total
        // recompute in one transaction) so re-saving can never double totals.
        const validItems = items.filter(item => item.description.trim());
        const { error: itemsError } = await (supabase as any).rpc("replace_invoice_items", {
          p_invoice_id: editingInvoice.id,
          p_items: validItems.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            inventory_item_id: item.inventory_item_id || null,
            auto_create_purchase: true,
          })),
          p_auto_create_purchase: true,
        });
        if (itemsError) throw itemsError;

        // Written after the replace so tax-inclusive totals are preserved.
        const { error: invoiceError } = await supabase
          .from("purchase_invoices")
          .update(invoiceData)
          .eq("id", editingInvoice.id);

        if (invoiceError) throw invoiceError;

        toast({ title: "Invoice updated" });
      } else {
        // Create new invoice
        const { data: invoice, error: invoiceError } = await supabase
          .from("purchase_invoices")
          .insert({
            ...invoiceData,
            created_by: user.id,
          })
          .select()
          .single();

        if (invoiceError) throw invoiceError;

        // Create invoice items through the atomic replace routine.
        const validItems = items.filter(item => item.description.trim());
        if (validItems.length > 0) {
          const { error: itemsError } = await (supabase as any).rpc("replace_invoice_items", {
            p_invoice_id: invoice.id,
            p_items: validItems.map(item => ({
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price,
              inventory_item_id: item.inventory_item_id || null,
              auto_create_purchase: true,
            })),
            p_auto_create_purchase: true,
          });

          if (itemsError) throw itemsError;

          const { error: totalsError } = await supabase
            .from("purchase_invoices")
            .update({
              subtotal: totals.subtotal,
              tax_amount: totals.tax,
              total_amount: totals.total,
            })
            .eq("id", invoice.id);

          if (totalsError) throw totalsError;
        }

        toast({ title: "Invoice created" });
      }

      fetchData();
      closeDialog();
    } catch (error: any) {
      console.error("Error saving invoice:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (invoice: Invoice) => {
    if (!confirm(`Delete invoice "${invoice.invoice_number}"?`)) return;

    try {
      // Lines are removed by the invoice's ON DELETE CASCADE.
      const { error } = await supabase
        .from("purchase_invoices")
        .delete()
        .eq("id", invoice.id);

      if (error) throw error;
      toast({ title: "Invoice deleted" });
      fetchData();
    } catch (error: any) {
      console.error("Error deleting invoice:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const openEditDialog = async (invoice: Invoice) => {
    setEditingInvoice(invoice);
    setInvoiceNumber(invoice.invoice_number);
    setSelectedSupplier(invoice.supplier_id || "");
    setInvoiceDate(invoice.invoice_date);
    setDueDate(invoice.due_date || "");
    setNotes(invoice.notes || "");
    setImageUrl(invoice.image_url);
    setSelectedStatus(invoice.status);

    // Fetch invoice items
    try {
      const { data: invoiceItems, error } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoice.id);

      if (error) throw error;

      if (invoiceItems && invoiceItems.length > 0) {
        setItems(invoiceItems.map(item => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          inventory_item_id: item.inventory_item_id,
        })));
      } else {
        setItems([{ description: "", quantity: 1, unit_price: 0, total_price: 0 }]);
      }
    } catch (error) {
      console.error("Error fetching invoice items:", error);
      setItems([{ description: "", quantity: 1, unit_price: 0, total_price: 0 }]);
    }

    setDialogOpen(true);
  };

  const generatePdf = async (invoice: Invoice) => {
    setGeneratingPdf(invoice.id);
    try {
      // Fetch invoice items
      const { data: invoiceItems, error } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoice.id);

      if (error) throw error;

      const response = await supabase.functions.invoke("generate-invoice-pdf", {
        body: {
          invoice: {
            ...invoice,
            supplier_name: invoice.suppliers?.name || "N/A",
          },
          items: invoiceItems || [],
          restaurant: {
            name: restaurant?.name,
            currency: restaurant?.currency || "SAR",
          },
        },
      });

      if (response.error) throw response.error;

      // Create download link
      const blob = new Blob([Uint8Array.from(atob(response.data.pdf), c => c.charCodeAt(0))], { 
        type: "application/pdf" 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "PDF downloaded" });
    } catch (error: any) {
      console.error("Error generating PDF:", error);
      toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
    } finally {
      setGeneratingPdf(null);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingInvoice(null);
    setInvoiceNumber(generateInvoiceNumber());
    setSelectedSupplier("");
    setInvoiceDate(new Date().toISOString().split("T")[0]);
    setDueDate("");
    setNotes("");
    setImageUrl(null);
    setSelectedStatus("pending");
    setItems([{ description: "", quantity: 1, unit_price: 0, total_price: 0 }]);
  };

  const openDialog = () => {
    setEditingInvoice(null);
    setInvoiceNumber(generateInvoiceNumber());
    setSelectedStatus("pending");
    setDialogOpen(true);
  };

  const totals = calculateTotals();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid": return "bg-emerald-500/10 text-emerald-600";
      case "pending": return "bg-amber-500/10 text-amber-600";
      case "overdue": return "bg-red-500/10 text-red-600";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const openPaymentDialog = (invoice: Invoice) => {
    setInvoiceToMarkPaid(invoice);
    setPaymentMethod("cash");
    setPaymentDialogOpen(true);
  };

  const handleMarkAsPaid = async () => {
    if (!invoiceToMarkPaid) return;
    
    setMarkingPaid(true);
    try {
      // Check if invoice was posted to ledger first
      if (!invoiceToMarkPaid.ledger_posted) {
        toast({ 
          title: "Invoice not posted", 
          description: "Please post the invoice to ledger first via View Invoice", 
          variant: "destructive" 
        });
        setMarkingPaid(false);
        return;
      }

      // Call RPC to post payment to ledger
      const { data, error } = await supabase.rpc("post_invoice_payment_to_ledger", {
        p_invoice_id: invoiceToMarkPaid.id,
        p_payment_method: paymentMethod,
      });

      if (error) throw error;
      
      toast({ 
        title: "Invoice marked as paid", 
        description: `Payment posted to ledger (${paymentMethod === "cash" ? "Cash" : "Bank"})` 
      });
      setPaymentDialogOpen(false);
      setInvoiceToMarkPaid(null);
      fetchData();
    } catch (error: any) {
      console.error("Error marking invoice as paid:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setMarkingPaid(false);
    }
  };

  // Calculate invoice stats
  const invoiceStats = {
    total: invoices.length,
    pending: invoices.filter(i => i.status === "pending").length,
    paid: invoices.filter(i => i.status === "paid").length,
    overdue: invoices.filter(i => i.status === "overdue").length,
    pendingAmount: invoices.filter(i => i.status === "pending").reduce((sum, i) => sum + Number(i.total_amount), 0),
    paidAmount: invoices.filter(i => i.status === "paid").reduce((sum, i) => sum + Number(i.total_amount), 0),
    overdueAmount: invoices.filter(i => i.status === "overdue").reduce((sum, i) => sum + Number(i.total_amount), 0),
  };

  return (
    <div className="space-y-4">
      {/* Invoice Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Invoices</p>
                <p className="text-2xl font-bold">{invoiceStats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{invoiceStats.pending}</p>
                <p className="text-xs text-muted-foreground">
                  {invoiceStats.pendingAmount.toFixed(0)} {restaurant?.currency || "SAR"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Paid</p>
                <p className="text-2xl font-bold">{invoiceStats.paid}</p>
                <p className="text-xs text-muted-foreground">
                  {invoiceStats.paidAmount.toFixed(0)} {restaurant?.currency || "SAR"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue</p>
                <p className="text-2xl font-bold">{invoiceStats.overdue}</p>
                <p className="text-xs text-muted-foreground">
                  {invoiceStats.overdueAmount.toFixed(0)} {restaurant?.currency || "SAR"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-medium">Purchase Invoices</CardTitle>
        <Dialog open={dialogOpen} onOpenChange={(open) => open ? openDialog() : closeDialog()}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Create Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingInvoice ? "Edit Invoice" : "Create Purchase Invoice"}</DialogTitle>
              <DialogDescription>
                {editingInvoice ? "Update invoice details" : "Record a purchase invoice and export as PDF"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Invoice Number *</Label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                  />
                </div>
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Invoice Date *</Label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Line Items */}
              <div className="space-y-2">
                <Label>Items</Label>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40%]">Description</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Unit Price</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Input
                              placeholder="Item description"
                              value={item.description}
                              onChange={(e) => updateItem(index, "description", e.target.value)}
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)}
                              className="h-8 w-16"
                              min="0"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={item.unit_price}
                              onChange={(e) => updateItem(index, "unit_price", parseFloat(e.target.value) || 0)}
                              className="h-8 w-20"
                              min="0"
                              step="0.01"
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {item.total_price.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            {items.length > 1 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => removeItem(index)}
                              >
                                ×
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button variant="outline" size="sm" onClick={addItem}>
                  + Add Item
                </Button>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-48 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal:</span>
                    <span>{totals.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT (15%):</span>
                    <span>{totals.tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-2">
                    <span>Total:</span>
                    <span>{totals.total.toFixed(2)} {restaurant?.currency || "SAR"}</span>
                  </div>
                </div>
              </div>

              {/* Invoice Image Upload */}
              {restaurant?.id && (
                <InvoiceImageUploader
                  imageUrl={imageUrl}
                  onImageChange={setImageUrl}
                  restaurantId={restaurant.id}
                  disabled={submitting}
                />
              )}

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
                disabled={submitting || !invoiceNumber.trim()}
              >
                {submitting ? "Saving..." : editingInvoice ? "Update Invoice" : "Create Invoice"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No invoices yet</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-sm">{invoice.invoice_number}</TableCell>
                  <TableCell>{format(new Date(invoice.invoice_date), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {invoice.suppliers?.name || "-"}
                  </TableCell>
                  <TableCell className="font-medium">
                    {Number(invoice.total_amount).toFixed(2)} {restaurant?.currency || "SAR"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={getStatusColor(invoice.status)}>
                      {invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          {invoice.ledger_posted ? (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              Posted
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-xs">
                              Pending
                            </Badge>
                          )}
                        </TooltipTrigger>
                        <TooltipContent>
                          {invoice.ledger_posted
                            ? "Posted to Chart of Accounts"
                            : "Not yet posted to ledger"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <ViewInvoiceDialog invoice={invoice} onLedgerPosted={fetchData} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => generatePdf(invoice)}
                        disabled={generatingPdf === invoice.id}
                        title="Download PDF"
                      >
                        {generatingPdf === invoice.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                      {invoice.status !== "paid" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={() => openPaymentDialog(invoice)}
                                title="Mark as Paid"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Mark as Paid</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {isManager && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(invoice)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(invoice)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

    {/* Payment Dialog */}
    <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Invoice as Paid</DialogTitle>
          <DialogDescription>
            This will post the payment to the ledger (DR Accounts Payable, CR Cash/Bank)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {invoiceToMarkPaid && (
            <>
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Invoice:</span>
                  <span className="font-mono">{invoiceToMarkPaid.invoice_number}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-semibold">
                    {Number(invoiceToMarkPaid.total_amount).toFixed(2)} {restaurant?.currency || "SAR"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Ledger Status:</span>
                  {invoiceToMarkPaid.ledger_posted ? (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 text-xs">
                      Posted
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs">
                      Not Posted
                    </Badge>
                  )}
                </div>
              </div>

              {!invoiceToMarkPaid.ledger_posted && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 inline mr-2" />
                  Invoice must be posted to ledger first. Use "View Invoice" to post it.
                </div>
              )}

              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select 
                  value={paymentMethod} 
                  onValueChange={(v) => setPaymentMethod(v as "cash" | "bank")}
                  disabled={!invoiceToMarkPaid.ledger_posted}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash (Account 1000)</SelectItem>
                    <SelectItem value="bank">Bank/Card (Account 1010)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button 
                className="w-full" 
                onClick={handleMarkAsPaid}
                disabled={markingPaid || !invoiceToMarkPaid.ledger_posted}
              >
                {markingPaid ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark as Paid & Post to Ledger
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </div>
  );
}
