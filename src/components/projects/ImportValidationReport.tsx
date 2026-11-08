import { AlertTriangle, CheckCircle2, Download, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadValidationReport, type ValidationReport } from "@/lib/importValidation";

const FIELD_LABELS: Record<string, string> = {
  vendor_name: "Vendor / item",
  txn_date: "Date",
  amount: "Amount",
  paid_by_name: "Paid by",
  cost_center: "Cost centre",
  notes: "Notes",
  status: "Status",
  row: "Row",
};

export function ImportValidationReport({
  report,
  fileName = "import-validation-report.csv",
}: {
  report: ValidationReport;
  fileName?: string;
}) {
  const flagged = report.rows.filter((r) => r.issues.length > 0);
  const okCount = report.validRows.length;

  if (report.rows.length === 0) return null;

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          {okCount} row{okCount === 1 ? "" : "s"} ready
        </span>
        {report.errorCount > 0 && (
          <span className="flex items-center gap-1.5 text-destructive">
            <XCircle className="h-3.5 w-3.5" />
            {report.errorCount} blocked
          </span>
        )}
        {report.warningCount > 0 && (
          <span className="flex items-center gap-1.5 text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {report.warningCount} with warnings
          </span>
        )}
        {report.blankRows > 0 && (
          <span className="text-muted-foreground">{report.blankRows} blank rows skipped</span>
        )}
        {flagged.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => downloadValidationReport(report, fileName)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Error report (CSV)
          </Button>
        )}
      </div>

      {flagged.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Every row passed validation — required fields, amounts and dates all parsed cleanly.
        </p>
      ) : (
        <ScrollArea className="max-h-[200px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Row</TableHead>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead className="w-32">Field</TableHead>
                <TableHead>Issue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flagged.flatMap((r) =>
                r.issues.map((issue, i) => (
                  <TableRow key={`${r.rowNumber}-${i}`}>
                    <TableCell className="text-xs">{r.rowNumber}</TableCell>
                    <TableCell>
                      <Badge
                        variant={issue.severity === "error" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {issue.severity === "error" ? "Blocked" : "Warning"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{FIELD_LABELS[issue.field] ?? issue.field}</TableCell>
                    <TableCell className="text-xs">
                      {issue.message}
                      {issue.raw ? <span className="text-muted-foreground"> · got “{issue.raw}”</span> : null}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  );
}
