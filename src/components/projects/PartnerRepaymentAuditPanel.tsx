import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ClipboardCheck, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";
import { FUNDING_LABELS, type FundingClassification, type ProjectPartner } from "@/hooks/useProjects";

const db = supabase as any;

interface LedgerRow {
  id: string;
  account_id: string;
  transaction_date: string;
  debit: number;
  credit: number;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  batch_id: string | null;
  created_by: string | null;
  created_at: string;
  is_voided: boolean;
}

interface BatchRow {
  id: string;
  reference_number: string | null;
  description: string | null;
  batch_date: string;
  entry_type: string | null;
  approval_status: string | null;
  is_posted: boolean;
  posted_at: string | null;
  posted_by: string | null;
  created_by: string | null;
  branch_id: string | null;
}

interface AckRow {
  id: string;
  batch_id: string;
  acknowledged_by: string | null;
  acknowledged_at: string;
  note: string | null;
}

export interface RepaymentAuditEntry {
  batchId: string;
  partnerId: string | null;
  partnerName: string;
  date: string;
  amount: number;
  classification: FundingClassification | null;
  accountLabel: string;
  balanceBefore: number;
  balanceAfter: number;
  paymentAccountId: string | null;
  voided: boolean;
  batch: BatchRow | null;
  ack: AckRow | null;
  createdBy: string | null;
  description: string | null;
}

/**
 * Immutable audit view of every partner repayment: the liability balance before
 * and after the posting, the journal batch it settled through, and who created,
 * posted and acknowledged it.
 */
