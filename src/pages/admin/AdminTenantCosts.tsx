import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { db } from "@/integrations/db/client";
import { Search, TrendingUp, TrendingDown, DollarSign, Server } from "lucide-react";
import { subDays } from "date-fns";

// Per-tenant monthly cost heuristic (SAR). Tune as real telemetry comes in.
const COST_MODEL = {
  baseInfra: 8,        // shared DB + auth + realtime baseline
  perUser: 1.5,        // auth sessions, profile reads
  perBranch: 3,        // partition overhead
  per1kSales: 4,       // edge fns + DB writes
  storageFlat: 5,      // logos, receipts, menu images
  emailDaily: 2,       // 1 daily profit email/day
};

interface Row {
  id: string;
  name: string;
  status: string;
  plan_name: string;
  plan_price: number;
  users: number;
  branches: number;
  sales30d: number;
  cost: number;
  margin: number;
  marginPct: number;
}

export default function AdminTenantCosts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const since = subDays(new Date(), 30).toISOString();
        const [tenantsRes, plansRes, profilesRes, restaurantsRes, salesRes] = await Promise.all([
          db.from("tenants").select("id, name, status, plan_id"),
          db.from("plans").select("id, name, price"),
          db.from("profiles").select("tenant_id"),
          db.from("restaurants").select("tenant_id"),
          db.from("sales_transactions").select("tenant_id, created_at").gte("created_at", since),
        ]);

        const plans = new Map((plansRes.data || []).map((p: any) => [p.id, p]));
        const usersByTenant = new Map<string, number>();
        (profilesRes.data || []).forEach((p: any) => {
          if (!p.tenant_id) return;
          usersByTenant.set(p.tenant_id, (usersByTenant.get(p.tenant_id) || 0) + 1);
        });
        const branchesByTenant = new Map<string, number>();
        (restaurantsRes.data || []).forEach((r: any) => {
          if (!r.tenant_id) return;
          branchesByTenant.set(r.tenant_id, (branchesByTenant.get(r.tenant_id) || 0) + 1);
        });
        const salesByTenant = new Map<string, number>();
        (salesRes.data || []).forEach((s: any) => {
          if (!s.tenant_id) return;
          salesByTenant.set(s.tenant_id, (salesByTenant.get(s.tenant_id) || 0) + 1);
        });

        const computed: Row[] = (tenantsRes.data || []).map((t: any) => {
          const plan: any = t.plan_id ? plans.get(t.plan_id) : null;
          const planPrice = Number(plan?.price || 0);
          const users = usersByTenant.get(t.id) || 0;
          const branches = branchesByTenant.get(t.id) || 1;
          const sales30d = salesByTenant.get(t.id) || 0;
          const cost =
            COST_MODEL.baseInfra +
            COST_MODEL.storageFlat +
            COST_MODEL.emailDaily * 30 / 30 +
            users * COST_MODEL.perUser +
            branches * COST_MODEL.perBranch +
            (sales30d / 1000) * COST_MODEL.per1kSales;
          const margin = planPrice - cost;
          const marginPct = planPrice > 0 ? (margin / planPrice) * 100 : 0;
          return {
            id: t.id,
            name: t.name,
            status: t.status,
            plan_name: plan?.name || "—",
            plan_price: planPrice,
            users,
            branches,
            sales30d,
            cost,
            margin,
            marginPct,
          };
        });

        setRows(computed.sort((a, b) => b.plan_price - a.plan_price));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + r.plan_price, 0);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    const margin = revenue - cost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    return { revenue, cost, margin, marginPct };
  }, [rows]);

  const fmt = (n: number) => `${n.toFixed(0)} ﷼`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tenant Cost & Margin</h1>
        <p className="text-sm text-muted-foreground">
          Estimated infrastructure cost vs. plan revenue per tenant.
          Model is heuristic — refine as real telemetry comes in.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs">
              <DollarSign className="h-3.5 w-3.5" /> MRR
            </CardDescription>
            <CardTitle className="text-2xl">{fmt(totals.revenue)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs">
              <Server className="h-3.5 w-3.5" /> Estimated infra cost
            </CardDescription>
            <CardTitle className="text-2xl">{fmt(totals.cost)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs">
              {totals.margin >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              Gross margin
            </CardDescription>
            <CardTitle className={`text-2xl ${totals.margin >= 0 ? "text-primary" : "text-destructive"}`}>
              {fmt(totals.margin)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Margin %</CardDescription>
            <CardTitle className="text-2xl">{totals.marginPct.toFixed(1)}%</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Per-tenant breakdown</CardTitle>
              <CardDescription>{rows.length} tenants</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tenants…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Branches</TableHead>
                  <TableHead className="text-right">Sales 30d</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.name}
                      <Badge variant="outline" className="ml-2 text-[10px]">{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.plan_name}</TableCell>
                    <TableCell className="text-right">{fmt(r.plan_price)}</TableCell>
                    <TableCell className="text-right">{r.users}</TableCell>
                    <TableCell className="text-right">{r.branches}</TableCell>
                    <TableCell className="text-right">{r.sales30d}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(r.cost)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.margin >= 0 ? "text-primary" : "text-destructive"}`}>
                      {fmt(r.margin)}
                    </TableCell>
                    <TableCell className={`text-right ${r.marginPct >= 40 ? "text-primary" : r.marginPct >= 0 ? "text-amber-600" : "text-destructive"}`}>
                      {r.marginPct.toFixed(0)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost model assumptions</CardTitle>
          <CardDescription>All values in SAR/month. Edit in <code>AdminTenantCosts.tsx</code>.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <div>Base infra: <span className="font-medium">{COST_MODEL.baseInfra} ﷼</span></div>
          <div>Storage flat: <span className="font-medium">{COST_MODEL.storageFlat} ﷼</span></div>
          <div>Per user: <span className="font-medium">{COST_MODEL.perUser} ﷼</span></div>
          <div>Per branch: <span className="font-medium">{COST_MODEL.perBranch} ﷼</span></div>
          <div>Per 1,000 sales: <span className="font-medium">{COST_MODEL.per1kSales} ﷼</span></div>
          <div>Daily emails: <span className="font-medium">{COST_MODEL.emailDaily} ﷼</span></div>
        </CardContent>
      </Card>
    </div>
  );
}