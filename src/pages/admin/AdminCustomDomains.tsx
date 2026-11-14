import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Globe2, RefreshCw, ExternalLink, Search, Shield, Loader2, AlertCircle, CheckCircle2, Clock,
} from "lucide-react";
import { format } from "date-fns";

interface DomainRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_status: string;
  custom_domain: string | null;
  domain_status: string;
  ssl_status: string | null;
  cf_hostname_id: string | null;
  verification_token: string | null;
  verification_error: string | null;
  dns_verified_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

const domainStatusBadge = (s: string) => {
  switch (s) {
    case "active":
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>;
    case "verifying":
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="h-3 w-3 mr-1" />Verifying</Badge>;
    case "pending":
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20"><AlertCircle className="h-3 w-3 mr-1" />Pending</Badge>;
    case "failed":
      return <Badge className="bg-destructive/10 text-destructive border-destructive/20">Failed</Badge>;
    case "offline":
      return <Badge variant="outline" className="bg-muted text-muted-foreground">Offline</Badge>;
    default:
      return <Badge variant="outline">{s}</Badge>;
  }
};

const sslBadge = (s: string | null) => {
  if (!s) return <Badge variant="outline" className="text-muted-foreground">—</Badge>;
  switch (s) {
    case "active":
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><Shield className="h-3 w-3 mr-1" />Active</Badge>;
    case "provisioning":
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Provisioning</Badge>;
    case "failed":
      return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Failed</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground"><Clock className="h-3 w-3 mr-1" />{s}</Badge>;
  }
};

export default function AdminCustomDomains() {
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await db.rpc("admin_list_custom_domains");
    if (error) {
      console.error(error);
      toast.error("Failed to load custom domains");
      setRows([]);
    } else {
      setRows((data as DomainRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRows(); }, []);

  // Auto SSL polling: while any row is in a transitional state, poll
  // Cloudflare for SSL status every 20s, then refresh the list.
  const polledRef = useRef(false);
  useEffect(() => {
    const transitional = rows.filter(
      (r) =>
        r.cf_hostname_id &&
        (r.ssl_status === "provisioning" ||
          r.ssl_status === "pending" ||
          r.domain_status === "verifying"),
    );
    if (transitional.length === 0) return;

    let cancelled = false;
    const tick = async () => {
      if (polledRef.current) return;
      polledRef.current = true;
      try {
        const results = await Promise.allSettled(
          transitional.map((r) =>
            db.functions.invoke("poll-domain-ssl", {
              body: { domain_id: r.id },
            }),
          ),
        );
        const anyChange = results.some(
          (r) =>
            r.status === "fulfilled" &&
            (r.value as { data?: { ssl_status?: string; domain_status?: string } })?.data?.ssl_status === "active",
        );
        if (!cancelled && (anyChange || results.length > 0)) {
          await fetchRows();
        }
      } finally {
        polledRef.current = false;
      }
    };

    const id = window.setInterval(tick, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r =>
      (r.custom_domain || "").toLowerCase().includes(needle) ||
      r.tenant_name.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const handleReverify = async (row: DomainRow) => {
    setVerifyingId(row.id);
    try {
      const { data, error } = await db.functions.invoke("verify-custom-domain", {
        body: { domain_id: row.id },
      });
      if (error) throw error;
      if (data?.verified) toast.success(`${row.custom_domain}: verified`);
      else toast.warning(data?.message || `${row.custom_domain}: verification incomplete`);
      await fetchRows();
    } catch (e) {
      toast.error(`Verification failed: ${(e as Error).message}`);
    } finally {
      setVerifyingId(null);
    }
  };

  const totalActive = rows.filter(r => r.domain_status === "active").length;
  const totalPending = rows.filter(r => r.domain_status !== "active" && r.domain_status !== "failed").length;
  const totalFailed = rows.filter(r => r.domain_status === "failed").length;
  const totalProvisioning = rows.filter(r => r.ssl_status === "provisioning" || r.ssl_status === "pending").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">Custom Domains</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and re-verify every tenant custom domain across the platform.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalProvisioning > 0 && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Auto-polling {totalProvisioning}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={fetchRows} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardDescription>Active</CardDescription><CardTitle className="text-2xl text-emerald-600">{totalActive}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Pending / Verifying</CardDescription><CardTitle className="text-2xl text-amber-600">{totalPending}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Failed</CardDescription><CardTitle className="text-2xl text-destructive">{totalFailed}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">All Custom Domains ({rows.length})</CardTitle>
            </div>
            <div className="relative w-64">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search domain or tenant..."
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {rows.length === 0 ? "No tenant has configured a custom domain yet." : "No matches."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SSL</TableHead>
                  <TableHead>Last Verified</TableHead>
                  <TableHead>CF Hostname</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.tenant_name}</div>
                      <div className="text-xs text-muted-foreground">{row.tenant_status}</div>
                    </TableCell>
                    <TableCell>
                      <a
                        href={`https://${row.custom_domain}`}
                        target="_blank"
                        rel="noopener"
                        className="font-mono text-sm hover:underline inline-flex items-center gap-1"
                      >
                        {row.custom_domain}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {row.verification_error && (
                        <div className="text-xs text-destructive mt-1 max-w-xs truncate" title={row.verification_error}>
                          {row.verification_error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{domainStatusBadge(row.domain_status)}</TableCell>
                    <TableCell>{sslBadge(row.ssl_status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.last_verified_at
                        ? format(new Date(row.last_verified_at), "MMM d, HH:mm")
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.cf_hostname_id ? `${row.cf_hostname_id.slice(0, 8)}…` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReverify(row)}
                        disabled={verifyingId === row.id}
                      >
                        {verifyingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                            Re-verify
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}