export function PartnerRepaymentAuditPanel({ partners }: { partners: ProjectPartner[] }) {
  const { format: money } = useCurrency();
  const { user, profile } = useAuth();
  const qc = useQueryClient();

  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  const [ackFilter, setAckFilter] = useState<"all" | "pending" | "acknowledged">("all");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const accountIds = useMemo(
    () =>
      partners.flatMap((p) =>
        [p.capital_account_id, p.loan_account_id, p.payable_account_id].filter(Boolean),
      ) as string[],
    [partners],
  );

  const partnerByAccount = useMemo(() => {
    const map = new Map<string, { partner: ProjectPartner; kind: FundingClassification }>();
    for (const p of partners) {
      if (p.capital_account_id) map.set(p.capital_account_id, { partner: p, kind: "capital" });
      if (p.loan_account_id) map.set(p.loan_account_id, { partner: p, kind: "loan" });
      if (p.payable_account_id) map.set(p.payable_account_id, { partner: p, kind: "payable" });
    }
    return map;
  }, [partners]);

  const ledgerQuery = useQuery({
    queryKey: ["partner-repayment-audit", accountIds],
    enabled: accountIds.length > 0,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data, error } = await db
        .from("account_transactions")
        .select(
          "id, account_id, transaction_date, debit, credit, description, reference_type, reference_id, batch_id, created_by, created_at, is_voided",
        )
        .in("account_id", accountIds)
        .order("transaction_date", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
  });

  const ledger = ledgerQuery.data ?? [];

  /** Running balance per partner account (credit-natural), captured before each settlement. */
  const entries: RepaymentAuditEntry[] = useMemo(() => {
    const running = new Map<string, number>();
    const out: RepaymentAuditEntry[] = [];
    for (const row of ledger) {
      const before = running.get(row.account_id) ?? 0;
      const delta = row.is_voided ? 0 : Number(row.credit) - Number(row.debit);
      const after = before + delta;
      running.set(row.account_id, after);

      if (row.reference_type !== "partner_settlement" || Number(row.debit) <= 0) continue;
      const meta = partnerByAccount.get(row.account_id);
      out.push({
        batchId: row.batch_id ?? row.id,
        partnerId: meta?.partner.id ?? row.reference_id,
        partnerName: meta?.partner.partner_name ?? "Unknown partner",
        date: row.transaction_date,
        amount: Number(row.debit),
        classification: meta?.kind ?? null,
        accountLabel: meta ? FUNDING_LABELS[meta.kind] : "Partner account",
        balanceBefore: before,
        balanceAfter: after,
        paymentAccountId: null,
        voided: row.is_voided,
        batch: null,
        ack: null,
        createdBy: row.created_by,
        description: row.description,
      });
    }
    return out.reverse();
  }, [ledger, partnerByAccount]);

  const batchIds = useMemo(
    () => Array.from(new Set(entries.map((e) => e.batchId).filter(Boolean))),
    [entries],
  );

  const metaQuery = useQuery({
    queryKey: ["partner-repayment-audit-meta", batchIds],
    enabled: batchIds.length > 0,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const [batches, acks] = await Promise.all([
        db
          .from("journal_entry_batches")
          .select(
            "id, reference_number, description, batch_date, entry_type, approval_status, is_posted, posted_at, posted_by, created_by, branch_id",
          )
          .in("id", batchIds),
        db
          .from("partner_settlement_acks")
          .select("id, batch_id, acknowledged_by, acknowledged_at, note")
          .in("batch_id", batchIds),
      ]);
      if (batches.error) throw batches.error;
      if (acks.error) throw acks.error;

      const batchRows = (batches.data ?? []) as BatchRow[];
      const ackRows = (acks.data ?? []) as AckRow[];
      const userIds = Array.from(
        new Set(
          [
            ...batchRows.flatMap((b) => [b.created_by, b.posted_by]),
            ...ackRows.map((a) => a.acknowledged_by),
          ].filter(Boolean) as string[],
        ),
      );
      let names = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await db.from("profiles").select("id, full_name").in("id", userIds);
        names = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name as string]));
      }
      return { batchRows, ackRows, names };
    },
  });

  const batchMap = useMemo(
    () => new Map((metaQuery.data?.batchRows ?? []).map((b) => [b.id, b])),
    [metaQuery.data],
  );
  const ackMap = useMemo(
    () => new Map((metaQuery.data?.ackRows ?? []).map((a) => [a.batch_id, a])),
    [metaQuery.data],
  );
  const nameOf = (id: string | null | undefined) =>
    (id && metaQuery.data?.names.get(id)) || (id ? "Unknown user" : "—");

  const rows = useMemo(
    () =>
      entries
        .map((e) => ({ ...e, batch: batchMap.get(e.batchId) ?? null, ack: ackMap.get(e.batchId) ?? null }))
        .filter((e) => partnerFilter === "all" || e.partnerId === partnerFilter)
        .filter((e) =>
          ackFilter === "all" ? true : ackFilter === "acknowledged" ? !!e.ack : !e.ack,
        ),
    [entries, batchMap, ackMap, partnerFilter, ackFilter],
  );

  const acknowledge = useMutation({
    mutationFn: async (entry: RepaymentAuditEntry) => {
      const { error } = await db.from("partner_settlement_acks").insert({
        tenant_id: profile?.tenant_id,
        batch_id: entry.batchId,
        partner_id: entry.partnerId,
        acknowledged_by: user?.id,
        note: noteDraft[entry.batchId] || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Repayment acknowledged.");
      qc.invalidateQueries({ queryKey: ["partner-repayment-audit-meta"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not acknowledge this repayment."),
  });

  const totals = useMemo(
    () => ({
      count: rows.length,
      amount: rows.reduce((s, r) => s + r.amount, 0),
      pending: rows.filter((r) => !r.ack).length,
    }),
    [rows],
  );

  const loading = ledgerQuery.isLoading || metaQuery.isLoading;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Repayment audit trail
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{totals.count} repayments</Badge>
            <Badge variant="secondary">{money(totals.amount)}</Badge>
            {totals.pending > 0 && <Badge variant="destructive">{totals.pending} unacknowledged</Badge>}
            <Select value={partnerFilter} onValueChange={setPartnerFilter}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All partners</SelectItem>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.partner_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ackFilter} onValueChange={(v) => setAckFilter(v as typeof ackFilter)}>
              <SelectTrigger className="h-8 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Awaiting acknowledgement</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading repayment history…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Settled against</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance before → after</TableHead>
                <TableHead>Journal reference</TableHead>
                <TableHead>Posted by</TableHead>
                <TableHead>Acknowledged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.batchId} className={r.voided ? "opacity-60" : undefined}>
                  <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                  <TableCell className="font-medium">{r.partnerName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.accountLabel}</TableCell>
                  <TableCell className="text-right font-medium">{money(r.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm">
                    <span className="text-muted-foreground">{money(r.balanceBefore)}</span>
                    <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" />
                    <span>{money(r.balanceAfter)}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-mono text-xs">{r.batch?.reference_number ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.batch?.is_posted ? "Posted" : "Not posted"}
                      {r.batch?.approval_status ? ` · ${r.batch.approval_status}` : ""}
                      {r.voided ? " · voided" : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{nameOf(r.batch?.posted_by ?? r.createdBy)}</div>
                    <div className="text-xs text-muted-foreground">
                      classified by {nameOf(r.batch?.created_by ?? r.createdBy)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.ack ? (
                      <div className="text-sm">
                        <span className="flex items-center gap-1 text-primary">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {nameOf(r.ack.acknowledged_by)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.ack.acknowledged_at).toLocaleString()}
                        </span>
                        {r.ack.note && (
                          <p className="text-xs text-muted-foreground">“{r.ack.note}”</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Input
                          value={noteDraft[r.batchId] ?? ""}
                          onChange={(e) =>
                            setNoteDraft((d) => ({ ...d, [r.batchId]: e.target.value }))
                          }
                          placeholder="Review note"
                          className="h-8 w-[140px] text-xs"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acknowledge.isPending}
                          onClick={() => acknowledge.mutate(r)}
                        >
                          <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Ack
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No repayments recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Balances are the partner's capital / loan / payable account balance immediately before and
          after each settlement posting. Entries are never edited — a correction is a new reversing
          journal entry.
        </p>
      </CardContent>
    </Card>
  );
}
