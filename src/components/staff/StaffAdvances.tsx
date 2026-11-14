import { useState } from "react";
import { toast } from "sonner";
import {
  AdvanceFundingSourceField,
  type AdvanceFundingSelection,
} from "./AdvanceFundingSourceField";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  advanceOutstanding,
  useStaffAdvances,
  type CreateAdvanceData,
  type StaffAdvance,
} from "@/hooks/useStaffAdvances";
import { useCurrency } from "@/hooks/useCurrency";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdvanceSettlementBadge } from "@/components/staff/AdvanceSettlementBadge";
import { deriveAdvanceSettlement } from "@/lib/staffAdvanceSettlement";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StaffTableCardSkeleton } from "@/components/staff/StaffSkeletons";
import {
  Plus,
  Loader2,
  MoreHorizontal,
  Banknote,
  Clock,
  CheckCircle,
  Trash2,
  Gift,
  Calculator,
  Receipt,
  HandCoins,
} from "lucide-react";
import { FiscalMonthPayableBreakdown } from "./FiscalMonthPayableBreakdown";
import { StaffAdvanceLedgerDialog } from "./StaffAdvanceLedgerDialog";
import { StaffAdvanceRepaymentDialog } from "./StaffAdvanceRepaymentDialog";
import { StaffAdvanceReconciliationPanel } from "./StaffAdvanceReconciliationPanel";
import { useBranch } from "@/contexts/BranchContext";
import { auditAdvanceBranchAlignment } from "@/lib/advanceBranchMismatch";
import {
  AdvanceBranchMismatchAlert,
  BranchMismatchBadge,
} from "@/components/staff/AdvanceBranchMismatchAlert";
import { AdvanceBranchConsistencyPanel } from "@/components/staff/AdvanceBranchConsistencyPanel";
import { AdvanceBranchAuditLog } from "@/components/staff/AdvanceBranchAuditLog";

interface Staff {
  id: string;
  name: string;
  role: string;
}

