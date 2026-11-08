import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { useProjects } from "@/hooks/useProjects";
import { Input } from "@/components/ui/input";
import {
  autoMap,
  parseProjectWorkbook,
  type ColumnMapping,
  type ParsedWorkbook,
} from "@/lib/projectSheetImport";
import { SheetColumnMapper } from "./SheetColumnMapper";
import { ImportValidationReport } from "./ImportValidationReport";
import { validateRows } from "@/lib/importValidation";
import {
  analyseImport,
  defaultAction,
  mergePatch,
  type DuplicateAction,
  type ExistingTxn,
} from "@/lib/importDedupe";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountSelect } from "@/components/accounting/AccountSelect";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { MATCH_LABELS, matchAccount } from "@/lib/accountMatch";
import { useImportFingerprints } from "@/hooks/useImportFingerprints";
import { detectPriorImports, IMPORT_SCOPES } from "@/lib/importFingerprint";
import { evaluateImportPostingRules } from "@/lib/importPostingRules";
import { ImportPostingRuleReport } from "./ImportPostingRuleReport";
import { useRecordPostingRejection } from "@/hooks/usePostingRejections";

type ProjectsApi = ReturnType<typeof useProjects>;

interface ParsedRow {
  vendor_name: string;
  txn_date: string;
  paid_by_name: string;
  amount: number;
  notes: string;
  account?: string;
}

const TEMPLATE = `Vendor,Date,Paid By,Amount,Account,Notes
Asrar,2026-06-10,Fraz,3500,6210 - Repairs & Maintenance,Electrical rough-in
Kitchen Contractor,2026-06-14,Syed Raza,40000,1550 - Construction in Progress,First contract instalment`;

/** Turns pasted CSV text into raw header/row records so it can go through the same validator. */
function parseCsvRaw(text: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { headers, rows };
}

