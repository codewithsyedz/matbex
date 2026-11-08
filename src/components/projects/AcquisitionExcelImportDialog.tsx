import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import {
  autoMap,
  groupByVendor,
  parseProjectWorkbook,
  type ColumnMapping,
  type ParsedWorkbook,
  type VendorGroup,
} from "@/lib/projectSheetImport";
import { SheetColumnMapper } from "./SheetColumnMapper";
import { ImportValidationReport } from "./ImportValidationReport";
import { validateRows } from "@/lib/importValidation";
import { matchAccount } from "@/lib/accountMatch";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { evaluateImportPostingRules } from "@/lib/importPostingRules";
import { ImportPostingRuleReport } from "./ImportPostingRuleReport";
import { useRecordPostingRejection } from "@/hooks/usePostingRejections";

export interface ImportedAllocation {
  label: string;
  amount: number;
  /** Resolved chart_of_accounts id when the sheet's Account column mapped cleanly. */
  account_id?: string | null;
}

export function AcquisitionExcelImportDialog({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApply: (allocations: ImportedAllocation[], total: number) => void;
}) {
  const { format: money } = useCurrency();
  const [fileName, setFileName] = useState("");
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [sheet, setSheet] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mode, setMode] = useState<"vendor" | "line">("vendor");
  const [splitByCostCentre, setSplitByCostCentre] = useState(true);
  const [parsing, setParsing] = useState(false);
  const { accounts } = useChartOfAccounts();

  const sheets = workbook?.sheetNames ?? [];
  const rawSheet = workbook && sheet ? workbook.sheets[sheet] : undefined;
  const headers = rawSheet?.headers ?? [];
  const report = useMemo(
    () =>
      rawSheet && mapping.amount
        ? validateRows(rawSheet.rows, mapping, {
            resolveAccount: (rawText) => {
              const m = matchAccount(rawText, accounts);
              return { matched: !!m.account, reason: m.reason };
            },
          })
        : null,
    [rawSheet, mapping, accounts],
  );
  const rows = report?.validRows ?? [];
  const accountIdOf = (raw: string) => matchAccount(raw, accounts).account?.id ?? null;
  const accountLabelOf = (raw: string) => {
    const a = matchAccount(raw, accounts).account;
    return a ? `${a.account_code} · ${a.account_name}` : null;
  };
  const groups: (VendorGroup & { account_id?: string | null })[] =
    mode === "vendor"
      ? groupByVendor(rows, splitByCostCentre).map((g) => {
          // A vendor group only inherits an account when every row agrees on it.
          const ids = new Set(
            rows
              .filter((r) => g.label.endsWith(r.vendor_name || "Unlabelled"))
              .map((r) => accountIdOf(r.account)),
          );
          return { ...g, account_id: ids.size === 1 ? [...ids][0] : null };
        })
      : rows.map((r) => ({
          label: [
            r.cost_center && splitByCostCentre ? r.cost_center : "",
            r.vendor_name || "Unlabelled",
            r.txn_date,
          ]
            .filter(Boolean)
            .join(" · "),
          amount: r.amount,
          count: 1,
          account_id: accountIdOf(r.account),
        }));
  const total = groups.reduce((s, g) => s + g.amount, 0);

  // Posting guards applied per sheet row before any allocation is created.
  const recordRejection = useRecordPostingRejection();
  const ruleReport = useMemo(
    () =>
      evaluateImportPostingRules(
        rows.map((r, i) => ({
          rowNumber: i + 2,
          accountText: r.account ?? "",
          account: accounts.find((a) => a.id === matchAccount(r.account ?? "", accounts).account?.id) ?? null,
          amount: r.amount,
          vendor: r.vendor_name,
        })),
        // Acquisitions capitalise to CIP, so fixed-asset accounts are allowed here;
        // partner loan / capital accounts never are.
        { viaFixedAssetRegister: true },
      ),
    [rows, accounts],
  );

  const reset = () => {
    setFileName("");
    setWorkbook(null);
    setSheet("");
    setMapping({});
  };

  const selectSheet = (name: string, wb: ParsedWorkbook) => {
    setSheet(name);
    setMapping(autoMap(wb.sheets[name]?.headers ?? []));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await parseProjectWorkbook(file);
      if (parsed.sheetNames.length === 0) {
        toast.error("No data rows were found in this file");
        reset();
        return;
      }
      setFileName(file.name);
      setWorkbook(parsed);
      selectSheet(parsed.sheetNames[0], parsed);
    } catch {
      toast.error("Could not read that file. Use .xlsx, .xls or .csv");
    } finally {
      setParsing(false);
    }
  };

  const handleApply = () => {
    if (groups.length === 0) return toast.error("Nothing to import");
    if (ruleReport.blockedCount > 0) {
      for (const v of ruleReport.violations) {
        recordRejection(v.violation, {
          source: "acquisition_import",
          origin: "client",
          entityType: "project_acquisition_import",
          fields: [
            { field: "account", label: "Account", value: v.accountText || null },
            { field: "sheet_row", label: "Sheet row", value: String(v.rowNumber) },
          ],
          values: { file: fileName || null, sheet: sheet || null },
        });
      }
      return toast.error(
        `${ruleReport.blockedCount} row${ruleReport.blockedCount === 1 ? "" : "s"} break a posting rule — fix the account column first`,
      );
    }
    onApply(
      groups.map((g) => ({ label: g.label, amount: g.amount, account_id: g.account_id ?? null })),
      total,
    );
    toast.success(`${groups.length} allocation lines imported`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import acquisition costs from Excel</DialogTitle>
          <DialogDescription>
            Upload the acquisition workbook (.xlsx, .xls or .csv). Columns recognised: Vendor, Date,
            Paid By, Amount, Notes. Imported rows become purchase price allocation lines — you still
            choose the ledger account for each before posting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Spreadsheet</Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {fileName && (
              <p className="text-xs text-muted-foreground">
                {fileName} · {sheets.length} sheet{sheets.length === 1 ? "" : "s"} with data
              </p>
            )}
          </div>

          {sheets.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Sheet</Label>
                <Select value={sheet} onValueChange={(v) => workbook && selectSheet(v, workbook)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s} ({workbook?.sheets[s]?.rows.length ?? 0} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Grouping</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as "vendor" | "line")}
                  className="flex gap-4 pt-1.5"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="vendor" /> One line per vendor
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="line" /> One line per row
                  </label>
                </RadioGroup>
              </div>
            </div>
          )}

          {headers.length > 0 && (
            <SheetColumnMapper headers={headers} mapping={mapping} onChange={setMapping} />
          )}

          {report && <ImportValidationReport report={report} fileName="acquisition-import-errors.csv" />}
          <ImportPostingRuleReport report={ruleReport} fileName="acquisition-posting-errors.csv" />

          {rows.some((r) => r.cost_center) && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={splitByCostCentre}
                onCheckedChange={(v) => setSplitByCostCentre(v === true)}
              />
              Split allocation lines by cost centre
            </label>
          )}

          {groups.length > 0 && (
            <ScrollArea className="max-h-[300px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Allocation label</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g, i) => (
                    <TableRow key={`${g.label}-${i}`}>
                      <TableCell>{g.label}</TableCell>
                      <TableCell className="text-xs">
                        {g.account_id
                          ? accounts.find((a) => a.id === g.account_id)
                            ? `${accounts.find((a) => a.id === g.account_id)!.account_code} · ${
                                accounts.find((a) => a.id === g.account_id)!.account_name
                              }`
                            : "—"
                          : <span className="text-muted-foreground">Pick on the form</span>}
                      </TableCell>
                      <TableCell className="text-right">{g.count}</TableCell>
                      <TableCell className="text-right">{money(g.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}

          {groups.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {groups.length} lines · total {money(total)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={parsing || groups.length === 0 || ruleReport.blockedCount > 0}
          >
            {parsing
              ? "Reading…"
              : ruleReport.blockedCount > 0
                ? `${ruleReport.blockedCount} row${ruleReport.blockedCount === 1 ? "" : "s"} blocked by posting rules`
                : `Import ${groups.length} lines`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
