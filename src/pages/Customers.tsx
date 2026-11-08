import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  Users,
  Plus,
  Search,
  Wallet,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  Ban,
  Edit,
  Eye,
  Clock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { BranchSwitcher } from "@/components/layout/BranchSwitcher";
import { useBranchUnpaidBalances } from "@/hooks/useBranchUnpaidBalances";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { format, subDays, startOfDay } from "date-fns";
import { getRestaurantDayBoundsUTC } from "@/lib/timezone";
import { useNavigate } from "react-router-dom";

type CreditStatus = "active" | "suspended" | "blocked";

interface Customer {
  id: string;
  restaurant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  current_balance: number;
  credit_status: CreditStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  branch_id: string | null;
}

export default function Customers() {
  const { user, restaurant } = useAuth();
  const { activeBranchId, activeBranch, branches } = useBranch();
  const { t } = useTranslation();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Pagination state (client-side over the filtered list)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    credit_limit: "",
    credit_status: "active" as CreditStatus,
    notes: "",
    branch_id: "shared" as string,
  });

  // Fetch customers
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data as Customer[];
    },
    enabled: !!restaurant?.id,
  });

  // Unpaid balances per customer, scoped to the active branch when one is selected.
  const {
    byCustomer: unpaidByCustomer,
    totalOutstanding: branchOutstanding,
    isBranchScoped,
  } = useBranchUnpaidBalances();

  // Fetch yesterday's outstanding (unpaid sales from yesterday)
  const { data: yesterdayOutstanding = 0 } = useQuery({
    queryKey: ["yesterday-outstanding", restaurant?.id, activeBranchId],
    queryFn: async () => {
      if (!restaurant?.id) return 0;
      
      const timezone = restaurant.timezone || 'Asia/Riyadh';
      const yesterday = subDays(startOfDay(new Date()), 1);
      const bounds = getRestaurantDayBoundsUTC(yesterday, timezone);
      
      let query = supabase
        .from("sales_transactions")
        .select("total")
        .eq("restaurant_id", restaurant.id)
        .eq("settlement_status", "unpaid")
        .gte("created_at", bounds.start.toISOString())
        .lt("created_at", bounds.endExclusive.toISOString());
      if (activeBranchId) query = query.eq("branch_id", activeBranchId);

      const { data, error } = await query;
      if (error) throw error;
      return data?.reduce((sum, tx) => sum + (tx.total || 0), 0) || 0;
    },
    enabled: !!restaurant?.id,
  });

  /** Outstanding balance for a customer, branch-scoped when a branch is active. */
  const balanceFor = (customer: Customer) =>
    isBranchScoped ? unpaidByCustomer[customer.id]?.amount ?? 0 : customer.current_balance;

  // Summary stats
  const stats = {
    totalCustomers: customers.length,
    activeCustomers: customers.filter((c) => c.credit_status === "active").length,
    totalOutstanding: isBranchScoped
      ? branchOutstanding
      : customers.reduce((sum, c) => sum + c.current_balance, 0),
    overdueCount: customers.filter((c) => c.credit_status === "blocked").length,
    yesterdayOutstanding,
  };

  // Filter customers
  const filteredCustomers = customers.filter((customer) => {
    // Branch scope: a branch's list shows its own customers plus shared (untagged) ones.
    const matchesBranch =
      !activeBranchId || !customer.branch_id || customer.branch_id === activeBranchId;
    const matchesSearch =
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone?.includes(searchTerm);
    const matchesStatus =
      statusFilter === "all" || customer.credit_status === statusFilter;
    return matchesBranch && matchesSearch && matchesStatus;
  });

  // Reset to first page whenever filters change
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, activeBranchId]);

  // Slice the filtered list to the current page
  const paginatedCustomers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCustomers.slice(start, start + pageSize);
  }, [filteredCustomers, page, pageSize]);

  // Add customer mutation
  const addCustomerMutation = useMutation({
    mutationFn: async () => {
      if (!restaurant?.id || !user?.id) throw new Error("Missing context");
      const { error } = await supabase.from("customers").insert({
        restaurant_id: restaurant.id,
        name: formData.name,
        email: formData.email || null,
        phone: formData.phone || null,
        address: formData.address || null,
        credit_limit: parseFloat(formData.credit_limit) || 0,
        credit_status: formData.credit_status,
        notes: formData.notes || null,
        branch_id: formData.branch_id === "shared" ? null : formData.branch_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast.success("Customer added successfully");
    },
    onError: (error) => {
      toast.error("Failed to add customer");
      console.error(error);
    },
  });

  // Update customer mutation
  const updateCustomerMutation = useMutation({
    mutationFn: async () => {
      if (!editingCustomer) throw new Error("No customer selected");
      const { error } = await supabase
        .from("customers")
        .update({
          name: formData.name,
          email: formData.email || null,
          phone: formData.phone || null,
          address: formData.address || null,
          credit_limit: parseFloat(formData.credit_limit) || 0,
          credit_status: formData.credit_status,
          notes: formData.notes || null,
          branch_id: formData.branch_id === "shared" ? null : formData.branch_id,
        })
        .eq("id", editingCustomer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setEditingCustomer(null);
      resetForm();
      toast.success("Customer updated successfully");
    },
    onError: (error) => {
      toast.error("Failed to update customer");
      console.error(error);
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      phone: "",
      address: "",
      credit_limit: "",
      credit_status: "active",
      notes: "",
      // New customers default to the branch you are working in.
      branch_id: activeBranchId ?? "shared",
    });
  };

  const handleEdit = (customer: Customer) => {
    setFormData({
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || "",
      address: customer.address || "",
      credit_limit: customer.credit_limit.toString(),
      credit_status: customer.credit_status,
      notes: customer.notes || "",
      branch_id: customer.branch_id ?? "shared",
    });
    setEditingCustomer(customer);
  };

  const getStatusBadge = (status: CreditStatus) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Active
          </Badge>
        );
      case "suspended":
        return (
          <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Clock className="h-3 w-3 mr-1" />
            Suspended
          </Badge>
        );
      case "blocked":
        return (
          <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
            <Ban className="h-3 w-3 mr-1" />
            Blocked
          </Badge>
        );
    }
  };

  const getCreditUtilization = (customer: Customer) => {
    if (customer.credit_limit <= 0) return 0;
    return Math.min((customer.current_balance / customer.credit_limit) * 100, 100);
  };

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 min-h-[56px]">
          <div className="min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">
              {t("app.customers.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("app.customers.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <BranchSwitcher />
          <Dialog
            open={isAddDialogOpen}
            onOpenChange={(open) => {
              if (open) {
                setFormData((prev) => ({ ...prev, branch_id: activeBranchId ?? "shared" }));
              }
              setIsAddDialogOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {t("app.customers.addCustomer")}
              </Button>
            </DialogTrigger>
            <DialogContent
              description={
                formData.name
                  ? `Add customer "${formData.name}" - set contact details and opening balance.`
                  : "Create a new customer - contact details and optional opening balance."
              }
              className="max-w-md"
            >
              <DialogHeader>
                <DialogTitle>Add New Customer</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Customer name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      placeholder="Email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData({ ...formData, phone: e.target.value })
                      }
                      placeholder="Phone"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Textarea
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    placeholder="Address"
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Credit Limit</Label>
                    <Input
                      type="number"
                      value={formData.credit_limit}
                      onChange={(e) =>
                        setFormData({ ...formData, credit_limit: e.target.value })
                      }
                      placeholder="0 = Unlimited"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={formData.credit_status}
                      onValueChange={(value: CreditStatus) =>
                        setFormData({ ...formData, credit_status: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="blocked">Blocked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select
                    value={formData.branch_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, branch_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shared">Shared (all branches)</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                          {b.code ? ` (${b.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Shared customers appear on every branch's list.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    placeholder="Internal notes..."
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => addCustomerMutation.mutate()}
                  disabled={!formData.name || addCustomerMutation.isPending}
                >
                  Add Customer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4" />
                Total Customers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.totalCustomers}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-600">
                {stats.activeCustomers}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-500" />
                Total Outstanding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-600">
                {formatCurrency(stats.totalOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isBranchScoped ? activeBranch?.name ?? "Current branch" : "All branches"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-orange-500" />
                Yesterday Outstanding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">
                {formatCurrency(stats.yesterdayOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isBranchScoped ? activeBranch?.name ?? "Current branch" : "All branches"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Blocked
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">
                {stats.overdueCount}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Customers Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead className="hidden sm:table-cell">Credit Limit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-muted-foreground">No customers found</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-medium">{customer.name}</p>
                            <p className="text-xs text-muted-foreground md:hidden">
                              {customer.phone || customer.email || "No contact"}
                            </p>
                          </div>
                          {(unpaidByCustomer[customer.id]?.count ?? 0) > 0 && (
                            <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs">
                              {unpaidByCustomer[customer.id].count} unpaid
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {customer.branch_id
                              ? branches.find((b) => b.id === customer.branch_id)?.code ??
                                branches.find((b) => b.id === customer.branch_id)?.name ??
                                "Branch"
                              : "Shared"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="text-sm">
                          {customer.email && <p>{customer.email}</p>}
                          {customer.phone && (
                            <p className="text-muted-foreground">{customer.phone}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className={`font-medium ${balanceFor(customer) > 0 ? "text-amber-600" : "text-foreground"}`}>
                            {formatCurrency(balanceFor(customer))}
                          </p>
                          {customer.credit_limit > 0 && (
                            <div className="w-20 h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  getCreditUtilization(customer) > 80
                                    ? "bg-red-500"
                                    : getCreditUtilization(customer) > 50
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                }`}
                                style={{ width: `${getCreditUtilization(customer)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {customer.credit_limit > 0
                          ? formatCurrency(customer.credit_limit)
                          : "Unlimited"}
                      </TableCell>
                      <TableCell>{getStatusBadge(customer.credit_status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/customers/${customer.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(customer)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              pageSize={pageSize}
              totalItems={filteredCustomers.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </CardContent>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={!!editingCustomer} onOpenChange={(open) => !open && setEditingCustomer(null)}>
          <DialogContent
            description={
              editingCustomer
                ? `Edit customer "${editingCustomer.name}" - contact details and credit settings.`
                : "Edit customer."
            }
            className="max-w-md"
          >
            <DialogHeader>
              <DialogTitle>Edit Customer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Customer name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    placeholder="Email"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    placeholder="Phone"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({ ...formData, address: e.target.value })
                  }
                  placeholder="Address"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Credit Limit</Label>
                  <Input
                    type="number"
                    value={formData.credit_limit}
                    onChange={(e) =>
                      setFormData({ ...formData, credit_limit: e.target.value })
                    }
                    placeholder="0 = Unlimited"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={formData.credit_status}
                    onValueChange={(value: CreditStatus) =>
                      setFormData({ ...formData, credit_status: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select
                  value={formData.branch_id}
                  onValueChange={(value) => setFormData({ ...formData, branch_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">Shared (all branches)</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                        {b.code ? ` (${b.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Internal notes..."
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingCustomer(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => updateCustomerMutation.mutate()}
                disabled={!formData.name || updateCustomerMutation.isPending}
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
