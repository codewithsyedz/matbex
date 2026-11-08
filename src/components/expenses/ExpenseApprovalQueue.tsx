import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Receipt, 
  AlertCircle,
  Eye,
  CheckCheck
} from "lucide-react";
import { format } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import { useExpenseApproval, ExpenseWithApproval } from "@/hooks/useExpenseApproval";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const paymentMethodLabels: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  other: 'Other',
};

export function ExpenseApprovalQueue() {
  const { format: formatCurrency } = useCurrency();
  const { 
    pendingExpenses, 
    isPendingLoading, 
    approveExpense, 
    rejectExpense,
    bulkApprove,
    canApprove 
  } = useExpenseApproval();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; expense: ExpenseWithApproval | null }>({
    open: false,
    expense: null,
  });
  const [rejectionReason, setRejectionReason] = useState("");
  const [detailsDialog, setDetailsDialog] = useState<{ open: boolean; expense: ExpenseWithApproval | null }>({
    open: false,
    expense: null,
  });
  const [bulkFundingOpen, setBulkFundingOpen] = useState(false);
  const [fundingDialog, setFundingDialog] = useState<{ open: boolean; expense: ExpenseWithApproval | null }>({
    open: false,
    expense: null,
  });
  const [paymentAccountId, setPaymentAccountId] = useState("");

  // Cash / bank / petty-cash accounts that can fund a paid expense.
  const { accounts } = useChartOfAccounts();
  const paymentAccounts = (accounts ?? []).filter(
    (a: any) =>
      a.is_active !== false &&
      a.account_type === "asset" &&
      a.account_code >= "1000" &&
      a.account_code < "1100",
  );
  const defaultPaymentAccountId =
    paymentAccounts.find((a: any) => a.account_code === "1000")?.id ??
    paymentAccounts[0]?.id;



  if (!canApprove) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            <span>You don't have permission to approve expenses.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(pendingExpenses.map(e => e.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    setSelectedIds(newSet);
  };

  const handleApprove = (expense: ExpenseWithApproval) => {
    const funded =
      (expense as any).payment_account_id || (expense as any).capital_account_id;
    // Paid expenses need a funding account before the ledger can balance.
    if (expense.status === "paid" && !funded) {
      setPaymentAccountId(defaultPaymentAccountId ?? "");
      setFundingDialog({ open: true, expense });
      return;
    }
    approveExpense.mutate({ expenseId: expense.id });
  };

  const handleConfirmFunding = () => {
    if (!fundingDialog.expense || !paymentAccountId) return;
    approveExpense.mutate(
      { expenseId: fundingDialog.expense.id, paymentAccountId },
      { onSuccess: () => setFundingDialog({ open: false, expense: null }) },
    );
  };

  const handleOpenReject = (expense: ExpenseWithApproval) => {
    setRejectionReason("");
    setRejectDialog({ open: true, expense });
  };

  const handleConfirmReject = () => {
    if (!rejectDialog.expense || !rejectionReason.trim()) return;
    rejectExpense.mutate(
      { expenseId: rejectDialog.expense.id, reason: rejectionReason },
      {
        onSuccess: () => {
          setRejectDialog({ open: false, expense: null });
          setRejectionReason("");
        },
      }
    );
  };

  const handleBulkApprove = () => {
    if (selectedIds.size === 0) return;
    // Paid expenses need a funding account, otherwise the ledger posting fails
    // silently after they leave the queue — ask once for the whole selection.
    const needsFunding = pendingExpenses.some(
      (expense) =>
        selectedIds.has(expense.id) &&
        expense.status === "paid" &&
        !((expense as any).payment_account_id || (expense as any).capital_account_id),
    );
    if (needsFunding) {
      setPaymentAccountId(defaultPaymentAccountId ?? "");
      setBulkFundingOpen(true);
      return;
    }
    bulkApprove.mutate({ expenseIds: Array.from(selectedIds) }, {
      onSuccess: () => setSelectedIds(new Set()),
    });
  };

  const handleConfirmBulkFunding = () => {
    if (!paymentAccountId) return;
    bulkApprove.mutate(
      { expenseIds: Array.from(selectedIds), paymentAccountId },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setBulkFundingOpen(false);
        },
      },
    );
  };

  if (isPendingLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Pending Approval
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (pendingExpenses.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            Approval Queue
          </CardTitle>
          <CardDescription>No pending expenses to approve</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 opacity-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalPending = pendingExpenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                Pending Approval
                <Badge variant="secondary">{pendingExpenses.length}</Badge>
              </CardTitle>
              <CardDescription>
                Total: {formatCurrency(totalPending)}
              </CardDescription>
            </div>
            {selectedIds.size > 0 && (
              <Button
                onClick={handleBulkApprove}
                disabled={bulkApprove.isPending}
                className="gap-2"
              >
                <CheckCheck className="h-4 w-4" />
                Approve Selected ({selectedIds.size})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === pendingExpenses.length && pendingExpenses.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(expense.id)}
                        onCheckedChange={(checked) => handleSelectOne(expense.id, !!checked)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(expense.expense_date), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {expense.description || '-'}
                    </TableCell>
                    <TableCell>
                      {expense.expense_categories ? (
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: expense.expense_categories.color || undefined,
                            color: expense.expense_categories.color || undefined,
                          }}
                        >
                          {expense.expense_categories.name}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {expense.account ? (
                        <span className="text-xs font-mono">
                          {expense.account.account_code}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {expense.payment_method ? paymentMethodLabels[expense.payment_method] : '-'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(expense.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setDetailsDialog({ open: true, expense })}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                          onClick={() => handleApprove(expense)}
                          disabled={approveExpense.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleOpenReject(expense)}
                          disabled={rejectExpense.isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Rejection Dialog */}
      <Dialog open={rejectDialog.open} onOpenChange={(open) => !open && setRejectDialog({ open: false, expense: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Reject Expense
            </DialogTitle>
            <DialogDescription>
              {rejectDialog.expense && (
                <span>
                  Rejecting expense of {formatCurrency(rejectDialog.expense.amount)} 
                  {rejectDialog.expense.description && ` - ${rejectDialog.expense.description}`}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rejection-reason">
                Rejection Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Please provide a reason for rejecting this expense..."
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialog({ open: false, expense: null })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReject}
              disabled={!rejectionReason.trim() || rejectExpense.isPending}
            >
              Reject Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Dialog */}
      <Dialog open={detailsDialog.open} onOpenChange={(open) => !open && setDetailsDialog({ open: false, expense: null })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Expense Details
            </DialogTitle>
          </DialogHeader>
          {detailsDialog.expense && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Date</Label>
                  <p className="font-medium">
                    {format(new Date(detailsDialog.expense.expense_date), 'MMMM d, yyyy')}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Amount</Label>
                  <p className="font-medium text-lg">
                    {formatCurrency(detailsDialog.expense.amount)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Payment Method</Label>
                  <p className="font-medium">
                    {detailsDialog.expense.payment_method 
                      ? paymentMethodLabels[detailsDialog.expense.payment_method] 
                      : '-'}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">Status</Label>
                  <Badge variant={detailsDialog.expense.status === 'paid' ? 'default' : 'secondary'}>
                    {detailsDialog.expense.status}
                  </Badge>
                </div>
              </div>
              
              {detailsDialog.expense.description && (
                <div>
                  <Label className="text-muted-foreground text-xs">Description</Label>
                  <p className="font-medium">{detailsDialog.expense.description}</p>
                </div>
              )}

              {detailsDialog.expense.expense_categories && (
                <div>
                  <Label className="text-muted-foreground text-xs">Category</Label>
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: detailsDialog.expense.expense_categories.color || undefined,
                      color: detailsDialog.expense.expense_categories.color || undefined,
                    }}
                  >
                    {detailsDialog.expense.expense_categories.name}
                  </Badge>
                </div>
              )}

              {detailsDialog.expense.account && (
                <div>
                  <Label className="text-muted-foreground text-xs">Chart of Accounts</Label>
                  <p className="font-mono text-sm">
                    {detailsDialog.expense.account.account_code} - {detailsDialog.expense.account.account_name}
                  </p>
                </div>
              )}

              {detailsDialog.expense.receipt_url && (
                <div>
                  <Label className="text-muted-foreground text-xs">Receipt</Label>
                  <a 
                    href={detailsDialog.expense.receipt_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline text-sm"
                  >
                    View Receipt
                  </a>
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button
                  className="flex-1 gap-2"
                  onClick={() => {
                    handleApprove(detailsDialog.expense!);
                    setDetailsDialog({ open: false, expense: null });
                  }}
                  disabled={approveExpense.isPending}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1 gap-2"
                  onClick={() => {
                    setDetailsDialog({ open: false, expense: null });
                    handleOpenReject(detailsDialog.expense!);
                  }}
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={fundingDialog.open}
        onOpenChange={(open) => !open && setFundingDialog({ open: false, expense: null })}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which account paid this?</DialogTitle>
            <DialogDescription>
              {fundingDialog.expense?.description || "This expense"} ·{" "}
              {fundingDialog.expense ? formatCurrency(fundingDialog.expense.amount) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Payment source</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select payment source" />
              </SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_code} · {a.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFundingDialog({ open: false, expense: null })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFunding}
              disabled={!paymentAccountId || approveExpense.isPending}
            >
              {approveExpense.isPending ? "Approving…" : "Approve & post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bulkFundingOpen} onOpenChange={setBulkFundingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which account paid these?</DialogTitle>
            <DialogDescription>
              {selectedIds.size} selected expenses · paid expenses without a payment source use this
              account so the ledger entry balances.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Payment source</Label>
            <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Select payment source" />
              </SelectTrigger>
              <SelectContent>
                {paymentAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_code} · {a.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkFundingOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmBulkFunding} disabled={!paymentAccountId || bulkApprove.isPending}>
              {bulkApprove.isPending ? "Approving…" : "Approve & post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
