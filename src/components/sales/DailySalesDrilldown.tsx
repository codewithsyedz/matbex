import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronRight, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchReconciledSalesByDay } from "@/lib/reconciledSales";
import { useCurrency } from "@/hooks/useCurrency";

interface DailySalesDrilldownProps {
  restaurantId?: string;
  dateFrom: string;
  dateTo: string;
  branchId: string | null;
  /** When false, open (not yet closed) days are excluded from the listing/total. */
  includeOpenDays?: boolean;
}

/**
 * Per-day drill-down for the selected range so the displayed range total can be
 * traced back to each business day's subtotal (raw POS + adjustments -> closed total).
 */
export function DailySalesDrilldown({
  restaurantId,
  dateFrom,
  dateTo,
  branchId,
  includeOpenDays = true,
}: DailySalesDrilldownProps) {
  const [open, setOpen] = useState(false);
  const { format: formatCurrency } = useCurrency();

  const { data, isLoading } = useQuery({
    queryKey: ["sales-daily-drilldown", restaurantId, dateFrom, dateTo, branchId],
    queryFn: async () =>
      fetchReconciledSalesByDay({
        restaurantId: restaurantId as string,
        dateFrom,
        dateTo,
        branchId,
      }),
    enabled: !!restaurantId && !!dateFrom && !!dateTo && open,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const days = new Set<string>([
      ...data.perDay.keys(),
      ...data.rawTxByDay.keys(),
      ...data.summaryByDay.keys(),
      ...data.adjustmentsByDay.keys(),
    ]);
    return Array.from(days)
      .sort()
      .map((day) => {
        const closed = data.summaryByDay.has(day);
        const detail = data.summaryDetailByDay.get(day);
        return {
          day,
          closed,
          raw: data.rawTxByDay.get(day) || 0,
          adjustment: data.adjustmentsByDay.get(day) || 0,
          cash: detail?.cash || 0,
          card: detail?.card || 0,
          subtotal: data.perDay.get(day) || 0,
        };
      })
      .filter((r) => (includeOpenDays ? true : r.closed));
  }, [data, includeOpenDays]);

  const total = rows.reduce((s, r) => s + r.subtotal, 0);

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-4 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          Daily breakdown for selected range
        </span>
        <span className="text-xs text-muted-foreground">
          {dateFrom || "—"} → {dateTo || "—"}
        </span>
      </button>

      {open && (
        <div className="border-t">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading daily subtotals…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No sales days in this range.</p>
          ) : (
            <ScrollArea className="max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left font-medium p-3">Date</th>
                    <th className="text-right font-medium p-3">Raw POS</th>
                    <th className="text-right font-medium p-3 hidden sm:table-cell">Adjustments</th>
                    <th className="text-right font-medium p-3 hidden md:table-cell">Cash</th>
                    <th className="text-right font-medium p-3 hidden md:table-cell">Card</th>
                    <th className="text-right font-medium p-3">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.day} className="border-t">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span>{format(parseISO(r.day), "EEE, dd MMM")}</span>
                          <Badge variant={r.closed ? "secondary" : "outline"} className="text-[10px]">
                            {r.closed ? "Closed" : "Open"}
                          </Badge>
                        </div>
                      </td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(r.raw)}</td>
                      <td className="p-3 text-right tabular-nums hidden sm:table-cell">
                        {r.adjustment ? formatCurrency(r.adjustment) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums hidden md:table-cell">
                        {r.closed ? formatCurrency(r.cash) : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums hidden md:table-cell">
                        {r.closed ? formatCurrency(r.card) : "—"}
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums">
                        {formatCurrency(r.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td className="p-3 font-medium">
                      Total ({rows.length} {rows.length === 1 ? "day" : "days"}
                      {includeOpenDays ? "" : ", closed only"})
                    </td>
                    <td className="p-3" colSpan={4} />
                    <td className="p-3 text-right font-semibold tabular-nums">
                      {formatCurrency(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}

export default DailySalesDrilldown;