import { useState } from "react";
import { Lock, MapPin, Copy, Check, AlertTriangle } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchVatRate } from "@/hooks/useBranchVatRate";
import { useBranchResolution } from "@/hooks/useBranchResolution";
import { BranchResolutionPanel } from "@/components/pos/BranchResolutionPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * Shows which branch the currently displayed menu prices come from.
 * On the Android/POS terminal the branch follows the signed-in user's
 * pinned branch, so cashiers can confirm at a glance that prices match
 * their login branch.
 */
export function PricingBranchBanner({ className }: { className?: string }) {
  const { activeBranch, activeBranchId, isAllBranches, pinnedBranchId } = useBranch();
  const branchId = !isAllBranches ? activeBranchId : null;
  const { vatPercent } = useBranchVatRate(branchId);
  const [copied, setCopied] = useState(false);

  const { data: resolution } = useBranchResolution();
  const isPinned = !!pinnedBranchId && pinnedBranchId === branchId;

  // Detect a mismatch between the user's login branch and the branch actually
  // resolved by the terminal API (terminal pin or primary fallback may override).
  const loginBranchId = resolution?.staffBranch ?? pinnedBranchId ?? null;
  const resolvedBranchId = resolution?.resolved ?? branchId;
  const mismatch =
    loginBranchId &&
    resolvedBranchId &&
    loginBranchId !== resolvedBranchId &&
    resolution?.source !== "user";

  const loginBranchName = loginBranchId
    ? resolution?.names.get(loginBranchId) ?? activeBranch?.name ?? "Unknown branch"
    : null;
  const resolvedBranchName = resolvedBranchId
    ? resolution?.names.get(resolvedBranchId) ?? activeBranch?.name ?? "Unknown branch"
    : null;

  const whatChanged = mismatch
    ? resolution?.source === "terminal"
      ? `This terminal is pinned to ${resolvedBranchName}, so prices are served from there even though your login branch is ${loginBranchName}.`
      : resolution?.source === "primary"
        ? `You are not assigned to a branch and this terminal is not pinned, so the primary branch ${resolvedBranchName} is used as a fallback.`
        : `Prices are being served from ${resolvedBranchName} instead of your login branch ${loginBranchName}.`
    : null;

  const copyId = async () => {
    if (!branchId) return;
    try {
      await navigator.clipboard.writeText(branchId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className={cn("border-b", className)}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 bg-muted/40 text-xs",
        )}
      >
        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-muted-foreground">Pricing branch:</span>
        <span className="font-medium text-foreground">
          {branchId ? activeBranch?.name ?? "Unknown branch" : "All branches (base prices)"}
        </span>
        {isPinned && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Lock className="h-3 w-3" /> your login branch
          </span>
        )}
        {branchId && (
          <button
            type="button"
            onClick={copyId}
            title="Copy branch ID"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {branchId}
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {branchId && (
            <span className="text-muted-foreground tabular-nums">VAT {vatPercent}% incl.</span>
          )}
          <BranchResolutionPanel />
        </span>
      </div>

      {mismatch && (
        <div className="px-4 py-2">
          <Alert variant="warning" className="text-xs py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Pricing branch differs from your login branch</AlertTitle>
            <AlertDescription>
              <p>
                Your login branch is <span className="font-medium">{loginBranchName}</span> but
                prices are being served from{" "}
                <span className="font-medium">{resolvedBranchName}</span>.
              </p>
              {whatChanged && <p className="mt-1 opacity-80">{whatChanged}</p>}
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
