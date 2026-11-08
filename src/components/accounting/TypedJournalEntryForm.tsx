import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  AlertTitle,
} from "@/components/ui/alert";
import { 
  Plus, 
  Trash2, 
  FileText, 
  Loader2, 
  AlertCircle, 
  Check, 
  ShoppingCart,
  TrendingDown,
  DollarSign,
  Receipt,
  Settings,
  HelpCircle,
  Info,
} from "lucide-react";
import { useJournalEntries, JournalEntryLine } from "@/hooks/useJournalEntries";
import { useChartOfAccounts, ChartOfAccount } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  JournalEntryType,
  JOURNAL_ENTRY_TYPES,
  filterAccountsForEntry,
  validateJournalEntry,
  getEntryTypeErrorMessage,
  JournalLineValidation,
} from "@/lib/journalEntryValidation";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface JournalLineInput extends JournalEntryLine {
  id: string;
  account_code?: string;
  account_type?: string;
}

// Icon mapping for entry types
const ENTRY_TYPE_ICONS: Record<JournalEntryType, React.ElementType> = {
  purchase: ShoppingCart,
  consumption: TrendingDown,
  sale: DollarSign,
  expense: Receipt,
  adjustment: Settings,
  correction: Settings,
  reversal: Settings,
  opening_balance: Settings,
};

