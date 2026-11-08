import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useCurrency } from "@/hooks/useCurrency";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarClock, Loader2 } from "lucide-react";

interface RecalcRow {
  payroll_id: string;
  staff_name: string;
  period_start: string;
  period_end: string;
  old_payment_date: string;
  new_payment_date: string;
  old_amount: number;
  new_amount: number;
  applied: boolean;
  skip_reason: string | null;
}

const fmtDate = (d: string | null) => (d ? format(new Date(d), "dd MMM yyyy") : "—");

export function PayrollScheduleRecalcDialog({ disabled }: { disabled?: boolean }) {
  const { restaurant } = useAuth();
  const { activeBranchId, isAllBranches } = useBranch();
  const { format: formatCurrency } = useCurrency();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [fromPeriod, setFromPeriod] = useState("");
  const [reprorate, setReprorate] = useState(true);
  const [preview, setPreview] = useState<RecalcRow[] | null>(null);

  const run = async (dryRun: boolean) => {
    if (!restaurant?.id) throw new Error("No restaurant selected");
    const { data, error } = await db.rpc("recalculate_payroll_payment_schedule", {
      p_restaurant_id: restaurant.id,
      p_from_period_start: fromPeriod || null,
      p_reprorate: reprorate,
      p_dry_run: dryRun,
      p_branch_id: isAllBranches ? null : activeBranchId,
    });
    if (error) throw error;
    return (data ?? []) as unknown as RecalcRow[];
  };

  const previewMutation = useMutation({
    mutationFn: () => run(true),
    onSuccess: (rows) => setPreview(rows),
    onError: (e: Error) => toast.error("Preview failed", { description: e.message }),
  });

  const applyMutation = useMutation({
    mutationFn: () => run(false),
    onSuccess: (rows) => {
      const changed = rows.filter((r) => r.applied).length;
      const skipped = rows.filter((r) => r.skip_reason).length;
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["staff-payables"] });
      toast.success(`Recalculated ${changed} payroll record${changed === 1 ? "" : "s"}`, {
        description: skipped > 0 ? `${skipped} skipped (locked periods)` : undefined,
      });
      setPreview(rows);
    },
    onError: (e: Error) => toast.error("Recalculation failed", { description: e.message }),
  });

  const changes = (preview ?? []).filter(
    (r) =>
      !r.skip_reason &&
      (r.old_payment_date !== r.new_payment_date || Number(r.old_amount) !== Number(r.new_amount))
  );
  const skipped = (preview ?? []).filter((r) => r.skip_reason);
  const busy = previewMutation.isPending || applyMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setPreview(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <CalendarClock className="h-4 w-4 mr-2" />
          Recalculate schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reset salaries to pay on the 1st</DialogTitle>
          <DialogDescription>
            Moves every payroll payment date to the 1st of the month after its pay period, and
            optionally re-prorates amounts from each staff member's joining (and termination) date.
            Locked pay periods are never touched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Apply from period start</Label>
            <Input
              type="date"
              className="h-9 w-[170px]"
              value={fromPeriod}
              onChange={(e) => {
                setFromPeriod(e.target.value);
                setPreview(null);
              }}
            />
            <p className="text-[11px] text-muted-foreground">Leave empty for all history</p>
          </div>
          <div className="flex items-center gap-2 pb-6">
            <Switch
              id="reprorate"
              checked={reprorate}
              onCheckedChange={(v) => {
                setReprorate(v);
                setPreview(null);
              }}
            />
            <Label htmlFor="reprorate" className="text-sm font-normal">
              Re-prorate amounts by joining date
            </Label>
          </div>
          <div className="pb-6">
            <Button variant="secondary" onClick={() => previewMutation.mutate()} disabled={busy}>
              {previewMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Preview
            </Button>
          </div>
        </div>

        {preview && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{changes.length} to change</Badge>
              <Badge variant="outline">{preview.length - changes.length - skipped.length} unchanged</Badge>
              {skipped.length > 0 && <Badge variant="destructive">{skipped.length} locked</Badge>}
            </div>
            <ScrollArea className="h-[min(360px,45vh)] w-full rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Payment date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((r) => (
                    <TableRow key={r.payroll_id}>
                      <TableCell className="font-medium">
                        {r.staff_name}
                        {r.skip_reason && (
                          <span className="block text-[11px] text-destructive">{r.skip_reason}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(r.period_start)} → {fmtDate(r.period_end)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.old_payment_date === r.new_payment_date ? (
                          fmtDate(r.old_payment_date)
                        ) : (
                          <>
                            <span className="line-through text-muted-foreground">
                              {fmtDate(r.old_payment_date)}
                            </span>{" "}
                            → <span className="font-medium">{fmtDate(r.new_payment_date)}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {Number(r.old_amount) === Number(r.new_amount) ? (
                          formatCurrency(Number(r.old_amount))
                        ) : (
                          <>
                            <span className="line-through text-muted-foreground">
                              {formatCurrency(Number(r.old_amount))}
                            </span>{" "}
                            <span className="font-medium">{formatCurrency(Number(r.new_amount))}</span>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        No payroll records match this range
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Close
          </Button>
          <Button
            onClick={() => applyMutation.mutate()}
            disabled={busy || !preview || changes.length === 0}
          >
            {applyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Apply to {changes.length} record{changes.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
