import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Zap } from "lucide-react";
import { format as formatDate, parseISO } from "date-fns";
import { useCurrency } from "@/hooks/useCurrency";
import {
  usePendingDailySalesPostings,
  useAutoPostDailySales,
} from "@/hooks/useAutoPostDailySales";

interface Props {
  date: Date;
  branchId: string | null;
  lookbackDays?: number;
}

/** Posts every closed day's net sales to the ledger in one click. */
export function AutoPostNetSalesButton({ date, branchId, lookbackDays = 60 }: Props) {
  const [open, setOpen] = useState(false);
  const { data: days, isLoading } = usePendingDailySalesPostings(date, branchId, lookbackDays);
  const autoPost = useAutoPostDailySales();
  const { format: formatCurrency } = useCurrency();

  const pending = days || [];
  const total = pending.reduce((s, d) => s + d.netSales, 0);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={isLoading}
        onClick={() => setOpen(true)}
      >
        <Zap className="h-4 w-4" />
        Auto-post
        {pending.length > 0 && (
          <Badge variant="secondary" className="ml-1">
            {pending.length}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="font-medium">Auto-post net sales</DialogTitle>
            <DialogDescription>
              Creates the ledger entries for each closed day's net sales in the last{" "}
              {lookbackDays} days
              {branchId ? " for the selected branch" : ""}.
            </DialogDescription>
          </DialogHeader>

          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Every closed day's net sales is already posted to the ledger.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{pending.length} day(s) pending</span>
                <span className="font-medium">{formatCurrency(total)}</span>
              </div>
              <ScrollArea className="max-h-[45vh] pr-3">
                <div className="space-y-1">
                  {pending.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>{formatDate(parseISO(d.salesDate), "MMM d, yyyy")}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {d.status}
                        </Badge>
                        <span className="font-medium">{formatCurrency(d.netSales)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              disabled={pending.length === 0 || autoPost.isPending}
              onClick={() =>
                autoPost.mutate(pending, {
                  onSuccess: ({ failures }) => {
                    if (failures.length === 0) setOpen(false);
                  },
                })
              }
            >
              {autoPost.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Post {pending.length} day(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
