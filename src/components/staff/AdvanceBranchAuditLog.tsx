import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, History } from "lucide-react";

interface AuditRow {
  id: string;
  advance_id: string;
  staff_name: string | null;
  advance_date: string | null;
  amount: number | null;
  changed_at: string;
  changed_by_name: string | null;
  old_branch_id: string | null;
  old_branch_name: string | null;
  new_branch_id: string | null;
  new_branch_name: string | null;
  ledger_legs_updated: number | null;
  source: string | null;
  note: string | null;
}

const shortId = (id: string | null) => (id ? `${id.slice(0, 8)}…` : "—");

/** Audit trail of branch reassignments on staff advances. */
export function AdvanceBranchAuditLog({ limit = 50 }: { limit?: number }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["advance-branch-audit", limit],
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>
          ) => Promise<{ data: unknown; error: { message: string } | null }>;
        }
      ).rpc("list_advance_branch_audit", { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as AuditRow[];
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Branch change audit log
          {rows.length > 0 && <Badge variant="outline">{rows.length}</Badge>}
        </CardTitle>
        <CardDescription>
          Who moved an advance between branches, which records were updated, and the before/after
          branch IDs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No branch changes recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Changed by</TableHead>
                  <TableHead>Advance</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Records updated</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.changed_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{r.changed_by_name ?? "System"}</TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{r.staff_name ?? "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.advance_date ?? "deleted"} · {shortId(r.advance_id)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{r.old_branch_name ?? "—"}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {shortId(r.old_branch_id)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1">
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        {r.new_branch_name ?? "—"}
                      </span>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {shortId(r.new_branch_id)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      1 advance · {r.ledger_legs_updated ?? 0} ledger leg
                      {(r.ledger_legs_updated ?? 0) === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary">{r.source ?? "manual_update"}</Badge>
                      {r.note && (
                        <div className="mt-1 text-muted-foreground">{r.note}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
