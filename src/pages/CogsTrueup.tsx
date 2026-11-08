import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Scale, Play, CheckCircle2, AlertTriangle, ArrowRight, Loader2, ShieldCheck, XCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { format as fmtDate } from "date-fns";
import { TrueupScheduler } from "@/components/cogs/TrueupScheduler";

type CheckSeverity = "ok" | "warn" | "fail";
type CheckResult = {
  id: string;
  label: string;
  severity: CheckSeverity;
  detail: string;
  blocking: boolean;
};

const VARIANCE_WARN_PCT = 0.25; // 25%
const VARIANCE_BLOCK_PCT = 0.5; // 50%

export default function CogsTrueup() {
  const { restaurant } = useAuth();
  const { format } = useCurrency();
  const qc = useQueryClient();
  const restaurantId = restaurant?.id;

  const [pickedKind, setPickedKind] = useState<"weekly" | "daily">("weekly");
  const [pickedStocktake, setPickedStocktake] = useState<string>("");
  const [correctWac, setCorrectWac] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [forceProceed, setForceProceed] = useState(false);

  // Stocktakes available to reconcile
  const { data: weekly = [] } = useQuery({
    queryKey: ["weekly-stocktakes-for-trueup", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("weekly_stocktakes")
        .select("id, stocktake_date, week_start_date, week_end_date, status, total_cogs")
        .eq("restaurant_id", restaurantId)
        .order("stocktake_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
  });

  const { data: daily = [] } = useQuery({
    queryKey: ["daily-stocktakes-for-trueup", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("stocktakes")
        .select("id, stocktake_date, status, total_variance_value")
        .eq("restaurant_id", restaurantId)
        .order("stocktake_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
  });

  // Past true-up runs
  const { data: runs = [], refetch } = useQuery({
    queryKey: ["cogs-trueup-runs", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("cogs_trueup_runs" as any)
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
  });

  const stocktakeOptions = pickedKind === "weekly" ? weekly : daily;

  // ---------- Pre-flight checklist ----------
  const { data: preflight, isFetching: preflightLoading } = useQuery<{
    checks: CheckResult[];
    summary: { provisional: number; actual: number; variancePct: number; pendingCount: number };
  } | null>({
    queryKey: ["cogs-trueup-preflight", restaurantId, pickedKind, pickedStocktake],
    enabled: !!restaurantId && !!pickedStocktake,
    queryFn: async () => {
      const checks: CheckResult[] = [];
      let periodStart: string | null = null;
      let periodEnd: string | null = null;
      let stStatus = "";
      let itemRows: Array<{ inventory_item_id: string; closing_qty?: number | null; closing_value?: number | null; counted_quantity?: number | null; consumption_value?: number | null; variance_value?: number | null }> = [];

      if (pickedKind === "weekly") {
        const { data, error } = await db
          .from("weekly_stocktakes")
          .select("status, week_start_date, week_end_date")
          .eq("id", pickedStocktake).single();
        if (error) throw error;
        stStatus = data.status ?? "draft";
        periodStart = data.week_start_date;
        periodEnd = data.week_end_date;
        const { data: items, error: ie } = await db
          .from("weekly_stocktake_items")
          .select("inventory_item_id, closing_qty, closing_value, consumption_value")
          .eq("stocktake_id", pickedStocktake);
        if (ie) throw ie;
        itemRows = items ?? [];
      } else {
        const { data, error } = await db
          .from("stocktakes")
          .select("status, stocktake_date").eq("id", pickedStocktake).single();
        if (error) throw error;
        stStatus = data.status ?? "draft";
        periodStart = data.stocktake_date;
        periodEnd = data.stocktake_date;
        const { data: items, error: ie } = await db
          .from("stocktake_items")
          .select("inventory_item_id, counted_quantity, variance_value")
          .eq("stocktake_id", pickedStocktake);
        if (ie) throw ie;
        itemRows = items ?? [];
      }

      // 1. Stocktake completeness (status)
      const okStatus = pickedKind === "weekly"
        ? ["submitted", "posted"].includes(stStatus)
        : stStatus === "completed";
      checks.push({
        id: "status",
        label: "Stocktake is completed",
        severity: okStatus ? "ok" : "fail",
        detail: okStatus
          ? `Status: ${stStatus}`
          : `Status is "${stStatus}". ${pickedKind === "weekly" ? "Submit or post" : "Complete"} the stocktake before reconciliation.`,
        blocking: true,
      });

      // 2. All items have counts
      const totalItems = itemRows.length;
      const missingCounts = pickedKind === "weekly"
        ? itemRows.filter((r) => r.closing_qty == null || r.closing_value == null).length
        : itemRows.filter((r) => r.counted_quantity == null).length;
      checks.push({
        id: "counts",
        label: "All items have physical counts",
        severity: totalItems === 0 ? "fail" : missingCounts === 0 ? "ok" : "fail",
        detail: totalItems === 0
          ? "Stocktake has no line items."
          : missingCounts === 0
            ? `${totalItems} items counted.`
            : `${missingCounts} of ${totalItems} items are missing counts.`,
        blocking: true,
      });

      // 3. WAC availability for referenced ingredients
      const ids = Array.from(new Set(itemRows.map((r) => r.inventory_item_id)));
      let missingWacIds: string[] = [];
      if (ids.length > 0) {
        const { data: invs, error: ive } = await db
          .from("inventory_items")
          .select("id, name, unit_cost")
          .in("id", ids);
        if (ive) throw ive;
        missingWacIds = (invs ?? []).filter((i: any) => !i.unit_cost || Number(i.unit_cost) <= 0).map((i: any) => i.id);
      }
      checks.push({
        id: "wac",
        label: "Weighted average cost available for all ingredients",
        severity: missingWacIds.length === 0 ? "ok" : missingWacIds.length <= 2 ? "warn" : "fail",
        detail: missingWacIds.length === 0
          ? "Every ingredient has a positive unit cost."
          : `${missingWacIds.length} ingredient(s) have no unit cost. Record a purchase or set a starting cost first.`,
        blocking: missingWacIds.length > 2,
      });

      // 4. Pending/posted provisional postings exist for the period
      const startTs = `${periodStart}T00:00:00Z`;
      const endTs = `${periodEnd}T23:59:59Z`;
      const { data: prov, error: pe } = await db
        .from("provisional_cogs_postings")
        .select("cogs_amount, status, is_negative_stock")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", startTs)
        .lte("created_at", endTs);
      if (pe) throw pe;
      const postedRows = (prov ?? []).filter((r: any) => r.status === "posted");
      const negStockCount = (prov ?? []).filter((r: any) => r.is_negative_stock).length;
      const provisionalTotal = postedRows.reduce((s: number, r: any) => s + Number(r.cogs_amount || 0), 0);
      checks.push({
        id: "provisional",
        label: "Provisional COGS postings exist for the period",
        severity: postedRows.length === 0 ? "fail" : "ok",
        detail: postedRows.length === 0
          ? "No posted provisional COGS rows in this period - nothing to reconcile."
          : `${postedRows.length} posted entries totaling ${format(provisionalTotal)}.`,
        blocking: postedRows.length === 0,
      });

      // 5. Negative-stock flags (warn only - allowed by policy)
      checks.push({
        id: "negstock",
        label: "Negative-stock entries reviewed",
        severity: negStockCount === 0 ? "ok" : "warn",
        detail: negStockCount === 0
          ? "No negative-stock provisional rows."
          : `${negStockCount} entries were posted with negative stock and will be re-valued.`,
        blocking: false,
      });

      // 6. Variance threshold
      const actualTotal = pickedKind === "weekly"
        ? itemRows.reduce((s, r) => s + Number(r.consumption_value || 0), 0)
        : itemRows.reduce((s, r) => s + Math.abs(Number(r.variance_value || 0)), 0);
      const variance = actualTotal - provisionalTotal;
      const variancePct = provisionalTotal > 0 ? Math.abs(variance) / provisionalTotal : 0;
      let vSev: CheckSeverity = "ok";
      let vBlock = false;
      let vDetail = `Variance ${variance >= 0 ? "+" : ""}${format(variance)} (${(variancePct * 100).toFixed(1)}%) within tolerance.`;
      if (provisionalTotal === 0) {
        vSev = "warn";
        vDetail = "Cannot evaluate variance, no provisional total.";
      } else if (variancePct > VARIANCE_BLOCK_PCT) {
        vSev = "fail"; vBlock = true;
        vDetail = `Variance ${(variancePct * 100).toFixed(1)}% exceeds ${VARIANCE_BLOCK_PCT * 100}% block threshold. Recount before posting, or override below.`;
      } else if (variancePct > VARIANCE_WARN_PCT) {
        vSev = "warn";
        vDetail = `Variance ${(variancePct * 100).toFixed(1)}% exceeds ${VARIANCE_WARN_PCT * 100}% warning threshold.`;
      }
      checks.push({
        id: "variance",
        label: "Variance within acceptable threshold",
        severity: vSev,
        detail: vDetail,
        blocking: vBlock,
      });

      return {
        checks,
        summary: { provisional: provisionalTotal, actual: actualTotal, variancePct, pendingCount: postedRows.length },
      };
    },
  });

  const blocking = (preflight?.checks ?? []).filter((c) => c.blocking && c.severity === "fail");
  const overridable = blocking.every((c) => c.id === "variance"); // only variance fail is overridable
  const canRun =
    !!pickedStocktake &&
    !preflightLoading &&
    !!preflight &&
    (blocking.length === 0 || (overridable && forceProceed));

  const reconcile = useMutation({
    mutationFn: async () => {
      if (!pickedStocktake) throw new Error("Pick a stocktake first.");
      const { data, error } = await db.rpc("reconcile_provisional_cogs" as any, {
        _stocktake_id: pickedStocktake,
        _kind: pickedKind,
        _correct_wac: correctWac,
        _reason: "Manual reconciliation",
      } as any);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Reconciliation complete");
      qc.invalidateQueries({ queryKey: ["cogs-trueup-runs", restaurantId] });
      setOpenRunId(id);
      refetch();
    },
    onError: (e: any) => toast.error(e.message ?? "Reconciliation failed"),
  });

  return (
    <>
      <div className="container mx-auto max-w-7xl py-5 md:py-7 space-y-5 md:space-y-6">
        <div className="flex items-center gap-3">
          <Scale className="h-7 w-7 text-primary" />
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight">COGS True-up</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Reconcile real-time provisional COGS (per sale) against your periodic stocktake
              and post the variance as a balanced adjustment journal.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Run a reconciliation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Stocktake type</Label>
                <Select value={pickedKind} onValueChange={(v) => { setPickedKind(v as any); setPickedStocktake(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Stocktake</Label>
                <Select value={pickedStocktake} onValueChange={setPickedStocktake}>
                  <SelectTrigger><SelectValue placeholder="Pick a stocktake to reconcile…" /></SelectTrigger>
                  <SelectContent>
                    {stocktakeOptions.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {pickedKind === "weekly"
                          ? `Week ${fmtDate(new Date(s.week_start_date), "MMM d")} – ${fmtDate(new Date(s.week_end_date ?? s.stocktake_date), "MMM d")} · ${format(Number(s.total_cogs ?? 0))}`
                          : `${fmtDate(new Date(s.stocktake_date), "MMM d, yyyy")} · variance ${format(Number(s.total_variance_value ?? 0))}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Re-base WAC to counted closing</div>
                <div className="text-xs text-muted-foreground">
                  When enabled, sets each ingredient's unit cost to closing_value ÷ closing_qty.
                  Negative-stock items are still allowed and not blocked.
                </div>
              </div>
              <Switch checked={correctWac} onCheckedChange={setCorrectWac} />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => reconcile.mutate()} disabled={!canRun || reconcile.isPending}>
                <Play className="h-4 w-4 mr-1.5" />
                {reconcile.isPending ? "Reconciling…" : "Run reconciliation"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {pickedStocktake && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Pre-flight checklist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {preflightLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Running checks…
                </div>
              )}
              {!preflightLoading && preflight?.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded-md border p-3">
                  {c.severity === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  ) : c.severity === "warn" ? (
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {c.label}
                      {c.blocking && c.severity === "fail" && (
                        <Badge variant="destructive" className="text-[10px]">Blocking</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{c.detail}</div>
                  </div>
                </div>
              ))}

              {!preflightLoading && preflight && blocking.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-3">
                  <Info className="h-4 w-4 text-destructive mt-0.5" />
                  <div className="flex-1 text-xs">
                    <div className="font-medium text-destructive">
                      {blocking.length} blocking issue{blocking.length === 1 ? "" : "s"} - execution disabled.
                    </div>
                    {overridable ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Switch checked={forceProceed} onCheckedChange={setForceProceed} id="force-proceed" />
                        <Label htmlFor="force-proceed" className="text-xs">
                          I acknowledge the variance and want to proceed anyway.
                        </Label>
                      </div>
                    ) : (
                      <div className="mt-1 text-muted-foreground">
                        Resolve the issues above (status, counts, WAC, or missing provisional postings) before running.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <TrueupScheduler />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Past runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No reconciliations yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Period end</TableHead>
                    <TableHead className="text-right">Provisional</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runs as any[]).map((r) => {
                    const variance = Number(r.total_variance);
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => setOpenRunId(r.id)}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {fmtDate(new Date(r.created_at), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{r.stocktake_kind}</Badge>
                          {r.wac_corrected && (
                            <Badge variant="secondary" className="text-[10px] ml-1">WAC re-based</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{r.period_end}</TableCell>
                        <TableCell className="text-right font-mono">{format(Number(r.total_provisional_cogs))}</TableCell>
                        <TableCell className="text-right font-mono">{format(Number(r.total_actual_cogs))}</TableCell>
                        <TableCell className={`text-right font-mono ${Math.abs(variance) < 0.01 ? "text-muted-foreground" : variance > 0 ? "text-amber-600" : "text-primary"}`}>
                          {variance > 0 ? "+" : ""}{format(variance)}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {r.items_with_variance}/{r.items_count}
                        </TableCell>
                        <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {openRunId && (
        <RunDetailsDialog runId={openRunId} onClose={() => setOpenRunId(null)} format={format} />
      )}
    </>
  );
}

function RunDetailsDialog({
  runId, onClose, format,
}: { runId: string; onClose: () => void; format: (n: number) => string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["cogs-trueup-adj", runId],
    queryFn: async () => {
      const { data, error } = await db
        .from("cogs_trueup_adjustments" as any)
        .select("*")
        .eq("trueup_run_id", runId)
        .order("variance", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const ids = useMemo(
    () => Array.from(new Set((rows as any[]).map((r) => r.inventory_item_id))),
    [rows]
  );
  const { data: invMap = {} } = useQuery({
    queryKey: ["cogs-trueup-adj-inv", ids],
    queryFn: async () => {
      if (!ids.length) return {};
      const { data, error } = await db
        .from("inventory_items").select("id, name, unit").in("id", ids);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r: any) => [r.id, r]));
    },
    enabled: ids.length > 0,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        description={`COGS true-up run ${runId.slice(0, 8)} - ${(rows as any[]).length} ingredient adjustment${(rows as any[]).length === 1 ? "" : "s"}.`}
        className="max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle>True-up details</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">Provisional</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Prev WAC → New WAC</TableHead>
                  <TableHead>Accounts (DR/CR)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows as any[]).map((r) => {
                  const v = Number(r.variance);
                  const inv = (invMap as any)[r.inventory_item_id];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {inv?.name ?? "-"} <span className="text-xs text-muted-foreground">{inv?.unit}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{format(Number(r.provisional_cogs))}</TableCell>
                      <TableCell className="text-right font-mono">{format(Number(r.actual_cogs))}</TableCell>
                      <TableCell className={`text-right font-mono ${Math.abs(v) < 0.01 ? "text-muted-foreground" : v > 0 ? "text-amber-600" : "text-primary"}`}>
                        {Math.abs(v) < 0.01 ? <CheckCircle2 className="inline h-3 w-3" /> : v > 0 ? <AlertTriangle className="inline h-3 w-3 mr-1" /> : null}
                        {v > 0 ? "+" : ""}{format(v)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {r.prev_wac != null ? Number(r.prev_wac).toFixed(4) : "-"}
                        {r.wac_corrected && r.new_wac != null && (
                          <> → <span className="text-primary">{Number(r.new_wac).toFixed(4)}</span></>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {r.cogs_account_code} / {r.inventory_account_code}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}