import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import type { DayEndScope } from "./DayEndAdjustmentDialog";

interface Props {
  /** Scope of the parent record. */
  scope: DayEndScope;
  /** Business date (YYYY-MM-DD) of the parent record. */
  businessDate?: string | null;
  /** Optional explicit scope_ref_id to match (preferred over date). */
  scopeRefId?: string | null;
  /** Smaller variant for inline use. */
  size?: "sm" | "md";
}

/**
 * Surfaces a "Day-End Adjusted" badge whenever an adjustment with a
 * variance note has been posted for the given scope+date. Tooltip shows
 * count, net amount and the latest reason.
 */
export function DayEndAdjustedBadge({
  scope,
  businessDate,
  scopeRefId,
  size = "md",
}: Props) {
  const { tenant } = useAuth();
  const { activeBranchId, isAllBranches } = useBranch();
  const { format: formatCurrency } = useCurrency();

  const { data } = useQuery({
    queryKey: [
      "day-end-adjusted-badge",
      tenant?.id,
      scope,
      businessDate ?? null,
      scopeRefId ?? null,
      isAllBranches ? "all" : activeBranchId,
    ],
    enabled: !!tenant?.id && (!!businessDate || !!scopeRefId),
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("day_end_adjustments")
        .select("id, amount, notes, reason, created_at, reversed_at, reversal_of_id")
        .eq("tenant_id", tenant!.id)
        .eq("scope", scope)
        .order("created_at", { ascending: false });
      if (scopeRefId) q = q.eq("scope_ref_id", scopeRefId);
      else if (businessDate) q = q.eq("business_date", businessDate);
      if (!isAllBranches && activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      // Only count active (non-reversed, non-reversal) entries
      return (data ?? []).filter(
        (a) => !a.reversed_at && !a.reversal_of_id && (a.notes?.trim().length ?? 0) > 0,
      );
    },
  });

  if (!data || data.length === 0) return null;

  const net = data.reduce((s, a) => s + Number(a.amount || 0), 0);
  const latest = data[0];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 ${
              size === "sm" ? "text-[10px] px-1.5 py-0" : ""
            }`}
          >
            <Scale className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
            Day-End Adjusted
            {data.length > 1 && (
              <span className="opacity-70">×{data.length}</span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <div className="font-medium mb-1">
            Net adjustment: {net >= 0 ? "+" : ""}
            {formatCurrency(net)}
          </div>
          <div className="text-muted-foreground">
            {data.length} entry{data.length === 1 ? "" : "ies"} posted
          </div>
          <div className="mt-1 border-t pt-1 line-clamp-3">
            <span className="font-medium capitalize">
              {latest.reason.replace(/_/g, " ")}:
            </span>{" "}
            {latest.notes}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}