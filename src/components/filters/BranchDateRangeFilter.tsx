import { useMemo } from "react";
import { startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths } from "date-fns";
import { DateRange } from "react-day-picker";
import { Building2, Lock, Link2, Share2 } from "lucide-react";

import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/reports/DateRangePicker";

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "this-month"
  | "last-month"
  | "custom";

export function resolvePreset(preset: DateRangePreset): DateRange | undefined {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "30d":
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "this-month":
      return { from: startOfMonth(now), to: endOfDay(now) };
    case "last-month": {
      const ref = subMonths(now, 1);
      return { from: startOfMonth(ref), to: endOfMonth(ref) };
    }
    case "custom":
    default:
      return undefined;
  }
}

interface BranchDateRangeFilterProps {
  /** "all" for owners/managers wanting cross-branch view; "untagged" for records with no branch; null for the active branch */
  branchId: string | "all" | "untagged" | null;
  onBranchChange: (next: string | "all" | "untagged") => void;
  preset: DateRangePreset;
  onPresetChange: (next: DateRangePreset) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (next: DateRange | undefined) => void;
}

/**
 * A page-level filter combining branch and date-range selection.
 * Respects branch pinning - pinned staff see a locked chip instead of a dropdown.
 */
export function BranchDateRangeFilter({
  branchId,
  onBranchChange,
  preset,
  onPresetChange,
  dateRange,
  onDateRangeChange,
}: BranchDateRangeFilterProps) {
  const { branches, hasMultipleBranches, canSwitchBranches, pinnedBranchId } = useBranch();
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const canSeeAll = hasRole("owner") || hasRole("manager") || hasRole("accountant");

  const branchValue = branchId === "all" ? "all" : branchId ?? "";
  const pinnedBranch = useMemo(
    () => branches.find((b) => b.id === pinnedBranchId),
    [branches, pinnedBranchId],
  );

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Link copied to clipboard", description: "Share this URL to open the same filtered view." });
    } catch {
      toast({ title: "Failed to copy link", variant: "destructive" });
    }
  };

  const handleSystemShare = async () => {
    const url = window.location.href;
    const shareData: ShareData = {
      title: "Matbex",
      text: "Check this report on Matbex:",
      url,
    };
    if (navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied to clipboard", description: "Share this URL to open the same filtered view." });
    } catch {
      toast({ title: "Failed to share", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasMultipleBranches && (
        <>
          {!canSwitchBranches ? (
            <div
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-muted/40 text-sm"
              title="You're assigned to this branch"
            >
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate max-w-[160px]">{pinnedBranch?.name ?? "Branch"}</span>
              <Lock className="h-3 w-3 text-muted-foreground" />
            </div>
          ) : (
            <Select value={branchValue} onValueChange={(v) => onBranchChange(v as string | "all" | "untagged")}>
              <SelectTrigger className="w-[180px] h-9">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground mr-1.5" />
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent className="z-50 bg-popover">
                {canSeeAll && <SelectItem value="all">All branches</SelectItem>}
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
                <SelectItem value="untagged">Untagged</SelectItem>
              </SelectContent>
            </Select>
          )}
        </>
      )}

      <Select value={preset} onValueChange={(v) => onPresetChange(v as DateRangePreset)}>
        <SelectTrigger className="w-[160px] h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-50 bg-popover">
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="yesterday">Yesterday</SelectItem>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="this-month">This month</SelectItem>
          <SelectItem value="last-month">Last month</SelectItem>
          <SelectItem value="custom">Custom range…</SelectItem>
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <DateRangePicker dateRange={dateRange} onDateRangeChange={onDateRangeChange} />
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5"
        onClick={handleCopyShareLink}
        title="Copy shareable link"
      >
        <Link2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Copy link</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5"
        onClick={handleSystemShare}
        title="Share via email, SMS, or apps"
      >
        <Share2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Share</span>
      </Button>
    </div>
  );
}