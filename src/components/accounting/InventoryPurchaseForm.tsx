/**
 * Specialized Inventory Purchase Form
 * 
 * Enforces strict rules: DR Inventory (1200-1299), CR Cash/Bank/AP (1000-1199 or 2000-2999)
 * Blocks COGS accounts entirely.
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { ShoppingCart, Loader2, Check, Info, AlertCircle } from "lucide-react";
import { useJournalEntries } from "@/hooks/useJournalEntries";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { useImpersonationGuard } from "@/hooks/useImpersonationGuard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PaymentMethod = 'cash' | 'bank' | 'credit';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', accountCode: '1000' },
  { value: 'bank', label: 'Bank Transfer / Card', accountCode: '1010' },
  { value: 'credit', label: 'On Credit (Accounts Payable)', accountCode: '2000' },
] as const;

export function InventoryPurchaseForm() {
  const { createJournalEntry, isCreating } = useJournalEntries();
  const { accounts } = useChartOfAccounts();
  const { format: formatCurrency } = useCurrency();
  const guardWrite = useImpersonationGuard();

  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [batchDate, setBatchDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState("");
  const [inventoryAccountId, setInventoryAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  // Filter inventory accounts (1200-1299)
  const inventoryAccounts = useMemo(() => 
    accounts.filter(a => 
      a.is_active && 
      a.account_code >= '1200' && 
      a.account_code < '1300'
    ).sort((a, b) => a.account_code.localeCompare(b.account_code)),
    [accounts]
  );

  // Get payment account based on method
  const paymentAccount = useMemo(() => {
    const targetCode = PAYMENT_METHODS.find(m => m.value === paymentMethod)?.accountCode;
    return accounts.find(a => 
      a.is_active && 
      a.account_code === targetCode
    );
  }, [accounts, paymentMethod]);

  const parsedAmount = parseFloat(amount) || 0;
  const isValid = parsedAmount > 0 && inventoryAccountId && paymentAccount && description.trim();

  const handleSubmit = () => {
    if (!guardWrite("record an inventory purchase")) return;
    if (!isValid || !paymentAccount) return;

    const inventoryAccount = inventoryAccounts.find(a => a.id === inventoryAccountId);
    
    createJournalEntry.mutate(
      {
        description: `Inventory Purchase: ${description}`,
        reference_number: referenceNumber || undefined,
        entry_type: "adjustment", // Will be stored as 'purchase' journal_type
        batch_date: batchDate,
        lines: [
          // DR Inventory (increase asset)
          {
            account_id: inventoryAccountId,
            debit: parsedAmount,
            description: `Purchase: ${description}`,
          },
          // CR Cash/Bank/AP (decrease asset or increase liability)
          {
            account_id: paymentAccount.id,
            credit: parsedAmount,
            description: `Purchase: ${description}`,
          },
        ],
      },
      {
        onSuccess: () => {
          setIsOpen(false);
          resetForm();
        },
      }
    );
  };

  const resetForm = () => {
    setDescription("");
    setReferenceNumber("");
    setBatchDate(new Date().toISOString().split("T")[0]);
    setAmount("");
    setInventoryAccountId("");
    setPaymentMethod("cash");
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <ShoppingCart className="h-4 w-4" />
          Record Purchase
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Record Inventory Purchase
          </DialogTitle>
          <DialogDescription>
            Record a purchase that increases inventory. COGS is recognized separately via consumption.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
              <strong>How this works:</strong> Purchases increase your Inventory asset account. 
              To recognize cost (COGS), use a separate "COGS Recognition" entry when goods are consumed.
            </AlertDescription>
          </Alert>

          {/* Date & Reference */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="purchase-date">Date</Label>
              <Input
                id="purchase-date"
                type="date"
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="purchase-ref">Invoice/Reference #</Label>
              <Input
                id="purchase-ref"
                placeholder="INV-001"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="purchase-desc">Description *</Label>
            <Textarea
              id="purchase-desc"
              placeholder="e.g., Weekly food supplies from ABC Supplier"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="purchase-amount">Amount *</Label>
            <Input
              id="purchase-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {/* Inventory Account (DEBIT) */}
          <div className="space-y-2">
            <Label>Inventory Account (Debit) *</Label>
            {inventoryAccounts.length === 0 ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No inventory accounts found. Create accounts in the 1200-1299 range first.
                </AlertDescription>
              </Alert>
            ) : (
              <Select value={inventoryAccountId} onValueChange={setInventoryAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select inventory account..." />
                </SelectTrigger>
                <SelectContent>
                  {inventoryAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      <span className="font-mono text-xs mr-2">{acc.account_code}</span>
                      {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Payment Method (CREDIT) */}
          <div className="space-y-2">
            <Label>Payment Method (Credit) *</Label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => setPaymentMethod(method.value as PaymentMethod)}
                  className={cn(
                    "p-3 rounded-lg border-2 transition-all text-sm text-center",
                    paymentMethod === method.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {method.label}
                </button>
              ))}
            </div>
            {paymentAccount && (
              <p className="text-xs text-muted-foreground">
                Will credit: {paymentAccount.account_code} - {paymentAccount.account_name}
              </p>
            )}
            {!paymentAccount && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Payment account not found. Please create account {PAYMENT_METHODS.find(m => m.value === paymentMethod)?.accountCode}.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Preview */}
          {parsedAmount > 0 && inventoryAccountId && paymentAccount && (
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="text-sm font-medium mb-2">Entry Preview:</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>DR {inventoryAccounts.find(a => a.id === inventoryAccountId)?.account_name}</span>
                  <span className="font-mono">{formatCurrency(parsedAmount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span className="pl-4">CR {paymentAccount.account_name}</span>
                  <span className="font-mono">{formatCurrency(parsedAmount)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isCreating || !isValid}
            className="gap-1"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Record Purchase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
