import { useMemo, useState } from "react";
import { AlertTriangle, Info, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { parseProjectWorkbook, toAmount, type ParsedWorkbook } from "@/lib/projectSheetImport";

type ProjectsApi = ReturnType<typeof useProjects>;

interface BudgetRow {
  category: string;
  amount: number;
  rowCount: number;
}

const CATEGORY_ALIASES = ["category", "head", "budget head", "cost head", "type", "group"];
const AMOUNT_ALIASES = ["budget", "budget amount", "amount", "total", "value", "spend", "cost"];

export interface ImportIssue {
  level: "error" | "warning";
  title: string;
  detail: string;
  rows?: number[];
}

const ROW_OFFSET = 2; // header row + 1-based sheet rows

const listRows = (rows: number[]) =>
  rows.length > 6 ? `${rows.slice(0, 6).join(", ")} and ${rows.length - 6} more` : rows.join(", ");

/** Blocking + advisory checks for a budget sheet mapping. */
export function validateBudgetImport(input: {
  headers: string[];
  rows: Record<string, unknown>[];
  categoryCol: string;
  amountCol: string;
}): ImportIssue[] {
  const { headers, rows, categoryCol, amountCol } = input;
  const issues: ImportIssue[] = [];

  if (!categoryCol) {
    issues.push({
      level: "error",
      title: "Category column not selected",
      detail:
        headers.length > 0
          ? `Pick which column holds the budget head. Available columns: ${headers.join(", ")}.`
          : "This sheet has no readable header row.",
    });
  }
  if (!amountCol) {
    issues.push({
      level: "error",
      title: "Amount column not selected",
      detail:
        headers.length > 0
          ? `Pick which column holds the budget value. Available columns: ${headers.join(", ")}.`
          : "This sheet has no readable header row.",
    });
  }
  if (categoryCol && amountCol && categoryCol === amountCol) {
    issues.push({
      level: "error",
      title: "Category and amount use the same column",
      detail: "Choose two different columns so names and values can be read separately.",
    });
  }
  if (!categoryCol || !amountCol || categoryCol === amountCol) return issues;

  const blankCategory: number[] = [];
  const blankAmount: number[] = [];
  const badAmount: number[] = [];
  const negativeAmount: number[] = [];
  let usable = 0;

  rows.forEach((r, i) => {
    const sheetRow = i + ROW_OFFSET;
    const rawCategory = String(r[categoryCol] ?? "").trim();
    const rawAmount = r[amountCol];
    const amountText = String(rawAmount ?? "").trim();
    const amount = toAmount(rawAmount);
    const emptyRow = !rawCategory && !amountText;
    if (emptyRow) return;

    if (!rawCategory) blankCategory.push(sheetRow);
    if (!amountText) blankAmount.push(sheetRow);
    else if (amount === 0 && !/^[-(]?0([.,]0+)?\)?$/.test(amountText)) badAmount.push(sheetRow);
    else if (amount < 0) negativeAmount.push(sheetRow);

    if (rawCategory && amountText && amount !== 0) usable += 1;
  });

  if (blankCategory.length)
    issues.push({
      level: "warning",
      title: `${blankCategory.length} row${blankCategory.length === 1 ? "" : "s"} have no category`,
      detail: `These rows cannot be mapped to a budget head and will be skipped. Rows: ${listRows(blankCategory)}.`,
      rows: blankCategory,
    });
  if (blankAmount.length)
    issues.push({
      level: "warning",
      title: `${blankAmount.length} row${blankAmount.length === 1 ? "" : "s"} have a blank amount`,
      detail: `Blank amounts are skipped. Fill them in the sheet or ignore. Rows: ${listRows(blankAmount)}.`,
      rows: blankAmount,
    });
  if (badAmount.length)
    issues.push({
      level: "warning",
      title: `${badAmount.length} amount${badAmount.length === 1 ? "" : "s"} could not be read as a number`,
      detail: `Remove text, formulas or stray symbols from these cells. Rows: ${listRows(badAmount)}.`,
      rows: badAmount,
    });
  if (negativeAmount.length)
    issues.push({
      level: "warning",
      title: `${negativeAmount.length} negative amount${negativeAmount.length === 1 ? "" : "s"}`,
      detail: `Negative budgets are imported as-is. Rows: ${listRows(negativeAmount)}.`,
      rows: negativeAmount,
    });
  if (usable === 0)
    issues.push({
      level: "error",
      title: "No importable rows",
      detail:
        "Every row is missing a category or a valid amount with the current column mapping. Check the selected columns and the sheet.",
    });

  return issues;
}

function guess(headers: string[], aliases: string[]) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const exact = lower.findIndex((h) => aliases.includes(h));
  if (exact >= 0) return headers[exact];
  const fuzzy = lower.findIndex((h) => aliases.some((a) => h.includes(a)));
  return fuzzy >= 0 ? headers[fuzzy] : "";
}

