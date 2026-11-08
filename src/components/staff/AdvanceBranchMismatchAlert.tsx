import { AlertTriangle, Building2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AdvanceBranchIssue } from "@/lib/advanceBranchMismatch";

/** Inline warning badge used inside dense tables. */
export function BranchMismatchBadge({
  issues,
  label = "Branch mismatch",
}: {
  issues: AdvanceBranchIssue[];
  label?: string;
}) {
  if (issues.length === 0) return null;
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="gap-1 border-amber-300 bg-amber-50 text-amber-700"
          >
            <AlertTriangle className="h-3 w-3" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {issues.map((i, idx) => (
              <li key={`${i.code}-${idx}`}>{i.message}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Full-width warning panel listing every branch inconsistency. */
export function AdvanceBranchMismatchAlert({
  issues,
  title = "Branch mismatch detected",
}: {
  issues: AdvanceBranchIssue[];
  title?: string;
}) {
  if (issues.length === 0) return null;
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-800">
      <Building2 className="h-4 w-4 !text-amber-600" />
      <AlertTitle className="text-amber-800">{title}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
          {issues.map((i, idx) => (
            <li key={`${i.code}-${idx}`}>{i.message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}