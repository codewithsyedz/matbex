import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSuperAdmin } from "@/contexts/SuperAdminContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Helmet } from "react-helmet-async";
import { TrendingUp, Link2, FileSearch, Globe, RefreshCw } from "lucide-react";

type SemrushRows = { columnNames: string[]; rows: Array<Record<string, unknown>> };
type SemrushRaw = { columnNames: string[]; rows: Array<Array<string | number> | Record<string, unknown>> };
type ProxyResponse<T = SemrushRaw> = { data?: T; error?: string };

/**
 * Semrush gateway returns rows as positional arrays aligned with
 * `columnNames`. Zip them into objects so UI code can read by key.
 * Also detects the "ERROR ## :: ..." sentinel that Semrush packs into
 * columnNames when the domain has no data in that database.
 */
function normalizeSemrush(raw: SemrushRaw): SemrushRows {
  const cols = raw?.columnNames ?? [];
  const isErrorSentinel = cols.length === 1 && /^ERROR\s+\d+/i.test(cols[0]);
  if (isErrorSentinel) return { columnNames: [], rows: [] };
  const rows = (raw?.rows ?? []).map((r) => {
    if (Array.isArray(r)) {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => { obj[c] = r[i]; });
      return obj;
    }
    return r as Record<string, unknown>;
  });
  return { columnNames: cols, rows };
}

async function callSemrush<T = SemrushRows>(
  path: string,
  params: Record<string, string | number>,
): Promise<T> {
  const { data, error } = await db.functions.invoke<ProxyResponse<SemrushRaw>>("semrush-proxy", {
    body: { path, params },
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response");
  if ((data as ProxyResponse).error) throw new Error((data as ProxyResponse).error);
  const raw = ((data as ProxyResponse<SemrushRaw>).data ?? data) as SemrushRaw;
  return normalizeSemrush(raw) as unknown as T;
}

const DATABASES = [
  { code: "sa", label: "Saudi Arabia" },
  { code: "ae", label: "UAE" },
  { code: "eg", label: "Egypt" },
  { code: "kw", label: "Kuwait" },
  { code: "us", label: "United States" },
];

/** Access gate; the dashboard is a separate component so its hooks always run in order. */
export default function AdminSEO() {
  const { hasRole } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();
  const canViewSeo = isSuperAdmin || hasRole("owner") || hasRole("manager");
  if (!canViewSeo) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">SEO Dashboard</h1>
              <p className="text-sm text-muted-foreground font-light leading-relaxed">
                This view is available to SuperAdmins, tenant owners, and managers.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return <AdminSEOScreen />;
}

function AdminSEOScreen() {
  const { hasRole } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();
  const [domain, setDomain] = useState("matbex.com");
  const [database, setDatabase] = useState("sa");


  const overview = useQuery({
    queryKey: ["seo", "ranks", domain, database],
    queryFn: () =>
      callSemrush("domains/domain_ranks", {
        domain,
        database,
        export_columns: "Db,Dn,Rk,Or,Ot,Oc,Ad",
      }),
    staleTime: 5 * 60 * 1000,
  });

  const topKeywords = useQuery({
    queryKey: ["seo", "organic", domain, database],
    queryFn: () =>
      callSemrush("domains/domain_organic", {
        domain,
        database,
        display_limit: 20,
        export_columns: "Ph,Po,Nq,Cp,Ur,Tr,Kd",
      }),
    staleTime: 5 * 60 * 1000,
  });

  const backlinks = useQuery({
    queryKey: ["seo", "backlinks", domain],
    queryFn: () =>
      callSemrush("backlinks/backlinks_overview", {
        target: domain,
        target_type: "root_domain",
        export_columns: "ascore,total,domains_num,urls_num,ips_num,follows_num,nofollows_num",
      }),
    staleTime: 30 * 60 * 1000,
  });

  const refetchAll = () => {
    overview.refetch();
    topKeywords.refetch();
    backlinks.refetch();
  };

  const ovRow = overview.data?.rows?.[0] as Record<string, string | number> | undefined;
  const blRow = backlinks.data?.rows?.[0] as Record<string, string | number> | undefined;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>SEO Dashboard | Matbex Admin</title>
      </Helmet>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mb-8"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-light tracking-tight">SEO Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1 font-light">
                Live keyword rankings, traffic, and backlinks — powered by Semrush.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={refetchAll}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          <div className="mt-6 flex gap-3 flex-wrap">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value.trim())}
              placeholder="domain.com"
              className="max-w-xs"
            />
            <Select value={database} onValueChange={setDatabase}>
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATABASES.map((d) => (
                  <SelectItem key={d.code} value={d.code}>
                    {d.label} ({d.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </motion.div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <KpiCard
            icon={<Globe className="h-4 w-4" />}
            label="Organic Keywords"
            value={ovRow?.Or}
            loading={overview.isLoading}
          />
          <KpiCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Est. Monthly Traffic"
            value={ovRow?.Ot}
            loading={overview.isLoading}
          />
          <KpiCard
            icon={<FileSearch className="h-4 w-4" />}
            label="Authority Score"
            value={blRow?.ascore}
            loading={backlinks.isLoading}
            max={100}
          />
          <KpiCard
            icon={<Link2 className="h-4 w-4" />}
            label="Referring Domains"
            value={blRow?.domains_num}
            loading={backlinks.isLoading}
          />
        </div>

        {/* Top keywords table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-light">
              Top Ranking Keywords — {DATABASES.find((d) => d.code === database)?.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topKeywords.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : topKeywords.isError ? (
              <p className="text-sm text-destructive">
                {(topKeywords.error as Error).message}
              </p>
            ) : !topKeywords.data?.rows?.length ? (
              <p className="text-sm text-muted-foreground">
                Not ranking yet in this market. Publish landing pages and check back in a few weeks.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead className="w-20 text-right">Position</TableHead>
                    <TableHead className="w-24 text-right">Volume/mo</TableHead>
                    <TableHead className="w-20 text-right">KDI</TableHead>
                    <TableHead className="w-20 text-right">CPC ($)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topKeywords.data.rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{String(row.Ph ?? "")}</TableCell>
                      <TableCell className="text-right">
                        <PositionBadge pos={Number(row.Po)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(row.Nq).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.Kd ? `${row.Kd}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.Cp ? `$${Number(row.Cp).toFixed(2)}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  loading,
  max,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number | undefined;
  loading?: boolean;
  max?: number;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
          {icon}
          {label}
        </div>
        <div className="mt-3 text-3xl font-light tabular-nums">
          {loading ? (
            <Skeleton className="h-9 w-20" />
          ) : value === undefined || value === null || value === "" ? (
            "—"
          ) : (
            <>
              {typeof value === "number" ? value.toLocaleString() : value}
              {max && <span className="text-base text-muted-foreground">/{max}</span>}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PositionBadge({ pos }: { pos: number }) {
  if (!pos) return <span className="text-muted-foreground">—</span>;
  const variant: "default" | "secondary" | "outline" =
    pos <= 3 ? "default" : pos <= 10 ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="tabular-nums">
      #{pos}
    </Badge>
  );
}