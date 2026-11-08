import { useState } from "react";
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
import { Plus, Trash2, FileText, Loader2, AlertCircle, Check } from "lucide-react";
import { useJournalEntries, JournalEntryLine } from "@/hooks/useJournalEntries";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { useImpersonationGuard } from "@/hooks/useImpersonationGuard";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

interface JournalLineInput extends JournalEntryLine {
  id: string;
}

const ENTRY_TYPES = ["adjustment", "correction", "reversal", "opening_balance"] as const;

export function JournalEntryForm() {
  const { createJournalEntry, isCreating } = useJournalEntries();
  const { accounts } = useChartOfAccounts();
  const { format: formatCurrency } = useCurrency();
  const guardWrite = useImpersonationGuard();
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [entryType, setEntryType] = useState<"adjustment" | "correction" | "reversal" | "opening_balance">("adjustment");
  const [batchDate, setBatchDate] = useState(new Date().toISOString().split("T")[0]);
  const [lines, setLines] = useState<JournalLineInput[]>([
    { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
    { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 },
  ]);

  const activeAccounts = accounts.filter((a) => a.is_active);

  const addLine = () => {
    setLines([...lines, { id: crypto.randomUUID(), account_id: "", debit: 0, credit: 0 }]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 2) return; // Minimum 2 lines
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
        
        return { ...l, [field]: value };
      })
    );
  };

  const totalDebits = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;
  const hasValidLines = lines.every((l) => l.account_id && (l.debit || l.credit));

  const handleSubmit = () => {
    if (!guardWrite("post a journal entry")) return;
    if (!description.trim() || !isBalanced || !hasValidLines) return;

    createJournalEntry.mutate(
      {
        description,
        reference_number: referenceNumber || undefined,
        entry_type: entryType,
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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <FileText className="h-4 w-4" />
          {t("finance.journalForm.new")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("finance.journalForm.title")}
          </DialogTitle>
          <DialogDescription>
            {t("finance.journalForm.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
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
              <Label htmlFor="entry-type">{t("finance.journalForm.entryType")}</Label>
              <Select value={entryType} onValueChange={(v: any) => setEntryType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTRY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`finance.journalForm.types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
                  {lines.map((line, idx) => (
                    <tr key={line.id}>
                      <td className="p-2">
                        <Select
                          value={line.account_id}
                          onValueChange={(v) => updateLine(line.id, "account_id", v)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder={t("finance.journalForm.selectAccount")} />
                          </SelectTrigger>
                          <SelectContent>
                            {activeAccounts.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id}>
                                <span className="font-mono text-xs me-2">{acc.account_code}</span>
                                {acc.account_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                  ))}
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

            {/* Balance Status */}
            <div className="flex items-center gap-2">
              {isBalanced ? (
                <Badge variant="secondary" className="gap-1 text-green-600">
                  <Check className="h-3 w-3" />
                  {t("finance.journalForm.balanced")}
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {t("finance.journalForm.unbalanced", { amount: formatCurrency(Math.abs(totalDebits - totalCredits)) })}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            {t("finance.journalForm.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isCreating || !isBalanced || !description.trim() || !hasValidLines}
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
