import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useState } from "react";

interface AlertRow {
  id: string;
  tenant_id: string;
  alert_key: string;
  entity_type: string | null;
  entity_id: string | null;
  severity: "info" | "warning" | "critical";
  message: string | null;
  metadata: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  notification_count: number;
}

const SEVERITY_META: Record<
  AlertRow["severity"],
  { label: string; tone: string; Icon: typeof AlertCircle }
> = {
  critical: { label: "Critical", tone: "text-destructive", Icon: ShieldAlert },
  warning: { label: "Warning", tone: "text-amber-600", Icon: AlertCircle },
  info: { label: "Info", tone: "text-muted-foreground", Icon: Bell },
};

function alertIcon(key: string) {
  if (key.startsWith("device.")) return Smartphone;
  if (key.startsWith("clearance.stale")) return Clock;
  return ShieldAlert;
}

export function ZatcaAlertsPanel() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["zatca-alerts", tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: open } = await supabase
        .from("zatca_alert_state")
        .select("*")
        .eq("tenant_id", tenantId!)
        .is("resolved_at", null)
        .order("severity", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(50);
      const { data: recent } = await supabase
        .from("zatca_alert_state")
        .select("*")
        .eq("tenant_id", tenantId!)
        .not("resolved_at", "is", null)
        .order("resolved_at", { ascending: false })
        .limit(20);
      return {
        open: (open ?? []) as AlertRow[],
        resolved: (recent ?? []) as AlertRow[],
      };
    },
  });

  // Real-time stream - refresh as soon as the monitor inserts a row.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`zatca_alerts_${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "zatca_alert_state",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["zatca-alerts", tenantId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, qc]);

  async function runNow() {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("zatca-device-monitor");
      if (error) throw error;
      toast.success("Health check complete");
      refetch();
    } catch (e) {
      toast.error(`Check failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  const open = data?.open ?? [];
  const resolved = data?.resolved ?? [];

  const counts = {
    critical: open.filter((a) => a.severity === "critical").length,
    warning: open.filter((a) => a.severity === "warning").length,
    info: open.filter((a) => a.severity === "info").length,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Device & clearance alerts
          </CardTitle>
          <CardDescription>
            Live health alerts from the ZATCA monitor. In-app, email, and webhook
            channels fire automatically based on each user&apos;s notification
            preferences.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={runNow} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2 hidden sm:inline">Run check now</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Critical" value={counts.critical} tone="text-destructive" />
          <Stat label="Warning" value={counts.warning} tone="text-amber-600" />
          <Stat
            label="Resolved (24h)"
            value={resolved.length}
            tone="text-emerald-600"
          />
        </div>

        {isLoading ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : open.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            All ZATCA devices and clearances are healthy.
          </div>
        ) : (
          <ScrollArea className="max-h-[400px] pr-2">
            <div className="space-y-2">
              {open.map((a) => (
                <AlertRowItem key={a.id} alert={a} />
              ))}
            </div>
          </ScrollArea>
        )}

        {resolved.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Recently resolved ({resolved.length})
            </summary>
            <ScrollArea className="max-h-[200px] pr-2 mt-2">
              <div className="space-y-1.5">
                {resolved.map((a) => (
                  <div
                    key={a.id}
                    className="text-xs px-2 py-1.5 rounded border bg-muted/30 flex items-center gap-2"
                  >
                    <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                    <span className="truncate">{a.message}</span>
                    <span className="ml-auto text-muted-foreground shrink-0">
                      {a.resolved_at
                        ? formatDistanceToNow(new Date(a.resolved_at), {
                            addSuffix: true,
                          })
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-light ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function AlertRowItem({ alert }: { alert: AlertRow }) {
  const meta = SEVERITY_META[alert.severity];
  const SeverityIcon = meta.Icon;
  const KeyIcon = alertIcon(alert.alert_key);
  return (
    <div className="rounded-md border p-3 bg-card">
      <div className="flex items-start gap-3">
        <SeverityIcon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.tone}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={alert.severity === "critical" ? "destructive" : "outline"}
              className="h-5 text-[10px]"
            >
              {meta.label}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <KeyIcon className="h-3 w-3" />
              {alert.alert_key.split(":")[0]}
            </span>
            {alert.notification_count > 1 && (
              <Badge variant="secondary" className="h-5 text-[10px]">
                ×{alert.notification_count}
              </Badge>
            )}
          </div>
          <p className="text-sm mt-1">{alert.message}</p>
          <div className="text-[11px] text-muted-foreground mt-1">
            First seen{" "}
            {formatDistanceToNow(new Date(alert.first_seen_at), { addSuffix: true })} · last
            seen{" "}
            {formatDistanceToNow(new Date(alert.last_seen_at), { addSuffix: true })}
          </div>
        </div>
      </div>
    </div>
  );
}