/** Aggregates sheet rows into one budget figure per category. */
export function aggregateBudgetRows(
  rows: Record<string, unknown>[],
  categoryCol: string,
  amountCol: string,
): BudgetRow[] {
  const map = new Map<string, BudgetRow>();
  for (const r of rows) {
    const category = String(r[categoryCol] ?? "").trim();
    const amount = toAmount(r[amountCol]);
    if (!category || amount === 0) continue;
    const key = category.toLowerCase();
    const found = map.get(key);
    if (found) {
      found.amount += amount;
      found.rowCount += 1;
    } else {
      map.set(key, { category, amount, rowCount: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function ProjectBudgetImportDialog({
  api,
  open,
  onOpenChange,
}: {
  api: ProjectsApi;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { format: money } = useCurrency();
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [sheet, setSheet] = useState("");
  const [categoryCol, setCategoryCol] = useState("");
  const [amountCol, setAmountCol] = useState("");
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [saving, setSaving] = useState(false);

  const rawSheet = workbook && sheet ? workbook.sheets[sheet] : undefined;
  const headers = rawSheet?.headers ?? [];

  const rows = useMemo(
    () =>
      rawSheet && categoryCol && amountCol
        ? aggregateBudgetRows(rawSheet.rows, categoryCol, amountCol)
        : [],
    [rawSheet, categoryCol, amountCol],
  );
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const issues = useMemo(
    () =>
      rawSheet
        ? validateBudgetImport({
            headers,
            rows: rawSheet.rows,
            categoryCol,
            amountCol,
          })
        : [],
    [rawSheet, headers, categoryCol, amountCol],
  );
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const blocked = errors.length > 0 || rows.length === 0;

  const existingFor = (category: string) =>
    api.categoryBreakdown.find((c) => c.category.toLowerCase() === category.toLowerCase());

  const selectSheet = (name: string, wb: ParsedWorkbook) => {
    setSheet(name);
    const h = wb.sheets[name]?.headers ?? [];
    setCategoryCol(guess(h, CATEGORY_ALIASES));
    setAmountCol(guess(h, AMOUNT_ALIASES));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await parseProjectWorkbook(file);
      if (parsed.sheetNames.length === 0) {
        toast.error("No data rows were found in this file");
        return;
      }
      setWorkbook(parsed);
      selectSheet(parsed.sheetNames[0], parsed);
    } catch {
      toast.error("Could not read that file. Use .xlsx, .xls or .csv");
    }
  };

  const reset = () => {
    setWorkbook(null);
    setSheet("");
    setCategoryCol("");
    setAmountCol("");
  };

  const handleImport = async () => {
    if (errors.length > 0) {
      toast.error(errors[0].title, { description: errors[0].detail });
      return;
    }
    if (rows.length === 0) {
      toast.error("Nothing to import", {
        description: "No row has both a category and a valid amount.",
      });
      return;
    }
    setSaving(true);
    try {
      for (const r of rows) {
        const existing = existingFor(r.category);
        const next = mode === "add" ? (existing?.budget ?? 0) + r.amount : r.amount;
        await api.saveBudgetLine.mutateAsync({
          id: existing?.lineId ?? undefined,
          category: existing?.category ?? r.category,
          budget_amount: next,
        });
      }
      toast.success(`${rows.length} budget line${rows.length === 1 ? "" : "s"} updated`);
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import budget from Excel</DialogTitle>
          <DialogDescription>
            Upload a sheet with a category column and an amount column. Rows are grouped per category
            and written to the project budget — nothing is posted to the ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Excel / CSV file</Label>
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFile(e.target.files?.[0])} />
          </div>

          {workbook && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Sheet</Label>
                <Select value={sheet} onValueChange={(v) => selectSheet(v, workbook)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {workbook.sheetNames.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n} ({workbook.sheets[n]?.rows.length ?? 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Category column</Label>
                <Select value={categoryCol} onValueChange={setCategoryCol}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount column</Label>
                <Select value={amountCol} onValueChange={setAmountCol}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {issues.length > 0 && (
            <div className="space-y-2">
              {errors.map((issue, i) => (
                <Alert key={`e${i}`} variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>{issue.title}</AlertTitle>
                  <AlertDescription>{issue.detail}</AlertDescription>
                </Alert>
              ))}
              {warnings.map((issue, i) => (
                <Alert key={`w${i}`}>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{issue.title}</AlertTitle>
                  <AlertDescription>{issue.detail}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          {rawSheet && errors.length === 0 && warnings.length === 0 && rows.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Sheet looks clean</AlertTitle>
              <AlertDescription>
                All {rawSheet.rows.length} rows have a category and a valid amount.
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={mode} onValueChange={(v) => setMode(v as "replace" | "add")}>
                  <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">Replace existing budget values</SelectItem>
                    <SelectItem value="add">Add on top of existing budget</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="secondary">
                  {rows.length} categories · {money(total)}
                </Badge>
              </div>

              <ScrollArea className="max-h-[300px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead className="text-right">Current budget</TableHead>
                      <TableHead className="text-right">New budget</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const existing = existingFor(r.category);
                      const next = mode === "add" ? (existing?.budget ?? 0) + r.amount : r.amount;
                      return (
                        <TableRow key={r.category}>
                          <TableCell className="font-medium">
                            {r.category}
                            {!existing && (
                              <Badge variant="outline" className="ml-2 text-[10px]">new</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{r.rowCount}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {money(existing?.budget ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-medium">{money(next)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={saving || blocked}>
            <Upload className="mr-2 h-4 w-4" />
            {saving ? "Importing…" : `Import ${rows.length || ""} categories`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
