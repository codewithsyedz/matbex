import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, History } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { db } from "@/integrations/db/client";
import { useCurrency } from "@/hooks/useCurrency";
import { roundMoney } from "@/lib/vatInclusive";

interface Props {
  tenantId?: string | null;
  /** "all" or a branch id */
  branchId: string;
  from: Date | null;
  to: Date | null;
  branchNameById: (id: string | null) => string;
}

interface RevenueLeg {
  accountCode: string;
  accountName: string;
  movedOut: number;
}

interface OriginalPosting {
  batchId: string;
  description: string;
  entryType: string;
  isPosted: boolean;
  accountCode: string;
  accountName: string;
  amount: number;
}

interface RestatementRow {
  batchId: string;
  date: string;
  branchId: string | null;
  branchName: string;
  createdAt: string | null;
  vatMoved: number;
  revenueLegs: RevenueLeg[];
  /** Revenue as it was originally credited (net after restatement + VAT moved). */
  originalGross: number;
  restatedNet: number;
  effectiveRate: number;
  originals: OriginalPosting[];
}

const isoDate = (d: Date) => format(d, "yyyy-MM-dd");

export function VatRestatementLog({ tenantId, branchId, from, to, branchNameById }: Props) {
  const { format: fmtMoney } = useCurrency();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: ["vat-restatement-log", tenantId, branchId, from?.toISOString(), to?.toISOString()],
    enabled: !!tenantId,
    queryFn: async (): Promise<RestatementRow[]> => {
      let batchQ = db
        .from("journal_entry_batches")
        .select("id, batch_date, description, branch_id, created_at, entry_type, is_posted")
        .eq("tenant_id", tenantId as string)
        .ilike("description", "Output VAT restatement%")
        .order("batch_date", { ascending: false });
      if (branchId !== "all") batchQ = batchQ.eq("branch_id", branchId);
      if (from) batchQ = batchQ.gte("batch_date", isoDate(from));
      if (to) batchQ = batchQ.lte("batch_date", isoDate(to));

      const { data: batches, error: batchErr } = await batchQ;
      if (batchErr) throw batchErr;
      if (!batches || batches.length === 0) return [];

      const batchIds = batches.map((b: any) => b.id);
      const { data: lines, error: lineErr } = await db
        .from("account_transactions")
        .select("batch_id, debit, credit, account_id, chart_of_accounts(account_code, account_name)")
        .in("batch_id", batchIds)
        .or("is_voided.is.null,is_voided.eq.false");
      if (lineErr) throw lineErr;

      // Original daily-sales / night-shift postings on the same date + branch.
      const dates = Array.from(new Set(batches.map((b: any) => b.batch_date)));
      let origQ = db
        .from("journal_entry_batches")
        .select("id, batch_date, branch_id, description, entry_type, is_posted")
        .eq("tenant_id", tenantId as string)
        .in("batch_date", dates)
        .neq("entry_type", "correction");
      if (branchId !== "all") origQ = origQ.eq("branch_id", branchId);
      const { data: origBatches, error: origErr } = await origQ;
      if (origErr) throw origErr;

      const origIds = (origBatches ?? []).map((b: any) => b.id);
      let origLines: any[] = [];
      if (origIds.length > 0) {
        const { data, error } = await db
          .from("account_transactions")
          .select("batch_id, debit, credit, chart_of_accounts(account_code, account_name)")
          .in("batch_id", origIds)
          .or("is_voided.is.null,is_voided.eq.false");
        if (error) throw error;
        origLines = data ?? [];
      }

      const origLinesByBatch = new Map<string, any[]>();
      for (const l of origLines) {
        const arr = origLinesByBatch.get(l.batch_id) ?? [];
        arr.push(l);
        origLinesByBatch.set(l.batch_id, arr);
      }

      return batches.map((b: any) => {
        const own = (lines ?? []).filter((l: any) => l.batch_id === b.id);
        const vatMoved = roundMoney(
          own
            .filter((l: any) => l.chart_of_accounts?.account_code === "2200")
            .reduce((s: number, l: any) => s + Number(l.credit ?? 0), 0),
        );
        const revenueLegs: RevenueLeg[] = own
          .filter((l: any) => Number(l.debit ?? 0) > 0)
          .map((l: any) => ({
            accountCode: l.chart_of_accounts?.account_code ?? "—",
            accountName: l.chart_of_accounts?.account_name ?? "Unknown account",
            movedOut: roundMoney(Number(l.debit ?? 0)),
          }));

        const revenueCodes = new Set(revenueLegs.map((r) => r.accountCode));
        const originals: OriginalPosting[] = [];
        for (const ob of origBatches ?? []) {
          if (ob.batch_date !== b.batch_date) continue;
          if ((ob.branch_id ?? null) !== (b.branch_id ?? null)) continue;
          for (const l of origLinesByBatch.get(ob.id) ?? []) {
            const code = l.chart_of_accounts?.account_code ?? "";
            const credit = Number(l.credit ?? 0);
            if (credit <= 0 || !revenueCodes.has(code)) continue;
            originals.push({
              batchId: ob.id,
              description: ob.description,
              entryType: ob.entry_type,
              isPosted: !!ob.is_posted,
              accountCode: code,
              accountName: l.chart_of_accounts?.account_name ?? "",
              amount: roundMoney(credit),
            });
          }
        }

        const restatedNet = roundMoney(
          originals.reduce((s, o) => s + o.amount, 0),
        );
        const originalGross = roundMoney(restatedNet + vatMoved);

        return {
          batchId: b.id,
          date: b.batch_date,
          branchId: b.branch_id ?? null,
          branchName: branchNameById(b.branch_id ?? null),
          createdAt: b.created_at ?? null,
          vatMoved,
          revenueLegs,
          originalGross,
          restatedNet,
          effectiveRate: restatedNet > 0 ? (vatMoved / restatedNet) * 100 : 0,
          originals,
        };
      });
    },
  });

  const rows = query.data ?? [];

  const totals = useMemo(
    () => ({
      batches: rows.length,
      vat: roundMoney(rows.reduce((s, r) => s + r.vatMoved, 0)),
      gross: roundMoney(rows.reduce((s, r) => s + r.originalGross, 0)),
    }),
    [rows],
  );

  const exportCsv = () => {
    const header = [
      "Batch date", "Branch", "Correction batch", "Revenue accounts debited",
      "VAT moved to 2200", "Revenue as originally credited", "Revenue after restatement",
      "Effective VAT rate %", "Original postings reclassified",
    ];
    const body = rows.map((r) => [
      r.date,
      r.branchName,
      r.batchId,
      r.revenueLegs.map((l) => `${l.accountCode} ${l.accountName} (${l.movedOut.toFixed(2)})`).join(" | "),
      r.vatMoved.toFixed(2),
      r.originalGross.toFixed(2),
      r.restatedNet.toFixed(2),
      r.effectiveRate.toFixed(2),
      r.originals.map((o) => `${o.description} → ${o.accountCode} ${o.amount.toFixed(2)}`).join(" | "),
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vat-restatement-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Output VAT restatement log
            </CardTitle>
            <CardDescription>
              Every correction batch that moved output VAT out of revenue into 2200 VAT Payable,
              with the original sales postings that were reclassified.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {query.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : query.error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load the restatement log</AlertTitle>
            <AlertDescription>{String((query.error as any)?.message ?? query.error)}</AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No output VAT restatement batches in this period and branch.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Summary label="Correction batches" value={String(totals.batches)} />
              <Summary label="VAT reclassified to 2200" value={fmtMoney(totals.vat)} />
              <Summary label="Revenue originally credited" value={fmtMoney(totals.gross)} />
            </div>

            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Date</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Revenue before</TableHead>
                    <TableHead className="text-right">VAT moved to 2200</TableHead>
                    <TableHead className="text-right">Revenue after</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isOpen = !!expanded[r.batchId];
                    return (
                      <Fragment key={r.batchId}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpanded((s) => ({ ...s, [r.batchId]: !isOpen }))}
                        >
                          <TableCell>
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                          <TableCell><BranchBadge branchId={r.branchId} /></TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(r.originalGross)}</TableCell>
                          <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                            {fmtMoney(r.vatMoved)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(r.restatedNet)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.effectiveRate.toFixed(2)}%</TableCell>
                        </TableRow>

                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7} className="p-4 space-y-4">
                              <div>
                                <p className="text-xs font-medium mb-1.5">What this correction changed</p>
                                <p className="text-xs text-muted-foreground mb-2">
                                  Sales were originally posted VAT-inclusive to revenue. This batch debits the
                                  revenue accounts and credits 2200 VAT Payable, so the tax sits as a liability
                                  until it is remitted.
                                </p>
                                <ul className="text-xs space-y-1">
                                  {r.revenueLegs.map((l, i) => (
                                    <li key={i} className="flex items-center gap-2">
                                      <Badge variant="outline" className="font-mono text-[10px]">DR</Badge>
                                      <span>{l.accountCode} — {l.accountName}</span>
                                      <span className="tabular-nums">{fmtMoney(l.movedOut)}</span>
                                    </li>
                                  ))}
                                  <li className="flex items-center gap-2">
                                    <Badge variant="outline" className="font-mono text-[10px]">CR</Badge>
                                    <span>2200 — VAT Payable</span>
                                    <span className="tabular-nums">{fmtMoney(r.vatMoved)}</span>
                                  </li>
                                </ul>
                                <p className="text-[11px] text-muted-foreground mt-2">
                                  Correction batch <span className="font-mono">{r.batchId.slice(0, 8)}</span>
                                  {r.createdAt ? ` · created ${format(new Date(r.createdAt), "dd MMM yyyy HH:mm")}` : ""}
                                </p>
                              </div>

                              <div>
                                <p className="text-xs font-medium mb-1.5">Original postings reclassified</p>
                                {r.originals.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    The original sales batch for this day is no longer available (voided or archived).
                                  </p>
                                ) : (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs">Source batch</TableHead>
                                        <TableHead className="text-xs">Account</TableHead>
                                        <TableHead className="text-xs">Status</TableHead>
                                        <TableHead className="text-xs text-right">Revenue now</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {r.originals.map((o, i) => (
                                        <TableRow key={`${o.batchId}-${i}`}>
                                          <TableCell className="text-xs">
                                            {o.description}
                                            <span className="block text-[10px] text-muted-foreground font-mono">
                                              {o.batchId.slice(0, 8)} · {o.entryType}
                                            </span>
                                          </TableCell>
                                          <TableCell className="text-xs">{o.accountCode} — {o.accountName}</TableCell>
                                          <TableCell>
                                            <Badge variant={o.isPosted ? "default" : "outline"} className="text-[10px]">
                                              {o.isPosted ? "Posted" : "Unposted"}
                                            </Badge>
                                          </TableCell>
                                          <TableCell className="text-xs text-right tabular-nums">
                                            {fmtMoney(o.amount)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-light tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