export function TypedJournalEntryForm() {
  const { createJournalEntry, isCreating } = useJournalEntries();
  const { accounts } = useChartOfAccounts();
  const { format: formatCurrency } = useCurrency();
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [entryType, setEntryType] = useState<JournalEntryType>("adjustment");
  const [batchDate, setBatchDate] = useState(new Date().toISOString().split("T")[0]);
  const [lines, setLines] = useState<JournalLineInput[]>([
    { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
    { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
  ]);

  const activeAccounts = accounts.filter((a) => a.is_active);
  const entryConfig = JOURNAL_ENTRY_TYPES[entryType];
  const EntryIcon = ENTRY_TYPE_ICONS[entryType];

  // Filter accounts based on entry type for debit/credit sides
  const debitAccounts = useMemo(() => 
    filterAccountsForEntry(activeAccounts, entryType, 'debit'),
    [activeAccounts, entryType]
  );
  
  const creditAccounts = useMemo(() => 
    filterAccountsForEntry(activeAccounts, entryType, 'credit'),
    [activeAccounts, entryType]
  );

  const addLine = () => {
    setLines([...lines, { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 }]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, field: keyof JournalLineInput, value: string | number) => {
    setLines(
      lines.map((l) => {
        if (l.id !== id) return l;
        
        // If setting debit, clear credit and vice versa
        if (field === "debit" && Number(value) > 0) {
          return { ...l, debit: Number(value), credit: 0 };
        }
        if (field === "credit" && Number(value) > 0) {
          return { ...l, credit: Number(value), debit: 0 };
        }
        
        // When selecting account, store account info for validation
        if (field === "account_id") {
          const account = activeAccounts.find(a => a.id === value);
          return { 
            ...l, 
            account_id: value as string,
            account_code: account?.account_code,
            account_type: account?.account_type,
          };
        }
        
        return { ...l, [field]: value };
      })
    );
  };

  const totalDebits = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;
  const hasValidLines = lines.every((l) => l.account_id && (l.debit || l.credit));

  // Validate entry with entry-type-specific rules
  const validationResult = useMemo(() => {
    const linesToValidate: JournalLineValidation[] = lines
      .filter(l => l.account_id && l.account_code && l.account_type)
      .map(l => ({
        account_id: l.account_id,
        account_code: l.account_code!,
        account_type: l.account_type as any,
        debit: l.debit,
        credit: l.credit,
      }));
    
    if (linesToValidate.length === 0) {
      return { valid: false, errors: [] };
    }
    
    return validateJournalEntry(entryType, linesToValidate);
  }, [lines, entryType]);

  // Check for common mistakes
  const getMistakeWarning = (line: JournalLineInput): string | null => {
    if (!line.account_code) return null;
    const side = (line.debit && line.debit > 0) ? 'debit' : 'credit';
    return getEntryTypeErrorMessage(entryType, line.account_code, side);
  };

  const handleSubmit = () => {
    if (!description.trim() || !isBalanced || !hasValidLines || !validationResult.valid) return;

    createJournalEntry.mutate(
      {
        description,
        reference_number: referenceNumber || undefined,
        entry_type: entryType as any,
        batch_date: batchDate,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          debit: l.debit || undefined,
          credit: l.credit || undefined,
        })),
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
    setEntryType("adjustment");
    setBatchDate(new Date().toISOString().split("T")[0]);
    setLines([
      { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
      { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
    ]);
  };

  // Get available accounts for a line based on whether it has debit or credit
  const getAccountsForLine = (line: JournalLineInput): ChartOfAccount[] => {
    if (line.debit && line.debit > 0) {
      return debitAccounts;
    }
    if (line.credit && line.credit > 0) {
      return creditAccounts;
    }
    // If no amount set, show all valid accounts for this entry type
    return [...new Set([...debitAccounts, ...creditAccounts])];
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <FileText className="h-4 w-4" />
          {t("finance.journalForm.new")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <EntryIcon className="h-5 w-5" />
            {t("finance.journalForm.title")}
          </DialogTitle>
          <DialogDescription>
            Select entry type for account validation. Debits must equal credits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Entry Type Selector */}
          <div className="space-y-2">
            <Label>{t("finance.journalForm.entryType")}</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(['purchase', 'consumption', 'sale', 'expense'] as JournalEntryType[]).map((type) => {
                const config = JOURNAL_ENTRY_TYPES[type];
                const Icon = ENTRY_TYPE_ICONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setEntryType(type);
                      // Reset lines when changing type
                      setLines([
                        { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
                        { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
                      ]);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-sm",
                      entryType === type
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="font-medium">{config.label}</span>
                  </button>
                );
              })}
            </div>
            <Select value={entryType} onValueChange={(v: JournalEntryType) => setEntryType(v)}>
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(JOURNAL_ENTRY_TYPES).map((config) => (
                  <SelectItem key={config.value} value={config.value}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{config.label}</span>
                      <span className="text-muted-foreground text-xs">- {config.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Entry Type Help */}
          <Alert className="bg-muted/50">
            <Info className="h-4 w-4" />
            <AlertTitle className="text-sm font-medium">{entryConfig.label}</AlertTitle>
            <AlertDescription className="text-sm text-muted-foreground">
              {entryConfig.helpText}
            </AlertDescription>
          </Alert>

          {/* Header Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="batch-date">{t("finance.journalForm.date")}</Label>
              <Input
                id="batch-date"
                type="date"
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">{t("finance.journalForm.reference")}</Label>
              <Input
                id="reference"
                placeholder={t("finance.journalForm.referencePlaceholder")}
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("finance.journalForm.descriptionLabel")}</Label>
            <Textarea
              id="description"
              placeholder={t("finance.journalForm.descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Entry Lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t("finance.journalForm.lines")}</Label>
              <Button variant="outline" size="sm" onClick={addLine} className="gap-1">
                <Plus className="h-3 w-3" />
                {t("finance.journalForm.addLine")}
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-start p-2 font-medium">{t("finance.journalForm.account")}</th>
                    <th className="text-end p-2 font-medium w-32">{t("finance.journalForm.debit")}</th>
                    <th className="text-end p-2 font-medium w-32">{t("finance.journalForm.credit")}</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((line, idx) => {
                    const availableAccounts = getAccountsForLine(line);
                    const mistakeWarning = getMistakeWarning(line);
                    
                    return (
                      <tr key={line.id} className={mistakeWarning ? "bg-destructive/5" : ""}>
                        <td className="p-2">
                          <div className="space-y-1">
                            <Select
                              value={line.account_id}
                              onValueChange={(v) => updateLine(line.id, "account_id", v)}
                            >
                              <SelectTrigger className={cn("h-9", mistakeWarning && "border-destructive")}>
                                <SelectValue placeholder={t("finance.journalForm.selectAccount")} />
                              </SelectTrigger>
                              <SelectContent>
                                {availableAccounts.length === 0 ? (
                                  <div className="p-2 text-sm text-muted-foreground text-center">
                                    No accounts available for this entry type.
                                    <br />
                                    Set amount first to filter accounts.
                                  </div>
                                ) : (
                                  availableAccounts.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id}>
                                      <span className="font-mono text-xs me-2">{acc.account_code}</span>
                                      {acc.account_name}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            {mistakeWarning && (
                              <p className="text-xs text-destructive flex items-start gap-1">
                                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                {mistakeWarning}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.debit || ""}
                            onChange={(e) => updateLine(line.id, "debit", e.target.value)}
                            className="text-end h-9"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.credit || ""}
                            onChange={(e) => updateLine(line.id, "credit", e.target.value)}
                            className="text-end h-9"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="p-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeLine(line.id)}
                            disabled={lines.length <= 2}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/30 font-medium">
                  <tr>
                    <td className="p-2 text-end">{t("finance.journalForm.totals")}</td>
                    <td className="p-2 text-end">{formatCurrency(totalDebits)}</td>
                    <td className="p-2 text-end">{formatCurrency(totalCredits)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Validation Status */}
            <div className="flex flex-wrap items-center gap-2">
              {isBalanced ? (
                <Badge variant="secondary" className="gap-1 text-green-600">
                  <Check className="h-3 w-3" />
                  Balanced
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {t("finance.journalForm.unbalanced", { amount: formatCurrency(Math.abs(totalDebits - totalCredits)) })}
                </Badge>
              )}
              
              {!validationResult.valid && validationResult.errors.length > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {validationResult.errors.length} validation error(s)
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                      <ul className="list-disc ps-4 space-y-1">
                        {validationResult.errors.map((err, i) => (
                          <li key={i} className="text-sm">{err}</li>
                        ))}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isCreating || 
              !isBalanced || 
              !description.trim() || 
              !hasValidLines ||
              !validationResult.valid
            }
            className="gap-1"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t("finance.journalForm.post")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
