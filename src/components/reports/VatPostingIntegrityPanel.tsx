import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, TriangleAlert, Loader2, CheckCircle2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { VatCorrectionDialog } from "./VatCorrectionDialog";

interface Props {
  tenantId?: string | null;
  branchId: string;
  from: Date | null;
  to: Date | null;
  branchNameById: (id: string | null) => string;
  fmt: (n: number) => string;
  periodLabel: string;
  branchScopeLabel: string;
  canManage: boolean;
}

interface ScanRow {
  batch_id: string;
  branch_id: string | null;
  branch_name: string | null;
  posting_date: string;
  reference_number: string | null;
  description: string | null;
  vat_rate: number;
  revenue_credit: number;
  vat_recorded: number;
  vat_expected: number;
  variance: number;
}

/**
 * Posting integrity: every sale posting must credit output VAT that matches
 * the revenue credited at the branch's configured VAT rate. Mismatches are
 * logged, and can optionally block future postings entirely.
 */
export function VatPostingIntegrityPanel({
  tenantId,
  branchId,
  from,
  to,
  branchNameById,
  fmt,
  periodLabel,
  branchScopeLabel,
  canManage,
}: Props) {
  const queryClient = useQueryClient();
  const [toleranceDraft, setToleranceDraft] = useState<string | null>(null);
  const [correctionBatchId, setCorrectionBatchId] = useState<string | null>(null);

  const scopedBranch = branchId && branchId !== "all" && branchId !== "untagged" ? branchId : null;

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["vat-posting-integrity-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vat_posting_integrity_settings")
        .select("tenant_id, enforce, tolerance")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { tenant_id: tenantId, enforce: false, tolerance: 1 }) as {
        tenant_id: string;
        enforce: boolean;
        tolerance: number;
      };
    },
  });

  const saveSettings = useMutation({
    mutationFn: async (patch: { enforce?: boolean; tolerance?: number }) => {
      const { error } = await (supabase as any)
        .from("vat_posting_integrity_settings")
        .upsert(
          {
            tenant_id: tenantId,
            enforce: patch.enforce ?? settings?.enforce ?? false,
            tolerance: patch.tolerance ?? Number(settings?.tolerance ?? 1),
          },
          { onConflict: "tenant_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Posting integrity settings saved");
      queryClient.invalidateQueries({ queryKey: ["vat-posting-integrity-settings", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["vat-posting-integrity-scan"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save settings"),
  });

  const { data: scan, isLoading: scanLoading } = useQuery({
    queryKey: [
      "vat-posting-integrity-scan",
      tenantId,
      scopedBranch,
      from?.toISOString() ?? null,
      to?.toISOString() ?? null,
    ],
    enabled: !!tenantId && !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<ScanRow[]> => {
      const { data, error } = await (supabase as any).rpc("scan_sale_posting_vat_integrity", {
        p_tenant_id: tenantId,
        p_from: format(from!, "yyyy-MM-dd"),
        p_to: format(to!, "yyyy-MM-dd"),
        p_branch_id: scopedBranch,
      });
      if (error) throw error;
      return (data ?? []) as ScanRow[];
    },
  });

  const { data: incidents } = useQuery({
    queryKey: [
      "vat-posting-integrity-incidents",
      tenantId,
      scopedBranch,
      from?.toISOString() ?? null,
      to?.toISOString() ?? null,
    ],
    enabled: !!tenantId && !!from && !!to,
    staleTime: 60_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from("vat_posting_integrity_incidents")
        .select(
          "id, branch_id, posting_date, source, vat_rate, revenue_credit, vat_recorded, vat_expected, variance, was_blocked, details, created_at",
        )
        .eq("tenant_id", tenantId)
        .gte("posting_date", format(from!, "yyyy-MM-dd"))
        .lte("posting_date", format(to!, "yyyy-MM-dd"))
        .order("created_at", { ascending: false })
        .limit(100);
      if (scopedBranch) q = q.eq("branch_id", scopedBranch);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = scan ?? [];
  const totals = useMemo(
    () => ({
      count: rows.length,
      variance: rows.reduce((s, r) => s + Number(r.variance ?? 0), 0),
    }),
    [rows],
  );

  const tolerance = toleranceDraft ?? String(settings?.tolerance ?? 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Posting integrity — revenue vs output VAT
            </CardTitle>
            <CardDescription>
              {periodLabel} · {branchScopeLabel} · every sale posting is checked against the
              branch VAT rate
            </CardDescription>
          </div>
          <Badge variant={settings?.enforce ? "default" : "secondary"}>
            {settings?.enforce ? "Enforced — mismatches blocked" : "Warn only — mismatches logged"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {settingsLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="flex flex-wrap items-end gap-6 rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Switch
                id="vat-integrity-enforce"
                checked={!!settings?.enforce}
                disabled={!canManage || saveSettings.isPending}
                onCheckedChange={(v) => saveSettings.mutate({ enforce: v })}
              />
              <div>
                <Label htmlFor="vat-integrity-enforce" className="text-sm">
                  Block postings that fail the check
                </Label>
                <p className="text-xs text-muted-foreground">
                  When off, the mismatch is recorded as an incident but posting continues.
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vat-integrity-tolerance" className="text-xs">
                Allowed rounding tolerance
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="vat-integrity-tolerance"
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-9 w-32"
                  value={tolerance}
                  disabled={!canManage}
                  onChange={(e) => setToleranceDraft(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canManage || saveSettings.isPending || toleranceDraft === null}
                  onClick={() => {
                    const num = Number(toleranceDraft);
                    if (!isFinite(num) || num < 0) {
                      toast.error("Enter a valid tolerance amount");
                      return;
                    }
                    saveSettings.mutate({ tolerance: num });
                    setToleranceDraft(null);
                  }}
                >
                  {saveSettings.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Only owners and accountants can change these settings.
              </p>
            )}
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium mb-2">Existing postings that fail the check</h4>
          {scanLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !rows.length ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Every sale posting reconciles</AlertTitle>
              <AlertDescription>
                Output VAT matches the revenue credited at each branch's configured rate for{" "}
                {periodLabel.toLowerCase()}.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Alert variant="destructive" className="mb-3">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>
                  {totals.count} posting{totals.count === 1 ? "" : "s"} out of line
                </AlertTitle>
                <AlertDescription>
                  Net VAT variance of {fmt(totals.variance)} against the branch VAT rates.
                </AlertDescription>
              </Alert>
              <ScrollArea className="max-h-[360px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Revenue credit</TableHead>
                      <TableHead className="text-right">VAT expected</TableHead>
                      <TableHead className="text-right">VAT posted</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Fix</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.batch_id}>
                        <TableCell className="whitespace-nowrap">{r.posting_date}</TableCell>
                        <TableCell>{r.branch_name ?? branchNameById(r.branch_id)}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-muted-foreground">
                          {r.reference_number ?? r.description ?? r.batch_id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(r.vat_rate).toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(Number(r.revenue_credit))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(Number(r.vat_expected))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(Number(r.vat_recorded))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">
                          {fmt(Number(r.variance))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => setCorrectionBatchId(r.batch_id)}
                          >
                            <Wand2 className="h-3.5 w-3.5 mr-1" />
                            Suggest fix
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </>
          )}
        </div>

        {!!incidents?.length && (
          <div>
            <h4 className="text-sm font-medium mb-2">Integrity incident log</h4>
            <ScrollArea className="max-h-[280px]">
              <div className="space-y-2">
                {incidents.map((i) => (
                  <div key={i.id} className="rounded-md border p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={i.was_blocked ? "destructive" : "secondary"}>
                        {i.was_blocked ? "Blocked" : "Warned"}
                      </Badge>
                      <span className="font-medium">{i.posting_date}</span>
                      <span className="text-muted-foreground">
                        {branchNameById(i.branch_id)} · {i.source}
                      </span>
                      <span className="ml-auto tabular-nums text-destructive">
                        {fmt(Number(i.variance))}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{i.details}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
      <VatCorrectionDialog
        batchId={correctionBatchId}
        open={!!correctionBatchId}
        onOpenChange={(v) => !v && setCorrectionBatchId(null)}
        fmt={fmt}
        canApply={canManage}
      />
    </Card>
  );
}
