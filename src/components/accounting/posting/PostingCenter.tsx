import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { UnpostedLedgerPanel } from "./UnpostedLedgerPanel";
import { ImbalancedPanel } from "./ImbalancedPanel";
import { PostingAuditTrail } from "./PostingAuditTrail";
import { PostingRulesCard } from "./PostingRulesCard";
import { PostingFiltersBar } from "./PostingFiltersBar";
import { PostingJobsPanel } from "./PostingJobsPanel";
import {
  emptyPostingFilters,
  filterImbalanced,
  filterUnposted,
  ShiftLookup,
} from "./postingFilters";
import { useUnpostedExpenses, useImbalancedExpenses } from "@/hooks/usePostingCenter";
import { supabase } from "@/integrations/supabase/client";

export function PostingCenter() {
  const { activeBranchId, activeBranch } = useBranch();
  const qc = useQueryClient();
  const [filters, setFilters] = useState(emptyPostingFilters);
  const { data: unposted = [] } = useUnpostedExpenses(activeBranchId);
  const { data: imbalanced = [] } = useImbalancedExpenses(activeBranchId);

  // Shift lookup for the currently loaded expenses (one batched fetch).
  const allIds = useMemo(
    () => Array.from(new Set([...unposted.map((u) => u.id), ...imbalanced.map((i) => i.id)])),
    [unposted, imbalanced],
  );
  const { data: shiftLookup = {} } = useQuery<ShiftLookup>({
    queryKey: ["posting-shift-lookup", allIds.join(",")],
    enabled: allIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("expenses")
        .select("id, shift_id")
        .in("id", allIds);
      if (error) throw error;
      const map: ShiftLookup = {};
      for (const r of (data ?? []) as any[]) map[r.id] = r.shift_id ?? null;
      return map;
    },
    staleTime: 60_000,
  });

  const filteredUnposted = useMemo(
    () => filterUnposted(unposted, filters, shiftLookup),
    [unposted, filters, shiftLookup],
  );
  const filteredImbalanced = useMemo(
    () => filterImbalanced(imbalanced, filters, shiftLookup),
    [imbalanced, filters, shiftLookup],
  );

  const readyCount = filteredUnposted.filter(
    (e) => e.classification?.reason_code === "ready",
  ).length;
  const blockedCount = filteredUnposted.length - readyCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Scope:{" "}
          <span className="font-medium text-foreground">
            {activeBranch?.name ?? "All branches"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["unposted-expenses"] });
            qc.invalidateQueries({ queryKey: ["imbalanced-expenses"] });
            qc.invalidateQueries({ queryKey: ["posting-audit"] });
            qc.invalidateQueries({ queryKey: ["posting-jobs"] });
          }}
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <PostingFiltersBar
        value={filters}
        onChange={setFilters}
        branchPinned={!!activeBranchId}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Eligible" value={readyCount} tone="green" />
        <Kpi label="Blocked / pending" value={blockedCount} tone="amber" />
        <Kpi label="Unposted total" value={filteredUnposted.length} tone="slate" />
        <Kpi label="Imbalanced" value={filteredImbalanced.length} tone="rose" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <UnpostedLedgerPanel branchId={activeBranchId} rows={filteredUnposted} />
          <ImbalancedPanel branchId={activeBranchId} rows={filteredImbalanced} />
        </div>
        <div className="space-y-4">
          <PostingRulesCard />
          <PostingJobsPanel branchId={activeBranchId} />
        </div>
      </div>

      <PostingAuditTrail branchId={activeBranchId} />
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "slate" | "rose";
}) {
  const colorMap = {
    green: "text-success",
    amber: "text-warning",
    slate: "text-muted-foreground",
    rose: "text-destructive",
  } as const;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${colorMap[tone]}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}