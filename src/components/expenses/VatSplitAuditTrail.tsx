import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, History, Percent, ShieldOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";

interface LedgerLeg {
  account_code?: string | null;
  account_name?: string | null;
  debit?: number | null;
  credit?: number | null;
  batch_id?: string | null;
  transaction_date?: string | null;
}

interface AuditRow {
  id: string;
  expense_id: string;
  action: "applied" | "marked_not_applicable";
  rate_percent: number | null;
  amount_before: number | null;
  net_before: number | null;
  vat_before: number | null;
  status_before: string | null;
  amount_after: number | null;
  net_after: number | null;
  vat_after: number | null;
  status_after: string | null;
  ledger_posted: boolean | null;
  batch_id: string | null;
  ledger_before: LedgerLeg[] | null;
  ledger_after: LedgerLeg[] | null;
  note: string | null;
  performed_by: string | null;
  performed_at: string;
  branch_id: string | null;
}

/**
 * Immutable log of every retroactive VAT-split decision: who applied a split
 * (or marked a bill as no-VAT), when, and the ledger legs before and after.
 */
export function VatSplitAuditTrail({ expenseId }: { expenseId?: string }) {
  const { activeBranchId } = useBranch();
  const { format: money } = useCurrency();
  const [openRow, setOpenRow] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: ["vat-split-audit", activeBranchId, expenseId ?? null],
    queryFn: async () => {
      let q = (supabase as any)
        .from("expense_vat_split_audit")
        .select("*")
        .order("performed_at", { ascending: false })
        .limit(200);
      if (expenseId) q = q.eq("expense_id", expenseId);
      else if (activeBranchId && activeBranchId !== "all") {
        q = q.eq("branch_id", activeBranchId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    staleTime: 60_000,
  });

  const actorIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.performed_by).filter(Boolean))) as string[],
    [rows],
  );

  const { data: actors = {} } = useQuery<Record<string, string>>({
    queryKey: ["vat-split-audit-actors", actorIds],
    enabled: actorIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, full_name")
        .in("id", actorIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: any) => {
        map[p.id] = p.full_name || "Unknown user";
      });
      return map;
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <History className="h-4 w-4" />
          VAT split audit trail
          <Badge variant="outline">{rows.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every applied split and &ldquo;no VAT&rdquo; decision, with the user, the
          timestamp and the ledger postings before and after the change.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No VAT split decisions recorded yet.
          </p>
        ) : (
          rows.map((r) => (
            <Collapsible
              key={r.id}
              open={openRow === r.id}
              onOpenChange={(o) => setOpenRow(o ? r.id : null)}
            >
              <div className="rounded-md border">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
                  >
                    {r.action === "applied" ? (
                      <Percent className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <ShieldOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-xs">
                      <span className="font-medium">
                        {r.action === "applied"
                          ? `VAT split applied${r.rate_percent ? ` @ ${r.rate_percent}%` : ""}`
                          : "Marked as no VAT applicable"}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        by {actors[r.performed_by ?? ""] ?? "Unknown user"} ·{" "}
                        {new Date(r.performed_at).toLocaleString()}
                      </span>
                    </span>
                    {r.batch_id && (
                      <Badge variant="secondary" className="text-[10px]">
                        correction batch
                      </Badge>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 border-t p-3 text-xs">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Amounts
                      title="Before"
                      status={r.status_before}
                      total={r.amount_before}
                      net={r.net_before}
                      vat={r.vat_before}
                      money={money}
                    />
                    <Amounts
                      title="After"
                      status={r.status_after}
                      total={r.amount_after}
                      net={r.net_after}
                      vat={r.vat_after}
                      money={money}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Legs title="Ledger before" legs={r.ledger_before} money={money} />
                    <Legs title="Ledger after" legs={r.ledger_after} money={money} />
                  </div>
                  {r.note && (
                    <p className="text-muted-foreground">Note: {r.note}</p>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Amounts({
  title,
  status,
  total,
  net,
  vat,
  money,
}: {
  title: string;
  status: string | null;
  total: number | null;
  net: number | null;
  vat: number | null;
  money: (n: number) => string;
}) {
  return (
    <div className="rounded-md bg-muted/30 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">{title}</span>
        <Badge variant="outline" className="text-[10px]">
          {status ?? "—"}
        </Badge>
      </div>
      <Line label="Total" value={money(Number(total ?? 0))} />
      <Line label="Net" value={net == null ? "—" : money(Number(net))} />
      <Line label="VAT" value={money(Number(vat ?? 0))} />
    </div>
  );
}

function Legs({
  title,
  legs,
  money,
}: {
  title: string;
  legs: LedgerLeg[] | null;
  money: (n: number) => string;
}) {
  const list = Array.isArray(legs) ? legs : [];
  return (
    <div className="rounded-md bg-muted/30 p-2">
      <p className="mb-1 font-medium">{title}</p>
      {list.length === 0 ? (
        <p className="text-muted-foreground">No ledger postings.</p>
      ) : (
        list.map((l, i) => (
          <Line
            key={i}
            label={`${l.account_code ?? "—"} ${l.account_name ?? ""}`.trim()}
            value={
              Number(l.debit ?? 0) > 0
                ? `DR ${money(Number(l.debit))}`
                : `CR ${money(Number(l.credit ?? 0))}`
            }
          />
        ))
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
