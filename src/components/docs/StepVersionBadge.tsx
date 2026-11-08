import { Sparkles, RefreshCw, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLatestStepVersion, useDocsStepVersions } from "@/hooks/useDocsVersions";
import { useDocsVersionContext } from "./DocsVersionContext";

interface Props {
  anchor: string;
}

/**
 * Per-step badge: "Added in vX" / "Updated in vX" with tooltip showing
 * the change summary and release date. Also indicates if the step did not
 * yet exist in the currently selected version.
 */
export function StepVersionBadge({ anchor }: Props) {
  const latest = useLatestStepVersion(anchor);
  const { data: allSteps } = useDocsStepVersions();
  const { selected, versions } = useDocsVersionContext();

  if (!latest || !latest.version) return null;

  // Determine the entry that applies to the currently selected version (if any).
  let appliesToSelected = latest;
  if (selected && allSteps) {
    const orderIndex = new Map(versions.map((v, i) => [v.id, i])); // 0 = newest
    const selectedIdx = orderIndex.get(selected.id) ?? 0;
    const candidate = allSteps
      .filter((s) => s.anchor === anchor && (orderIndex.get(s.version_id) ?? 999) >= selectedIdx)
      .sort(
        (a, b) =>
          (orderIndex.get(a.version_id) ?? 999) - (orderIndex.get(b.version_id) ?? 999),
      )[0];
    if (candidate) appliesToSelected = candidate;
  }

  // If the latest entry for this step is newer than the selected version,
  // surface a "not yet in vX" notice.
  const orderIndex = new Map(versions.map((v, i) => [v.id, i]));
  const latestIdx = orderIndex.get(latest.version_id) ?? 0;
  const selectedIdx = selected ? orderIndex.get(selected.id) ?? 0 : 0;
  const notYetIntroduced = selected && latestIdx > selectedIdx && !appliesToSelected;

  if (notYetIntroduced) {
    return (
      <Badge variant="outline" className="gap-1.5 text-[11px] font-light border-dashed">
        <AlertTriangle className="h-3 w-3" />
        Not in v{selected!.version} — introduced in v{latest.version!.version}
      </Badge>
    );
  }

  const entry = appliesToSelected;
  const ver = entry.version!;
  const isAdded = entry.change_type === "added";
  const Icon = isAdded ? Sparkles : RefreshCw;
  const label = isAdded ? "Added" : entry.change_type === "deprecated" ? "Deprecated" : "Updated";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={isAdded ? "default" : "secondary"}
            className="gap-1.5 text-[11px] font-light cursor-help"
          >
            <Icon className="h-3 w-3" />
            {label} in v{ver.version}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-medium">v{ver.version}</span>
              <span className="text-[11px] text-muted-foreground">
                {format(parseISO(ver.released_at), "MMM d, yyyy")}
              </span>
            </div>
            {entry.change_summary && (
              <p className="text-xs font-light">{entry.change_summary}</p>
            )}
            {(ver.app_version || ver.schema_version) && (
              <p className="text-[11px] text-muted-foreground font-mono">
                {ver.app_version && `app ${ver.app_version}`}
                {ver.app_version && ver.schema_version && " · "}
                {ver.schema_version && `schema ${ver.schema_version}`}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}