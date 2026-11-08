import { Download, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PostingRuleAlert } from "@/components/accounting/PostingRuleAlert";
import {
  downloadImportPostingRuleReport,
  type ImportPostingRuleReport as Report,
} from "@/lib/importPostingRules";
import { REJECTION_RULE_LABELS } from "@/lib/postingRejectionLog";

/** Per-row posting-rule failures for an import preview. */
export function ImportPostingRuleReport({
  report,
  fileName = "import-posting-rule-errors.csv",
}: {
  report: Report;
  fileName?: string;
}) {
  if (report.blockedCount === 0) return null;

  return (
    <div className="rounded-md border border-destructive/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-destructive">
          <ShieldAlert className="h-3.5 w-3.5" />
          {report.blockedCount} row{report.blockedCount === 1 ? "" : "s"} break a posting rule — posting is
          blocked
        </span>
        {report.ruleCounts.map((r) => (
          <Badge key={r.rule} variant="outline" className="text-[10px] font-normal">
            {REJECTION_RULE_LABELS[r.rule] ?? r.rule} · {r.count}
          </Badge>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={() => downloadImportPostingRuleReport(report, fileName)}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          Export reasons
        </Button>
      </div>
      <ScrollArea className="max-h-[260px]">
        <div className="space-y-3 p-3">
          {report.violations.map((v, i) => (
            <div key={`${v.rowNumber}-${i}`} className="space-y-1">
              <p className="text-xs font-medium">
                Sheet row {v.rowNumber}
                {v.accountText ? ` · ${v.accountText}` : ""}
              </p>
              <PostingRuleAlert violation={v.violation} />
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}