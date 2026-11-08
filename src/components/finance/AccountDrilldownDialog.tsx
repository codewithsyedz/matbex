import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge, branchDisplayLabel, UNTAGGED_BRANCH_LABEL } from "@/components/branch/BranchBadge";
import { useCurrency } from "@/hooks/useCurrency";
import type { TrialBalanceRow } from "@/hooks/useTrialBalance";

interface Props {
  row: TrialBalanceRow | null;
  from: Date | null;
  to: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountDrilldownDialog({ row, from, to, open, onOpenChange }: Props) {
  const { profile } = useAuth();
  const { branches } = useBranch();
  const { format: fmt } = useCurrency();
  const tenantId = profile?.tenant_id;
  const [branchFilter, setBranchFilter] = useState<string>("all");

  useEffect(() => {
    if (open) setBranchFilter("all");
  }, [open, row?.accountId]);

  const branchNames = useMemo(
    () => new Map(branches.map((b) => [b.id, b.name])),
    [branches],
  );

  const fromKey = from ? format(from, "yyyy-MM-dd") : null;
  const toKey = to ? format(to, "yyyy-MM-dd") : null;

  const { data: tx, isLoading } = useQuery({
    queryKey: ["account-drilldown", tenantId, row?.accountId, fromKey, toKey],
    enabled: !!tenantId && !!row?.accountId && !!fromKey && !!toKey && open,
    queryFn: async () => {
      const pageSize = 1000;
      const all: Array<{
        id: string;
        transaction_date: string;
        debit: number | null;
        credit: number | null;
        description: string | null;
        reference_type: string | null;
        reference_id: string | null;
        branch_id: string | null;
        is_voided: boolean | null;
        created_at: string;
      }> = [];
      let page = 0;
      while (true) {
        const { data, error } = await db
          .from("account_transactions")
          .select("id, transaction_date, debit, credit, description, reference_type, reference_id, branch_id, is_voided, created_at")
          .eq("tenant_id", tenantId!)
          .eq("account_id", row!.accountId)
          .eq("is_voided", false)
          .gte("transaction_date", fromKey!)
          .lte("transaction_date", toKey!)
          .order("transaction_date", { ascending: true })
          .order("created_at", { ascending: true })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        page += 1;
        if (page > 20) break;
      }
      return all;
    },
    staleTime: 1000 * 60 * 2,
  });

  const filteredTx = useMemo(() => {
    if (!tx) return [];
    if (branchFilter === "all") return tx;
    if (branchFilter === "__untagged__") return tx.filter((t) => !t.branch_id);
    return tx.filter((t) => t.branch_id === branchFilter);
  }, [tx, branchFilter]);

  const branchTotals = useMemo(() => {
    if (!row || !tx) return [] as Array<{ key: string; label: string; branchId: string | null; net: number; count: number }>;
    const map = new Map<string, { key: string; label: string; branchId: string | null; net: number; count: number }>();
    for (const t of tx) {
      const key = t.branch_id ?? "__untagged__";
      const entry =
        map.get(key) ??
        {
          key,
          label: t.branch_id
            ? branchDisplayLabel(branchNames.get(t.branch_id))
            : UNTAGGED_BRANCH_LABEL,
          branchId: t.branch_id,
          net: 0,
          count: 0,
        };
      const d = Number(t.debit ?? 0);
      const c = Number(t.credit ?? 0);
      entry.net += row.side === "debit" ? d - c : c - d;
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [row, tx, branchNames]);

  const running = useMemo(() => {
    if (!row || !filteredTx.length) return [];
    // Running balance expressed on the account's normal side.
    let bal = 0;
    return filteredTx.map((t) => {
      const d = Number(t.debit ?? 0);
      const c = Number(t.credit ?? 0);
      bal += row.side === "debit" ? d - c : c - d;
      return { ...t, runningBalance: bal };
    });
  }, [row, filteredTx]);

  const totalDebit = filteredTx.reduce((s, t) => s + Number(t.debit ?? 0), 0);
  const totalCredit = filteredTx.reduce((s, t) => s + Number(t.credit ?? 0), 0);
  const filteredNet = filteredTx.reduce(
    (s, t) => s + (row?.side === "debit" ? Number(t.debit ?? 0) - Number(t.credit ?? 0) : Number(t.credit ?? 0) - Number(t.debit ?? 0)),
    0,
  );

  const handleExport = () => {
    if (!row || !filteredTx.length) return;
    const header = ["Date", "Description", "Reference", "Branch", "Debit", "Credit", "Running Balance"];
    const lines = [header.join(",")];
    for (const t of running) {
      lines.push(
        [
          t.transaction_date,
          `"${(t.description ?? "").replace(/"/g, '""')}"`,
          t.reference_type ?? "",
          `"${t.branch_id ? branchDisplayLabel(branchNames.get(t.branch_id)) : UNTAGGED_BRANCH_LABEL}"`,
          Number(t.debit ?? 0).toFixed(2),
          Number(t.credit ?? 0).toFixed(2),
          t.runningBalance.toFixed(2),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `account-${row.code}-${fromKey}-to-${toKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Transactions exported");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {row && (
              <>
                <span className="font-mono text-sm text-muted-foreground">{row.code}</span>
                <span>{row.name}</span>
                <Badge variant="outline" className="ml-1 text-[10px] capitalize">
                  {row.type}
                </Badge>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {fromKey && toKey ? `${fromKey} – ${toKey}` : "-"} · {filteredTx.length} transaction
            {filteredTx.length === 1 ? "" : "s"}
            {branchFilter !== "all" && ` of ${tx?.length ?? 0}`}
          </DialogDescription>
        </DialogHeader>

        {branchTotals.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setBranchFilter("all")}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                branchFilter === "all" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              All branches · <span className="tabular-nums font-medium">{fmt(row?.netBalance ?? 0)}</span>
            </button>
            {branchTotals.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setBranchFilter(b.key)}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${
                  branchFilter === b.key ? "border-primary bg-primary/5" : "hover:bg-muted"
                }`}
              >
                <BranchBadge name={b.branchId ? branchNames.get(b.branchId) : null} branchId={b.branchId} size="sm" />
                <span className="tabular-nums font-medium">{fmt(b.net)}</span>
                <span className="text-muted-foreground">({b.count})</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Total debits:{" "}
              <span className="font-semibold tabular-nums">{fmt(totalDebit)}</span>
            </span>
            <span className="text-muted-foreground">·</span>
            <span>
              Total credits:{" "}
              <span className="font-semibold tabular-nums">{fmt(totalCredit)}</span>
            </span>
            {row && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>
                  Net ({row.side}):{" "}
                  <span className="font-semibold tabular-nums">
                    {fmt(branchFilter === "all" ? row.netBalance : filteredNet)}
                  </span>
                </span>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleExport}
            disabled={filteredTx.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>

        <ScrollArea className="max-h-[60vh] border rounded-md">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : filteredTx.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No transactions in this period.
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="w-[100px]">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[130px]">Branch</TableHead>
                  <TableHead className="w-[110px]">Source</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {running.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs tabular-nums">{t.transaction_date}</TableCell>
                    <TableCell className="text-sm">
                      {t.description ?? <span className="text-muted-foreground italic">-</span>}
                    </TableCell>
                    <TableCell className="max-w-[130px]">
                      <BranchBadge
                        name={t.branch_id ? branchNames.get(t.branch_id) : null}
                        branchId={t.branch_id}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell>
                      {t.reference_type ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t.reference_type}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(t.debit ?? 0) > 0 ? fmt(Number(t.debit)) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(t.credit ?? 0) > 0 ? fmt(Number(t.credit)) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmt(t.runningBalance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>

        {row && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            For full edit access, open the Accounting module.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}