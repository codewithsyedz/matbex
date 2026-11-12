import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChannelProfitability } from "@/hooks/useChannelProfitability";
import { useAggregatorSettlements, type SettlementChannel } from "@/hooks/useAggregatorSettlements";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useAuth } from "@/contexts/AuthContext";
import { LockedFeatureScreen } from "@/components/LockedFeatureScreen";
import { BarChart3, CheckCircle2, Plus, Receipt } from "lucide-react";

const RIYAL = "﷼";
const fmt = (n: number) =>
  `${RIYAL} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CHANNEL_LABEL: Record<string, string> = {
  direct: "Direct",
  hungerstation: "HungerStation",
  jahez: "Jahez",
  mrsool: "Mrsool",
  talabat: "Talabat",
  qr: "QR Dine-in",
  waiter: "Waiter",
};

const CHANNEL_DOT: Record<string, string> = {
  direct: "bg-emerald-500",
  hungerstation: "bg-emerald-600",
  jahez: "bg-rose-500",
  mrsool: "bg-orange-500",
  talabat: "bg-amber-500",
  qr: "bg-primary",
  waiter: "bg-blue-500",
};

function startOfMonth(d: Date) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d: Date) { const x = new Date(d); x.setMonth(x.getMonth()+1, 0); x.setHours(23,59,59,999); return x; }

export default function ChannelPnL() {
  const enabled = useFeatureFlag("channel_pnl_enabled", true);
  const { isOwner, isManager } = useAuth();
  const canEdit = isOwner || isManager;

  const [monthAnchor, setMonthAnchor] = useState<Date>(new Date());
  const from = useMemo(() => startOfMonth(monthAnchor), [monthAnchor]);
  const to = useMemo(() => endOfMonth(monthAnchor), [monthAnchor]);
  const monthLabel = monthAnchor.toLocaleString(undefined, { month: "long", year: "numeric" });

  const { channels, totals, isLoading } = useChannelProfitability(from, to);

  if (!enabled) {
    return (
      <LockedFeatureScreen
        featureName="Channel Profitability"
        description="Track revenue, commissions and margin per delivery channel."
        featureKey="channel_pnl_enabled"
      />
    );
  }

  const margin = totals.gross > 0 ? (totals.net / totals.gross) * 100 : 0;

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <header className="mb-6 fade-slide-in">
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Channel Profitability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Delivery-app payouts marked reconciled: gross, commission and what reached the bank — {monthLabel}
        </p>
      </header>

      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth()-1, 1))}>← Prev</Button>
        <Button variant="outline" size="sm" onClick={() => setMonthAnchor(new Date())}>This month</Button>
        <Button variant="outline" size="sm" onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth()+1, 1))}>Next →</Button>
      </div>

      <Tabs defaultValue="report">
        <TabsList>
          <TabsTrigger value="report" className="gap-2"><BarChart3 className="h-4 w-4" /> Profitability</TabsTrigger>
          <TabsTrigger value="settlements" className="gap-2"><Receipt className="h-4 w-4" /> Settlements</TabsTrigger>
        </TabsList>

        <TabsContent value="report" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label="Gross Revenue" value={fmt(totals.gross)} sub={`${totals.orders} orders`} />
            <KpiCard label="Commission Paid" value={fmt(totals.commission)} sub="Aggregator fees" tone="negative" />
            <KpiCard label="Blended Margin" value={`${margin.toFixed(1)}%`} sub={`Net ${fmt(totals.net)}`} tone="positive" />
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base font-medium">By Channel</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">No channel activity this month. Aggregator orders will appear here once paid.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">Comm %</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">AOV</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {channels.map((r) => {
                      const commPct = r.gross > 0 ? (r.commission / r.gross) * 100 : 0;
                      return (
                        <TableRow key={r.channel}>
                          <TableCell>
                            <span className="inline-flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${CHANNEL_DOT[r.channel] ?? "bg-muted"}`} />
                              {CHANNEL_LABEL[r.channel] ?? r.channel}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{r.orders}</TableCell>
                          <TableCell className="text-right">{fmt(r.gross)}</TableCell>
                          <TableCell className="text-right text-destructive">{fmt(r.commission)}</TableCell>
                          <TableCell className="text-right">{commPct.toFixed(1)}%</TableCell>
                          <TableCell className="text-right font-medium">{fmt(r.net)}</TableCell>
                          <TableCell className="text-right">{fmt(r.aov)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settlements" className="mt-6">
          <SettlementsPanel canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  const color = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SettlementsPanel({ canEdit }: { canEdit: boolean }) {
  const { list, create, reconcile, softDelete } = useAggregatorSettlements();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<SettlementChannel>("hungerstation");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0,10));
  const [gross, setGross] = useState("0");
  const [commission, setCommission] = useState("0");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [bankCode, setBankCode] = useState("1010");

  // Where the payout landed: active cash/bank accounts (1000-1099) of this business.
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["cash-bank-accounts"],
    queryFn: async () => {
      const { data, error } = await db
        .from("chart_of_accounts")
        .select("account_code, account_name")
        .eq("account_type", "asset")
        .eq("is_active", true)
        .gte("account_code", "1000")
        .lte("account_code", "1099")
        .order("account_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const grossNum = Number(gross) || 0;
  const commissionNum = Number(commission) || 0;
  const net = Math.round((grossNum - commissionNum) * 100) / 100;
  const amountsOk = grossNum > 0 && commissionNum >= 0 && net >= 0;

  const submit = async () => {
    await create.mutateAsync({
      channel,
      settlement_date: date,
      gross_amount: Number(gross) || 0,
      commission_amount: Number(commission) || 0,
      net_payout: net,
      bank_account_code: bankCode,
      reference: reference || undefined,
      notes: notes || undefined,
    });
    setOpen(false);
    setGross("0"); setCommission("0"); setReference(""); setNotes("");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-medium">Aggregator Settlements</CardTitle>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Record settlement</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Record aggregator payout</DialogTitle></DialogHeader>
              <ScrollArea className="max-h-[70vh]">
                <div className="space-y-3 pr-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Channel</Label>
                      <Select value={channel} onValueChange={(v) => setChannel(v as SettlementChannel)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hungerstation">HungerStation</SelectItem>
                          <SelectItem value="jahez">Jahez</SelectItem>
                          <SelectItem value="mrsool">Mrsool</SelectItem>
                          <SelectItem value="toyou">ToYou</SelectItem>
                          <SelectItem value="carriage">Carriage</SelectItem>
                          <SelectItem value="talabat">Talabat</SelectItem>
                          <SelectItem value="uber_eats">Uber Eats</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Settlement date</Label>
                      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Gross (﷼)</Label>
                    <Input type="number" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Commission (﷼)</Label>
                    <Input type="number" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3 text-sm flex justify-between">
                    <span className="text-muted-foreground">Net payout</span>
                    <span className={net < 0 ? "font-medium text-destructive" : "font-medium"}>{fmt(net)}</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Paid into</Label>
                    <Select value={bankCode} onValueChange={setBankCode}>
                      <SelectTrigger><SelectValue placeholder="Bank account" /></SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((a) => (
                          <SelectItem key={a.account_code} value={a.account_code}>
                            {a.account_code} {a.account_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      When reconciled: net to this account, commission to Delivery Platform Commissions, and the
                      gross clears Delivery Sales Receivable (1100) booked at End of Day.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reference</Label>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Statement #" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>
              </ScrollArea>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={submit} disabled={create.isPending || !amountsOk || !bankCode}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (list.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No settlements recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.settlement_date}</TableCell>
                  <TableCell>{CHANNEL_LABEL[s.channel]}</TableCell>
                  <TableCell className="text-muted-foreground">{s.reference ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(s.gross_amount))}</TableCell>
                  <TableCell className="text-right text-destructive">{fmt(Number(s.commission_amount))}</TableCell>
                  <TableCell className="text-right font-medium">{fmt(Number(s.net_payout))}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === "reconciled" ? "default" : s.status === "disputed" ? "destructive" : "secondary"}>
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && s.status === "pending" && (
                      <Button size="sm" variant="ghost" className="gap-1" onClick={() => reconcile.mutate(s.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Reconcile
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}