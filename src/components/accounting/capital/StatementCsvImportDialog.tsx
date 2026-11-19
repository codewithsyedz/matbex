import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

import { parseCsv, downloadCsv } from "@/lib/migration/parsers";
import type { CapitalStatementLine, StatementLineInput } from "@/hooks/useCapitalStatementMatch";
import type { CapitalAccountSummary } from "@/hooks/useOwnerCapital";

const NONE = "__none__";

type DateFormat = "auto" | "dmy" | "mdy";

interface Mapping {
  date: string;
  description: string;
  reference: string;
  amount: string;
  moneyIn: string;
  moneyOut: string;
}

const emptyMapping: Mapping = {
  date: "",
  description: "",
  reference: "",
  amount: "",
  moneyIn: "",
  moneyOut: "",
};

const HEADER_HINTS: Record<keyof Mapping, string[]> = {
  date: ["date", "value date", "transaction date", "posting date", "txn date"],
  description: ["description", "narrative", "details", "particulars", "remarks", "memo"],
  reference: ["reference", "ref", "cheque", "transaction id", "voucher"],
  amount: ["amount", "value", "transaction amount", "signed amount"],
  moneyIn: ["credit", "money in", "deposit", "paid in", "cr"],
  moneyOut: ["debit", "money out", "withdrawal", "paid out", "dr"],
};

function guessMapping(headers: string[]): Mapping {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const pick = (hints: string[]) => {
    for (const hint of hints) {
      const exact = lower.findIndex((h) => h === hint);
      if (exact >= 0) return headers[exact];
    }
    for (const hint of hints) {
      const partial = lower.findIndex((h) => h.includes(hint));
      if (partial >= 0) return headers[partial];
    }
    return "";
  };
  return {
    date: pick(HEADER_HINTS.date),
    description: pick(HEADER_HINTS.description),
    reference: pick(HEADER_HINTS.reference),
    amount: pick(HEADER_HINTS.amount),
    moneyIn: pick(HEADER_HINTS.moneyIn),
    moneyOut: pick(HEADER_HINTS.moneyOut),
  };
}

