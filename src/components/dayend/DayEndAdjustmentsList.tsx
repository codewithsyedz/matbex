import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RotateCcw, ShieldAlert, History } from "lucide-react";
import { DAY_END_REASONS, type DayEndScope } from "./DayEndAdjustmentDialog";

interface AdjustmentRow {
  id: string;
  business_date: string;
  scope: DayEndScope;
  reason: string;
  notes: string;
  amount: number;
  ledger_posted: boolean;
  created_at: string;
  created_by: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  reversed_adjustment_id: string | null;
  reversal_of_id: string | null;
}

interface Props {
  scope?: DayEndScope;
  limit?: number;
}

export function DayEndAdjustmentsList({ scope, limit = 25 }: Props) {
  const { t, i18n } = useTranslation();
  const { tenant } = useAuth();
  const { activeBranchId, isAllBranches } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();

  const [reverseTarget, setReverseTarget] = useState<AdjustmentRow | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: [
      "day-end-adjustments",
      tenant?.id,
      scope,
      limit,
      isAllBranches ? "all" : activeBranchId,
    ],
    queryFn: async () => {
      if (!tenant?.id) return [];
      let q = db
        .from("day_end_adjustments")
        .select(
          "id, business_date, scope, reason, notes, amount, ledger_posted, created_at, created_by, reversed_at, reversed_by, reversal_reason, reversed_adjustment_id, reversal_of_id",
        )
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (scope) q = q.eq("scope", scope);
      if (!isAllBranches && activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AdjustmentRow[];
    },
    enabled: !!tenant?.id,
  });

  // Collect unique user ids to label "by …"
  const userIds = Array.from(
    new Set(
      (data ?? [])
        .flatMap((r) => [r.created_by, r.reversed_by])
        .filter((v): v is string => !!v),
    ),
  );

  const { data: profiles } = useQuery({
    queryKey: ["dea-profiles", userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const p of data ?? []) map.set(p.id, p.full_name ?? p.id.slice(0, 8));
      return map;
    },
  });

  const nameOf = (id: string | null | undefined) =>
    id ? profiles?.get(id) ?? id.slice(0, 8) : "-";

  const reverseMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await db.rpc(
        "reverse_day_end_adjustment" as never,
        { p_adjustment_id: id, p_reason: reason } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(t("app.expenses.adjustments.reversedToast"));
      queryClient.invalidateQueries({ queryKey: ["day-end-adjustments"] });
      setReverseTarget(null);
      setReversalReason("");
    },
    onError: (e: Error) => toast.error(e.message ?? t("app.expenses.adjustments.reversalFailed")),
  });

  const reasonLabel = (v: string) =>
    DAY_END_REASONS.find((r) => r.value === v)?.label ?? v;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
           {t("app.expenses.adjustments.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
             <Loader2 className="h-4 w-4 me-2 animate-spin" /> {t("common.loading")}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
             {t("app.expenses.adjustments.empty")}
          </p>
        ) : (
          <ScrollArea className="max-h-[420px] pe-2">
            <div className="space-y-2">
              <TooltipProvider>
                {data.map((row) => {
                  const isReversal = !!row.reversal_of_id;
                  const isReversed = !!row.reversed_at;
                  return (
                    <div
                      key={row.id}
                      className={`rounded-lg border p-3 text-sm transition ${
                        isReversed
                          ? "bg-muted/40 border-dashed"
                          : isReversal
                            ? "bg-amber-50/40 border-amber-200/60 dark:bg-amber-950/20"
                            : "bg-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">
                              {row.amount > 0 ? "+" : ""}
                              {formatCurrency(row.amount)}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {row.scope.replace("_", " ")}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {reasonLabel(row.reason)}
                            </Badge>
                            {isReversal && (
                              <Badge className="text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/30">
                                {t("app.expenses.adjustments.reversal")}
                              </Badge>
                            )}
                            {isReversed && (
                              <Badge variant="destructive" className="text-[10px]">
                                {t("app.expenses.adjustments.reversed")}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {row.notes}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                             {format(new Date(row.business_date), "PP")} · {t("app.expenses.adjustments.postedBy")}{" "}
                            <span className="font-medium">{nameOf(row.created_by)}</span>{" "}
                            <span title={new Date(row.created_at).toISOString()}>
                              {formatDistanceToNow(new Date(row.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </p>
                          {isReversed && (
                            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px]">
                              <div className="flex items-center gap-1 font-medium text-destructive">
                                <ShieldAlert className="h-3 w-3" />
                                 {t("app.expenses.adjustments.reversedBy", { name: nameOf(row.reversed_by) })} ·{" "}
                                {row.reversed_at &&
                                  formatDistanceToNow(new Date(row.reversed_at), {
                                    addSuffix: true,
                                  })}
                              </div>
                              {row.reversal_reason && (
                                <p className="mt-1 text-muted-foreground">
                                  “{row.reversal_reason}”
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        {!isReversed && !isReversal && row.ledger_posted && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 shrink-0"
                                onClick={() => setReverseTarget(row)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                 {t("app.expenses.adjustments.reverse")}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                               {t("app.expenses.adjustments.reverseHelp")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })}
              </TooltipProvider>
            </div>
          </ScrollArea>
        )}
      </CardContent>

      <Dialog
        open={!!reverseTarget}
        onOpenChange={(o) => {
          if (!o) {
            setReverseTarget(null);
            setReversalReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
               {t("app.expenses.adjustments.dialogTitle")}
            </DialogTitle>
            <DialogDescription>
               {t("app.expenses.adjustments.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          {reverseTarget && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div>
                 <span className="text-muted-foreground">{t("app.expenses.amount")}:</span>{" "}
                <span className="font-medium">
                  {formatCurrency(reverseTarget.amount)}
                </span>
              </div>
              <div>
                 <span className="text-muted-foreground">{t("app.expenses.date")}:</span>{" "}
                {format(new Date(reverseTarget.business_date), "PP")}
              </div>
              <div>
                 <span className="text-muted-foreground">{t("app.expenses.adjustments.reason")}:</span>{" "}
                {reasonLabel(reverseTarget.reason)}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-medium">
               {t("app.expenses.adjustments.reversalReason")} <span className="text-destructive">*</span>{" "}
               <span className="text-muted-foreground font-normal">{t("app.expenses.adjustments.minChars")}</span>
            </label>
            <Textarea
              rows={3}
              maxLength={500}
               placeholder={t("app.expenses.adjustments.reasonPlaceholder")}
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value.slice(0, 500))}
            />
             <p className="text-[11px] text-muted-foreground text-end">
              {reversalReason.trim().length}/500
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReverseTarget(null)}
              disabled={reverseMutation.isPending}
            >
               {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                reversalReason.trim().length < 10 || reverseMutation.isPending
              }
              onClick={() =>
                reverseTarget &&
                reverseMutation.mutate({
                  id: reverseTarget.id,
                  reason: reversalReason.trim(),
                })
              }
            >
              {reverseMutation.isPending && (
                 <Loader2 className="h-4 w-4 me-2 animate-spin" />
              )}
               {t("app.expenses.adjustments.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}