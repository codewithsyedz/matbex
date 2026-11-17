import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { Info, Loader2, RefreshCw } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { planLabel } from "@/lib/billing/planLabel";

interface MonthRow {
  month: string; mrr: number; paying: number;
  new_mrr: number; expansion_mrr: number; contraction_mrr: number; churned_mrr: number;
  new_businesses: number; churned_businesses: number;
  cash_collected: number; net_revenue: number; refunds: number;
}
interface Revenue {
  generated_at: string;
  current_month: string;
  kpis: {
    mrr: number; arr: number; paying: number; arpa: number;
    cash_this_month: number; net_revenue_this_month: number; refunds_this_month: number;
    trials: number; past_due: number; renewals_due_7d: number; renewals_due_7d_value: number;
    trial_cohort: number; trial_converted: number;
  };
  months: MonthRow[];
  by_plan: { plan: string; mrr: number }[];
  top: { tenant_id: string; name: string; plan: string | null; status: string | null; paid_until: string | null; mrr: number }[];
  renewals_due: { tenant_id: string; name: string; plan: string | null; paid_until: string; status: string }[];
  legacy: { count: number; list_price_mrr: number };
}

const sar = (n: number, digits = 0) =>
  `SAR ${Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const short = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `${Math.round(n)}`);
const monthName = (key: string, long = false) => format(new Date(`${key}-01T12:00:00`), long ? "MMMM yyyy" : "MMM");

async function fetchRevenue(): Promise<Revenue> {
  const { data, error } = await db.functions.invoke("admin-revenue", { body: {} });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((b: { error?: string }) => b?.error).catch(() => null) : null;
    throw new Error(msg || error.message);
  }
  return data as Revenue;
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="border-border/40">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

/** Tooltip in text tokens; the coloured swatch carries the series identity. */
function Tip({ active, payload, label, rows }: {
  active?: boolean; label?: string;
  payload?: { payload: MonthRow }[];
  rows: (m: MonthRow) => { swatch?: string; name: string; value: string }[];
}) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label ? monthName(label, true) : ""}</p>
      {rows(m).map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {r.swatch && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: r.swatch }} />}{r.name}
          </span>
          <span className="tabular-nums text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const axis = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };

export default function AdminRevenue() {
  const q = useQuery({ queryKey: ["admin-revenue"], queryFn: fetchRevenue, staleTime: 60_000 });

  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? "Could not load revenue"}</p>;
  const r = q.data;
  const k = r.kpis;
  const movement = r.months.map((m) => ({ ...m, gain: m.new_mrr + m.expansion_mrr, loss: -(m.contraction_mrr + m.churned_mrr) }));
  const conversion = k.trial_cohort ? Math.round((k.trial_converted / k.trial_cohort) * 100) : null;
  const hasHistory = r.months.some((m) => m.mrr > 0 || m.cash_collected > 0);

  return (
    <div className="admin-revenue space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Revenue</h1>
          <p>What businesses pay Matbex, from payments received. Amounts exclude VAT unless marked as cash.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${q.isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Kpi label="MRR" value={sar(k.mrr)} note={`ARR ${sar(k.arr)}`} />
        <Kpi label="Paying businesses" value={String(k.paying)} note={k.paying ? `${sar(k.arpa)} average a month` : undefined} />
        <Kpi label={`Cash collected, ${monthName(r.current_month, true)}`} value={sar(k.cash_this_month)}
          note={`incl. VAT${k.refunds_this_month ? ` · ${sar(k.refunds_this_month)} refunded` : ""}`} />
        <Kpi label="Trial to paid (last 90 days)" value={conversion == null ? "—" : `${conversion}%`}
          note={`${k.trial_converted} of ${k.trial_cohort} businesses · ${k.trials} on trial now`} />
        <Kpi label="Renewals due in 7 days" value={String(k.renewals_due_7d)} note={k.renewals_due_7d ? `${sar(k.renewals_due_7d_value)} MRR at stake` : undefined} />
        <Kpi label="Past due" value={String(k.past_due)} note="paid period ended, not renewed" />
        <Kpi label={`Net revenue, ${monthName(r.current_month, true)}`} value={sar(k.net_revenue_this_month)} note="excl. VAT, after refunds" />
        <Kpi label="MRR by plan" value={r.by_plan.length ? planLabel(r.by_plan[0].plan) : "—"}
          note={r.by_plan.map((p) => `${planLabel(p.plan)} ${sar(p.mrr)}`).join(" · ") || "no paying plans yet"} />
      </div>

      {r.legacy.count > 0 && (
        <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {r.legacy.count} paid business{r.legacy.count > 1 ? "es are" : " is"} still billed outside Matbex's payments (old Stripe
          accounts, list price {sar(r.legacy.list_price_mrr)} a month) and not counted above until they pay through Matbex.
        </p>
      )}

      {!hasHistory ? (
        <Card className="border-border/40"><CardContent className="p-6 text-sm text-muted-foreground">No payments yet in the last 12 months.</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">MRR, last 12 months</CardTitle>
              <CardDescription>Monthly recurring revenue at each month's end (this month: today).</CardDescription>
            </CardHeader>
            <CardContent className="h-64 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={r.months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                  <XAxis dataKey="month" tickFormatter={(m) => monthName(m)} tick={axis} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={short} tick={axis} axisLine={false} tickLine={false} width={44} />
                  <Tooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }}
                    content={<Tip rows={(m) => [
                      { swatch: "var(--rev-mrr)", name: "MRR", value: sar(m.mrr) },
                      { name: "Paying businesses", value: String(m.paying) },
                    ]} />} />
                  <Area type="monotone" dataKey="mrr" stroke="var(--rev-mrr)" strokeWidth={2} fill="var(--rev-mrr)" fillOpacity={0.12}
                    dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-border/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">MRR gained and lost</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--rev-gain)" }} />New and upgrades</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--rev-loss)" }} />Downgrades and churn</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="h-64 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={movement} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%" stackOffset="sign">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                  <XAxis dataKey="month" tickFormatter={(m) => monthName(m)} tick={axis} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={short} tick={axis} axisLine={false} tickLine={false} width={44} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                    content={<Tip rows={(m) => [
                      { swatch: "var(--rev-gain)", name: `New (${m.new_businesses})`, value: sar(m.new_mrr) },
                      { swatch: "var(--rev-gain)", name: "Upgrades", value: sar(m.expansion_mrr) },
                      { swatch: "var(--rev-loss)", name: "Downgrades", value: `− ${sar(m.contraction_mrr)}` },
                      { swatch: "var(--rev-loss)", name: `Churned (${m.churned_businesses})`, value: `− ${sar(m.churned_mrr)}` },
                    ]} />} />
                  <Bar dataKey="gain" stackId="m" fill="var(--rev-gain)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="loss" stackId="m" fill="var(--rev-loss)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">By month</CardTitle>
          <CardDescription>Newest first. Cash and refunds include VAT; net revenue excludes it.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">MRR</TableHead>
                <TableHead className="text-right">Paying</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Churned</TableHead>
                <TableHead className="text-right">Cash collected</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Net revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...r.months].reverse().map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="whitespace-nowrap">{monthName(m.month, true)}</TableCell>
                  <TableCell className="text-right tabular-nums">{sar(m.mrr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.paying}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.new_businesses || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.churned_businesses || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.cash_collected ? sar(m.cash_collected, 2) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.refunds ? sar(m.refunds, 2) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.net_revenue ? sar(m.net_revenue, 2) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top businesses by MRR</CardTitle>
          </CardHeader>
          <CardContent>
            {r.top.length === 0 ? <p className="text-sm text-muted-foreground">No paying businesses yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Plan</TableHead><TableHead>Paid until</TableHead><TableHead className="text-right">MRR</TableHead></TableRow></TableHeader>
                <TableBody>
                  {r.top.map((t) => (
                    <TableRow key={t.tenant_id}>
                      <TableCell><Link to={`/admin/tenants/${t.tenant_id}`} className="font-medium hover:underline">{t.name}</Link></TableCell>
                      <TableCell>{planLabel(t.plan)}</TableCell>
                      <TableCell className="whitespace-nowrap">{t.paid_until ? format(new Date(t.paid_until), "d MMM yyyy") : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{sar(t.mrr)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Renewals due in 7 days</CardTitle>
            <CardDescription>Businesses whose paid period ends soon; they get reminder emails.</CardDescription>
          </CardHeader>
          <CardContent>
            {r.renewals_due.length === 0 ? <p className="text-sm text-muted-foreground">None this week.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Plan</TableHead><TableHead>Paid until</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {r.renewals_due.map((t) => (
                    <TableRow key={t.tenant_id}>
                      <TableCell><Link to={`/admin/tenants/${t.tenant_id}`} className="font-medium hover:underline">{t.name}</Link></TableCell>
                      <TableCell>{planLabel(t.plan)}</TableCell>
                      <TableCell className="whitespace-nowrap">{format(new Date(t.paid_until), "d MMM yyyy")}</TableCell>
                      <TableCell><Badge variant={t.status === "active" ? "secondary" : "outline"} className="capitalize">{t.status.replace("_", " ")}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        MRR spreads each payment over the period it pays for (a yearly payment counts 1/12 a month), net of refunds.
        Updated {format(new Date(r.generated_at), "d MMM yyyy, HH:mm")}.
      </p>
    </div>
  );
}
