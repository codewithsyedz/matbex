import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBranch } from "@/contexts/BranchContext";

/**
 * Explains why a daily total can differ between a single-branch view and the
 * "All branches" view. Kept in one place so every chart/card says the same
 * thing.
 */
export const BRANCH_TOTALS_EXPLANATION = {
  branch: [
    "Totals come from this branch's POS transactions plus day-end adjustments tagged to this branch.",
    "The operator's closed day-end summary (Adjusted Total) is recorded for the whole restaurant, so it is not applied here.",
    "Sales or adjustments without a branch tag are excluded from this view.",
  ],
  all: [
    "Totals start from all POS transactions and day-end adjustments across branches.",
    "When a day is closed, the operator's day-end summary (Adjusted Total) overrides the raw POS total for that day.",
    "Because of that override and untagged entries, the sum of branch views can differ from this total.",
  ],
} as const;

export function BranchTotalsExplainerTooltip({
  className,
}: {
  className?: string;
}) {
  const { isAllBranches, activeBranch } = useBranch();
  const lines = isAllBranches
    ? BRANCH_TOTALS_EXPLANATION.all
    : BRANCH_TOTALS_EXPLANATION.branch;
  const title = isAllBranches
    ? "How the All branches total is calculated"
    : `How the ${activeBranch?.name ?? "branch"} total is calculated`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Why do branch and All branches totals differ?"
            className={className}
          >
            <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-medium mb-1">{title}</p>
          <ul className="space-y-1 list-disc pl-4">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function BranchTotalsExplainerBanner({
  className = "",
}: {
  className?: string;
}) {
  const { isAllBranches, activeBranch, hasMultipleBranches } = useBranch();
  if (!hasMultipleBranches) return null;
  const lines = isAllBranches
    ? BRANCH_TOTALS_EXPLANATION.all
    : BRANCH_TOTALS_EXPLANATION.branch;
  const scopeLabel = isAllBranches
    ? "All branches combined"
    : activeBranch?.name ?? "Current branch";

  return (
    <div
      className={`flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground ${className}`}
    >
      <Info className="h-4 w-4 shrink-0 text-primary" />
      <span className="font-semibold text-foreground">{scopeLabel}</span>
      <span aria-hidden="true" className="text-border">•</span>
      <span>{isAllBranches ? "Restaurant-wide reconciled totals" : "Branch-tagged sales and adjustments only"}</span>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="ml-auto inline-flex min-h-10 items-center font-semibold text-primary transition-colors hover:text-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              How totals work
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-sm text-xs">
            <ul className="list-disc space-y-1 pl-4">
              {lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}