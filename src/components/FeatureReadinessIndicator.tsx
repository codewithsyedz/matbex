import { cn } from "@/lib/utils";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useAuth } from "@/contexts/AuthContext";

export type FeatureState = "locked" | "preview" | "enabled";

interface FeatureReadinessIndicatorProps {
  featureKey: string;
  showLabel?: boolean;
  className?: string;
}

/**
 * Shows a small readiness badge for a feature-gated capability.
 *
 * Locked  = not included in current plan
 * Preview = plan has it, but remote feature flag is OFF (invisible to end users)
 * Enabled = plan has it AND remote flag is ON (fully live)
 */
export function FeatureReadinessIndicator({
  featureKey,
  showLabel = true,
  className,
}: FeatureReadinessIndicatorProps) {
  const { hasFeature } = useAuth();
  const flagEnabled = useFeatureFlag(featureKey, true); // default true = enabled if flag missing

  const hasPlanFeature = hasFeature(featureKey);

  let state: FeatureState;
  let label: string;
  let colorClass: string;

  if (!hasPlanFeature) {
    state = "locked";
    label = "Locked";
    colorClass = "bg-muted text-muted-foreground border border-border";
  } else if (!flagEnabled) {
    state = "preview";
    label = "Preview";
    colorClass = "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900";
  } else {
    state = "enabled";
    label = "Enabled";
    colorClass = "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none whitespace-nowrap",
        colorClass,
        className
      )}
      title={
        state === "locked"
          ? "Not included in your plan - upgrade to unlock"
          : state === "preview"
          ? "Available in plan but currently off via remote flag"
          : "Fully enabled"
      }
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full mr-1 flex-shrink-0",
          state === "locked" && "bg-muted-foreground/50",
          state === "preview" && "bg-amber-500",
          state === "enabled" && "bg-emerald-500"
        )}
      />
      {showLabel && label}
    </span>
  );
}
