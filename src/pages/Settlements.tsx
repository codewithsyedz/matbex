import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  Receipt,
  Search,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Users,
  Wallet,
  Calendar,
  Eye,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { useBranchUnpaidBalances } from "@/hooks/useBranchUnpaidBalances";
import { BranchOutstandingSummary } from "@/components/settlements/BranchOutstandingSummary";
import { db } from "@/integrations/db/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/useCurrency";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SettlementStatus = "pending" | "partial" | "settled" | "overdue";

interface SettlementInvoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  restaurant_id: string;
  billing_period_start: string;
  billing_period_end: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  status: SettlementStatus;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  customers: {
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

export default function Settlements() {
  const { restaurant, user } = useAuth();
  const { activeBranch } = useBranch();
  const { byCustomer: unpaidByCustomer, isBranchScoped } = useBranchUnpaidBalances();
  const { format: formatCurrency } = useCurrency();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    end: format(endOfMonth(new Date()), "yyyy-MM-dd"),
  });

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<SettlementInvoice | null>(null);
  const [editForm, setEditForm] = useState({
    billing_period_start: "",
    billing_period_end: "",
    due_date: "",
    notes: "",
    status: "" as SettlementStatus,
  });

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SettlementInvoice | null>(null);

  // Fetch all settlement invoices with customer info
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["all-settlement-invoices", restaurant?.id, dateRange],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("settlement_invoices")
        .select("*, customers(name, email, phone)")
        .eq("restaurant_id", restaurant.id)
        .gte("created_at", dateRange.start)
        .lte("created_at", `${dateRange.end}T23:59:59`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SettlementInvoice[];
    },
    enabled: !!restaurant?.id,
  });

  // Fetch customers with outstanding balances
  const { data: allCustomers = [] } = useQuery({
    queryKey: ["customers-with-balance", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("customers")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("current_balance", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!restaurant?.id,
  });

  // Branch-scoped outstanding balances (falls back to tenant-wide balance).
  const customersWithBalance = useMemo(
    () =>
      allCustomers
        .map((c) => ({
          ...c,
          current_balance: isBranchScoped
            ? unpaidByCustomer[c.id]?.amount ?? 0
            : c.current_balance,
        }))
        .filter((c) => c.current_balance > 0)
        .sort((a, b) => b.current_balance - a.current_balance)
        .slice(0, 10),
    [allCustomers, isBranchScoped, unpaidByCustomer],
  );

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await db
        .from("settlement_invoices")
        .update({
          billing_period_start: editForm.billing_period_start,
          billing_period_end: editForm.billing_period_end,
          due_date: editForm.due_date || null,
          notes: editForm.notes || null,
          status: editForm.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoiceId);

      if (error) throw error;

      // Log audit
      if (restaurant?.id && user?.id && selectedInvoice) {
        await db.from("settlement_audit_logs").insert({
          restaurant_id: restaurant.id,
          settlement_invoice_id: invoiceId,
          customer_id: selectedInvoice.customer_id,
          action: "invoice_updated",
          actor_id: user.id,
          details: {
            changes: editForm,
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-settlement-invoices"] });
      setEditDialogOpen(false);
      setSelectedInvoice(null);
      toast.success("Invoice updated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update invoice");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (invoice: SettlementInvoice) => {
      // First, unlink all transactions from this invoice
      const { error: unlinkError } = await db
        .from("sales_transactions")
        .update({ settlement_invoice_id: null })
        .eq("settlement_invoice_id", invoice.id);

      if (unlinkError) throw unlinkError;

      // Delete related payments
      const { error: paymentsError } = await db
        .from("settlement_payments")
        .delete()
        .eq("settlement_invoice_id", invoice.id);

      if (paymentsError) throw paymentsError;

      // Delete audit logs for this invoice
      const { error: auditError } = await db
        .from("settlement_audit_logs")
        .delete()
        .eq("settlement_invoice_id", invoice.id);

      if (auditError) throw auditError;

      // Delete the invoice itself
      const { error: invoiceError } = await db
        .from("settlement_invoices")
        .delete()
        .eq("id", invoice.id);

      if (invoiceError) throw invoiceError;

      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-settlement-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["customer-transactions"] });
      setDeleteDialogOpen(false);
      setInvoiceToDelete(null);
      toast.success("Invoice deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete invoice");
    },
  });

  // Calculate summary stats
  const stats = {
    totalInvoices: invoices.length,
    pendingAmount: invoices
      .filter((i) => i.status === "pending" || i.status === "partial")
      .reduce((sum, i) => sum + (i.total_amount - i.amount_paid), 0),
    settledThisMonth: invoices
      .filter((i) => i.status === "settled")
      .reduce((sum, i) => sum + i.total_amount, 0),
    overdueCount: invoices.filter((i) => i.status === "overdue").length,
  };

  // Total outstanding across all customers
  const totalOutstanding = customersWithBalance.reduce((sum, c) => sum + c.current_balance, 0);

  // Filter invoices
  const filteredInvoices = invoices.filter((invoice) => {
    const customer = invoice.customers;
    const matchesSearch =
      invoice.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || invoice.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Pagination over the filtered list
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, dateRange]);
  const paginatedInvoices = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredInvoices.slice(start, start + pageSize);
  }, [filteredInvoices, page, pageSize]);

  const handleEditClick = (invoice: SettlementInvoice) => {
    setSelectedInvoice(invoice);
    setEditForm({
      billing_period_start: invoice.billing_period_start,
      billing_period_end: invoice.billing_period_end,
      due_date: invoice.due_date || "",
      notes: invoice.notes || "",
      status: invoice.status,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (invoice: SettlementInvoice) => {
    setInvoiceToDelete(invoice);
    setDeleteDialogOpen(true);
  };

  const getStatusBadge = (status: SettlementStatus) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "partial":
        return (
          <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">
            <DollarSign className="h-3 w-3 mr-1" />
            Partial
          </Badge>
        );
      case "settled":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Settled
          </Badge>
        );
      case "overdue":
        return (
          <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Overdue
          </Badge>
        );
    }
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Settlements</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage month-end invoices and payment reconciliation
            </p>
          </div>
          <BranchSwitcher />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-500" />
                Total Outstanding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-600">
                {formatCurrency(totalOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Across {customersWithBalance.length} customer(s) ·{" "}
                {isBranchScoped ? activeBranch?.name ?? "Current branch" : "All branches"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" />
                Pending Settlement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">
                {formatCurrency(stats.pendingAmount)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {invoices.filter((i) => i.status === "pending" || i.status === "partial").length} invoice(s)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Settled This Month
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-600">
                {formatCurrency(stats.settledThisMonth)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Overdue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{stats.overdueCount}</p>
              <p className="text-xs text-muted-foreground mt-1">invoice(s) past due</p>
            </CardContent>
          </Card>
        </div>

        {/* Pending Settlement Progress */}
        {/* Branch-scoped outstanding breakdown */}
        <BranchOutstandingSummary />

        {totalOutstanding > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">
                Pending Settlement Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {customersWithBalance.slice(0, 5).map((customer) => (
                  <div key={customer.id} className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{customer.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Balance: {formatCurrency(customer.current_balance)}
                        {customer.credit_limit > 0 &&
                          ` / ${formatCurrency(customer.credit_limit)}`}
                      </p>
                    </div>
                    <div className="w-32">
                      <Progress
                        value={
                          customer.credit_limit > 0
                            ? (customer.current_balance / customer.credit_limit) * 100
                            : 50
                        }
                        className="h-2"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/customers/${customer.id}`)}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      View
                    </Button>
                  </div>
                ))}
                {customersWithBalance.length > 5 && (
                  <Button
                    variant="link"
                    className="text-sm"
                    onClick={() => navigate("/customers")}
                  >
                    View all {customersWithBalance.length} customers →
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoices or customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="w-[140px]"
            />
            <Input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="w-[140px]"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="settled">Settled</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Invoices Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Period</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="hidden sm:table-cell">Paid</TableHead>
                  <TableHead className="hidden sm:table-cell">Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-muted-foreground">No invoices found</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedInvoices.map((invoice) => {
                    const customer = invoice.customers;
                    const paid = Number(invoice.amount_paid) || 0;
                    const total = Number(invoice.total_amount) || 0;
                    const remaining = Math.max(0, total - paid);
                    // Display status derived from actual paid vs total - fixes
                    // cases where status was manually set to "settled" but the
                    // invoice still has an outstanding balance.
                    const derivedStatus: SettlementStatus =
                      remaining < 0.01
                        ? "settled"
                        : paid > 0
                        ? "partial"
                        : invoice.status === "overdue"
                        ? "overdue"
                        : "pending";
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-sm">
                          {invoice.invoice_number}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{customer?.name || "Unknown"}</p>
                            <p className="text-xs text-muted-foreground md:hidden">
                              {format(new Date(invoice.billing_period_start), "MMM dd")} -{" "}
                              {format(new Date(invoice.billing_period_end), "MMM dd")}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm">
                          {format(new Date(invoice.billing_period_start), "MMM dd")} -{" "}
                          {format(new Date(invoice.billing_period_end), "MMM dd, yyyy")}
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(total)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {formatCurrency(paid)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "hidden sm:table-cell font-medium",
                            remaining > 0 ? "text-red-600" : "text-muted-foreground",
                          )}
                        >
                          {formatCurrency(remaining)}
                        </TableCell>
                        <TableCell>{getStatusBadge(derivedStatus)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/customers/${invoice.customer_id}`)}
                              title="View Customer"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditClick(invoice)}
                              title="Edit Invoice"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteClick(invoice)}
                              title="Delete Invoice"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              pageSize={pageSize}
              totalItems={filteredInvoices.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </CardContent>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Invoice</DialogTitle>
              <DialogDescription>
                Update invoice details for {selectedInvoice?.invoice_number}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Period Start</Label>
                  <Input
                    type="date"
                    value={editForm.billing_period_start}
                    onChange={(e) =>
                      setEditForm({ ...editForm, billing_period_start: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Period End</Label>
                  <Input
                    type="date"
                    value={editForm.billing_period_end}
                    onChange={(e) =>
                      setEditForm({ ...editForm, billing_period_end: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v: SettlementStatus) =>
                    setEditForm({ ...editForm, status: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="settled">Settled</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="Add notes..."
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => selectedInvoice && editMutation.mutate(selectedInvoice.id)}
                disabled={editMutation.isPending}
              >
                {editMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Invoice?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Are you sure you want to delete invoice{" "}
                  <strong>{invoiceToDelete?.invoice_number}</strong>?
                </p>
                <p className="text-amber-600">
                  This will unlink all associated transactions and delete payment records.
                  The transactions will return to unpaid status.
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => invoiceToDelete && deleteMutation.mutate(invoiceToDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete Invoice
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
