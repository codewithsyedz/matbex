import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, BookOpen, Loader2 } from "lucide-react";
import { format as formatDate } from "date-fns";
import {
  useDailyLedgerPosting,
  usePostDailyLedger,
  type DailyPostingItem,
} from "@/hooks/useDailyLedgerPosting";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  date: Date;
  branchId: string | null;
}

export function DailyProfitLedgerPanel({ date, branchId }: Props) {
  const { data: groups, isLoading } = useDailyLedgerPosting(date, branchId);
  const { postOne, postAll } = usePostDailyLedger(date, branchId);
  const { format: formatCurrency } = useCurrency();

  const allItems = (groups || []).flatMap((g) => g.items);
  const pending = allItems.filter((i) => !i.posted && !i.blockedReason);
  const blocked = allItems.filter((i) => !i.posted && i.blockedReason);
  const postedCount = allItems.filter((i) => i.posted).length;
  const busy = postAll.isPending || postOne.isPending;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            Ledger posting — {formatDate(date, "MMM d, yyyy")}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Post this day's sales, adjustments, overhead and expenses so the P&L appears in the
            financial reports.
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy || pending.length === 0}
          onClick={() => postAll.mutate(pending)}
        >
          {postAll.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Post day ({pending.length})
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing recorded for this day yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" /> {postedCount} posted
              </Badge>
              <Badge variant="outline">{pending.length} pending</Badge>
              {blocked.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <AlertCircle className="h-3 w-3 text-warning" /> {blocked.length} blocked
                </Badge>
              )}
            </div>

            <div className="space-y-4">
              {(groups || [])
                .filter((g) => g.items.length > 0)
                .map((group) => (
                  <div key={group.kind} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span>{group.title}</span>
                      <span>{formatCurrency(group.total)}</span>
                    </div>
                    <div className="divide-y rounded-md border">
                      {group.items.map((item: DailyPostingItem) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm truncate">{item.label}</p>
                            {item.blockedReason && !item.posted && (
                              <p className="text-xs text-warning">{item.blockedReason}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-sm tabular-nums">
                              {formatCurrency(item.amount)}
                            </span>
                            {item.posted ? (
                              <Badge variant="outline" className="gap-1 text-success">
                                <CheckCircle2 className="h-3 w-3" /> Posted
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy || !!item.blockedReason}
                                onClick={() => postOne.mutate(item)}
                              >
                                Post
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
