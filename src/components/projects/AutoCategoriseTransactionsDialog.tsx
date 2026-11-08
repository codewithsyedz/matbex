import { useEffect, useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useCurrency } from "@/hooks/useCurrency";
import type { useProjects } from "@/hooks/useProjects";
import { suggestCategories } from "@/lib/projectCategoryMatching";

type ProjectsApi = ReturnType<typeof useProjects>;

export function AutoCategoriseTransactionsDialog({
  api,
  open,
  onOpenChange,
}: {
  api: ProjectsApi;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { format: money } = useCurrency();
  const [includeCategorised, setIncludeCategorised] = useState(false);
  const [minConfidence, setMinConfidence] = useState("0.3");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const categories = useMemo(
    () => api.budgetLines.map((l) => l.category).filter(Boolean),
    [api.budgetLines],
  );

  const suggestions = useMemo(
    () =>
      suggestCategories({
        transactions: api.transactions,
        categories,
        uncategorisedOnly: !includeCategorised,
        minConfidence: Number(minConfidence),
      }),
    [api.transactions, categories, includeCategorised, minConfidence],
  );

  useEffect(() => {
    if (!open) return;
    setSelected(Object.fromEntries(suggestions.map((s) => [s.transactionId, true])));
    setOverrides({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, includeCategorised, minConfidence]);

  const txnById = useMemo(
    () => new Map(api.transactions.map((t) => [t.id, t])),
    [api.transactions],
  );

  const chosenCount = suggestions.filter((s) => selected[s.transactionId]).length;

  const apply = async () => {
    const assignments = suggestions
      .filter((s) => selected[s.transactionId])
      .map((s) => ({
        id: s.transactionId,
        category: overrides[s.transactionId] ?? s.category,
      }));
    if (assignments.length === 0) {
      toast.error("Nothing selected");
      return;
    }
    setSaving(true);
    try {
      await api.bulkAssignCategories.mutateAsync(assignments);
      toast.success(`${assignments.length} transactions categorised`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not apply categories");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Auto-match transactions to budget categories</DialogTitle>
          <DialogDescription>
            Suggestions come from vendors already booked to a category on this project and from
            keywords in the vendor name or description. Review before applying — nothing is posted
            to the ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="include-categorised"
              checked={includeCategorised}
              onCheckedChange={(v) => setIncludeCategorised(!!v)}
            />
            <Label htmlFor="include-categorised" className="text-sm font-normal">
              Also re-match already categorised rows
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm font-normal">Minimum confidence</Label>
            <Select value={minConfidence} onValueChange={setMinConfidence}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.3">Low (30%)</SelectItem>
                <SelectItem value="0.5">Medium (50%)</SelectItem>
                <SelectItem value="0.7">High (70%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Badge variant="secondary">{chosenCount} selected</Badge>
        </div>

        <ScrollArea className="max-h-[380px] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]" />
                <TableHead>Vendor / description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[210px]">Category</TableHead>
                <TableHead className="w-[120px]">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((s) => {
                const t = txnById.get(s.transactionId);
                if (!t) return null;
                return (
                  <TableRow key={s.transactionId}>
                    <TableCell>
                      <Checkbox
                        checked={!!selected[s.transactionId]}
                        onCheckedChange={(v) =>
                          setSelected((prev) => ({ ...prev, [s.transactionId]: !!v }))
                        }
                        aria-label="Apply this suggestion"
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate font-medium">{t.vendor_name ?? "—"}</div>
                      <div className="truncate text-xs text-muted-foreground" title={s.reason}>
                        {t.description ?? t.notes ?? ""} · {s.reason}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{money(Number(t.amount))}</TableCell>
                    <TableCell>
                      <Select
                        value={overrides[s.transactionId] ?? s.category}
                        onValueChange={(v) =>
                          setOverrides((prev) => ({ ...prev, [s.transactionId]: v }))
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.confidence >= 0.7 ? "default" : "secondary"}>
                        {Math.round(s.confidence * 100)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {suggestions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    {categories.length === 0
                      ? "Import or create budget categories first."
                      : "No confident matches found. Lower the confidence threshold or rename categories to match vendor wording."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={saving || chosenCount === 0}>
            <Wand2 className="mr-2 h-4 w-4" />
            {saving ? "Applying…" : `Apply ${chosenCount || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}