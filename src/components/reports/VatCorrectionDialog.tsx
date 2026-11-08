import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wand2, TriangleAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/integrations/db/client";
import { useState } from "react";

export interface VatCorrectionPlanLine {
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

export interface VatCorrectionPlan {
  ok: boolean;
  reason: string;
  batch_id: string;
  existing_correction_batch_id: string | null;
  branch_name: string | null;
  posting_date: string | null;
  vat_rate: number;
  gross_takings: number;
  revenue_current: number;
  vat_current: number;
  vat_target: number;
  revenue_target: number;
  delta: number;
  direction: "increase_vat" | "decrease_vat";
  narrative: string;
  lines: VatCorrectionPlanLine[];
}

const REASON_COPY: Record<string, string> = {
  already_corrected: "A correction entry has already been posted for this batch.",
  no_variance: "This posting already reconciles — nothing to correct.",
  no_revenue_legs: "No revenue lines were found on this batch, so no reclassification can be proposed.",
  no_branch_rate: "The branch has no VAT rate configured. Set it in Settings → Branches first.",
  missing_vat_account: "Account 2200 (VAT Payable) is missing or inactive in the chart of accounts.",
  batch_not_found: "The ledger batch could not be found.",
  forbidden: "You do not have access to this ledger batch.",
};

interface Props {
  batchId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fmt: (n: number) => string;
  canApply: boolean;
}

/**
 * Reviews and applies the suggested reclassification for a sale posting whose
 * output VAT does not match the revenue credited at the branch VAT rate.
 * Gross takings never change — only the revenue / VAT payable split.
 */
export function VatCorrectionDialog({ batchId, open, onOpenChange, fmt, canApply }: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const { data: plan, isLoading } = useQuery({
    queryKey: ["vat-posting-correction-plan", batchId],
    enabled: open && !!batchId,
    queryFn: async (): Promise<VatCorrectionPlan> => {
      const { data, error } = await (db as any).rpc("suggest_vat_posting_correction", {
        p_batch_id: batchId,
      });
      if (error) throw error;
      return data as VatCorrectionPlan;
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      const { data, error } = await (db as any).rpc("apply_vat_posting_correction", {
        p_batch_id: batchId,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      return data as { correction_batch_id: string };
    },
    onSuccess: () => {
      toast.success("Correction posted", {
        description: "Revenue and output VAT are now aligned for this posting.",
      });
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["vat-posting-integrity-scan"] });
      queryClient.invalidateQueries({ queryKey: ["vat-posting-integrity-incidents"] });
      queryClient.invalidateQueries({ queryKey: ["vat-posting-correction-plan"] });
      queryClient.invalidateQueries({ queryKey: ["vat-output-ledger"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not apply the correction"),
  });

  const lines = plan?.lines ?? [];
  const drTotal = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const crTotal = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Suggested correction
          </DialogTitle>
          <DialogDescription>
            Review the proposed reclassification before it is posted. Gross takings stay
            unchanged — only the split between sales revenue and output VAT is restated.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading || !plan ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !plan.ok ? (
            <Alert variant={plan.reason === "no_variance" ? "default" : "destructive"}>
              {plan.reason === "no_variance" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <TriangleAlert className="h-4 w-4" />
              )}
              <AlertTitle>No correction proposed</AlertTitle>
              <AlertDescription>
                {REASON_COPY[plan.reason] ?? plan.reason}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4 pb-2">
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{plan.posting_date}</Badge>
                  <span className="text-muted-foreground">{plan.branch_name}</span>
                  <Badge variant="outline">{Number(plan.vat_rate).toFixed(2)}% VAT</Badge>
                </div>
                <p className="mt-2 text-muted-foreground">{plan.narrative}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Figure label="Gross takings" value={fmt(Number(plan.gross_takings))} />
                <Figure
                  label="Net revenue"
                  value={`${fmt(Number(plan.revenue_current))} → ${fmt(Number(plan.revenue_target))}`}
                />
                <Figure
                  label="Output VAT"
                  value={`${fmt(Number(plan.vat_current))} → ${fmt(Number(plan.vat_target))}`}
                />
                <Figure
                  label="Adjustment"
                  value={fmt(Math.abs(Number(plan.delta)))}
                  tone={plan.direction === "increase_vat" ? "up" : "down"}
                />
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Proposed journal lines</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={`${l.account_id}-${i}`}>
                        <TableCell>
                          <span className="font-mono text-xs">{l.account_code}</span>{" "}
                          {l.account_name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(l.debit) ? fmt(Number(l.debit)) : ""}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(l.credit) ? fmt(Number(l.credit)) : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmt(drTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {fmt(crTotal)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {Math.abs(drTotal - crTotal) > 0.009 && (
                  <Alert variant="destructive" className="mt-3">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertTitle>Proposal is unbalanced</AlertTitle>
                    <AlertDescription>
                      Debits and credits differ — this correction cannot be applied.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="vat-correction-note" className="text-xs">
                  Note for the audit trail (optional)
                </Label>
                <Textarea
                  id="vat-correction-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. VAT omitted when the day was first posted"
                />
              </div>

              {!canApply && (
                <p className="text-xs text-muted-foreground">
                  Only owners and accountants can apply corrections.
                </p>
              )}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !plan?.ok ||
              !canApply ||
              apply.isPending ||
              Math.abs(drTotal - crTotal) > 0.009
            }
            onClick={() => apply.mutate()}
          >
            {apply.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Posting…
              </>
            ) : (
              "Apply correction"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-medium tabular-nums ${
          tone === "up" ? "text-emerald-600" : tone === "down" ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