export function normalizeDate(raw: string, fmt: DateFormat): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const [, a, b] = m;
    let y = m[3];
    if (y.length === 2) y = `20${y}`;
    let day = a;
    let month = b;
    if (fmt === "mdy" || (fmt === "auto" && Number(a) > 12 === false && Number(b) > 12)) {
      day = b;
      month = a;
    }
    if (Number(a) > 12) {
      day = a;
      month = b;
    }
    const dd = day.padStart(2, "0");
    const mm = month.padStart(2, "0");
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
    return `${y}-${mm}-${dd}`;
  }
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export function normalizeAmount(raw: string): number | null {
  let v = (raw ?? "").trim();
  if (!v) return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (/(^|\s)(dr|debit)$/i.test(v)) negative = true;
  v = v.replace(/[^0-9.,-]/g, "");
  // Treat the last separator as the decimal point when both are present.
  if (v.includes(",") && v.includes(".")) {
    v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (v.includes(",")) {
    v = /,\d{1,2}$/.test(v) ? v.replace(",", ".") : v.replace(/,/g, "");
  }
  const num = Number(v);
  if (!Number.isFinite(num) || num === 0) return null;
  return negative ? -Math.abs(num) : num;
}

export interface PreviewRow {
  ok: boolean;
  error?: string;
  duplicate: boolean;
  statementDate: string;
  description: string;
  reference: string;
  amount: number;
  direction: "credit" | "debit";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: CapitalAccountSummary[];
  existingLines: CapitalStatementLine[];
  defaultAccountId?: string | null;
  isSaving?: boolean;
  onImport: (rows: StatementLineInput[]) => Promise<unknown>;
}

const TEMPLATE_CSV =
  "date,description,amount,reference\n" +
  "2026-07-01,Capital transfer from partner,50000,TRF9931\n" +
  "2026-07-08,Owner drawing,-12000,TRF9987\n";

export function StatementCsvImportDialog({
  open,
  onOpenChange,
  accounts,
  existingLines,
  defaultAccountId,
  isSaving,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [dateFormat, setDateFormat] = useState<DateFormat>("auto");
  const [invertSign, setInvertSign] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const reset = () => {
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping(emptyMapping);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("CSV files must be smaller than 5 MB");
      return;
    }
    const text = await file.text();
    const grid = parseCsv(text);
    if (grid.length < 2) {
      toast.error("That file has no data rows");
      return;
    }
    const head = grid[0].map((h) => h.trim());
    setHeaders(head);
    setRows(grid.slice(1));
    setMapping(guessMapping(head));
    setFileName(file.name);
  };

  const colIndex = (header: string) => headers.indexOf(header);

  const duplicateKeys = useMemo(() => {
    const set = new Set<string>();
    for (const l of existingLines) {
      if (accountId && l.capital_account_id !== accountId) continue;
      set.add(`${l.statement_date}|${Number(l.amount).toFixed(2)}|${l.direction}`);
    }
    return set;
  }, [existingLines, accountId]);

  const preview = useMemo<PreviewRow[]>(() => {
    if (!headers.length) return [];
    const di = colIndex(mapping.date);
    const desci = colIndex(mapping.description);
    const refi = colIndex(mapping.reference);
    const ai = colIndex(mapping.amount);
    const ini = colIndex(mapping.moneyIn);
    const outi = colIndex(mapping.moneyOut);

    const seen = new Set<string>();
    return rows.map((r) => {
      const statementDate = normalizeDate(di >= 0 ? r[di] ?? "" : "", dateFormat);
      let signed: number | null = null;
      if (ai >= 0) signed = normalizeAmount(r[ai] ?? "");
      if (signed === null && (ini >= 0 || outi >= 0)) {
        const inAmt = ini >= 0 ? normalizeAmount(r[ini] ?? "") : null;
        const outAmt = outi >= 0 ? normalizeAmount(r[outi] ?? "") : null;
        if (inAmt) signed = Math.abs(inAmt);
        else if (outAmt) signed = -Math.abs(outAmt);
      }
      if (signed !== null && invertSign) signed = -signed;

      const base = {
        description: (desci >= 0 ? r[desci] ?? "" : "").trim(),
        reference: (refi >= 0 ? r[refi] ?? "" : "").trim(),
      };

      if (!statementDate) {
        return { ok: false, error: "Unreadable date", duplicate: false, statementDate: (di >= 0 ? r[di] ?? "" : ""), amount: 0, direction: "credit" as const, ...base };
      }
      if (signed === null) {
        return { ok: false, error: "Unreadable amount", duplicate: false, statementDate, amount: 0, direction: "credit" as const, ...base };
      }

      const direction: "credit" | "debit" = signed >= 0 ? "credit" : "debit";
      const amount = Math.abs(signed);
      const key = `${statementDate}|${amount.toFixed(2)}|${direction}`;
      const duplicate = duplicateKeys.has(key) || seen.has(key);
      seen.add(key);

      return { ok: true, duplicate, statementDate, amount, direction, ...base };
    });
  }, [headers, rows, mapping, dateFormat, invertSign, duplicateKeys]);

  const validRows = preview.filter((p) => p.ok);
  const invalidCount = preview.length - validRows.length;
  const duplicateCount = validRows.filter((p) => p.duplicate).length;
  const importable = skipDuplicates ? validRows.filter((p) => !p.duplicate) : validRows;

  const submit = async () => {
    if (!accountId) {
      toast.error("Pick the capital account this statement belongs to");
      return;
    }
    if (!importable.length) {
      toast.error("There are no rows to import");
      return;
    }
    const branchId = accounts.find((a) => a.id === accountId)?.branch_id ?? null;
    try {
      await onImport(
        importable.map((p) => ({
          capitalAccountId: accountId,
          branchId,
          statementDate: p.statementDate,
          description: p.description || null,
          reference: p.reference || null,
          amount: p.amount,
          direction: p.direction,
        })),
      );
      toast.success(
        `Imported ${importable.length} line(s)` +
          (skipDuplicates && duplicateCount ? ` · skipped ${duplicateCount} duplicate(s)` : ""),
      );
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not import the statement");
    }
  };

  const columnSelect = (key: keyof Mapping, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select
        value={mapping[key] || NONE}
        onValueChange={(v) => setMapping((m) => ({ ...m, [key]: v === NONE ? "" : v }))}
      >
        <SelectTrigger>
          <SelectValue placeholder="Not mapped" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not mapped</SelectItem>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import bank statement (CSV)</DialogTitle>
          <DialogDescription>
            Upload the bank's CSV export, map the columns, and review the parsed rows before they
            are added for matching.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Capital account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.partner_name} — {a.bank_name} ..{a.account_last4}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Statement file</Label>
                <div className="flex gap-2">
                  <Input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => downloadCsv("bank-statement-template.csv", TEMPLATE_CSV)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
                {fileName && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <FileSpreadsheet className="h-3 w-3" />
                    {fileName} · {rows.length} row(s)
                  </p>
                )}
              </div>
            </div>

            {!!headers.length && (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  {columnSelect("date", "Date column")}
                  {columnSelect("description", "Description column")}
                  {columnSelect("reference", "Reference column")}
                  {columnSelect("amount", "Signed amount", "Negative = money out")}
                  {columnSelect("moneyIn", "Money in (credit)", "Used when no signed amount")}
                  {columnSelect("moneyOut", "Money out (debit)", "Used when no signed amount")}
                </div>

                <div className="flex flex-wrap items-center gap-6">
                  <div className="space-y-1">
                    <Label className="text-xs">Date format</Label>
                    <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as DateFormat)}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto-detect</SelectItem>
                        <SelectItem value="dmy">Day/Month/Year</SelectItem>
                        <SelectItem value="mdy">Month/Day/Year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={invertSign} onCheckedChange={setInvertSign} />
                    Invert signs
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={skipDuplicates} onCheckedChange={setSkipDuplicates} />
                    Skip duplicates
                  </label>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{validRows.length} valid</Badge>
                  {invalidCount > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {invalidCount} unreadable
                    </Badge>
                  )}
                  {duplicateCount > 0 && (
                    <Badge variant="outline">{duplicateCount} possible duplicate(s)</Badge>
                  )}
                  <Badge>{importable.length} will import</Badge>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.slice(0, 25).map((p, i) => (
                        <TableRow key={i} className={!p.ok ? "opacity-60" : undefined}>
                          <TableCell className="whitespace-nowrap">{p.statementDate || "—"}</TableCell>
                          <TableCell className="max-w-[220px] truncate">
                            {p.description || "—"}
                          </TableCell>
                          <TableCell className="text-xs">{p.reference || "—"}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {p.ok ? (
                              <span
                                className={
                                  p.direction === "credit" ? "text-emerald-600" : "text-destructive"
                                }
                              >
                                {p.direction === "credit" ? "+" : "−"}
                                {p.amount.toFixed(2)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {!p.ok ? (
                              <span className="text-destructive">{p.error}</span>
                            ) : p.duplicate ? (
                              <span className="text-muted-foreground">
                                {skipDuplicates ? "Duplicate — skipped" : "Duplicate"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Ready</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {preview.length > 25 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                            Showing first 25 of {preview.length} rows
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isSaving || !importable.length || !accountId}>
            <Upload className="h-4 w-4 mr-2" />
            Import {importable.length || ""} row(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
