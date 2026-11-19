import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { planLabel } from "@/lib/billing/planLabel";
import { costBreakdown, DEFAULT_COST_MODEL, type CostModel, type TenantCostRow } from "@/lib/admin/tenantCosts";

const sar = (n: number, d = 0) => `SAR ${Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export default function AdminTenantCosts() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(30);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const model = useQuery({
    queryKey: ["cost-model"],
    queryFn: async () => {
      const { data } = await db.from("platform_settings").select("value").eq("key", "cost_model").maybeSingle();
      return { ...DEFAULT_COST_MODEL, ...((data?.value ?? {}) as Partial<CostModel>) } as CostModel;
    },
  });
  const rows = useQuery({
    queryKey: ["admin-tenant-costs", days],
    queryFn: async () => {
      const { data, error } = await db.rpc("admin_tenant_costs", { _days: days });
      if (error) throw error;
      return (data ?? []) as unknown as TenantCostRow[];
    },
  });

  const computed = useMemo(() => {
    if (!rows.data || !model.data) return [];
    return rows.data.map((r) => ({ r, c: costBreakdown(r, model.data, days) }))
      .sort((a, b) => b.c.revenue - a.c.revenue || a.r.name.localeCompare(b.r.name));
  }, [rows.data, model.data, days]);
  const shown = computed.filter(({ r }) => r.name.toLowerCase().includes(search.trim().toLowerCase()));
  const totals = computed.reduce((t, { c }) => ({
    revenue: t.revenue + c.revenue, infra: t.infra + c.infra, ai: t.ai + c.ai, fees: t.fees + c.fees, cost: t.cost + c.total,
  }), { revenue: 0, infra: 0, ai: 0, fees: 0, cost: 0 });
  const margin = totals.revenue - totals.cost;

  return (
    <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Tenant costs</h1>
          <p>What each business paid Matbex and what it cost to serve: infrastructure, AI and card fees.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>Last {d} days</Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4 mr-1" />Rates</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {[
          { label: "Received (excl. VAT)", value: sar(totals.revenue), note: "subscription payments less refunds" },
          { label: "Cost to serve", value: sar(totals.cost), note: `infra ${sar(totals.infra)} · AI ${sar(totals.ai, 2)} · fees ${sar(totals.fees, 2)}` },
          { label: "Margin", value: sar(margin), note: totals.revenue > 0 ? `${((margin / totals.revenue) * 100).toFixed(1)}% of received` : "no payments in the period" },
          { label: "AI and card fees", value: sar(totals.ai + totals.fees, 2), note: "priced with the rates below" },
        ].map((k) => (
          <Card key={k.label} className="border-border/40">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{k.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{k.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/40">
        <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base font-medium">Per business, last {days} days</CardTitle>
            <CardDescription>Received = what the business actually paid Matbex (excl. VAT), not its plan's list price.</CardDescription>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search businesses…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
        </CardHeader>
        <CardContent>
          {rows.isLoading || model.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : rows.error ? (
            <p className="text-sm text-destructive">{(rows.error as Error).message}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Infra (est.)</TableHead>
                  <TableHead className="text-right">AI</TableHead>
                  <TableHead className="text-right">Card fees</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Usage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ r, c }) => (
                  <TableRow key={r.tenant_id}>
                    <TableCell>
                      <Link to={`/admin/tenants/${r.tenant_id}`} className="font-medium hover:underline">{r.name}</Link>
                      <div className="text-xs text-muted-foreground">{planLabel(r.plan)} · list {sar(Number(r.plan_price))}/branch/month · {r.status}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{sar(c.revenue, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{sar(c.infra, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sar(c.ai, 2)}
                      {c.aiScans > 0 && <div className="text-xs text-muted-foreground">{c.aiScans} scan{c.aiScans > 1 ? "s" : ""}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sar(c.fees, 2)}
                      {r.moyasar_payments > 0 && <div className="text-xs text-muted-foreground">{r.moyasar_payments} payment{r.moyasar_payments > 1 ? "s" : ""}</div>}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${c.margin < 0 ? "text-destructive" : ""}`}>
                      {sar(c.margin, 2)}
                      {c.revenue > 0 && <div className="text-xs text-muted-foreground">{((c.margin / c.revenue) * 100).toFixed(0)}%</div>}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                      {r.users} users · {r.branches} branch{r.branches === 1 ? "" : "es"} · {r.sales.toLocaleString("en-US")} sales
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {model.data && (
        <p className="text-xs text-muted-foreground">
          AI: invoice scans priced per model ({Object.entries(model.data.model_prices).map(([m, [i, o]]) => `${m} $${i}/$${o} per million tokens`).join("; ")}) at {model.data.usd_to_sar} SAR/USD.
          Card fees: {model.data.moyasar_pct}% + SAR {model.data.moyasar_fixed_sar} per Moyasar payment (Matbex's own account; restaurants' card payments use their own Moyasar accounts).
          Infrastructure is an estimate; set the rates to your actual invoices under Rates.
        </p>
      )}

      {model.data && (
        <RatesDialog open={settingsOpen} onOpenChange={setSettingsOpen} model={model.data}
          onSaved={() => { void qc.invalidateQueries({ queryKey: ["cost-model"] }); }} />
      )}
    </div>
  );
}

