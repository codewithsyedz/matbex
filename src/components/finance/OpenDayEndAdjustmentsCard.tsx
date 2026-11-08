import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const db = supabase as any;
const UNASSIGNED = "unassigned";

interface OpenAdjustment {
  id: string;
  business_date: string;
  branch_id: string | null;
  scope: string;
  reason: string;
  notes: string | null;
  amount: number;
}

interface Props {
  from: Date | null;
  to: Date | null;
  branchId: string | null;
}

/**
 * Day-end adjustments recorded but not yet posted to the ledger, grouped per
 * branch so the whole branch can be closed in one click.
 */
export function OpenDayEndAdjustmentsCard({ from, to, branchId }: Props) {
  const { profile } = useAuth();
  const { branches } = useBranch();
  const { format: fmt } = useCurrency();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id;

  const fromStr = from ? format(from, "yyyy-MM-dd") : null;
  const toStr = to ? format(to, "yyyy-MM-dd") : null;
  const branchKey = branchId && branchId !== "all" ? branchId : null;
  const [busyBranch, setBusyBranch] = useState<string | null>(null);

  const { data, isLoading } = useQuery<OpenAdjustment[]>({
    queryKey: ["open-day-end-adjustments", tenantId, fromStr, toStr, branchKey],
    enabled: !!tenantId && !!fromStr && !!toStr,
    staleTime: 30_000,
    queryFn: async () => {
      let q = db
        .from("day_end_adjustments")
        .select("id, business_date, branch_id, scope, reason, notes, amount")
        .eq("tenant_id", tenantId)
        .eq("ledger_posted", false)
        .is("reversed_at", null)
        .gte("business_date", fromStr)
        .lte("business_date", toStr)
        .order("business_date", { ascending: true });
      if (branchKey) q = q.eq("branch_id", branchKey);
      const { data: rows, error } = await q;
      if (error) throw error;
      return (rows || []).map((r: any) => ({ ...r, amount: Number(r.amount || 0) }));
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, OpenAdjustment[]>();
    for (const row of data || []) {
      const key = row.branch_id ?? UNASSIGNED;
      const arr = map.get(key) ?? [];
      arr.push(row);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      branchId: key,
      items,
      total: items.reduce((s, i) => s + i.amount, 0),
    }));
  }, [data]);

  const branchName = (id: string) =>
    id === UNASSIGNED ? "Unassigned" : branches.find((b) => b.id === id)?.name ?? id.slice(0, 8);

  const postMutation = useMutation({
    mutationFn: async (items: OpenAdjustment[]) => {
      let posted = 0;
      const failures: string[] = [];
      for (const item of items) {
        const { error } = await db.rpc("post_day_end_adjustment_to_ledger", {
          p_adjustment_id: item.id,
        });
        if (error) failures.push(`${item.business_date}: ${error.message}`);
        else posted++;
      }
      return { posted, failures };
    },
    onSuccess: ({ posted, failures }) => {
      if (posted > 0) toast.success(`Posted ${posted} adjustment${posted === 1 ? "" : "s"}`);
      if (failures.length > 0)
        toast.error(`${failures.length} failed`, { description: failures[0] });
      qc.invalidateQueries({ queryKey: ["open-day-end-adjustments"] });
      qc.invalidateQueries({ queryKey: ["trial-balance"] });
      qc.invalidateQueries({ queryKey: ["daily-profit"] });
      qc.invalidateQueries({ queryKey: ["profit-loss"] });
      qc.invalidateQueries({ queryKey: ["account-transactions"] });
      qc.invalidateQueries({ queryKey: ["day-end-adjustments"] });
    },
    onError: (e: any) => toast.error("Posting failed", { description: e?.message }),
    onSettled: () => setBusyBranch(null),
  });

  const runPost = (key: string, items: OpenAdjustment[]) => {
    setBusyBranch(key);
    postMutation.mutate(items);
  };

  const allItems = data || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Day-end adjustments
          </CardTitle>
          <CardDescription>
            Open entries not yet posted to the ledger for the selected period.
          </CardDescription>
        </div>
        {allItems.length > 0 && (
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={postMutation.isPending}
            onClick={() => runPost("__all__", allItems)}
          >
            {busyBranch === "__all__" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Close all ({allItems.length})
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            All day-end adjustments in this period are posted.
          </p>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <div className="space-y-4 pr-2">
              {groups.map((g) => (
                <div key={g.branchId} className="rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{branchName(g.branchId)}</span>
                      <Badge variant="secondary" className="font-normal">
                        {g.items.length} open
                      </Badge>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {fmt(g.total)}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      disabled={postMutation.isPending}
                      onClick={() => runPost(g.branchId, g.items)}
                    >
                      {busyBranch === g.branchId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Close branch
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-9">Date</TableHead>
                        <TableHead className="h-9">Scope</TableHead>
                        <TableHead className="h-9">Reason</TableHead>
                        <TableHead className="h-9 text-right">Amount</TableHead>
                        <TableHead className="h-9 w-[90px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="py-2 whitespace-nowrap">
                            {format(new Date(`${item.business_date}T00:00:00`), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell className="py-2 capitalize">
                            {String(item.scope).replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="py-2 text-muted-foreground">
                            {item.notes || String(item.reason).replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums">
                            {fmt(item.amount)}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              disabled={postMutation.isPending}
                              onClick={() => runPost(item.id, [item])}
                            >
                              {busyBranch === item.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Post"
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
