import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface MoyasarPayout {
  id: string;
  reference: string;
  date: string;
  gross: number;
  fees: number;
  transfer_fee: number;
  net: number;
  other_lines: number;
  other_types: string[];
  transactions: number;
  matched: number;
  unmatched_payments: number;
  period_from: string | null;
  period_to: string | null;
  recorded: boolean;
  invoice_url: string | null;
}
interface PayoutsReport {
  payouts: MoyasarPayout[];
  truncated: boolean;
  totals: { payouts_gross: number; payouts_fees: number; payouts_net: number; matbex_charges: number; matbex_refunds: number; matbex_net: number };
  balance: { not_paid_out: number; available: number } | null;
}

const fmt = (n: number) => `SAR ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Moyasar payouts for the accountant: what Moyasar paid to the bank in a period (gross card
 * takings, fees, net), matched to the Moyasar payments Matbex recorded, and one click to record a
 * payout as the bank deposit that clears 1015. Read from the business's own Moyasar account.
 */
export function MoyasarPayoutsPanel({ onRecord }: { onRecord: (p: MoyasarPayout) => void }) {
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const report = useQuery({
    queryKey: ["moyasar-payouts", from, to],
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.functions.invoke("moyasar-payouts", { body: { from, to } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.clone === "function" ? await ctx.clone().json().catch(() => null) : null;
        throw new Error(body?.error || error.message);
      }
      return data as PayoutsReport;
    },
  });

  const r = report.data;
  const diff = r ? Math.round((r.totals.matbex_net - r.totals.payouts_gross) * 100) / 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Moyasar payouts</CardTitle>
        <CardDescription>
          Online card payments (POS QR and online orders) that Moyasar paid to your bank, compared with the Moyasar takings
          recorded in Matbex. Record each payout once to clear it from Card Settlements Receivable (1015).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label htmlFor="mp-from">From</Label><Input id="mp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" /></div>
          <div className="space-y-1"><Label htmlFor="mp-to">To</Label><Input id="mp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" /></div>
          <Button variant="outline" onClick={() => report.refetch()} disabled={report.isFetching}>
            {report.isFetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Refresh
          </Button>
        </div>

        {report.isError && <p className="text-sm text-destructive">{(report.error as Error).message}</p>}
        {report.isLoading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading Moyasar…</p>}

        {r && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div className="rounded-md border p-3"><p className="text-muted-foreground">Card takings in Matbex</p><p className="font-semibold tabular-nums">{fmt(r.totals.matbex_net)}</p><p className="text-xs text-muted-foreground">{fmt(r.totals.matbex_charges)} paid − {fmt(r.totals.matbex_refunds)} refunded</p></div>
              <div className="rounded-md border p-3"><p className="text-muted-foreground">Paid out by Moyasar (gross)</p><p className="font-semibold tabular-nums">{fmt(r.totals.payouts_gross)}</p><p className="text-xs text-muted-foreground">fees {fmt(r.totals.payouts_fees)} · to bank {fmt(r.totals.payouts_net)}</p></div>
              <div className="rounded-md border p-3"><p className="text-muted-foreground">Not paid out yet</p><p className="font-semibold tabular-nums">{r.balance ? fmt(r.balance.not_paid_out) : "—"}</p><p className="text-xs text-muted-foreground">waiting in Moyasar</p></div>
              <div className="rounded-md border p-3"><p className="text-muted-foreground">Takings not in a payout</p><p className={`font-semibold tabular-nums ${Math.abs(diff) > 0.005 ? "text-warning" : ""}`}>{fmt(diff)}</p><p className="text-xs text-muted-foreground">usually still waiting; check if it stays</p></div>
            </div>

            {r.truncated && <p className="text-xs text-warning">Showing the first payouts only; choose a shorter period to see all.</p>}
            {r.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Moyasar payouts in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payout date</TableHead>
                      <TableHead className="text-right">Card takings</TableHead>
                      <TableHead className="text-right">Moyasar fees</TableHead>
                      <TableHead className="text-right">To bank</TableHead>
                      <TableHead>Payments</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.payouts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {p.date}
                          {p.period_from && <span className="block text-xs text-muted-foreground">sales {p.period_from} → {p.period_to}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.gross)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(p.fees)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{fmt(p.net)}</TableCell>
                        <TableCell className="text-xs">
                          {p.matched}/{p.transactions} in Matbex
                          {p.unmatched_payments > 0 && <span className="block text-warning">{p.unmatched_payments} payment(s) not from Matbex</span>}
                          {Math.abs(p.other_lines) > 0.005 && <span className="block text-warning">{fmt(p.other_lines)} other ({p.other_types.join(", ") || "adjustments"})</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.recorded
                            ? <Badge variant="secondary">Recorded</Badge>
                            : <Button size="sm" onClick={() => onRecord(p)} disabled={!(p.gross > 0)}>Record deposit</Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
