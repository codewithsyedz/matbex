import { useState, useEffect } from "react";
import { Plus, CreditCard, Trash2, Receipt } from "lucide-react";
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

interface SupplierPayment {
  id: string;
  supplier_id: string;
  invoice_id: string | null;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
  supplier?: {
    name: string;
  };
  invoice?: {
    invoice_number: string;
  } | null;
}

interface Supplier {
  id: string;
  name: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  supplier_id: string | null;
  total_amount: number;
  status: string;
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
];

export function SupplierPayments() {
  const { restaurant, user, hasRole } = useAuth();
  const isManager = hasRole("manager") || hasRole("owner");
  const isOwner = hasRole("owner");
  const { toast } = useToast();
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [supplierId, setSupplierId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (restaurant?.id) {
      fetchData();
    }
  }, [restaurant?.id]);

  const fetchData = async () => {
    if (!restaurant?.id) return;
    
    try {
      const [paymentsRes, suppliersRes, invoicesRes] = await Promise.all([
        db
          .from("supplier_payments")
          .select(`
            *,
            supplier:suppliers(name),
            invoice:purchase_invoices(invoice_number)
          `)
          .eq("restaurant_id", restaurant.id)
          .order("payment_date", { ascending: false }),
        db
          .from("suppliers")
          .select("id, name")
          .eq("restaurant_id", restaurant.id)
          .eq("is_active", true)
          .order("name"),
        db
          .from("purchase_invoices")
          .select("id, invoice_number, supplier_id, total_amount, status")
          .eq("restaurant_id", restaurant.id)
          .order("invoice_date", { ascending: false }),
      ]);

      if (paymentsRes.error) throw paymentsRes.error;
      if (suppliersRes.error) throw suppliersRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      setPayments(paymentsRes.data || []);
      setSuppliers(suppliersRes.data || []);
      setInvoices(invoicesRes.data || []);
    } catch (error) {
      console.error("Error fetching payment data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!supplierId || !amount || !restaurant?.id || !user?.id) {
      toast({ title: "Error", description: "Please fill required fields", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const paymentData = {
        supplier_id: supplierId,
        invoice_id: invoiceId || null,
        amount: parseFloat(amount),
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference_number: referenceNumber.trim() || null,
        notes: notes.trim() || null,
        restaurant_id: restaurant.id,
        created_by: user.id,
      };

      const { error } = await db.from("supplier_payments").insert(paymentData);

      if (error) throw error;
      toast({ title: "Payment recorded" });

      fetchData();
      closeDialog();
    } catch (error: any) {
      console.error("Error saving payment:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (payment: SupplierPayment) => {
    if (!confirm("Delete this payment record?")) return;

    try {
      const { error } = await db
        .from("supplier_payments")
        .delete()
        .eq("id", payment.id);

      if (error) throw error;
      toast({ title: "Payment deleted" });
      fetchData();
    } catch (error: any) {
      console.error("Error deleting payment:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSupplierId("");
    setInvoiceId("");
    setAmount("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("cash");
    setReferenceNumber("");
    setNotes("");
  };

  // Filter invoices by selected supplier
  const filteredInvoices = supplierId 
    ? invoices.filter(inv => inv.supplier_id === supplierId)
    : invoices;

  // Calculate totals
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base font-medium">Supplier Payments</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Total Paid: {totalPaid.toFixed(2)} {restaurant?.currency || "SAR"}
          </p>
        </div>
        {isManager && (
          <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Record Supplier Payment</DialogTitle>
                <DialogDescription>
                  Record a payment made to a supplier
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Supplier *</Label>
                  <Select value={supplierId} onValueChange={(val) => {
                    setSupplierId(val);
                    setInvoiceId(""); // Reset invoice when supplier changes
                  }}>
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
                  <Label>Invoice (Optional)</Label>
                  <Select value={invoiceId} onValueChange={setInvoiceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Link to invoice (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredInvoices.map((invoice) => (
                        <SelectItem key={invoice.id} value={invoice.id}>
                          {invoice.invoice_number} - {invoice.total_amount.toFixed(2)} {restaurant?.currency || "SAR"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Amount *</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Date</Label>
                    <Input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method.value} value={method.value}>
                            {method.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Reference #</Label>
                    <Input
                      placeholder="Optional"
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    placeholder="Any additional notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                <Button 
                  className="w-full" 
                  onClick={handleSave}
                  disabled={submitting || !supplierId || !amount}
                >
                  {submitting ? "Saving..." : "Record Payment"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : payments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No payments recorded yet</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {isOwner && <TableHead className="w-16">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>
                    {new Date(payment.payment_date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="font-medium">
                    {payment.supplier?.name || "-"}
                  </TableCell>
                  <TableCell>
                    {payment.invoice?.invoice_number ? (
                      <Badge variant="outline" className="gap-1">
                        <Receipt className="h-3 w-3" />
                        {payment.invoice.invoice_number}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {PAYMENT_METHODS.find(m => m.value === payment.payment_method)?.label || payment.payment_method}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {payment.amount.toFixed(2)} {restaurant?.currency || "SAR"}
                  </TableCell>
                  {isOwner && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(payment)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}