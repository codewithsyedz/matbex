import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useFiscalSettings, getFiscalMonthRange } from "@/hooks/useFiscalSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronDown, ChevronUp, Split, X } from "lucide-react";
import { format } from "date-fns";

interface Row {
  id: string;
  name: string;
  monthly_amount: number;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
}

const DISMISS_KEY = "overhead-duplicate-warning-dismissed";

const normalize = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");

/**
 * Warns when a shared (all-branches) overhead item shares a name/category with a
 * branch-specific item that is active in the same fiscal period — the classic
 * double-count that inflates a branch's fixed cost.
 */
export function OverheadDuplicateWarning() {
  const { restaurant } = useAuth();
  const { branches, activeBranchId, isAllBranches } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const { monthStartDay } = useFiscalSettings();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === "1"
  );

  const { start, end } = getFiscalMonthRange(new Date(), monthStartDay);
  const periodLabel = `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;

  const { data: rows } = useQuery({
    queryKey: ["overhead-duplicate-check", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [] as Row[];
      const { data, error } = await supabase
        .from("overhead_allocation")
        .select("id, name, monthly_amount, branch_id, is_active, created_at")
        .eq("restaurant_id", restaurant.id)
        .eq("is_active", true);
      if (error) throw error;
      return (data || []) as unknown as Row[];
    },
    enabled: !!restaurant?.id,
    staleTime: 5 * 60 * 1000,
  });

  const conflicts = useMemo(() => {
    const all = rows || [];
    const shared = all.filter((r) => !r.branch_id);
    const scoped = all.filter((r) => r.branch_id);

    return shared
      .map((sharedItem) => {
        const matches = scoped.filter((s) => normalize(s.name) === normalize(sharedItem.name));
        const relevant = isAllBranches || !activeBranchId
          ? matches
          : matches.filter((m) => m.branch_id === activeBranchId);
        return { sharedItem, matches: relevant };
      })
      .filter((c) => c.matches.length > 0);
  }, [rows, activeBranchId, isAllBranches]);

  if (dismissed || conflicts.length === 0) return null;

  const branchName = (id: string | null) =>
    branches.find((b) => b.id === id)?.name ?? "Branch";

  // Each shared item is charged again to every branch that already has its own copy.
  const doubleCounted = conflicts.reduce(
    (sum, c) => sum + Number(c.sharedItem.monthly_amount) * c.matches.length,
    0
  );

  const handleDismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <Alert variant="destructive" className="border-warning/40 bg-warning/5 text-foreground">
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertTitle className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>Possible overhead double count</span>
        <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={handleDismiss}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {conflicts.length} shared overhead item{conflicts.length === 1 ? "" : "s"} share a name with a
          branch-specific item active in {periodLabel}. Up to{" "}
          <span className="font-medium text-foreground">{formatCurrency(doubleCounted)}/mo</span> may be counted twice
          in branch fixed cost.
        </p>

        {expanded && (
          <div className="space-y-2">
            {conflicts.map(({ sharedItem, matches }) => (
              <div key={sharedItem.id} className="rounded-md border bg-card p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{sharedItem.name}</span>
                  <Badge variant="outline" className="text-xs text-muted-foreground">Shared</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatCurrency(Number(sharedItem.monthly_amount))}/mo
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {matches.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1 w-1 rounded-full bg-warning" />
                      Also charged to <span className="font-medium text-foreground">{branchName(m.branch_id)}</span> as{" "}
                      {formatCurrency(Number(m.monthly_amount))}/mo
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5 mr-1.5" /> : <ChevronDown className="h-3.5 w-3.5 mr-1.5" />}
            {expanded ? "Hide details" : "View details"}
          </Button>
          <Button size="sm" asChild>
            <Link to="/settings?tab=business">
              <Split className="h-3.5 w-3.5 mr-1.5" />
              Re-scope shared overhead
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
