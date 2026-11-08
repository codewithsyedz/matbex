import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, CheckCircle2, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  tenantId?: string;
  branchId?: string | null;
  fmt: (n: number) => string;
  branchNameById: (id: string | null) => string;
  canManage?: boolean;
}

/**
 * Live feed of installment (BNPL) VAT mismatches raised by the database
 * watcher whenever plans or their ledger batches change.
 */
export function InstallmentVatAlertsPanel({
  tenantId,
  branchId,
  fmt,
  branchNameById,
  canManage,
}: Props) {
  const qc = useQueryClient();

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["installment-vat-alerts", tenantId, branchId],
    enabled: !!tenantId,
    queryFn: async () => {
      let q = (supabase as any)
        .from("installment_vat_mismatch_alerts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "open")
        .order("detected_at", { ascending: false });
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("installment_vat_mismatch_alerts")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alert dismissed");
      qc.invalidateQueries({ queryKey: ["installment-vat-alerts"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not dismiss the alert"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            Installment VAT alerts
          </CardTitle>
          <CardDescription className="text-xs">
            Raised automatically when an installment plan's recoverable VAT stops matching the input
            VAT posted to its ledger batch. Owners, managers and accountants are notified in-app.
          </CardDescription>
        </div>
        {!isLoading && (
          <Badge variant="outline" className="gap-1 text-xs font-normal">
            {alerts?.length ? (
              <>
                <AlertTriangle className="h-3 w-3 text-destructive" /> {alerts.length} open
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> All clear
              </>
            )}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !alerts?.length ? (
          <p className="text-xs text-muted-foreground">
            No open installment VAT mismatches for this scope.
          </p>
        ) : (
          <ScrollArea className="max-h-72">
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className="rounded-md border p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {branchNameById(a.branch_id)}
                    </Badge>
                    <span className="text-muted-foreground">{a.purchase_date || "—"}</span>
                    <span className="ml-auto font-semibold text-destructive tabular-nums">
                      {fmt(Number(a.difference))}
                    </span>
                  </div>
                  <p className="mt-1.5">{a.detail}</p>
                  <p className="mt-1 text-muted-foreground">
                    Goods VAT {fmt(Number(a.goods_vat))} · Finance VAT {fmt(Number(a.finance_vat))} ·
                    Expected {fmt(Number(a.expected_vat))} · Posted {fmt(Number(a.posted_vat))}
                  </p>
                  {canManage && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dismiss.isPending}
                        onClick={() => dismiss.mutate(a.id)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default InstallmentVatAlertsPanel;
