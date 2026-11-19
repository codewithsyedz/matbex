import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, UserCog } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AnalyticsRow {
  impersonated_role: "manager" | "accountant" | "cashier";
  session_count: number;
  total_minutes: number;
  avg_minutes: number;
  last_used_at: string;
}

const ROLE_LABEL: Record<AnalyticsRow["impersonated_role"], string> = {
  manager: "Manager",
  accountant: "Accountant",
  cashier: "Cashier",
};

/**
 * Gap #10 — aggregate telemetry for "Test as…" usage. Answers
 * "how often do owners use this?" and "which roles are tested most?"
 * Reads from get_impersonation_analytics(tenant_id, days) which is
 * owner-gated server-side.
 */
const RANGE_OPTIONS: Array<{ value: string; label: string; days: number }> = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "180", label: "Last 180 days", days: 180 },
  { value: "365", label: "Last 12 months", days: 365 },
];

export function ImpersonationAnalyticsCard({ days: defaultDays = 30 }: { days?: number }) {
  const { tenant, canImpersonateRoles } = useAuth();
  const [rangeValue, setRangeValue] = useState<string>(String(defaultDays));
  const days = Number(rangeValue) || 30;

  const { data, isLoading } = useQuery({
    queryKey: ["impersonation-analytics", tenant?.id, days],
    queryFn: async () => {
      if (!tenant?.id) return [] as AnalyticsRow[];
      const { data, error } = await db.rpc("get_impersonation_analytics", {
        _tenant_id: tenant.id,
        _days: days,
      });
      if (error) throw error;
      return ((data ?? []) as unknown as AnalyticsRow[]).map((r) => ({
        ...r,
        session_count: Number(r.session_count),
        total_minutes: Number(r.total_minutes ?? 0),
        avg_minutes: Number(r.avg_minutes ?? 0),
      }));
    },
    enabled: !!tenant?.id && canImpersonateRoles,
    staleTime: 60_000,
  });

  if (!canImpersonateRoles) return null;

  const totalSessions = (data ?? []).reduce(
    (acc, r) => acc + r.session_count,
    0,
  );
  const totalMinutes = (data ?? []).reduce(
    (acc, r) => acc + r.total_minutes,
    0,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Test as… usage
            </CardTitle>
            <CardDescription>
              Per-role session counts and time spent in read-only impersonation.
            </CardDescription>
          </div>
          <Select value={rangeValue} onValueChange={setRangeValue}>
            <SelectTrigger
              className="h-8 w-[160px] shrink-0"
              aria-label="Date range"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Total sessions</div>
            <div className="mt-1 text-2xl font-light tabular-nums">
              {isLoading ? "—" : totalSessions}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Total time</div>
            <div className="mt-1 text-2xl font-light tabular-nums">
              {isLoading ? "—" : `${Math.round(totalMinutes)}m`}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground">
            No "Test as…" sessions recorded in the last {days} days.
          </div>
        ) : (
          <div className="space-y-2">
            {data!.map((row) => (
              <div
                key={row.impersonated_role}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-2">
                  <UserCog className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {ROLE_LABEL[row.impersonated_role]}
                  </span>
                  <Badge variant="secondary" className="ml-1">
                    {row.session_count} session
                    {row.session_count === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    avg {row.avg_minutes}m · total{" "}
                    {Math.round(row.total_minutes)}m
                  </span>
                  <span>
                    last{" "}
                    {formatDistanceToNow(new Date(row.last_used_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