export function ProjectImportDialog({
  api,
  open,
  onOpenChange,
}: {
  api: ProjectsApi;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [sheet, setSheet] = useState("");
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [actions, setActions] = useState<Record<number, DuplicateAction>>({});
  /** Per-row account override, keyed by preview row index. */
  const [accountOverrides, setAccountOverrides] = useState<Record<number, string>>({});
  const { accounts } = useChartOfAccounts();

  const rawSheet = workbook && sheet ? workbook.sheets[sheet] : undefined;
  const pasted = useMemo(() => (rawSheet ? { headers: [], rows: [] } : parseCsvRaw(raw)), [raw, rawSheet]);
  const headers = rawSheet?.headers ?? [];
  const activeRows = rawSheet ? rawSheet.rows : pasted.rows;
  const activeMapping = useMemo(
    () => (rawSheet ? mapping : autoMap(pasted.headers)),
    [rawSheet, mapping, pasted.headers],
  );

  const report = useMemo(
    () =>
      activeRows.length > 0 && activeMapping.amount
        ? validateRows(activeRows, activeMapping, {
            resolveAccount: (rawText) => {
              const m = matchAccount(rawText, accounts);
              return { matched: !!m.account, reason: m.reason };
            },
          })
        : null,
    [activeRows, activeMapping, accounts],
  );
  const rows: ParsedRow[] = report?.validRows ?? [];

  // Resolve each preview row's Account text against the chart once per render.
  const accountMatches = useMemo(
    () => rows.map((r) => matchAccount(r.account ?? "", accounts)),
    [rows, accounts],
  );
  const accountIdFor = (i: number) =>
    accountOverrides[i] ?? accountMatches[i]?.account?.id ?? "";
  const unmappedAccounts = rows.filter((_, i) => !accountIdFor(i)).length;

  // Posting guards (partner loan / fixed asset) applied per row during preview.
  const recordRejection = useRecordPostingRejection();
  const ruleReport = useMemo(
    () =>
      evaluateImportPostingRules(
        rows.map((r, i) => {
          const id = accountOverrides[i] ?? accountMatches[i]?.account?.id ?? "";
          const acc = accounts.find((a) => a.id === id) ?? null;
          return {
            rowNumber: i + 2,
            accountText: r.account ?? "",
            account: acc,
            amount: r.amount,
            vendor: r.vendor_name,
          };
        }),
        { projectId: api.activeProject?.id ?? null },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, accountMatches, accountOverrides, accounts, api.activeProject?.id],
  );
  const ruleBlockedCount = ruleReport.blockedCount;

  const existing: ExistingTxn[] = useMemo(
    () =>
      api.transactions.map((t) => ({
        id: t.id,
        vendor_name: t.vendor_name,
        txn_date: t.txn_date,
        amount: Number(t.amount),
        notes: t.notes ?? t.description,
      })),
    [api.transactions],
  );

  const matches = useMemo(() => analyseImport(rows, existing), [rows, existing]);

  // Durable guard: rows fingerprinted in a previous import can never be posted again.
  const { known: knownFingerprints, recordImported } = useImportFingerprints(
    IMPORT_SCOPES.projectTransactions,
    api.activeProject?.id ?? null,
  );
  const priorHits = useMemo(
    () =>
      detectPriorImports(
        rows.map((r) => ({
          vendor_name: r.vendor_name,
          txn_date: r.txn_date,
          amount: r.amount,
          notes: r.notes,
          extra: [(r as { cost_center?: string }).cost_center ?? "", r.paid_by_name ?? ""],
        })),
        knownFingerprints,
      ),
    [rows, knownFingerprints],
  );
  const blockedCount = priorHits.filter((h) => h.blocked).length;

  const actionFor = (i: number): DuplicateAction =>
    priorHits[i]?.blocked ? "skip" : actions[i] ?? defaultAction(matches[i]);
  const duplicateCount = matches.filter((m) => m.strength).length;
  const importCount = matches.filter((_, i) => actionFor(i) === "import").length;
  const mergeCount = matches.filter((_, i) => actionFor(i) === "merge").length;
  const skipCount = rows.length - importCount - mergeCount;

  const resetFile = () => {
    setWorkbook(null);
    setSheet("");
    setMapping({});
    setActions({});
    setAccountOverrides({});
    setFileName("");
  };

  const selectSheet = (name: string, wb: ParsedWorkbook) => {
    setSheet(name);
    setMapping(autoMap(wb.sheets[name]?.headers ?? []));
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
      setFileName(file.name);
      selectSheet(parsed.sheetNames[0], parsed);
    } catch {
      toast.error("Could not read that file. Use .xlsx, .xls or .csv");
    }
  };

  const matchPartner = (name: string) =>
    api.partners.find((p) => p.partner_name.toLowerCase() === name.trim().toLowerCase()) ?? null;

  const handleImport = async () => {
    if (rows.length === 0) {
      toast.error("Nothing to import");
      return;
    }
    if (ruleBlockedCount > 0) {
      for (const v of ruleReport.violations) {
        recordRejection(v.violation, {
          source: "project_import",
          origin: "client",
          entityType: "project_transaction_import",
          fields: [
            { field: "account", label: "Account", value: v.accountText || null },
            { field: "sheet_row", label: "Sheet row", value: String(v.rowNumber) },
          ],
          values: { file: fileName || "pasted rows", sheet: sheet || null },
        });
      }
      toast.error(
        `${ruleBlockedCount} row${ruleBlockedCount === 1 ? "" : "s"} break a posting rule — fix the account on those rows first`,
      );
      return;
    }
    const toImport = rows.filter((_, i) => actionFor(i) === "import");
    const toMerge = rows
      .map((r, i) => ({ row: r, match: matches[i], action: actionFor(i) }))
      .filter((x) => x.action === "merge" && x.match.existing);
    if (toImport.length === 0 && toMerge.length === 0) {
      toast.error("Every row is set to skip");
      return;
    }
    setSaving(true);
    try {
      for (const { row, match } of toMerge) {
        const patch = mergePatch(row, match.existing!);
        if (Object.keys(patch).length === 0) continue;
        await api.saveTransaction.mutateAsync({ id: match.existing!.id, ...patch });
      }

      const payload = toImport.map((r) => {
        const partner = matchPartner(r.paid_by_name);
        const originalIndex = rows.indexOf(r);
        return {
          vendor_name: r.vendor_name || null,
          txn_date: r.txn_date,
          amount: r.amount,
          description: r.notes || null,
          notes: r.notes || null,
          paid_by: partner ? ("partner" as const) : ("company" as const),
          partner_id: partner?.id ?? null,
          // Mapped chart-of-accounts entry; the review step still gates posting.
          debit_account_id: accountIdFor(originalIndex) || null,
          // Deliberately left unclassified — nothing reaches the ledger until reviewed.
          treatment: null,
          funding_classification: null,
          branch_id: api.activeProject?.branch_id ?? null,
        };
      });
      let imported = 0;
      if (payload.length > 0) {
        const res = await api.bulkImport.mutateAsync(payload);
        imported = res.count;
        // Fingerprint what we just posted so a re-upload of this sheet is blocked.
        await recordImported({
          sourceFile: fileName || "pasted rows",
          sourceSheet: sheet || null,
          targetTable: "project_transactions",
          rows: toImport.map((r) => {
            const originalIndex = rows.indexOf(r);
            return {
              row: {
                vendor_name: r.vendor_name,
                txn_date: r.txn_date,
                amount: r.amount,
                notes: r.notes,
                extra: [(r as { cost_center?: string }).cost_center ?? "", r.paid_by_name ?? ""],
              },
              sourceRowNumber: originalIndex + 2,
            };
          }),
        });
      }
      toast.success(
        `${imported} imported · ${toMerge.length} merged · ${rows.length - imported - toMerge.length} skipped${
          blockedCount ? ` · ${blockedCount} already imported` : ""
        }`,
      );
      setRaw("");
      setActions({});
      resetFile();
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
          <DialogTitle>Import historical transactions</DialogTitle>
          <DialogDescription>
            Paste CSV with Vendor, Date, Paid By, Amount, Account, Notes. Map the Account column so each
            row carries the right chart-of-accounts entry. Every row lands in "Needs review" —
            nothing is posted to the ledger and no amount is treated as capital until it is classified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Excel / CSV file</Label>
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFile(e.target.files?.[0])} />
          </div>

          {workbook && workbook.sheetNames.length > 0 && (
            <div className="space-y-1.5">
              <Label>Sheet</Label>
              <Select value={sheet} onValueChange={(v) => selectSheet(v, workbook)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workbook.sheetNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n} ({workbook.sheets[n]?.rows.length ?? 0} rows)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {headers.length > 0 && (
            <SheetColumnMapper headers={headers} mapping={mapping} onChange={setMapping} />
          )}
          <div className="flex items-center justify-between">
            <Label>Or paste CSV data</Label>
            <Button variant="ghost" size="sm" onClick={() => setRaw(TEMPLATE)}>
              Insert template
            </Button>
          </div>
          <Textarea
            rows={8}
            value={raw}
            onChange={(e) => {
              resetFile();
              setRaw(e.target.value);
            }}
            placeholder="Vendor,Date,Paid By,Amount,Notes"
            className="font-mono text-xs"
          />

          {report && <ImportValidationReport report={report} />}
          <ImportPostingRuleReport report={ruleReport} fileName="project-import-posting-errors.csv" />

          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {blockedCount > 0 && (
                <Badge variant="destructive" className="text-[11px]">
                  {blockedCount} row{blockedCount === 1 ? " was" : "s were"} imported before — locked out to protect
                  existing records
                </Badge>
              )}
              {unmappedAccounts > 0 && (
                <Badge variant="secondary" className="text-[11px]">
                  {unmappedAccounts} row{unmappedAccounts === 1 ? "" : "s"} without an account — set one before posting
                </Badge>
              )}
              <span>
                {duplicateCount > 0
                  ? `${duplicateCount} possible duplicate${duplicateCount === 1 ? "" : "s"} detected (date, vendor, amount, notes)`
                  : "No duplicates detected"}
              </span>
              {duplicateCount > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setActions(
                        Object.fromEntries(
                          matches.map((m, i) => [i, m.strength ? "skip" : "import"]),
                        ) as Record<number, DuplicateAction>,
                      )
                    }
                  >
                    Skip all duplicates
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setActions(
                        Object.fromEntries(
                          matches.map((m, i) => [i, m.strength && m.existing ? "merge" : "import"]),
                        ) as Record<number, DuplicateAction>,
                      )
                    }
                  >
                    Merge all duplicates
                  </Button>
                </>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <ScrollArea className="max-h-[240px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Paid by</TableHead>
                    <TableHead>Cost centre</TableHead>
                    <TableHead className="min-w-[220px]">Account</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Duplicate</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.vendor_name || "—"}</TableCell>
                      <TableCell>{r.txn_date}</TableCell>
                      <TableCell>
                        {matchPartner(r.paid_by_name)?.partner_name ?? r.paid_by_name ?? "Company"}
                      </TableCell>
                      <TableCell>{(r as { cost_center?: string }).cost_center || "—"}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <AccountSelect
                            value={accountIdFor(i)}
                            onValueChange={(id) =>
                              setAccountOverrides((p) => ({ ...p, [i]: id }))
                            }
                            placeholder="Select account"
                            className="h-8 text-xs"
                          />
                          <span className="block text-[11px] text-muted-foreground">
                            {ruleReport.byIndex[i] ? (
                              <span className="text-destructive">
                                {ruleReport.byIndex[i].title}
                              </span>
                            ) : accountIdFor(i) ? (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {accountOverrides[i]
                                  ? "Manual"
                                  : MATCH_LABELS[accountMatches[i]?.confidence ?? "none"]}
                              </Badge>
                            ) : (
                              accountMatches[i]?.reason
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{r.amount.toLocaleString()}</TableCell>
                      <TableCell className="text-xs">
                        {priorHits[i]?.blocked ? (
                          <span className="flex flex-col gap-0.5">
                            <Badge variant="destructive">Already imported</Badge>
                            <span className="text-muted-foreground">{priorHits[i].reason}</span>
                          </span>
                        ) : matches[i]?.strength ? (
                          <span className="flex flex-col gap-0.5">
                            <Badge variant={matches[i].strength === "exact" ? "destructive" : "secondary"}>
                              {matches[i].strength === "exact" ? "Duplicate" : "Possible"}
                            </Badge>
                            <span className="text-muted-foreground">{matches[i].reasons.join(" · ")}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">New</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={actionFor(i)}
                          disabled={priorHits[i]?.blocked}
                          onValueChange={(v) => setActions((p) => ({ ...p, [i]: v as DuplicateAction }))}
                        >
                          <SelectTrigger className="h-8 w-[110px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="import">Import</SelectItem>
                            <SelectItem value="skip">Skip</SelectItem>
                            <SelectItem value="merge" disabled={!matches[i]?.existing}>
                              Merge
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={saving || ruleBlockedCount > 0 || importCount + mergeCount === 0}
          >
            {saving
              ? "Importing…"
              : ruleBlockedCount > 0
                ? `${ruleBlockedCount} row${ruleBlockedCount === 1 ? "" : "s"} blocked by posting rules`
                : `Import ${importCount}${mergeCount ? ` · merge ${mergeCount}` : ""}${skipCount ? ` · skip ${skipCount}` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}