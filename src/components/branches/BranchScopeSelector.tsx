import { Building2, Lock } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface BranchScopeSelectorProps {
  /** Small caption rendered under the control. */
  hint?: string;
  /** Show the "Branch" label chip before the control. */
  showLabel?: boolean;
  className?: string;
}

/**
 * Visible, page-level branch selector bound directly to BranchContext.
 *
 * Every chart/report that reads `activeBranchId` (or `pinnedBranchId`) stays
 * synchronized with this control - and with the global header switcher -
 * because there is a single source of truth.
 */
export function BranchScopeSelector({
  hint = "All charts on this page follow this branch",
  showLabel = true,
  className,
}: BranchScopeSelectorProps) {
  const {
    branches,
    activeBranchId,
    isAllBranches,
    setActiveBranchId,
    canSwitchBranches,
    pinnedBranchId,
    hasMultipleBranches,
    isLoading,
  } = useBranch();
  const { hasRole } = useAuth();

  if (isLoading || !hasMultipleBranches) return null;

  const canSeeAll = hasRole("owner") || hasRole("manager") || hasRole("accountant");
  const pinnedName = branches.find((b) => b.id === pinnedBranchId)?.name;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        {showLabel && (
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Branch
          </span>
        )}
        {!canSwitchBranches ? (
          <div
            className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/40 text-sm"
            title="You're assigned to this branch"
          >
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate max-w-[160px]">{pinnedName ?? "Branch"}</span>
            <Lock className="h-3 w-3 text-muted-foreground" />
          </div>
        ) : (
          <Select
            value={isAllBranches ? "all" : activeBranchId ?? ""}
            onValueChange={(v) => setActiveBranchId(v as string | "all")}
          >
            <SelectTrigger className="w-[200px] h-9">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent className="z-50 bg-popover">
              {canSeeAll && <SelectItem value="all">All branches</SelectItem>}
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
