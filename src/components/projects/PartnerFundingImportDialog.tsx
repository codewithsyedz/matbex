import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useCurrency } from "@/hooks/useCurrency";
import { parseCsv } from "@/lib/migration/parsers";
import { FUNDING_LABELS, type FundingClassification, type useProjects } from "@/hooks/useProjects";

type ProjectsApi = ReturnType<typeof useProjects>;

const NONE = "__none__";

/** Logical fields the importer understands, in mapping-UI order. */
const FIELDS = [
  { key: "date", label: "Date", required: true, hints: ["date", "txndate", "paymentdate", "entrydate"] },
  { key: "partner", label: "Partner name", required: true, hints: ["partner", "paidby", "name", "partnername"] },
  { key: "amount", label: "Amount", required: true, hints: ["amount", "value", "total", "paid"] },
  { key: "type", label: "Funding type", required: true, hints: ["type", "fundingtype", "classification", "category", "head"] },
  { key: "direction", label: "Entry kind (funding / repayment)", required: false, hints: ["direction", "kind", "entrytype", "entry", "flow"] },
  { key: "description", label: "Description", required: false, hints: ["description", "details", "narration", "purpose", "vendor", "notes"] },
  { key: "reference", label: "Reference / notes", required: false, hints: ["reference", "ref", "invoice", "remarks", "note"] },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

const TEMPLATE = `Date,Partner,Type,Direction,Amount,Description,Reference
2026-06-01,Fraz,Capital,Funding,58650,Initial equity injection,BANK-001
2026-06-08,Syed Raza,Loan,Funding,25000,Loan for kitchen equipment,TT-4471
2026-06-20,Syed Raza,Payable,Funding,4300,Paid contractor personally,INV-882
2026-07-05,Syed Raza,Payable,Repayment,4300,Reimbursed from company bank,PAY-019`;

function normalise(v: string) {
  return v.toLowerCase().replace(/[\s_\-/]+/g, "");
}

function toDate(raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toAmount(raw: string): number {
  const cleaned = (raw ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/** Maps free-text values in the "type" column onto the three funding classifications. */
function toClassification(raw: string): FundingClassification | null {
  const v = normalise(raw ?? "");
  if (!v) return null;
  if (v.includes("capital") || v.includes("equity") || v.includes("injection") || v.includes("contribution")) {
    return "capital";
  }
  if (v.includes("loan") || v.includes("advance") || v.includes("lent") || v.includes("borrow")) return "loan";
  if (v.includes("payable") || v.includes("duetopartner") || v.includes("reimburs") || v.includes("expense")) {
    return "payable";
  }
  return null;
}

function toDirection(raw: string): "funding" | "repayment" {
  const v = normalise(raw ?? "");
  if (!v) return "funding";
  if (
    v.includes("repay") ||
    v.includes("refund") ||
    v.includes("settle") ||
    v.includes("withdraw") ||
    v.includes("payback") ||
    v.includes("out")
  ) {
    return "repayment";
  }
  return "funding";
}

interface Prepared {
  index: number;
  date: string | null;
  partnerName: string;
  partnerId: string | null;
  amount: number;
  classification: FundingClassification | null;
  direction: "funding" | "repayment";
  description: string;
  reference: string;
  error: string | null;
}

export function PartnerFundingImportDialog({
  api,
  open,
  onOpenChange,
}: {
  api: ProjectsApi;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { format: money } = useCurrency();
  const { accounts } = useChartOfAccounts();
  const fileRef = useRef<HTMLInputElement>(null);

  const [raw, setRaw] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [payAccountId, setPayAccountId] = useState("");
  const [saving, setSaving] = useState(false);

  const grid = useMemo(() => parseCsv(raw), [raw]);
  const headers = useMemo(() => (grid[0] ?? []).map((h) => h.trim()), [grid]);

  const cashAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "asset" && a.is_active),
    [accounts],
  );

  /** Auto-suggest a mapping whenever the header row changes. */
  useEffect(() => {
    if (headers.length === 0) return;
    const lc = headers.map(normalise);
    const next: Record<string, string> = {};
    for (const f of FIELDS) {
      const hit = lc.findIndex((h) => f.hints.some((hint) => h === hint || h.includes(hint)));
      next[f.key] = hit >= 0 ? headers[hit] : NONE;
    }
    setMapping(next);
  }, [headers.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const matchPartner = (name: string) =>
    api.partners.find((p) => normalise(p.partner_name) === normalise(name)) ?? null;

  const cell = (row: string[], key: FieldKey) => {
    const header = mapping[key];
    if (!header || header === NONE) return "";
    const idx = headers.indexOf(header);
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  };

  const prepared: Prepared[] = useMemo(() => {
    if (grid.length < 2) return [];
    return grid.slice(1).map((row, i) => {
      const date = toDate(cell(row, "date"));
      const partnerName = cell(row, "partner");
      const partner = matchPartner(partnerName);
      const amount = toAmount(cell(row, "amount"));
      const classification = toClassification(cell(row, "type"));
      const direction = toDirection(cell(row, "direction"));

      let error: string | null = null;
      if (!partnerName) error = "Partner missing";
      else if (!partner) error = `No partner named "${partnerName}"`;
      else if (!date) error = "Invalid date";
      else if (amount <= 0) error = "Amount must be greater than zero";
      else if (!classification) error = "Type must map to capital, loan or payable";
      else if (direction === "repayment" && classification === "capital") {
        error = "Capital cannot be repaid here — use a capital withdrawal";
      }

      return {
        index: i + 2,
        date,
        partnerName,
        partnerId: partner?.id ?? null,
        amount,
        classification,
        direction,
        description: cell(row, "description"),
        reference: cell(row, "reference"),
        error,
      };
    });
  }, [grid, mapping, headers, api.partners]);

  const valid = prepared.filter((r) => !r.error);
  const invalid = prepared.filter((r) => r.error);
  const fundingRows = valid.filter((r) => r.direction === "funding");
  const repaymentRows = valid.filter((r) => r.direction === "repayment");
  const missingRequired = FIELDS.filter(
    (f) => f.required && (!mapping[f.key] || mapping[f.key] === NONE),
  );

  const readFile = async (file: File) => {
    const text = await file.text();
    setRaw(text);
  };

  const reset = () => {
    setRaw("");
    setMapping({});
  };

  const handleImport = async () => {
    if (valid.length === 0) {
      toast.error("Nothing valid to import.");
      return;
    }
    if (repaymentRows.length > 0 && !payAccountId) {
      toast.error("Choose the cash/bank account the repayments were paid from.");
      return;
    }
    setSaving(true);
    try {
      let created = 0;
      if (fundingRows.length > 0) {
        const res = await api.bulkImport.mutateAsync(
          fundingRows.map((r) => ({
            txn_date: r.date!,
            amount: r.amount,
            description: r.description || `${FUNDING_LABELS[r.classification!]} — ${r.partnerName}`,
            notes: r.reference || null,
            vendor_name: null,
            paid_by: "partner" as const,
            partner_id: r.partnerId,
            funding_classification: r.classification,
            treatment: null,
            branch_id: api.activeProject?.branch_id ?? null,
          })),
        );
        created = res.count;
      }

      let repaid = 0;
      const failures: string[] = [];
      for (const r of repaymentRows) {
        try {
          await api.reimbursePartner.mutateAsync({
            partnerId: r.partnerId!,
            amount: r.amount,
            paymentAccountId: payAccountId,
            date: r.date!,
            kind: r.classification!,
            notes: [r.description, r.reference].filter(Boolean).join(" · ") || undefined,
          });
          repaid += 1;
        } catch (e: any) {
          failures.push(`Row ${r.index}: ${e?.message ?? "failed"}`);
        }
      }

      toast.success(
        `${created} funding entr${created === 1 ? "y" : "ies"} queued for review · ${repaid} repayment${
          repaid === 1 ? "" : "s"
        } posted.`,
      );
      if (failures.length > 0) toast.error(failures.slice(0, 3).join("\n"));
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import partner funding &amp; repayments</DialogTitle>
          <DialogDescription>
            Upload or paste a CSV, map the columns, then import. Funding entries land in the review queue
            as partner-paid transactions classified as capital, loan or payable. Repayments post
            immediately as settlements from the selected cash/bank account.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>CSV data</Label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setRaw(TEMPLATE)}>
                    Insert template
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload file
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void readFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              <Textarea
                rows={6}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="Date,Partner,Type,Direction,Amount,Description,Reference"
                className="font-mono text-xs"
              />
            </div>

            {headers.length > 0 && (
              <div className="space-y-2">
                <Label>Column mapping</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <p className="text-xs font-light text-muted-foreground">
                        {f.label}
                        {f.required && <span className="text-destructive"> *</span>}
                      </p>
                      <Select
                        value={mapping[f.key] ?? NONE}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
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
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Type values are matched loosely: "capital / equity / injection" → capital, "loan /
                  advance" → loan, "payable / due to partner / reimbursable" → payable. Rows without an
                  entry-kind column default to funding.
                </p>
              </div>
            )}

            {repaymentRows.length > 0 && (
              <div className="space-y-1">
                <Label>Repayment paid from</Label>
                <Select value={payAccountId} onValueChange={setPayAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select cash or bank account" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} · {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {prepared.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{fundingRows.length} funding</Badge>
                  <Badge variant="secondary">{repaymentRows.length} repayments</Badge>
                  {invalid.length > 0 ? (
                    <Badge variant="destructive">{invalid.length} skipped</Badge>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> All rows valid
                    </span>
                  )}
                  {missingRequired.length > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Map: {missingRequired.map((f) => f.label).join(", ")}
                    </span>
                  )}
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Partner</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prepared.slice(0, 50).map((r) => (
                        <TableRow key={r.index} className={r.error ? "bg-destructive/5" : undefined}>
                          <TableCell className="text-muted-foreground">{r.index}</TableCell>
                          <TableCell>{r.date ?? "—"}</TableCell>
                          <TableCell>{r.partnerName || "—"}</TableCell>
                          <TableCell>
                            {r.classification ? FUNDING_LABELS[r.classification] : "—"}
                          </TableCell>
                          <TableCell className="capitalize">{r.direction}</TableCell>
                          <TableCell className="text-right">{money(r.amount)}</TableCell>
                          <TableCell className="text-xs">
                            {r.error ? (
                              <span className="text-destructive">{r.error}</span>
                            ) : (
                              <span className="text-muted-foreground">Ready</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {prepared.length > 50 && (
                  <p className="text-xs text-muted-foreground">
                    Showing the first 50 of {prepared.length} rows — all valid rows will be imported.
                  </p>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={saving || valid.length === 0}>
            {saving ? "Importing…" : `Import ${valid.length} rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
