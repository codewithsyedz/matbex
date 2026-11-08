import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/hooks/useCurrency";
import {
  FUNDING_LABELS,
  TREATMENT_LABELS,
  type ProjectPartner,
  type ProjectTransaction,
} from "@/hooks/useProjects";

const db = supabase as any;

interface LedgerRow {
  id: string;
  account_id: string;
  transaction_date: string;
  debit: number;
  credit: number;
  description: string | null;
  reference_type: string | null;
  batch_id: string | null;
  is_voided: boolean;
}

type StatusFilter = "all" | "needs_review" | "classified" | "posted" | "rejected" | "voided";

export function PartnerDrilldownDialog({
  partner,
  transactions,
  open,
  onOpenChange,
}: {
  partner: ProjectPartner | null;
  transactions: ProjectTransaction[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { format: money } = useCurrency();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [classification, setClassification] = useState<"all" | "capital" | "loan" | "payable" | "none">(
    "all",
  );

  const accountIds = useMemo(
    () =>
      [partner?.capital_account_id, partner?.loan_account_id, partner?.payable_account_id].filter(
        Boolean,
      ) as string[],
    [partner],
  );

  const accountLabel = (id: string) => {
    if (id === partner?.capital_account_id) return "Capital (equity)";
    if (id === partner?.loan_account_id) return "Loan (liability)";
    if (id === partner?.payable_account_id) return "Due to partner";
    return "Other";
  };

  const ledgerQuery = useQuery({
    queryKey: ["partner-drilldown", partner?.id, accountIds],
    enabled: open && accountIds.length > 0,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data, error } = await db
        .from("account_transactions")
        .select(
          "id, account_id, transaction_date, debit, credit, description, reference_type, batch_id, is_voided",
        )
        .in("account_id", accountIds)
        .order("transaction_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
  });

  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);

  /** Costs the partner paid personally, with their funding classification. */
  const fundingEntries = useMemo(
    () =>
      transactions
        .filter((t) => t.paid_by === "partner" && t.partner_id === partner?.id)
        .filter((t) => inRange(t.txn_date))
        .filter((t) => status === "all" || t.status === status)
        .filter((t) =>
          classification === "all"
            ? true
            : classification === "none"
              ? !t.funding_classification
              : t.funding_classification === classification,
        ),
    [transactions, partner?.id, from, to, status, classification],
  );

  const ledgerRows = useMemo(
    () => (ledgerQuery.data ?? []).filter((r) => inRange(r.transaction_date)),
    [ledgerQuery.data, from, to],
  );

  const repayments = useMemo(
    () => ledgerRows.filter((r) => r.reference_type === "partner_settlement"),
    [ledgerRows],
  );

  const unclassified = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.partner_id === partner?.id &&
            t.status !== "voided" &&
            (!t.funding_classification || t.status === "needs_review" || !t.treatment),
        )
        .filter((t) => inRange(t.txn_date)),
    [transactions, partner?.id, from, to],
  );

  const totals = useMemo(() => {
    const funded = fundingEntries.reduce((s, t) => s + Number(t.amount), 0);
    const repaid = repayments.reduce((s, r) => s + Number(r.debit), 0);
    const byAccount = accountIds.map((id) => {
      const rows = ledgerRows.filter((r) => r.account_id === id && !r.is_voided);
      const debit = rows.reduce((s, r) => s + Number(r.debit), 0);
      const credit = rows.reduce((s, r) => s + Number(r.credit), 0);
      return { id, label: accountLabel(id), balance: credit - debit, debit, credit };
    });
    return {
      funded,
      repaid,
      unclassified: unclassified.reduce((s, t) => s + Number(t.amount), 0),
      byAccount,
    };
  }, [fundingEntries, repayments, unclassified, ledgerRows, accountIds]);

  const exportCsv = () => {
    const lines: string[] = ["Section,Date,Reference,Description,Classification,Status,Debit,Credit,Amount"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    fundingEntries.forEach((t) =>
      lines.push(
        [
          "Funding",
          t.txn_date,
          esc(t.vendor_name ?? ""),
          esc(t.description ?? ""),
          t.funding_classification ?? "unclassified",
          t.status,
          "",
          "",
          Number(t.amount).toFixed(2),
        ].join(","),
      ),
    );
    repayments.forEach((r) =>
      lines.push(
        [
          "Repayment",
          r.transaction_date,
          esc(accountLabel(r.account_id)),
          esc(r.description ?? ""),
          "",
          r.is_voided ? "voided" : "posted",
          Number(r.debit).toFixed(2),
          Number(r.credit).toFixed(2),
          "",
        ].join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `partner-${partner?.partner_name ?? "statement"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{partner?.partner_name ?? "Partner"} — funding drill-down</DialogTitle>
          <DialogDescription>
            Every entry that moves this partner's capital, loan and payable accounts, plus items still
            waiting to be classified.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[72vh] pr-3">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="needs_review">Needs review</SelectItem>
                    <SelectItem value="classified">Classified</SelectItem>
                    <SelectItem value="posted">Posted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="voided">Voided</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Treatment of funding</Label>
                <Select value={classification} onValueChange={(v) => setClassification(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="capital">{FUNDING_LABELS.capital}</SelectItem>
                    <SelectItem value="loan">{FUNDING_LABELS.loan}</SelectItem>
                    <SelectItem value="payable">{FUNDING_LABELS.payable}</SelectItem>
                    <SelectItem value="none">Unclassified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Funded (filtered)" value={money(totals.funded)} />
              <Kpi label="Repaid (filtered)" value={money(totals.repaid)} />
              <Kpi label="Unclassified" value={money(totals.unclassified)} />
              <Kpi
                label="Ownership"
                value={`${Number(partner?.ownership_pct ?? 0).toFixed(2)}%`}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {totals.byAccount.map((a) => (
                <Card key={a.id}>
                  <CardContent className="pt-6">
                    <p className="text-xs font-light text-muted-foreground">{a.label}</p>
                    <p className="mt-1 text-lg font-medium">{money(a.balance)}</p>
                    <p className="text-xs text-muted-foreground">
                      DR {money(a.debit)} · CR {money(a.credit)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>

            <Tabs defaultValue="funding">
              <TabsList>
                <TabsTrigger value="funding">Funding entries ({fundingEntries.length})</TabsTrigger>
                <TabsTrigger value="repayments">Repayments ({repayments.length})</TabsTrigger>
                <TabsTrigger value="unclassified">Unclassified ({unclassified.length})</TabsTrigger>
                <TabsTrigger value="ledger">Account ledger ({ledgerRows.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="funding" className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Treatment</TableHead>
                      <TableHead>Classified as</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fundingEntries.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.txn_date}</TableCell>
                        <TableCell>{t.vendor_name ?? "—"}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{t.description ?? "—"}</TableCell>
                        <TableCell>{t.treatment ? TREATMENT_LABELS[t.treatment] : "—"}</TableCell>
                        <TableCell>
                          {t.funding_classification ? (
                            <Badge variant="secondary">
                              {FUNDING_LABELS[t.funding_classification]}
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Unclassified</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{t.status.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{money(Number(t.amount))}</TableCell>
                      </TableRow>
                    ))}
                    {fundingEntries.length === 0 && <Empty cols={7} />}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="repayments" className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Settled against</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {repayments.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.transaction_date}</TableCell>
                        <TableCell>{accountLabel(r.account_id)}</TableCell>
                        <TableCell className="max-w-[280px] truncate">{r.description ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={r.is_voided ? "destructive" : "secondary"}>
                            {r.is_voided ? "Voided" : "Posted"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{money(Number(r.debit))}</TableCell>
                      </TableRow>
                    ))}
                    {repayments.length === 0 && <Empty cols={5} />}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="unclassified" className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Missing</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unclassified.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.txn_date}</TableCell>
                        <TableCell>{t.vendor_name ?? "—"}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{t.description ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[!t.funding_classification && "funding treatment", !t.treatment && "cost treatment"]
                            .filter(Boolean)
                            .join(", ") || "review"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{t.status.replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{money(Number(t.amount))}</TableCell>
                      </TableRow>
                    ))}
                    {unclassified.length === 0 && <Empty cols={6} label="Nothing pending." />}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="ledger" className="mt-3">
                {ledgerQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading ledger…
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerRows.map((r) => (
                        <TableRow key={r.id} className={r.is_voided ? "opacity-50 line-through" : undefined}>
                          <TableCell>{r.transaction_date}</TableCell>
                          <TableCell>{accountLabel(r.account_id)}</TableCell>
                          <TableCell className="max-w-[260px] truncate">{r.description ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {(r.reference_type ?? "—").replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="text-right">{money(Number(r.debit))}</TableCell>
                          <TableCell className="text-right">{money(Number(r.credit))}</TableCell>
                        </TableRow>
                      ))}
                      {ledgerRows.length === 0 && <Empty cols={6} />}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-light text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

function Empty({ cols, label = "No entries for these filters." }: { cols: number; label?: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center text-sm text-muted-foreground">
        {label}
      </TableCell>
    </TableRow>
  );
}
