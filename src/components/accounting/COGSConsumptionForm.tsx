/**
 * COGS Consumption Form
 * 
 * Enforces strict rules: DR COGS (5000-5999), CR Inventory (1200-1299)
 * Used to recognize cost when inventory is consumed/sold.
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
import { TrendingDown, Loader2, Check, Info, AlertCircle, Calculator } from "lucide-react";
import { useJournalEntries } from "@/hooks/useJournalEntries";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { useImpersonationGuard } from "@/hooks/useImpersonationGuard";
import { cn } from "@/lib/utils";

type ConsumptionMethod = 'manual' | 'stock_count' | 'recipe';

const CONSUMPTION_METHODS = [
  { value: 'manual', label: 'Manual Entry', description: 'Enter amount directly' },
  { value: 'stock_count', label: 'Stock Count', description: 'Calculate from opening/closing stock' },
  { value: 'recipe', label: 'Recipe Based', description: 'Based on items sold (coming soon)' },
] as const;

export function COGSConsumptionForm() {
  const { createJournalEntry, isCreating } = useJournalEntries();
  const { accounts } = useChartOfAccounts();
  const { format: formatCurrency } = useCurrency();
  const guardWrite = useImpersonationGuard();

  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [batchDate, setBatchDate] = useState(new Date().toISOString().split("T")[0]);
  const [method, setMethod] = useState<ConsumptionMethod>("manual");
  
  // Manual entry
  const [amount, setAmount] = useState("");
  
  // Stock count method
  const [openingStock, setOpeningStock] = useState("");
  const [purchases, setPurchases] = useState("");
  const [closingStock, setClosingStock] = useState("");
  
  const [cogsAccountId, setCogsAccountId] = useState("");
  const [inventoryAccountId, setInventoryAccountId] = useState("");

  // Filter COGS accounts (5000-5999)
  const cogsAccounts = useMemo(() => 
    accounts.filter(a => 
      a.is_active && 
      a.account_type === 'cogs'
    ).sort((a, b) => a.account_code.localeCompare(b.account_code)),
    [accounts]
  );

  // Filter inventory accounts (1200-1299)
  const inventoryAccounts = useMemo(() => 
    accounts.filter(a => 
      a.is_active && 
      a.account_code >= '1200' && 
      a.account_code < '1300'
    ).sort((a, b) => a.account_code.localeCompare(b.account_code)),
    [accounts]
  );

  // Calculate COGS based on method
  const calculatedCOGS = useMemo(() => {
    if (method === 'manual') {
      return parseFloat(amount) || 0;
    }
    if (method === 'stock_count') {
      const opening = parseFloat(openingStock) || 0;
      const purch = parseFloat(purchases) || 0;
      const closing = parseFloat(closingStock) || 0;
      return opening + purch - closing;
    }
    return 0;
  }, [method, amount, openingStock, purchases, closingStock]);

  const isValid = calculatedCOGS > 0 && cogsAccountId && inventoryAccountId && description.trim();

  const handleSubmit = () => {
    if (!guardWrite("record COGS consumption")) return;
    if (!isValid) return;

    const cogsAccount = cogsAccounts.find(a => a.id === cogsAccountId);
    const inventoryAccount = inventoryAccounts.find(a => a.id === inventoryAccountId);
    
    let entryDescription = `COGS Recognition: ${description}`;
    if (method === 'stock_count') {
      entryDescription += ` (Opening: ${formatCurrency(parseFloat(openingStock) || 0)} + Purchases: ${formatCurrency(parseFloat(purchases) || 0)} - Closing: ${formatCurrency(parseFloat(closingStock) || 0)})`;
    }

    createJournalEntry.mutate(
      {
        description: entryDescription,
        reference_number: referenceNumber || undefined,
        entry_type: "adjustment", // Will be stored as 'consumption' journal_type
        batch_date: batchDate,
        lines: [
          // DR COGS (increase expense)
          {
            account_id: cogsAccountId,
            debit: calculatedCOGS,
            description: `COGS: ${description}`,
          },
          // CR Inventory (decrease asset)
          {
            account_id: inventoryAccountId,
            credit: calculatedCOGS,
            description: `COGS: ${description}`,
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
    setMethod("manual");
    setAmount("");
    setOpeningStock("");
    setPurchases("");
    setClosingStock("");
    setCogsAccountId("");
    setInventoryAccountId("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <TrendingDown className="h-4 w-4" />
          Record COGS
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Record COGS (Consumption)
          </DialogTitle>
          <DialogDescription>
            Move cost from Inventory to COGS when goods are consumed or sold.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900">
            <Info className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
              <strong>Consumption moves value:</strong> This entry reduces your Inventory (asset) 
              and increases COGS (expense). Use this after goods are sold or consumed.
            </AlertDescription>
          </Alert>

          {/* Date & Reference */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cogs-date">Date</Label>
              <Input
                id="cogs-date"
                type="date"
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cogs-ref">Reference #</Label>
              <Input
                id="cogs-ref"
                placeholder="COGS-001"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="cogs-desc">Description *</Label>
            <Textarea
              id="cogs-desc"
              placeholder="e.g., Weekly food consumption, Monthly COGS recognition"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Calculation Method */}
          <div className="space-y-2">
            <Label>Calculation Method</Label>
            <div className="grid grid-cols-2 gap-2">
              {CONSUMPTION_METHODS.filter(m => m.value !== 'recipe').map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value as ConsumptionMethod)}
                  className={cn(
                    "p-3 rounded-lg border-2 transition-all text-left",
                    method === m.value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <p className="font-medium text-sm">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Amount Input - Manual */}
          {method === 'manual' && (
            <div className="space-y-2">
              <Label htmlFor="cogs-amount">COGS Amount *</Label>
              <Input
                id="cogs-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          )}

          {/* Stock Count Calculator */}
          {method === 'stock_count' && (
            <div className="space-y-3 p-4 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="h-4 w-4" />
                <span className="font-medium text-sm">COGS Calculator</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                COGS = Opening Stock + Purchases − Closing Stock
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Opening Stock</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={openingStock}
                    onChange={(e) => setOpeningStock(e.target.value)}
                    className="text-right"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">+ Purchases</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={purchases}
                    onChange={(e) => setPurchases(e.target.value)}
                    className="text-right"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">− Closing Stock</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={closingStock}
                    onChange={(e) => setClosingStock(e.target.value)}
                    className="text-right"
                  />
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t mt-2">
                <span className="font-medium">Calculated COGS:</span>
                <span className={cn(
                  "text-lg font-bold",
                  calculatedCOGS < 0 ? "text-destructive" : "text-primary"
                )}>
                  {formatCurrency(calculatedCOGS)}
                </span>
              </div>
              {calculatedCOGS < 0 && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  COGS cannot be negative. Check your values.
                </p>
              )}
            </div>
          )}

          {/* COGS Account (DEBIT) */}
          <div className="space-y-2">
            <Label>COGS Account (Debit) *</Label>
            {cogsAccounts.length === 0 ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No COGS accounts found. Create accounts in the 5000-5999 range first.
                </AlertDescription>
              </Alert>
            ) : (
              <Select value={cogsAccountId} onValueChange={setCogsAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select COGS account..." />
                </SelectTrigger>
                <SelectContent>
                  {cogsAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      <span className="font-mono text-xs mr-2">{acc.account_code}</span>
                      {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Inventory Account (CREDIT) */}
          <div className="space-y-2">
            <Label>Inventory Account (Credit) *</Label>
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

          {/* Preview */}
          {calculatedCOGS > 0 && cogsAccountId && inventoryAccountId && (
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="text-sm font-medium mb-2">Entry Preview:</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>DR {cogsAccounts.find(a => a.id === cogsAccountId)?.account_name}</span>
                  <span className="font-mono">{formatCurrency(calculatedCOGS)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span className="pl-4">CR {inventoryAccounts.find(a => a.id === inventoryAccountId)?.account_name}</span>
                  <span className="font-mono">{formatCurrency(calculatedCOGS)}</span>
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
            disabled={isCreating || !isValid || calculatedCOGS <= 0}
            className="gap-1"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Record COGS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
