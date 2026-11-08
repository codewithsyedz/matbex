import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, BellRing, CheckCircle2, EyeOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { BranchBadge } from "@/components/branch/BranchBadge";

const ISSUE_LABEL: Record<string, string> = {
  vat_on_top: "VAT added on top",
  wrong_split: "Net/VAT split incorrect",
  missing_vat: "VAT missing",
  items_mismatch: "Total ≠ line items",
};

type StatusFilter = "open" | "resolved" | "ignored" | "all";

interface Props {
  restaurantId?: string;
  branchId: string;
  branchName: (id: string | null) => string;
  fmt: (n: number) => string;
}

/**
 * Live incident feed: a DB trigger opens a vat_incidents row whenever a sale
 * fails VAT-inclusive reconciliation. This panel alerts on new ones and lets
 * managers resolve or ignore them.
 */
export function VatIncidentsPanel({ restaurantId, branchId, branchName, fmt }: Props) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("open");

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ["vat-incidents", restaurantId, branchId, status],
    enabled: !!restaurantId,
    staleTime: 30_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from("vat_incidents")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (status !== "all") q = q.eq("status", status);
      if (branchId && branchId !== "all") q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Realtime alert for newly detected incidents.
  useEffect(() => {
    if (!restaurantId) return;
    const channel = supabase
      .channel(`vat-incidents-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vat_incidents",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        (payload: any) => {
          const row = payload.new;
          if (payload.eventType === "INSERT" && row?.status === "open") {
            toast.warning(
              `VAT mismatch on ${row.receipt_number ?? "new sale"}: ${
                ISSUE_LABEL[row.issue_kind] ?? row.issue_kind
              }`,
              { description: `${branchName(row.branch_id)} · expected total ${fmt(Number(row.expected_total ?? 0))}` },
            );
          }
          queryClient.invalidateQueries({ queryKey: ["vat-incidents"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId, queryClient, branchName, fmt]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: "resolved" | "ignored" | "open" }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("vat_incidents")
        .update({
          status: next,
          resolved_at: next === "open" ? null : new Date().toISOString(),
          resolved_by: next === "open" ? null : auth?.user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Incident updated");
      queryClient.invalidateQueries({ queryKey: ["vat-incidents"] });
    },
    onError: (e: any) => toast.error(e?.message || "Could not update incident"),
  });

  const openCount = useMemo(
    () => incidents.filter((i) => i.status === "open").length,
    [incidents],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" /> Incidents
            {status === "open" && openCount > 0 && (
              <Badge variant="destructive">{openCount} open</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Automatically raised whenever a new or edited sale fails VAT-inclusive
            reconciliation.
          </CardDescription>
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents…
          </div>
        ) : incidents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-6 w-6 text-primary" />
            <p className="text-sm text-muted-foreground">
              No {status === "all" ? "" : status} incidents for this branch.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">Stored</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.receipt_number ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(i.created_at), "dd MMM yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="max-w-[150px]">
                      <BranchBadge
                        size="sm"
                        branchId={i.branch_id}
                        name={i.branch_id ? branchName(i.branch_id) : null}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {ISSUE_LABEL[i.issue_kind] ?? i.issue_kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(Number(i.stored_total))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(Number(i.expected_total))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(Number(i.delta))}
                    </TableCell>
                    <TableCell className="text-right">
                      {i.status === "open" ? (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1"
                            onClick={() => updateStatus.mutate({ id: i.id, next: "resolved" })}
                            disabled={updateStatus.isPending}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1"
                            onClick={() => updateStatus.mutate({ id: i.id, next: "ignored" })}
                            disabled={updateStatus.isPending}
                          >
                            <EyeOff className="h-3.5 w-3.5" /> Ignore
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="secondary">{i.status}</Badge>
                      )}
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