export function StaffAdvances() {
  const { restaurant, hasRole } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const isManager = hasRole("owner") || hasRole("manager");
  const isOwner = hasRole("owner");
  const { branches } = useBranch();
  const branchName = (id: string | null | undefined) =>
    (id ? branches.find((b) => b.id === id)?.name : null) ?? (id ? "another branch" : "no branch");

  const {
    advances,
    isLoading,
    totalPending,
    totalDeducted,
    totalForgiven,
    getTotalPendingForStaff,
    createAdvance,
    forgiveAdvance,
    deleteAdvance,
    isCreating,
  } = useStaffAdvances();

  const branchIssuesFor = (advance: StaffAdvance) =>
    auditAdvanceBranchAlignment({
      advanceBranchId: advance.branch_id ?? null,
      staffBranchId: advance.staff?.branch_id ?? null,
      branchName,
    });
  const mismatchedAdvances = advances.filter((a) => branchIssuesFor(a).length > 0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [forgiveDialogOpen, setForgiveDialogOpen] = useState(false);
  const [selectedAdvanceId, setSelectedAdvanceId] = useState<string | null>(null);
  const [ledgerAdvanceId, setLedgerAdvanceId] = useState<string | null>(null);
  const [repayAdvanceId, setRepayAdvanceId] = useState<string | null>(null);
  // Derive from the live list so balances refresh after each repayment.
  const repayAdvance: StaffAdvance | null =
    advances.find((a) => a.id === repayAdvanceId) ?? null;

  const [formData, setFormData] = useState<CreateAdvanceData>({
    staff_id: "",
    amount: 0,
    advance_date: new Date().toISOString().split("T")[0],
    reason: "",
    payment_method: "cash",
  });

  const [funding, setFunding] = useState<AdvanceFundingSelection>({
    funding_source: "company",
    funding_account_id: null,
    capital_account_id: null,
  });

  // Duplicate guard: same staff + same date + same amount, still live (not reversed/forgiven)
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const duplicateAdvances = formData.staff_id && formData.amount > 0
    ? advances.filter(
        (a) =>
          a.staff_id === formData.staff_id &&
          a.advance_date === formData.advance_date &&
          Number(a.amount) === Number(formData.amount) &&
          a.status !== "forgiven" &&
          !a.ledger_reversed
      )
    : [];
  const hasDuplicate = duplicateAdvances.length > 0;

  // Fetch active staff
  const { data: staffList } = useQuery({
    queryKey: ["staff-active", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("staff")
        .select("id, name, role")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data as Staff[];
    },
    enabled: !!restaurant?.id,
  });

  const resetForm = () => {
    setFormData({
      staff_id: "",
      amount: 0,
      advance_date: new Date().toISOString().split("T")[0],
      reason: "",
      payment_method: "cash",
    });
    setFunding({ funding_source: "company", funding_account_id: null, capital_account_id: null });
    setDuplicateAcknowledged(false);
  };

  const handleSubmit = () => {
    if (!formData.staff_id) {
      return;
    }
    if (formData.amount <= 0) {
      return;
    }
    if (funding.funding_source !== "company" && !funding.capital_account_id) {
      toast.error("Select the owner or partner account funding this advance");
      return;
    }
    if (hasDuplicate && !duplicateAcknowledged) {
      toast.error("A matching advance already exists — confirm it is not a duplicate first");
      return;
    }
    createAdvance.mutate({ ...formData, ...funding }, {
      onSuccess: () => {
        setDialogOpen(false);
        resetForm();
      },
    });
  };

  const handleDelete = () => {
    if (!selectedAdvanceId) return;
    deleteAdvance.mutate(selectedAdvanceId, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        setSelectedAdvanceId(null);
      },
    });
  };

  const handleForgive = () => {
    if (!selectedAdvanceId) return;
    forgiveAdvance.mutate(selectedAdvanceId, {
      onSuccess: () => {
        setForgiveDialogOpen(false);
        setSelectedAdvanceId(null);
      },
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case "deducted":
        return (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-300 bg-green-50">
            <CheckCircle className="h-3 w-3" />
            Deducted
          </Badge>
        );
      case "forgiven":
        return (
          <Badge variant="outline" className="gap-1 text-purple-600 border-purple-300 bg-purple-50">
            <Gift className="h-3 w-3" />
            Forgiven
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case "cash":
        return "Cash";
      case "bank_transfer":
        return "Bank Transfer";
      case "cheque":
        return "Cheque";
      default:
        return method;
    }
  };

  const safeFormatDate = (dateStr: string | null | undefined, formatStr: string) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    return format(date, formatStr);
  };

  if (isLoading) {
    return <StaffTableCardSkeleton rows={6} />;
  }

  return (
    <Tabs defaultValue="payables" className="space-y-4">
      <TabsList>
        <TabsTrigger value="payables" className="gap-2">
          <Calculator className="h-4 w-4" />
          Fiscal Payables
        </TabsTrigger>
        <TabsTrigger value="advances" className="gap-2">
          <Receipt className="h-4 w-4" />
          Record Advances
        </TabsTrigger>
      </TabsList>

      <TabsContent value="payables">
        <FiscalMonthPayableBreakdown />
      </TabsContent>

      <TabsContent value="advances" className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 mt-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-amber-500/10">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending Advances</p>
                <p className="text-2xl font-semibold">{formatCurrency(totalPending)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-green-500/10">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Repaid / Deducted</p>
                <p className="text-2xl font-semibold">{formatCurrency(totalDeducted)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-purple-500/10">
                <Gift className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Forgiven</p>
                <p className="text-2xl font-semibold">{formatCurrency(totalForgiven)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <StaffAdvanceReconciliationPanel
        advances={advances.map((a) => ({
          id: a.id,
          amount: Number(a.amount || 0),
          ledger_posted: (a as { ledger_posted?: boolean | null }).ledger_posted ?? null,
          ledger_reversed: (a as { ledger_reversed?: boolean | null }).ledger_reversed ?? null,
          status: a.status ?? null,
          repaid_amount: Number((a as { repaid_amount?: number | null }).repaid_amount ?? 0),
          staff_name: (a as { staff?: { name?: string } | null }).staff?.name ?? null,
        }))}
        isLoading={isLoading}
      />

      <AdvanceBranchConsistencyPanel />

      <AdvanceBranchAuditLog />

      {mismatchedAdvances.length > 0 && (
        <AdvanceBranchMismatchAlert
          title={`${mismatchedAdvances.length} advance${
            mismatchedAdvances.length === 1 ? "" : "s"
          } sit on a different branch than the staff profile`}
          issues={mismatchedAdvances.flatMap((a) =>
            branchIssuesFor(a).map((i) => ({
              ...i,
              message: `${a.staff?.name ?? "Staff"} · ${a.advance_date}: ${i.message}`,
            }))
          )}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-medium">Staff Advances</CardTitle>
            <CardDescription>Track advance payments given to staff members</CardDescription>
          </div>
          {isManager && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={resetForm}>
                  <Plus className="h-4 w-4 mr-2" />
                  Record Advance
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Record Advance Payment</DialogTitle>
                  <DialogDescription>
                    Record an advance payment given to a staff member
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Staff Member *</Label>
                    <Select
                      value={formData.staff_id}
                      onValueChange={(v) => setFormData({ ...formData, staff_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select staff" />
                      </SelectTrigger>
                      <SelectContent>
                        {staffList?.map((staff) => {
                          const pendingAmount = getTotalPendingForStaff(staff.id);
                          return (
                            <SelectItem key={staff.id} value={staff.id}>
                              <div className="flex items-center justify-between gap-2">
                                <span>{staff.name}</span>
                                {pendingAmount > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    {formatCurrency(pendingAmount)} pending
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount *</Label>
                      <Input
                        id="amount"
                        type="number"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        value={formData.amount || ""}
                        onChange={(e) =>
                          setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="advance_date">Date</Label>
                      <Input
                        id="advance_date"
                        type="date"
                        value={formData.advance_date}
                        onChange={(e) =>
                          setFormData({ ...formData, advance_date: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <Select
                      value={formData.payment_method}
                      onValueChange={(v: "cash" | "bank_transfer" | "cheque") =>
                        setFormData({ ...formData, payment_method: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <AdvanceFundingSourceField value={funding} onChange={setFunding} />

                  {hasDuplicate && (
                    <Alert variant="destructive">
                      <AlertTitle>Possible duplicate advance</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p className="text-xs">
                          {duplicateAdvances.length} existing advance
                          {duplicateAdvances.length === 1 ? "" : "s"} of{" "}
                          {formatCurrency(formData.amount)} already recorded for this staff member on{" "}
                          {formData.advance_date}.
                        </p>
                        <label className="flex items-center gap-2 text-xs font-medium">
                          <Checkbox
                            checked={duplicateAcknowledged}
                            onCheckedChange={(v) => setDuplicateAcknowledged(v === true)}
                          />
                          This is a separate payout, record it anyway
                        </label>
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="reason">Reason (optional)</Label>
                    <Textarea
                      id="reason"
                      placeholder="Reason for advance..."
                      value={formData.reason || ""}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={
                      isCreating ||
                      !formData.staff_id ||
                      formData.amount <= 0 ||
                      (hasDuplicate && !duplicateAcknowledged)
                    }
                  >
                    {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Record Advance
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {advances.length === 0 ? (
            <div className="text-center py-12">
              <Banknote className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No advance payments recorded yet</p>
              {isManager && (
                <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Record First Advance
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ledger</TableHead>
                    <TableHead>Reason</TableHead>
                    {isManager && <TableHead className="w-12"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {advances.map((advance) => (
                    <TableRow
                      key={advance.id}
                      className={
                        branchIssuesFor(advance).length > 0
                          ? "bg-amber-50/60 hover:bg-amber-50"
                          : ""
                      }
                    >
                      <TableCell className="font-medium">
                        {safeFormatDate(advance.advance_date, "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{advance.staff?.name || "Unknown"}</p>
                            <BranchMismatchBadge issues={branchIssuesFor(advance)} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {advance.staff?.role || ""}
                          </p>
                          {advance.branch_id && (
                            <p className="text-[11px] text-muted-foreground">
                              {branchName(advance.branch_id)}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(advance.amount)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-semibold">
                            {formatCurrency(advanceOutstanding(advance))}
                          </p>
                          {Number(advance.repaid_amount || 0) > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              {formatCurrency(Number(advance.repaid_amount))} repaid
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{getPaymentMethodLabel(advance.payment_method)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <AdvanceSettlementBadge advance={advance} />
                          {deriveAdvanceSettlement(advance).status === "partially_paid" && (
                            <p className="text-[11px] text-muted-foreground">
                              {deriveAdvanceSettlement(advance).percentRepaid}% settled ·{" "}
                              {formatCurrency(advanceOutstanding(advance))} due
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {advance.ledger_posted ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 gap-1"
                              onClick={() => setLedgerAdvanceId(advance.id)}
                            >
                              <Receipt className="h-3 w-3" />
                              View entry
                            </Button>
                            {advance.ledger_reversed && (
                              <Badge variant="destructive" className="text-[10px]">
                                Reversed
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Not posted
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {advance.reason || "-"}
                      </TableCell>
                      {isManager && (
                        <TableCell>
                          {advance.status === "pending" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setRepayAdvanceId(advance.id)}>
                                  <HandCoins className="h-4 w-4 mr-2" />
                                  Record repayment
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedAdvanceId(advance.id);
                                    setForgiveDialogOpen(true);
                                  }}
                                >
                                  <Gift className="h-4 w-4 mr-2" />
                                  Forgive Advance
                                </DropdownMenuItem>
                                {isOwner && (
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => {
                                      setSelectedAdvanceId(advance.id);
                                      setDeleteDialogOpen(true);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Advance?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this advance record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Forgive Confirmation */}
      <AlertDialog open={forgiveDialogOpen} onOpenChange={setForgiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forgive Advance?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the advance as forgiven. The amount will not be deducted from the
              staff member's salary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleForgive}>Forgive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StaffAdvanceLedgerDialog
        advanceId={ledgerAdvanceId}
        open={!!ledgerAdvanceId}
        onOpenChange={(o) => !o && setLedgerAdvanceId(null)}
      />

      <StaffAdvanceRepaymentDialog
        advance={repayAdvance}
        open={!!repayAdvance}
        onOpenChange={(o) => !o && setRepayAdvanceId(null)}
        canDelete={isOwner}
      />
      </TabsContent>
    </Tabs>
  );
}