function RatesDialog({ open, onOpenChange, model, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; model: CostModel; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const flat: Record<string, string> = {};
    for (const [k, val] of Object.entries(model)) if (typeof val === "number") flat[k] = String(val);
    for (const [m, [i, o]] of Object.entries(model.model_prices)) { flat[`in:${m}`] = String(i); flat[`out:${m}`] = String(o); }
    setV(flat);
  }, [open, model]);

  const save = useMutation({
    mutationFn: async () => {
      const next: CostModel = { ...model, model_prices: { ...model.model_prices } };
      for (const [k, s] of Object.entries(v)) {
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) throw new Error(`"${k}" must be a number of 0 or more`);
        if (k.startsWith("in:")) next.model_prices[k.slice(3)] = [n, next.model_prices[k.slice(3)]?.[1] ?? 0];
        else if (k.startsWith("out:")) next.model_prices[k.slice(4)] = [next.model_prices[k.slice(4)]?.[0] ?? 0, n];
        else (next as unknown as Record<string, number>)[k] = n;
      }
      const { error } = await db.from("platform_settings").upsert(
        { key: "cost_model", value: next as unknown as Record<string, unknown>, is_secret: false, description: "Tenant Costs rates (infra estimates, AI model prices, Moyasar fees)" },
        { onConflict: "key" },
      );
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Rates saved"); onOpenChange(false); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const field = (k: string, label: string) => (
    <div key={k} className="space-y-1">
      <Label htmlFor={`rate-${k}`} className="text-xs">{label}</Label>
      <Input id={`rate-${k}`} type="number" min={0} step="0.01" value={v[k] ?? ""} onChange={(e) => setV((cur) => ({ ...cur, [k]: e.target.value }))} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cost rates</DialogTitle>
          <DialogDescription>Used to price each business's usage. Set them from your Moyasar contract and hosting and Anthropic invoices.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Card fees (Matbex's Moyasar account)</p>
            <div className="grid grid-cols-2 gap-3">{field("moyasar_pct", "Percentage per payment (%)")}{field("moyasar_fixed_sar", "Fixed per payment (SAR)")}</div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">AI (USD per million tokens)</p>
            <div className="grid grid-cols-2 gap-3">
              {Object.keys(model.model_prices).flatMap((m) => [field(`in:${m}`, `${m} input`), field(`out:${m}`, `${m} output`)])}
              {field("usd_to_sar", "SAR per USD")}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Infrastructure estimate (SAR per month)</p>
            <div className="grid grid-cols-2 gap-3">
              {field("base_infra", "Base per business")}{field("storage_flat", "Storage per business")}{field("email_monthly", "Email per business")}
              {field("per_user", "Per user")}{field("per_branch", "Per branch")}{field("per_1k_sales", "Per 1,000 sales")}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save rates</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
