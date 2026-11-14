import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useZatcaCompliance } from "@/hooks/useZatcaCompliance";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { categorizeFailure, FAILURE_BUCKET_LABEL, type FailureBucket } from "@/lib/zatca/failureBuckets";

const BUCKET_COLOR: Record<FailureBucket, string> = {
  schema: "hsl(var(--destructive))",
  signature: "hsl(38 92% 50%)",
  network: "hsl(217 91% 60%)",
  fatoora: "hsl(280 83% 56%)",
  unknown: "hsl(var(--muted-foreground))",
};

/**
 * Donut chart of failure causes across the last 30 days. Data is sourced
 * from rejected/schema-invalid sales and bucketed by error heuristics.
 */
export function ZatcaFailureBreakdown() {
  const { restaurant } = useAuth();
  const { activeBranchId, pinnedBranchId } = useBranch();
  const branchId = pinnedBranchId ?? activeBranchId ?? null;
  const { data: m } = useZatcaCompliance();
  const restaurantId = restaurant?.id ?? null;

  const { data: rows = [] } = useQuery({
    queryKey: ["zatca", "failure-breakdown", restaurantId, branchId],
    enabled: !!restaurantId && !!m && (m.rejected + m.schemaInvalid > 0),
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      let q = db
        .from("sales_transactions")
        .select("id, zatca_clearance_status, zatca_clearance_response")
        .eq("restaurant_id", restaurantId!)
        .in("zatca_clearance_status", ["REJECTED", "SCHEMA_INVALID"])
        .gte("created_at", since)
        .limit(500);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const chartData = useMemo(() => {
    const counts = new Map<FailureBucket, number>();
    for (const r of rows as Array<{ zatca_clearance_status: string | null; zatca_clearance_response: unknown }>) {
      const b = categorizeFailure(r.zatca_clearance_status, r.zatca_clearance_response);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([bucket, value]) => ({
      name: FAILURE_BUCKET_LABEL[bucket],
      color: BUCKET_COLOR[bucket],
      value,
    }));
  }, [rows]);

  const total = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Failure breakdown</CardTitle>
        <CardDescription>
          {total > 0
            ? `${total} failure${total === 1 ? "" : "s"} in the last 30 days, grouped by cause`
            : "No failures in the last 30 days"}
        </CardDescription>
      </CardHeader>
      <CardContent className="h-64">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            All clearances succeeded.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={80}
                paddingAngle={2}
              >
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend
                iconSize={8}
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) => <span className="text-foreground">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}