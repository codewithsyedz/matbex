import { Building2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface BranchBadgeProps {
  name?: string | null;
  branchId?: string | null;
  size?: "sm" | "default";
  showIcon?: boolean;
  className?: string;
  untaggedLabel?: string;
  /** When true, the badge is rendered as a compact dot + abbreviation. */
  compact?: boolean;
}

export const branchColorways = [
  "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15",
  "bg-chart-2/10 text-chart-2 border-chart-2/20 hover:bg-chart-2/15",
  "bg-chart-3/10 text-chart-3 border-chart-3/20 hover:bg-chart-3/15",
  "bg-chart-4/10 text-chart-4 border-chart-4/20 hover:bg-chart-4/15",
  "bg-chart-5/10 text-chart-5 border-chart-5/20 hover:bg-chart-5/15",
  "bg-accent text-accent-foreground border-accent/40 hover:bg-accent/80",
  "bg-secondary text-secondary-foreground border-border hover:bg-secondary/80",
];

export function branchColorwayIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h << 5) - h + name.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % branchColorways.length;
}

/** Default label used by the badge when a record has no branch. */
export const UNTAGGED_BRANCH_LABEL = "Untagged";

/**
 * Same labeling rule the badge applies: trimmed branch name, or the untagged
 * label when the record has no branch. Use this anywhere branches are rendered
 * outside the badge (CSV exports, PDFs, tooltips) so labels stay consistent.
 */
export function branchDisplayLabel(
  name?: string | null,
  untaggedLabel: string = UNTAGGED_BRANCH_LABEL,
): string {
  return name?.trim() || untaggedLabel;
}

/** Two-letter abbreviation used by the compact badge variant. */
export function branchInitials(name?: string | null): string {
  const displayName = name?.trim();
  if (!displayName) return "";
  return displayName
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");
}

export function BranchBadge({
  name,
  branchId,
  size = "default",
  showIcon = true,
  className,
  untaggedLabel = "Untagged",
  compact = false,
}: BranchBadgeProps) {
  const displayName = name?.trim() || null;
  const colorway = displayName
    ? branchColorways[branchColorwayIndex(displayName)]
    : branchColorways[0];

  const sizeClasses =
    size === "sm"
      ? "text-[10px] px-1.5 py-0 gap-1"
      : "text-xs px-2.5 py-0.5 gap-1.5";

  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  if (!displayName) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-destructive/40 text-destructive font-normal",
          sizeClasses,
          className,
        )}
      >
        {showIcon && <AlertCircle className={iconSize} />}
        <span>{untaggedLabel}</span>
      </Badge>
    );
  }

  const initials = displayName
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");

  const badgeContent = compact ? (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full justify-center font-medium tabular-nums",
        colorway,
        size === "sm" ? "h-5 w-5 p-0 text-[10px]" : "h-6 w-6 p-0 text-xs",
        className,
      )}
      title={displayName}
    >
      {initials}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full font-normal whitespace-nowrap max-w-full",
        colorway,
        sizeClasses,
        className,
      )}
    >
      {showIcon && <Building2 className={cn(iconSize, "shrink-0")} />}
      <span className="truncate">{displayName}</span>
    </Badge>
  );

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className="inline-flex max-w-[160px]">{badgeContent}</span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-xs">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-medium">{displayName}</p>
            {branchId && (
              <p className="text-[10px] text-muted-foreground font-mono">
                {branchId}
              </p>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
