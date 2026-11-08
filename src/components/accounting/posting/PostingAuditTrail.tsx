import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePostingAudit } from "@/hooks/usePostingCenter";
import { format } from "date-fns";

interface Props {
  branchId: string | null;
}

const sourceColor: Record<string, string> = {
  manual: "bg-primary/10 text-primary border-primary/30",
  bulk: "bg-accent text-accent-foreground border-primary/20",
  auto_trigger: "bg-muted text-muted-foreground border-border",
  reconcile_job: "bg-success/10 text-success border-success/30",
};

const outcomeColor: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  blocked: "bg-warning/10 text-warning border-warning/30",
  needs_manual_review: "bg-destructive/10 text-destructive border-destructive/30",
};

export function PostingAuditTrail({ branchId }: Props) {
  const { data: rows = [], isLoading } = usePostingAudit(branchId, 200);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Posting audit trail</CardTitle>
        <p className="text-xs text-muted-foreground">
          Every post, skip, and reconcile attempt with who/when/why.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground p-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No posting activity yet.
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Time</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">Outcome</TableHead>
                  <TableHead className="text-xs">Source</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">Expense</TableHead>
                  <TableHead className="text-xs">Batch</TableHead>
                  <TableHead className="text-xs text-right">DR / CR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs tabular-nums whitespace-nowrap">
                      {format(new Date(r.created_at), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell className="text-xs capitalize">{r.action}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${outcomeColor[r.outcome] ?? ""}`}
                      >
                        {r.outcome.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${sourceColor[r.trigger_source] ?? ""}`}
                      >
                        {r.trigger_source.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono">{r.reason_code}</div>
                      {r.reason_detail && (
                        <div className="text-muted-foreground truncate max-w-xs">
                          {r.reason_detail}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {r.expense_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {r.batch_id ? r.batch_id.slice(0, 8) + "…" : "—"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-right">
                      {r.dr_total != null && r.cr_total != null
                        ? `${Number(r.dr_total).toFixed(2)} / ${Number(r.cr_total).toFixed(2)}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}