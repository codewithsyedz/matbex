import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, FileSpreadsheet } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BranchBadge, branchDisplayLabel } from "@/components/branch/BranchBadge";
import { db } from "@/integrations/db/client";
import { roundMoney, sumMoney } from "@/lib/vatInclusive";

interface BatchRow {
  batchId: string;
  reference: string;
  description: string;
  entryType: string;
  approvalStatus: string;
  isPosted: boolean;
  net: number;
  vat: number;
}

export interface VatLedgerDayRow {
  key: string;
  date: string;
  branchId: string | null;
  branchName: string;
  net: number;
  vat: number;
  gross: number;
  effectiveRate: number;
  batches: BatchRow[];
}

interface Props {
  tenantId?: string | null;
  branchId: string;
  from: Date | null;
  to: Date | null;
  branchNameById: (id: string | null) => string;
  fmt: (n: number) => string;
  periodLabel: string;
  branchScopeLabel: string;
}

/**
 * Detailed output-VAT report built straight from the general ledger:
 * revenue credits (net sales) and 2200 VAT Payable credits (output VAT),
 * grouped per day + branch with the exact journal batches behind them.
 */
export function VatOutputLedgerReport({
  tenantId,
  branchId,
  from,
  to,
  branchNameById,
  fmt,
  periodLabel,
  branchScopeLabel,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: [
      "vat-output-ledger",
      tenantId,
      branchId,
      from?.toISOString() ?? null,
      to?.toISOString() ?? null,
    ],
    enabled: !!tenantId && !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<VatLedgerDayRow[]> => {
      const { data: accounts, error: aErr } = await (db as any)
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("tenant_id", tenantId);
      if (aErr) throw aErr;

      const revenueIds: string[] = [];
      const vatIds: string[] = [];
      for (const a of (accounts ?? []) as any[]) {
        if (a.account_type === "revenue") revenueIds.push(a.id);
        else if (a.account_code === "2200") vatIds.push(a.id);
      }
      const accountIds = [...revenueIds, ...vatIds];
      if (!accountIds.length) return [];
      const isVatAccount = new Set(vatIds);

      let q = (db as any)
        .from("account_transactions")
        .select("id, transaction_date, branch_id, account_id, debit, credit, batch_id")
        .eq("tenant_id", tenantId)
        .eq("is_voided", false)
        .in("account_id", accountIds)
        .gte("transaction_date", format(from!, "yyyy-MM-dd"))
        .lte("transaction_date", format(to!, "yyyy-MM-dd"))
        .limit(20000);
      if (branchId && branchId !== "all") {
        if (branchId === "untagged") q = q.is("branch_id", null);
        else q = q.eq("branch_id", branchId);
      }
      const { data: txns, error } = await q;
      if (error) throw error;

      const batchIds = Array.from(
        new Set(((txns ?? []) as any[]).map((t) => t.batch_id).filter(Boolean)),
      );
      const batchMeta: Record<string, any> = {};
      for (let i = 0; i < batchIds.length; i += 300) {
        const chunk = batchIds.slice(i, i + 300);
        const { data: batches } = await (db as any)
          .from("journal_entry_batches")
          .select("id, reference_number, description, entry_type, approval_status, is_posted")
          .in("id", chunk);
        for (const b of (batches ?? []) as any[]) batchMeta[b.id] = b;
      }

      const days = new Map<string, VatLedgerDayRow>();
      for (const t of (txns ?? []) as any[]) {
        const bId: string | null = t.branch_id ?? null;
        const key = `${t.transaction_date}__${bId ?? "none"}`;
        const row =
          days.get(key) ??
          ({
            key,
            date: t.transaction_date,
            branchId: bId,
            branchName: branchNameById(bId),
            net: 0,
            vat: 0,
            gross: 0,
            effectiveRate: 0,
            batches: [],
          } as VatLedgerDayRow);

        // Credits increase revenue/VAT; debits (refunds, reversals) reduce them.
        const amount = Number(t.credit ?? 0) - Number(t.debit ?? 0);
        const vatLeg = isVatAccount.has(t.account_id);
        if (vatLeg) row.vat = roundMoney(row.vat + amount);
        else row.net = roundMoney(row.net + amount);

        const bKey = t.batch_id ?? "no-batch";
        let batch = row.batches.find((x) => x.batchId === bKey);
        if (!batch) {
          const meta = t.batch_id ? batchMeta[t.batch_id] : null;
          batch = {
            batchId: bKey,
            reference: meta?.reference_number ?? (t.batch_id ? t.batch_id.slice(0, 8) : "—"),
            description: meta?.description ?? "Unbatched ledger line",
            entryType: meta?.entry_type ?? "—",
            approvalStatus: meta?.approval_status ?? "—",
            isPosted: !!meta?.is_posted,
            net: 0,
            vat: 0,
          };
          row.batches.push(batch);
        }
        if (vatLeg) batch.vat = roundMoney(batch.vat + amount);
        else batch.net = roundMoney(batch.net + amount);

        days.set(key, row);
      }

      const rows = Array.from(days.values());
      for (const r of rows) {
        r.gross = roundMoney(r.net + r.vat);
        r.effectiveRate = r.net > 0 ? Math.round((r.vat / r.net) * 10000) / 100 : 0;
        r.batches.sort((a, b) => b.vat + b.net - (a.vat + a.net));
      }
      return rows.sort(
        (a, b) => b.date.localeCompare(a.date) || a.branchName.localeCompare(b.branchName),
      );
    },
  });

  const rows = data ?? [];

  const totals = useMemo(
    () => ({
      net: sumMoney(rows.map((r) => r.net)),
      vat: sumMoney(rows.map((r) => r.vat)),
      gross: sumMoney(rows.map((r) => r.gross)),
      batches: new Set(rows.flatMap((r) => r.batches.map((b) => b.batchId))).size,
    }),
    [rows],
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push(`VAT Output Ledger Report`);
    lines.push(`Period,${esc(periodLabel)}`);
    lines.push(`Branch,${esc(branchScopeLabel)}`);
    lines.push(`Generated,${format(new Date(), "yyyy-MM-dd HH:mm")}`);
    lines.push("");
    lines.push(
      [
        "Date",
        "Branch",
        "Branch ID",
        "Level",
        "Batch reference",
        "Batch description",
        "Entry type",
        "Status",
        "Gross sales",
        "Net sales",
        "Output VAT",
        "Effective VAT %",
      ].join(","),
    );
    for (const r of rows) {
      lines.push(
        [
          r.date,
          esc(branchDisplayLabel(r.branchName)),
          r.branchId ?? "",
          "Day total",
          "",
          "",
          "",
          "",
          r.gross.toFixed(2),
          r.net.toFixed(2),
          r.vat.toFixed(2),
          r.effectiveRate.toFixed(2),
        ].join(","),
      );
      for (const b of r.batches) {
        lines.push(
          [
            r.date,
            esc(branchDisplayLabel(r.branchName)),
            r.branchId ?? "",
            "Batch",
            esc(b.reference),
            esc(b.description),
            esc(b.entryType),
            esc(b.isPosted ? "posted" : b.approvalStatus),
            roundMoney(b.net + b.vat).toFixed(2),
            b.net.toFixed(2),
            b.vat.toFixed(2),
            b.net > 0 ? ((b.vat / b.net) * 100).toFixed(2) : "",
          ].join(","),
        );
      }
    }
    lines.push("");
    lines.push(
      ["TOTAL", "", "", "", "", "", "", "", totals.gross.toFixed(2), totals.net.toFixed(2), totals.vat.toFixed(2), ""].join(","),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vat-output-ledger-${from ? format(from, "yyyy-MM-dd") : "all"}-to-${
      to ? format(to, "yyyy-MM-dd") : "all"
    }.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" /> Output VAT by day & branch
          </CardTitle>
          <CardDescription>
            Gross, net and output VAT taken from posted ledger lines — {periodLabel} ·{" "}
            {branchScopeLabel}. Expand a day to see the exact journal batches.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          onClick={exportCsv}
          disabled={!rows.length}
        >
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Gross sales" value={fmt(totals.gross)} />
          <Stat label="Net sales (excl. VAT)" value={fmt(totals.net)} />
          <Stat label="Output VAT (2200)" value={fmt(totals.vat)} accent />
          <Stat label="Ledger batches" value={String(totals.batches)} />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !rows.length ? (
          <Alert>
            <AlertTitle>No ledger activity</AlertTitle>
            <AlertDescription>
              No revenue or VAT ledger lines were found for this period and branch.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Gross sales</TableHead>
                  <TableHead className="text-right">Net sales</TableHead>
                  <TableHead className="text-right">Output VAT</TableHead>
                  <TableHead className="text-right">Eff. VAT %</TableHead>
                  <TableHead className="text-right">Batches</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const open = expanded.has(r.key);
                  return (
                    <Fragment key={r.key}>
                      <TableRow className="cursor-pointer" onClick={() => toggle(r.key)}>
                        <TableCell className="text-muted-foreground">
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {format(new Date(`${r.date}T00:00:00`), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <BranchBadge name={r.branchName} branchId={r.branchId} size="sm" />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(r.gross)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmt(r.net)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmt(r.vat)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.effectiveRate.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.batches.length}
                        </TableCell>
                      </TableRow>
                      {open &&
                        r.batches.map((b) => (
                          <TableRow key={`${r.key}-${b.batchId}`} className="bg-muted/40">
                            <TableCell />
                            <TableCell colSpan={2} className="text-xs">
                              <div className="font-medium">{b.description}</div>
                              <div className="text-muted-foreground">
                                Ref {b.reference} · {b.entryType}{" "}
                                <Badge
                                  variant={b.isPosted ? "secondary" : "outline"}
                                  className="ml-1 font-normal"
                                >
                                  {b.isPosted ? "posted" : b.approvalStatus}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {fmt(roundMoney(b.net + b.vat))}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                              {fmt(b.net)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {fmt(b.vat)}
                            </TableCell>
                            <TableCell colSpan={2} className="text-right text-xs text-muted-foreground">
                              {b.batchId === "no-batch" ? "—" : b.batchId.slice(0, 8)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })}
                <TableRow className="border-t-2 font-medium">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.net)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(totals.vat)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}
