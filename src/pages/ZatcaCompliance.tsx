import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, ShieldAlert, Clock, Smartphone, Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useZatcaCompliance, useZatcaAuditTrail, type AuditFilters } from "@/hooks/useZatcaCompliance";
import { useZatcaDevices } from "@/hooks/useZatcaDevices";
import { useZatcaFailureBreakdown } from "@/hooks/useZatcaFailureBreakdown";
import { format, formatDistanceToNow } from "date-fns";
import { ZatcaFailuresPanel } from "@/components/zatca/ZatcaFailuresPanel";
import { ZatcaAlertsPanel } from "@/components/zatca/ZatcaAlertsPanel";
import { ZatcaExportMenu } from "@/components/zatca/ZatcaExportMenu";
import { ZatcaFailureBreakdown } from "@/components/zatca/ZatcaFailureBreakdown";
import { ChainIntegrityBadge } from "@/components/zatca/ChainIntegrityBadge";
import { ZatcaAuditFilters } from "@/components/zatca/ZatcaAuditFilters";
import { useZatcaRealtime } from "@/hooks/useZatcaRealtime";
import { CertificationWizard } from "@/components/zatca/CertificationWizard";
import { ResponsiveContainer, AreaChart, Area, Tooltip as RTooltip } from "recharts";

function pct(n: number) {
  return `${Math.round(n * 1000) / 10}%`;
}

export default function ZatcaCompliance() {
  useZatcaRealtime();
  const { data: m, isLoading } = useZatcaCompliance();
  const [filters, setFilters] = useState<AuditFilters>({});
  const { data: audit, isFetching: auditFetching } = useZatcaAuditTrail(200, filters);
  const { devices } = useZatcaDevices();
  const { data: failures } = useZatcaFailureBreakdown();

  const successRateColor = useMemo(() => {
    if (!m) return "muted";
    if (m.successRate >= 0.98) return "text-emerald-600";
    if (m.successRate >= 0.9) return "text-amber-600";
    return "text-red-600";
  }, [m]);

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <header className="flex items-start justify-between gap-4 min-h-[56px]">
          <div className="space-y-1 min-w-[240px] flex-1"><h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">ZATCA Compliance</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time clearance health across all devices, last 30 days.
            </p>
          </div>
          <ZatcaExportMenu metrics={m} devices={devices} audit={audit} failures={failures} />
        </header>

        {/* Phase 2 production certification wizard */}
        <CertificationWizard />

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {isLoading || !m ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <KpiCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Success rate"
                value={pct(m.successRate)}
                tone={successRateColor}
                hint={`${m.cleared + m.reported} of ${m.cleared + m.reported + m.rejected + m.schemaInvalid} finalized`}
              />
              <KpiCard
                icon={<Clock className="h-4 w-4" />}
                label="Avg latency"
                value={m.avgLatencyMs != null ? `${(m.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                hint="Submission → cleared"
              />
              <KpiCard
                icon={<Activity className="h-4 w-4" />}
                label="Pending"
                value={String(m.pending)}
                hint="Awaiting Fatoora response"
              />
              <KpiCard
                icon={<ShieldAlert className="h-4 w-4" />}
                label="Failed"
                value={String(m.rejected + m.schemaInvalid)}
                tone={m.rejected + m.schemaInvalid > 0 ? "text-red-600" : undefined}
                hint={`${m.rejected} rejected · ${m.schemaInvalid} invalid`}
              />
            </>
          )}
        </div>

        {/* Status breakdown */}
        {m && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Status breakdown</CardTitle>
              <CardDescription>{m.total} clearance events in window</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Stat label="Cleared" value={m.cleared} className="text-emerald-600" />
              <Stat label="Reported" value={m.reported} className="text-emerald-600" />
              <Stat label="Pending" value={m.pending} className="text-amber-600" />
              <Stat label="Rejected" value={m.rejected} className="text-red-600" />
              <Stat label="Schema invalid" value={m.schemaInvalid} className="text-red-600" />
            </CardContent>
          </Card>
        )}

        {/* Per-device health */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Smartphone className="h-4 w-4" /> Device health
            </CardTitle>
            <CardDescription>Onboarded devices and CSID expiry</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {(devices ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No ZATCA devices onboarded yet.</p>
            )}
            {(devices ?? []).map((d) => {
              const expires = d.csid_expires_at ? new Date(d.csid_expires_at) : null;
              const expiringSoon =
                expires && expires.getTime() - Date.now() < 30 * 24 * 3600 * 1000;
              return (
                <div key={d.id} className="flex items-center justify-between py-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{d.serial_number}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant={d.registration_status === "REGISTERED" ? "default" : "secondary"}>
                      {d.registration_status}
                    </Badge>
                    {expires && (
                      <Badge variant={expiringSoon ? "destructive" : "outline"}>
                        CSID {expiringSoon ? "expires" : "valid"} {formatDistanceToNow(expires, { addSuffix: true })}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Failure breakdown + 14-day trend */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ZatcaFailureBreakdown />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Clearance trend</CardTitle>
              <CardDescription>Last 14 days · cleared vs failed</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              {!m || m.last24h.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No clearance activity yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={m.last24h} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                    <defs>
                      <linearGradient id="zCleared" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="zFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <RTooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area type="monotone" dataKey="cleared" stroke="hsl(160 84% 39%)" fill="url(#zCleared)" strokeWidth={2} />
                    <Area type="monotone" dataKey="failed"  stroke="hsl(var(--destructive))" fill="url(#zFailed)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live device & clearance alerts */}
        <ZatcaAlertsPanel />

        {/* Failed clearances admin */}
        <ZatcaFailuresPanel />

        {/* Tamper-evident audit trail */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Tamper-evident audit trail
                </CardTitle>
                <CardDescription>Hash-chained record of every clearance status change</CardDescription>
              </div>
              <ChainIntegrityBadge />
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <ZatcaAuditFilters value={filters} onChange={setFilters} />
            </div>
            <div className="mb-2 text-[11px] text-muted-foreground">
              {auditFetching
                ? "Loading…"
                : `${(audit ?? []).length} event${(audit ?? []).length === 1 ? "" : "s"}`}
            </div>
            <ScrollArea className="h-96 pr-4">
              <div className="space-y-2">
                {(audit ?? []).map((row) => (
                  <div key={row.id} className="rounded-md border p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {row.action}
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {row.entity_type}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground">
                        {format(new Date(row.created_at), "PPp")}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground break-all">
                      hash: {row.payload_hash.slice(0, 32)}…
                    </div>
                    {row.prev_hash && (
                      <div className="font-mono text-[10px] text-muted-foreground break-all">
                        prev: {row.prev_hash.slice(0, 32)}…
                      </div>
                    )}
                  </div>
                ))}
                {(audit ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No audit events yet.</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function KpiCard({ icon, label, value, hint, tone }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className={`text-2xl font-light ${tone ?? ""}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="space-y-0.5">
      <div className={`text-xl font-light ${className ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}