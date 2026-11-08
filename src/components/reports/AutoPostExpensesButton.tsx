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
import { useCurrency } from "@/hooks/useCurrency";
import {
  usePendingExpensePostings,
  useAutoPostExpenses,
} from "@/hooks/useAutoPostExpenses";

interface Props {
  /** yyyy-MM-dd */
  fromDate: string | null;
  /** yyyy-MM-dd */
  toDate: string | null;
  branchId: string | null;
}

/** Posts every unposted approved expense of the period, grouped by category. */
export function AutoPostExpensesButton({ fromDate, toDate, branchId }: Props) {
  const [open, setOpen] = useState(false);
  const { data: categories, isLoading } = usePendingExpensePostings(fromDate, toDate, branchId);
  const autoPost = useAutoPostExpenses(branchId);
  const { format: formatCurrency } = useCurrency();

  const pending = categories || [];
  const total = pending.reduce((s, c) => s + c.total, 0);
  const entries = pending.reduce((s, c) => s + c.count, 0);

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
        Auto-post expenses
        {entries > 0 && (
          <Badge variant="secondary" className="ml-1">
            {entries}
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Post expenses to the ledger</DialogTitle>
            <DialogDescription>
              Every approved expense in this period that has not reached the general ledger yet,
              grouped by category.
            </DialogDescription>
          </DialogHeader>

          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              All expenses in this period are already posted.
            </p>
          ) : (
            <ScrollArea className="max-h-[45vh] pr-3">
              <div className="space-y-2">
                {pending.map((c) => (
                  <div
                    key={c.categoryId}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.categoryName}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.count} entr{c.count === 1 ? "y" : "ies"}
                      </p>
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrency(c.total)}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="sm:justify-between items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Total {formatCurrency(total)} · {entries} entries
            </span>
            <Button
              onClick={async () => {
                await autoPost.mutateAsync(pending);
                setOpen(false);
              }}
              disabled={pending.length === 0 || autoPost.isPending}
              className="gap-2"
            >
              {autoPost.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Post {pending.length} categor{pending.length === 1 ? "y" : "ies"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
