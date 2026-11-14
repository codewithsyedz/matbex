import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/useCurrency";
import type { SalaryCalendarRow, SalaryCycle } from "@/lib/salaryCalendar";

interface AutoPostPayrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycle?: SalaryCycle;
  rows: SalaryCalendarRow[];
  cycleIndex: number;
  restaurantId?: string;
  userId?: string;
}

export function AutoPostPayrollDialog({
  open,
  onOpenChange,
  cycle,
  rows,
  cycleIndex,
  restaurantId,
  userId,
}: AutoPostPayrollDialogProps) {
  const { format: fmt } = useCurrency();
  const queryClient = useQueryClient();
  const [postToLedger, setPostToLedger] = useState(true);

  const candidates = useMemo(() => {
    return rows
      .map((row) => ({ row, cell: row.cells[cycleIndex] }))
      .filter((c) => c.cell && c.cell.amount > 0 && !c.cell.isPaid);
  }, [rows, cycleIndex]);

  const total = candidates.reduce((sum, c) => sum + c.cell.amount, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId || !userId) throw new Error("Missing restaurant or user");
      if (!cycle) throw new Error("No cycle selected");
      const { db } = await import("@/integrations/db/client");

      let created = 0;
      let posted = 0;
      const failures: string[] = [];

      for (const { row, cell } of candidates) {
        const { data: inserted, error } = await db
          .from("payroll_records")
          .insert({
            restaurant_id: restaurantId,
            staff_id: row.staff.id,
            branch_id: row.staff.assigned_branch_id ?? null,
            amount: cell.amount,
            payment_date: format(cycle.paymentDate, "yyyy-MM-dd"),
            period_start: format(cycle.start, "yyyy-MM-dd"),
            period_end: format(cycle.end, "yyyy-MM-dd"),
            deductions: 0,
            bonus: 0,
            notes: `Auto-generated from Salary Calendar (${cell.payableDays}/30 days)`,
            created_by: userId,
          })
          .select("id")
          .single();

        if (error || !inserted) {
          failures.push(`${row.staff.name}: ${error?.message ?? "insert failed"}`);
          continue;
        }
        created += 1;

        if (postToLedger) {
          const { error: postError } = await db.rpc("post_payroll_to_ledger", {
            p_payroll_id: inserted.id,
          });
          if (postError) failures.push(`${row.staff.name}: ${postError.message}`);
          else posted += 1;
        }
      }

      return { created, posted, failures };
    },
    onSuccess: ({ created, posted, failures }) => {
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-journal"] });
      queryClient.invalidateQueries({ queryKey: ["salary-calendar-payroll"] });
      if (failures.length > 0) {
        toast.warning(`${created} record(s) created, ${failures.length} issue(s)`, {
          description: failures.slice(0, 3).join(" · "),
        });
      } else {
        toast.success(
          postToLedger
            ? `${created} payroll record(s) created, ${posted} posted to ledger`
            : `${created} payroll record(s) created`
        );
      }
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error("Auto-post failed", { description: error.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Auto-post {cycle?.label ?? "cycle"} payroll</DialogTitle>
          <DialogDescription>
            Creates a payroll record per employee for {cycle ? format(cycle.start, "dd MMM") : "—"} –{" "}
            {cycle ? format(cycle.end, "dd MMM yyyy") : "—"}, payable{" "}
            {cycle ? format(cycle.paymentDate, "dd MMM yyyy") : "—"}. Employees already paid for this
            cycle are skipped.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing to post — every employee in this view already has a payroll record for this cycle.
          </p>
        ) : (
          <ScrollArea className="max-h-[45vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map(({ row, cell }) => (
                  <TableRow key={row.staff.id}>
                    <TableCell>
                      <div className="font-medium">{row.staff.name}</div>
                      <div className="text-xs capitalize text-muted-foreground">{row.staff.role}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{cell.payableDays}/30</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(cell.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="post-ledger"
              checked={postToLedger}
              onCheckedChange={(v) => setPostToLedger(v === true)}
            />
            <Label htmlFor="post-ledger" className="text-sm font-normal">
              Post each record to the general ledger immediately
            </Label>
          </div>
          <span className="text-sm font-semibold tabular-nums">{fmt(total)}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || candidates.length === 0}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create {candidates.length} record{candidates.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AutoPostPayrollDialog;
