import { useQuery } from "@tanstack/react-query";
import { formatDistanceStrict, formatDistanceToNow } from "date-fns";
import { Clock, Download, History, ShieldCheck, UserCog } from "lucide-react";
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
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImpersonationLogRow {
  id: string;
  impersonated_role: "manager" | "accountant" | "cashier";
  started_at: string;
  ended_at: string | null;
  expires_at: string;
  end_reason: string | null;
  user_agent: string | null;
}

const REASON_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  manual: { label: "Manual exit", variant: "secondary" },
  timeout: { label: "Timed out", variant: "outline" },
  signout: { label: "Signed out", variant: "outline" },
  invalidated: { label: "Invalidated", variant: "destructive" },
  tab_close: { label: "Tab closed", variant: "outline" },
  stale: { label: "Stale (swept)", variant: "destructive" },
};

/**
 * SOC2 / audit evidence export. Pulls the full set of impersonation rows for
 * the tenant (RLS-scoped server-side) and emits a CSV. We always re-fetch on
 * click rather than reusing the 50-row preview cache so the export is
 * complete and time-stamped.
 */
function toCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Gap #1 — surfaces the previously write-only `role_impersonation_logs`
 * table to Owners so they can review every "Test as…" session for their
 * tenant. RLS already restricts the query to owners of the tenant.
 */
export function ImpersonationHistoryCard() {
  const { tenant, canImpersonateRoles } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["role-impersonation-logs", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [] as ImpersonationLogRow[];
      const { data, error } = await supabase
        .from("role_impersonation_logs")
        .select("id, impersonated_role, started_at, ended_at, expires_at, end_reason, user_agent")
        .eq("tenant_id", tenant.id)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ImpersonationLogRow[];
    },
    enabled: !!tenant?.id && canImpersonateRoles,
    staleTime: 60_000,
  });

  if (!canImpersonateRoles) return null;

  const handleExport = async () => {
    if (!tenant?.id) return;
    try {
      const { data: rows, error } = await supabase
        .from("role_impersonation_logs")
        .select("id, impersonated_role, started_at, ended_at, expires_at, end_reason, user_agent")
        .eq("tenant_id", tenant.id)
        .order("started_at", { ascending: false })
        .limit(10000);
      if (error) throw error;

      const header = [
        "id",
        "impersonated_role",
        "started_at",
        "ended_at",
        "expires_at",
        "duration_seconds",
        "end_reason",
        "user_agent",
      ];
      const lines = [header.join(",")];
      for (const r of (rows ?? []) as ImpersonationLogRow[]) {
        const endIso = r.ended_at ?? r.expires_at;
        const durationSec = Math.max(
          0,
          Math.round(
            (new Date(endIso).getTime() - new Date(r.started_at).getTime()) / 1000,
          ),
        );
        lines.push(
          [
            r.id,
            r.impersonated_role,
            r.started_at,
            r.ended_at ?? "",
            r.expires_at,
            String(durationSec),
            r.end_reason ?? "",
            r.user_agent ?? "",
          ]
            .map(toCsvCell)
            .join(","),
        );
      }
      const csv = lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `impersonation-logs-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows?.length ?? 0} sessions`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Impersonation history
            </CardTitle>
            <CardDescription>
              Every "Test as…" session opened from this workspace. Sessions auto-expire after 60 minutes.
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={handleExport}
            disabled={!data || data.length === 0}
            aria-label="Export impersonation logs as CSV"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No impersonation sessions recorded yet.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => {
                  const isActive = !row.ended_at && new Date(row.expires_at) > new Date();
                  const endsAt = row.ended_at ?? row.expires_at;
                  const duration = formatDistanceStrict(new Date(row.started_at), new Date(endsAt));
                  const reason = row.end_reason ? REASON_LABEL[row.end_reason] : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserCog className="h-3.5 w-3.5 text-primary" />
                          <span className="capitalize font-medium">{row.impersonated_role}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(row.started_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {duration}
                        </span>
                      </TableCell>
                      <TableCell>
                        {isActive ? (
                          <Badge variant="default">Active</Badge>
                        ) : reason ? (
                          <Badge variant={reason.variant}>{reason.label}</Badge>
                        ) : (
                          <Badge variant="outline">Ended</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}