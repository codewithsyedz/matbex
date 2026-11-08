import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/integrations/db/client";

interface CorrectionLine {
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

interface InstallmentVatCorrection {
  ok: boolean;
  reason?: string;
  plan_label?: string;
  purchase_date?: string | null;
  batch_id?: string | null;
  existing_correction_batch_id?: string | null;
  goods_vat?: number;
  finance_vat?: number;
  expected_vat?: number;
  posted_vat?: number;
  delta?: number;
  direction?: "increase_input_vat" | "decrease_input_vat";
  narrative?: string;
  lines?: CorrectionLine[];
}

const REASON_COPY: Record<string, string> = {
  plan_not_found: "This installment plan no longer exists.",
  forbidden: "You do not have access to this installment plan.",
  no_batch: "This plan was never posted to the ledger, so there is nothing to reclassify.",
  no_variance: "The posted input VAT already matches this plan — nothing to correct.",
  already_corrected: "A correction has already been posted for this plan.",
  missing_vat_account:
    "No active Input VAT Recoverable account (1180-1182) was found in the chart of accounts.",
  missing_target_account:
    "The plan has no asset / cost account, so the offsetting leg cannot be determined.",
};

interface Props {
  planId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fmt: (n: number) => string;
  canApply: boolean;
}

/**
 * Reviews and applies the suggested reclassification for one installment
 * (BNPL) purchase whose recoverable input VAT does not match what was posted.
 * The purchase total never changes — only the split between the asset / cost
 * account and Input VAT Recoverable.
 */
export function InstallmentVatCorrectionDialog({
  planId,
  open,
  onOpenChange,
  fmt,
  canApply,
}: Props) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const { data: proposal, isLoading } = useQuery({
    queryKey: ["installment-vat-correction-plan", planId],
    enabled: open && !!planId,
    queryFn: async (): Promise<InstallmentVatCorrection> => {
      const { data, error } = await (db as any).rpc("suggest_installment_vat_correction", {
        p_plan_id: planId,
      });
      if (error) throw error;
      return data as InstallmentVatCorrection;
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      const { data, error } = await (db as any).rpc("apply_installment_vat_correction", {
        p_plan_id: planId,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      return data as { correction_batch_id: string };
    },
    onSuccess: () => {
      toast.success("Correction posted", {
        description: "Input VAT and the asset cost are now aligned for this plan.",
      });
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["vat-recoverable-recon"] });
      queryClient.invalidateQueries({ queryKey: ["installment-vat-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["installment-vat-correction-plan"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not apply the correction"),
  });

  const lines = proposal?.lines ?? [];
  const drTotal = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const crTotal = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Suggested input VAT correction
          </DialogTitle>
          <DialogDescription className="text-xs">
            {proposal?.plan_label ? `${proposal.plan_label} · ` : ""}
            {proposal?.purchase_date || ""} — reclassifies value between the asset / cost account
            and Input VAT Recoverable. The total value of the purchase is unchanged.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-2">
          {isLoading || !proposal ? (
            <Skeleton className="h-40 w-full" />
          ) : !proposal.ok ? (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>No correction proposed</AlertTitle>
              <AlertDescription className="text-xs">
                {REASON_COPY[proposal.reason ?? ""] ??
                  proposal.reason ??
                  "This plan cannot be corrected automatically."}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <Stat label="Goods VAT" value={fmt(Number(proposal.goods_vat ?? 0))} />
                <Stat label="Finance VAT" value={fmt(Number(proposal.finance_vat ?? 0))} />
                <Stat label="Expected input VAT" value={fmt(Number(proposal.expected_vat ?? 0))} />
                <Stat label="Posted to ledger" value={fmt(Number(proposal.posted_vat ?? 0))} />
              </div>

              <Alert>
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle className="flex items-center gap-2">
                  Gap {fmt(Math.abs(Number(proposal.delta ?? 0)))}
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {proposal.direction === "increase_input_vat"
                      ? "understated"
                      : "overstated"}
                  </Badge>
                </AlertTitle>
                <AlertDescription className="text-xs">{proposal.narrative}</AlertDescription>
              </Alert>

              <div>
                <p className="mb-1 text-xs font-medium">Proposed entries</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Account</TableHead>
                      <TableHead className="text-right text-xs">Debit</TableHead>
                      <TableHead className="text-right text-xs">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={`${l.account_id}-${i}`}>
                        <TableCell className="text-xs">
                          <span className="font-mono">{l.account_code}</span> {l.account_name}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {l.debit ? fmt(Number(l.debit)) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {l.credit ? fmt(Number(l.credit)) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="text-xs font-medium">Totals</TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {fmt(drTotal)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {fmt(crTotal)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Balanced adjustment — posted as an approved correction batch.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ivat-note" className="text-xs">
                  Note (optional)
                </Label>
                <Textarea
                  id="ivat-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why this correction is being applied"
                  className="text-xs"
                  rows={2}
                />
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!proposal?.ok || !canApply || apply.isPending}
            onClick={() => apply.mutate()}
          >
            {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default InstallmentVatCorrectionDialog;
