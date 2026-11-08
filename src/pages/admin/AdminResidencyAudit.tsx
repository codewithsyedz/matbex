import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ArrowRight, Download, Globe, Lock, LockOpen, RefreshCw, Shield } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  created_at: string;
  tenant_id: string | null;
  user_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  tenant_name?: string | null;
  actor_name?: string | null;
};

type RegionFilter = "all" | "global" | "ksa";

export default function AdminResidencyAudit() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");

  const fetchLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, created_at, tenant_id, user_id, old_data, new_data, ip_address")
      .eq("action", "tenant.data_region.changed")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      toast.error(error.message || "Failed to load residency audit logs");
      setLoading(false);
      return;
    }

    const base = (data || []) as Row[];
    const tenantIds = Array.from(new Set(base.map((r) => r.tenant_id).filter(Boolean))) as string[];
    const userIds = Array.from(new Set(base.map((r) => r.user_id).filter(Boolean))) as string[];

    const [tenantsRes, profilesRes] = await Promise.all([
      tenantIds.length
        ? supabase.from("tenants").select("id, name").in("id", tenantIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      userIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    ]);

    const tenantMap = new Map<string, string>(
      (tenantsRes.data || []).map((t) => [t.id, t.name] as const),
    );
    const profileMap = new Map<string, string | null>(
      (profilesRes.data || []).map((p) => [p.id, p.full_name] as const),
    );

    setRows(
      base.map((r) => ({
        ...r,
        tenant_name: r.tenant_id ? tenantMap.get(r.tenant_id) ?? null : null,
        actor_name: r.user_id ? profileMap.get(r.user_id) ?? null : null,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const toRegion = String((r.new_data as any)?.data_region ?? "");
      if (regionFilter !== "all" && toRegion !== regionFilter) return false;
      if (!q) return true;
      return (
        (r.tenant_name || "").toLowerCase().includes(q) ||
        (r.actor_name || "").toLowerCase().includes(q) ||
        (r.tenant_id || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, regionFilter]);

  const exportCsv = () => {
    const header = [
      "timestamp",
      "tenant_id",
      "tenant_name",
      "actor_id",
      "actor_name",
      "from_region",
      "to_region",
      "from_locked",
      "to_locked",
      "ip_address",
    ];
    const lines = filtered.map((r) => {
      const o = (r.old_data || {}) as any;
      const n = (r.new_data || {}) as any;
      return [
        r.created_at,
        r.tenant_id ?? "",
        r.tenant_name ?? "",
        r.user_id ?? "",
        r.actor_name ?? "",
        o.data_region ?? "",
        n.data_region ?? "",
        String(o.residency_locked ?? ""),
        String(n.residency_locked ?? ""),
        r.ip_address ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `residency-audit-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderRegionDelta = (r: Row) => {
    const from = String((r.old_data as any)?.data_region ?? "—");
    const to = String((r.new_data as any)?.data_region ?? "—");
    if (from === to) return <span className="text-muted-foreground">No region change</span>;
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="uppercase">
          <Globe className="h-3 w-3 mr-1" />
          {from}
        </Badge>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <Badge variant="default" className="uppercase">
          <Globe className="h-3 w-3 mr-1" />
          {to}
        </Badge>
      </div>
    );
  };

  const renderLockDelta = (r: Row) => {
    const from = Boolean((r.old_data as any)?.residency_locked);
    const to = Boolean((r.new_data as any)?.residency_locked);
    if (from === to) return <span className="text-xs text-muted-foreground">unchanged</span>;
    const Icon = to ? Lock : LockOpen;
    return (
      <Badge variant={to ? "destructive" : "outline"} className="gap-1">
        <Icon className="h-3 w-3" />
        {to ? "Locked" : "Unlocked"}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Data Residency Audit
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Every change to a tenant's data region or residency lock, with timestamp, actor, and
            originating IP. Records are immutable and written by the database trigger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="text-base font-medium">Changes</CardTitle>
          <CardDescription>
            {loading
              ? "Loading…"
              : `${filtered.length} of ${rows.length} record${rows.length === 1 ? "" : "s"} (last 500)`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search tenant or actor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-xs"
            />
            <Select value={regionFilter} onValueChange={(v) => setRegionFilter(v as RegionFilter)}>
              <SelectTrigger className="sm:max-w-[200px]">
                <SelectValue placeholder="Filter by target region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All target regions</SelectItem>
                <SelectItem value="global">→ Global</SelectItem>
                <SelectItem value="ksa">→ KSA</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border border-border/40 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Region change</TableHead>
                  <TableHead>Lock</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      Loading audit log…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No residency changes recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(new Date(r.created_at), "MMM d, yyyy HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">
                            {r.tenant_name || "Unknown tenant"}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                            {r.tenant_id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{renderRegionDelta(r)}</TableCell>
                      <TableCell>{renderLockDelta(r)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm">{r.actor_name || "—"}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.user_id ? (
                              <span className="font-mono">{r.user_id.slice(0, 8)}…</span>
                            ) : (
                              "System"
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {r.ip_address || "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}